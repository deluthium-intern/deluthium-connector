const { ethers, network } = require("hardhat");

async function main() {
  const priceUpdater = process.env.PRICE_UPDATER;
  if (!priceUpdater) {
    throw new Error("PRICE_UPDATER environment variable is required");
  }

  console.log("Deploying DeluthiumOracle...");
  console.log(`  Network:       ${network.name}`);
  console.log(`  Price Updater: ${priceUpdater}`);

  const [deployer] = await ethers.getSigners();
  console.log(`  Deployer:      ${deployer.address}`);
  console.log(`  Balance:       ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`);

  const DeluthiumOracle = await ethers.getContractFactory("DeluthiumOracle");
  const oracle = await DeluthiumOracle.deploy(priceUpdater);
  await oracle.waitForDeployment();

  const oracleAddress = await oracle.getAddress();

  console.log("\nDeluthiumOracle deployed successfully!");
  console.log(`  Address: ${oracleAddress}`);
  console.log(`  Owner:   ${deployer.address}`);

  console.log("\nTo verify on block explorer, run:");
  console.log(`  npx hardhat verify --network ${network.name} ${oracleAddress} "${priceUpdater}"`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Deployment failed:", error);
    process.exit(1);
  });
