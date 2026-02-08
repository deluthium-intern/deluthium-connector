// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IOracle.sol";

contract DeluthiumOracle is IOracle, Ownable {
    struct PriceData {
        uint256 rate;
        uint256 weight;
        uint256 timestamp;
    }

    IERC20 public constant NONE = IERC20(0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF);

    address public priceUpdater;
    uint256 public maxPriceAge = 300;

    mapping(bytes32 => PriceData) public prices;

    event PriceUpdated(
        IERC20 indexed srcToken,
        IERC20 indexed dstToken,
        uint256 rate,
        uint256 weight,
        uint256 timestamp
    );
    event PriceUpdaterChanged(address indexed oldUpdater, address indexed newUpdater);
    event MaxPriceAgeChanged(uint256 oldAge, uint256 newAge);

    error UnauthorizedUpdater();
    error InvalidArrayLength();
    error ZeroAddress();

    modifier onlyPriceUpdater() {
        if (msg.sender != priceUpdater) revert UnauthorizedUpdater();
        _;
    }

    constructor(address _priceUpdater) Ownable(msg.sender) {
        if (_priceUpdater == address(0)) revert ZeroAddress();
        priceUpdater = _priceUpdater;
    }

    function updatePrice(
        IERC20 srcToken,
        IERC20 dstToken,
        uint256 rate,
        uint256 weight
    ) external onlyPriceUpdater {
        bytes32 key = _getPairKey(srcToken, dstToken);
        prices[key] = PriceData({
            rate: rate,
            weight: weight,
            timestamp: block.timestamp
        });
        emit PriceUpdated(srcToken, dstToken, rate, weight, block.timestamp);
    }

    function batchUpdatePrices(
        IERC20[] calldata srcTokens,
        IERC20[] calldata dstTokens,
        uint256[] calldata rates,
        uint256[] calldata weights
    ) external onlyPriceUpdater {
        uint256 length = srcTokens.length;
        if (length != dstTokens.length || length != rates.length || length != weights.length) {
            revert InvalidArrayLength();
        }

        uint256 ts = block.timestamp;

        for (uint256 i; i < length;) {
            bytes32 key = _getPairKey(srcTokens[i], dstTokens[i]);
            prices[key] = PriceData({
                rate: rates[i],
                weight: weights[i],
                timestamp: ts
            });
            emit PriceUpdated(srcTokens[i], dstTokens[i], rates[i], weights[i], ts);

            unchecked { ++i; }
        }
    }

    function getRate(
        IERC20 srcToken,
        IERC20 dstToken,
        IERC20 connector,
        uint256 thresholdFilter
    ) external view override returns (uint256 rate, uint256 weight) {
        if (connector != NONE) revert ConnectorShouldBeNone();

        bytes32 key = _getPairKey(srcToken, dstToken);
        PriceData memory data = prices[key];

        if (data.timestamp == 0 || block.timestamp - data.timestamp > maxPriceAge) {
            return (0, 0);
        }

        if (data.weight < thresholdFilter) {
            return (0, 0);
        }

        return (data.rate, data.weight);
    }

    function getPriceData(IERC20 srcToken, IERC20 dstToken) external view returns (PriceData memory) {
        bytes32 key = _getPairKey(srcToken, dstToken);
        return prices[key];
    }

    function isPriceFresh(IERC20 srcToken, IERC20 dstToken) external view returns (bool) {
        bytes32 key = _getPairKey(srcToken, dstToken);
        PriceData memory data = prices[key];
        if (data.timestamp == 0) return false;
        return block.timestamp - data.timestamp <= maxPriceAge;
    }

    function setPriceUpdater(address newUpdater) external onlyOwner {
        if (newUpdater == address(0)) revert ZeroAddress();
        address oldUpdater = priceUpdater;
        priceUpdater = newUpdater;
        emit PriceUpdaterChanged(oldUpdater, newUpdater);
    }

    function setMaxPriceAge(uint256 newAge) external onlyOwner {
        uint256 oldAge = maxPriceAge;
        maxPriceAge = newAge;
        emit MaxPriceAgeChanged(oldAge, newAge);
    }

    function _getPairKey(IERC20 srcToken, IERC20 dstToken) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(address(srcToken), address(dstToken)));
    }
}
