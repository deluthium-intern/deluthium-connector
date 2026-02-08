import { ethers, Contract, Wallet, JsonRpcProvider } from "ethers";

// --- Configuration ---

const ORACLE_ADDRESS = requireEnv("ORACLE_ADDRESS");
const PRIVATE_KEY = requireEnv("PRIVATE_KEY");
const RPC_URL = requireEnv("RPC_URL");
const DELUTHIUM_API_KEY = requireEnv("DELUTHIUM_API_KEY");
const DELUTHIUM_API_BASE_URL =
  process.env.DELUTHIUM_API_BASE_URL || "https://rfq-api.deluthium.ai";
const UPDATE_INTERVAL_MS = parseInt(
  process.env.UPDATE_INTERVAL_MS || "60000",
  10
);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// --- Oracle ABI (minimal) ---

const ORACLE_ABI = [
  "function batchUpdatePrices(address[] calldata srcTokens, address[] calldata dstTokens, uint256[] calldata rates, uint256[] calldata weights) external",
  "function getRate(address srcToken, address dstToken, address connector, uint256 thresholdFilter) external view returns (uint256 rate, uint256 weight)",
];

// --- Types ---

interface TradingPair {
  baseToken: string;
  quoteToken: string;
  baseDecimals: number;
  quoteDecimals: number;
}

interface IndicativeQuote {
  amountIn: string;
  amountOut: string;
  decimalsIn: number;
  decimalsOut: number;
}

// --- API Client ---

async function fetchListingPairs(): Promise<TradingPair[]> {
  const url = `${DELUTHIUM_API_BASE_URL}/v1/listing/pairs`;
  log("info", `Fetching listing pairs from ${url}`);

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${DELUTHIUM_API_KEY}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch listing pairs: ${response.status} ${response.statusText}`
    );
  }

  const data = (await response.json()) as { pairs: TradingPair[] };
  log("info", `Fetched ${data.pairs.length} trading pairs`);
  return data.pairs;
}

async function fetchIndicativeQuote(
  baseToken: string,
  quoteToken: string
): Promise<IndicativeQuote | null> {
  const url = `${DELUTHIUM_API_BASE_URL}/v1/quote/indicative`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${DELUTHIUM_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        baseToken,
        quoteToken,
      }),
    });

    if (!response.ok) {
      log(
        "warn",
        `Failed to get indicative quote for ${baseToken}/${quoteToken}: ${response.status}`
      );
      return null;
    }

    return (await response.json()) as IndicativeQuote;
  } catch (error) {
    log(
      "error",
      `Error fetching indicative quote for ${baseToken}/${quoteToken}: ${error}`
    );
    return null;
  }
}

// --- Rate Calculation ---

function calculateRate(quote: IndicativeQuote): bigint {
  const amountIn = BigInt(quote.amountIn);
  const amountOut = BigInt(quote.amountOut);

  if (amountIn === 0n) {
    return 0n;
  }

  // Normalize rate to 18 decimals:
  // rate = (amountOut * 10^18 * 10^decimalsIn) / (amountIn * 10^decimalsOut)
  const rate =
    (amountOut * 10n ** 18n * 10n ** BigInt(quote.decimalsIn)) /
    (amountIn * 10n ** BigInt(quote.decimalsOut));

  return rate;
}

// --- Logging ---

function log(level: "info" | "warn" | "error", message: string): void {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
  switch (level) {
    case "error":
      console.error(`${prefix} ${message}`);
      break;
    case "warn":
      console.warn(`${prefix} ${message}`);
      break;
    default:
      console.log(`${prefix} ${message}`);
  }
}

// --- Main Update Loop ---

async function updatePrices(oracle: Contract): Promise<void> {
  log("info", "Starting price update cycle");

  const pairs = await fetchListingPairs();

  if (pairs.length === 0) {
    log("warn", "No trading pairs found, skipping update");
    return;
  }

  const srcTokens: string[] = [];
  const dstTokens: string[] = [];
  const rates: bigint[] = [];
  const weights: bigint[] = [];

  for (const pair of pairs) {
    const quote = await fetchIndicativeQuote(pair.baseToken, pair.quoteToken);

    if (!quote) {
      continue;
    }

    const rate = calculateRate(quote);

    if (rate === 0n) {
      log(
        "warn",
        `Zero rate for ${pair.baseToken}/${pair.quoteToken}, skipping`
      );
      continue;
    }

    // Weight represents liquidity confidence — use amountIn as a proxy
    const weight = BigInt(quote.amountIn);

    srcTokens.push(pair.baseToken);
    dstTokens.push(pair.quoteToken);
    rates.push(rate);
    weights.push(weight);

    log(
      "info",
      `Pair ${pair.baseToken}/${pair.quoteToken}: rate=${rate.toString()}, weight=${weight.toString()}`
    );
  }

  if (srcTokens.length === 0) {
    log("warn", "No valid quotes obtained, skipping on-chain update");
    return;
  }

  log("info", `Submitting batch update for ${srcTokens.length} pairs`);

  try {
    const tx = await oracle.batchUpdatePrices(
      srcTokens,
      dstTokens,
      rates,
      weights
    );
    log("info", `Transaction submitted: ${tx.hash}`);

    const receipt = await tx.wait();
    log(
      "info",
      `Transaction confirmed in block ${receipt.blockNumber}, gas used: ${receipt.gasUsed.toString()}`
    );
  } catch (error) {
    log("error", `Failed to submit batch update: ${error}`);
    throw error;
  }
}

// --- Service Entrypoint ---

async function main(): Promise<void> {
  log("info", "Deluthium 1inch Price Updater starting...");
  log("info", `Oracle address: ${ORACLE_ADDRESS}`);
  log("info", `RPC URL: ${RPC_URL}`);
  log("info", `API base URL: ${DELUTHIUM_API_BASE_URL}`);
  log("info", `Update interval: ${UPDATE_INTERVAL_MS}ms`);

  const provider = new JsonRpcProvider(RPC_URL);
  const wallet = new Wallet(PRIVATE_KEY, provider);
  const oracle = new Contract(ORACLE_ADDRESS, ORACLE_ABI, wallet);

  log("info", `Updater wallet: ${wallet.address}`);

  const network = await provider.getNetwork();
  log("info", `Connected to chain ID: ${network.chainId}`);

  // Run first update immediately
  try {
    await updatePrices(oracle);
  } catch (error) {
    log("error", `Initial update failed: ${error}`);
  }

  // Schedule recurring updates
  const intervalId = setInterval(async () => {
    try {
      await updatePrices(oracle);
    } catch (error) {
      log("error", `Update cycle failed: ${error}`);
    }
  }, UPDATE_INTERVAL_MS);

  // Graceful shutdown
  const shutdown = (signal: string) => {
    log("info", `Received ${signal}, shutting down gracefully...`);
    clearInterval(intervalId);
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  log("info", "Price updater service is running");
}

main().catch((error) => {
  log("error", `Fatal error: ${error}`);
  process.exit(1);
});
