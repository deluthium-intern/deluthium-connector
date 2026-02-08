// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.19;

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
}

interface IRFQManager {
    struct MMQuote {
        address manager;
        address from;
        address to;
        address inputToken;
        address outputToken;
        uint256 amountIn;
        uint256 amountOut;
        uint256 deadline;
        uint256 nonce;
        bytes extraData;
    }
    function settle(MMQuote calldata quote, bytes calldata signature) external returns (uint256 outputAmount);
}

/**
 * @title DeluthiumParaswapPool
 * @notice Pool adapter that Augustus Swapper calls to execute swaps through
 *         Deluthium RFQ settlement. Only Augustus can invoke swap().
 * @dev Architecture:
 *   1. Augustus routes a swap to this contract via swap().
 *   2. This contract transfers input tokens from Augustus.
 *   3. It approves and calls the Deluthium RFQ Manager to settle the trade.
 *   4. The RFQ Manager returns the output tokens to this contract.
 *   5. This contract transfers output tokens to the beneficiary.
 */
contract DeluthiumParaswapPool {
    address public owner;
    address public augustusSwapper;
    address public rfqManager;
    address public wrappedNativeToken;
    bool public paused;

    address private constant NATIVE_TOKEN = address(0);

    event SwapExecuted(address indexed fromToken, address indexed toToken, uint256 fromAmount, uint256 toAmount, address indexed beneficiary);
    event OwnershipTransferred(address indexed prev, address indexed next_);
    event AugustusSwapperUpdated(address indexed prev, address indexed next_);
    event RFQManagerUpdated(address indexed prev, address indexed next_);
    event Paused(address account);
    event Unpaused(address account);
    event EmergencyWithdraw(address indexed token, uint256 amount, address indexed to);

    error OnlyOwner();
    error OnlyAugustus();
    error ContractPaused();
    error InvalidAddress();
    error InsufficientOutput(uint256 expected, uint256 received);
    error TransferFailed();
    error SwapFailed(string reason);
    error DeadlineExpired();

    modifier onlyOwner() { if (msg.sender != owner) revert OnlyOwner(); _; }
    modifier onlyAugustus() { if (msg.sender != augustusSwapper) revert OnlyAugustus(); _; }
    modifier whenNotPaused() { if (paused) revert ContractPaused(); _; }

    constructor(address _augustus, address _rfqManager, address _wrappedNative) {
        if (_augustus == address(0)) revert InvalidAddress();
        if (_rfqManager == address(0)) revert InvalidAddress();
        if (_wrappedNative == address(0)) revert InvalidAddress();
        owner = msg.sender;
        augustusSwapper = _augustus;
        rfqManager = _rfqManager;
        wrappedNativeToken = _wrappedNative;
    }

    /**
     * @notice Execute a swap through Deluthium RFQ settlement.
     * @param fromToken     Source token address
     * @param toToken       Destination token address
     * @param fromAmount    Amount of source token in wei
     * @param toAmount      Minimum output amount expected
     * @param beneficiary   Recipient of output tokens
     * @param rfqData       ABI-encoded (MMQuote, signature)
     * @return receivedAmount Actual amount of destination token received
     */
    function swap(
        address fromToken,
        address toToken,
        uint256 fromAmount,
        uint256 toAmount,
        address beneficiary,
        bytes calldata rfqData
    ) external onlyAugustus whenNotPaused returns (uint256 receivedAmount) {
        // Pull input tokens from Augustus
        if (fromToken != NATIVE_TOKEN) {
            if (!IERC20(fromToken).transferFrom(msg.sender, address(this), fromAmount))
                revert TransferFailed();
        }

        // Decode RFQ data
        (IRFQManager.MMQuote memory quote, bytes memory signature) =
            abi.decode(rfqData, (IRFQManager.MMQuote, bytes));

        if (block.timestamp > quote.deadline) revert DeadlineExpired();

        // Approve RFQ Manager to spend input tokens
        if (fromToken != NATIVE_TOKEN) {
            _safeApprove(fromToken, rfqManager, fromAmount);
        }

        // Snapshot output balance before settlement
        uint256 balBefore = _getBalance(toToken, address(this));

        // Settle via RFQ Manager
        try IRFQManager(rfqManager).settle(quote, signature) returns (uint256 out) {
            receivedAmount = out;
        } catch Error(string memory reason) {
            revert SwapFailed(reason);
        } catch {
            revert SwapFailed("RFQ settlement failed");
        }

        // Verify with balance diff
        uint256 balAfter = _getBalance(toToken, address(this));
        uint256 actualOut = balAfter - balBefore;
        if (actualOut > receivedAmount) receivedAmount = actualOut;
        if (receivedAmount < toAmount) revert InsufficientOutput(toAmount, receivedAmount);

        // Send output to beneficiary
        _transferOut(toToken, beneficiary, receivedAmount);
        emit SwapExecuted(fromToken, toToken, fromAmount, receivedAmount, beneficiary);
    }

    /// @notice Returns 0 -- actual pricing is determined off-chain via Deluthium API.
    function getRate(address, address, uint256) external pure returns (uint256) {
        return 0;
    }

    // ---- Admin Functions ----------------------------------------------------

    function setAugustusSwapper(address v) external onlyOwner {
        if (v == address(0)) revert InvalidAddress();
        emit AugustusSwapperUpdated(augustusSwapper, v);
        augustusSwapper = v;
    }

    function setRFQManager(address v) external onlyOwner {
        if (v == address(0)) revert InvalidAddress();
        emit RFQManagerUpdated(rfqManager, v);
        rfqManager = v;
    }

    function pause() external onlyOwner { paused = true; emit Paused(msg.sender); }
    function unpause() external onlyOwner { paused = false; emit Unpaused(msg.sender); }

    function transferOwnership(address v) external onlyOwner {
        if (v == address(0)) revert InvalidAddress();
        emit OwnershipTransferred(owner, v);
        owner = v;
    }

    function emergencyWithdraw(address token, uint256 amount, address to) external onlyOwner {
        if (to == address(0)) revert InvalidAddress();
        _transferOut(token, to, amount);
        emit EmergencyWithdraw(token, amount, to);
    }

    // ---- Internal Helpers ---------------------------------------------------

    function _safeApprove(address token, address spender, uint256 amt) internal {
        if (IERC20(token).allowance(address(this), spender) > 0) {
            IERC20(token).approve(spender, 0);
        }
        IERC20(token).approve(spender, amt);
    }

    function _getBalance(address token, address account) internal view returns (uint256) {
        return token == NATIVE_TOKEN ? account.balance : IERC20(token).balanceOf(account);
    }

    function _transferOut(address token, address to, uint256 amount) internal {
        if (token == NATIVE_TOKEN) {
            _sendNative(to, amount);
        } else {
            if (!IERC20(token).transfer(to, amount)) revert TransferFailed();
        }
    }

    /// @dev Send native currency to an address, reverts on failure.
    function _sendNative(address to, uint256 amount) internal {
        // solhint-disable-next-line avoid-low-level-calls
        (bool ok, ) = payable(to).call{ value: amount }("");
        if (!ok) revert TransferFailed();
    }

    /// @notice Accept native token deposits for native swaps.
    receive() external payable {}
}
