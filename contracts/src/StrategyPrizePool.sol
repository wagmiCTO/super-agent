// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title StrategyPrizePool
/// @notice The weekly prize of every strategy, held and paid out by a
/// contract rather than by the platform.
///
/// During a week anyone — in practice the platform, out of its builder fees —
/// funds a strategy's pool; players watch it grow. When the week is over, a
/// settler publishes the winners with the results they earned it on, and each
/// winner claims their share themselves. Once settled, nobody can take the
/// money back or change who won: the platform's only power is to publish a
/// list, in public, with the numbers anyone can check against the venue.
///
/// Amounts are in the collateral token's own units (AUSD, 6 decimals).
contract StrategyPrizePool {
    IERC20 public immutable token;
    address public owner;
    mapping(address => bool) public settlers;

    /// week => strategy => funded and not yet allocated
    mapping(uint64 => mapping(bytes32 => uint256)) public pool;
    mapping(uint64 => mapping(bytes32 => bool)) public settled;
    /// week => strategy => wallet => prize
    mapping(uint64 => mapping(bytes32 => mapping(address => uint256))) public prizes;
    mapping(uint64 => mapping(bytes32 => mapping(address => bool))) public claimed;

    event Funded(uint64 indexed week, bytes32 indexed strategy, address indexed from, uint256 amount, uint256 total);
    event Settled(uint64 indexed week, bytes32 indexed strategy, address[] winners, uint256[] amounts, int128[] pnls, uint256 carried);
    event Claimed(uint64 indexed week, bytes32 indexed strategy, address indexed wallet, uint256 amount);
    event SettlerSet(address indexed settler, bool allowed);
    event OwnerSet(address indexed owner);

    error NotOwner();
    error NotSettler();
    error WeekNotOver(uint64 week);
    error AlreadySettled(uint64 week, bytes32 strategy);
    error NotSettled(uint64 week, bytes32 strategy);
    error LengthMismatch();
    error ExceedsPool(uint256 wanted, uint256 available);
    error NothingToClaim();
    error TransferFailed();
    error ZeroAmount();

    /// Unix epoch is a Thursday; shifting by three days makes weeks start on Monday.
    uint64 private constant MONDAY_SHIFT = 3 days;

    constructor(IERC20 token_, address settler) {
        token = token_;
        owner = msg.sender;
        emit OwnerSet(msg.sender);
        if (settler != address(0)) {
            settlers[settler] = true;
            emit SettlerSet(settler, true);
        }
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlySettler() {
        if (!settlers[msg.sender]) revert NotSettler();
        _;
    }

    function setSettler(address settler, bool allowed) external onlyOwner {
        settlers[settler] = allowed;
        emit SettlerSet(settler, allowed);
    }

    function setOwner(address next) external onlyOwner {
        owner = next;
        emit OwnerSet(next);
    }

    /// @notice The week index a timestamp falls in; weeks start Monday 00:00 UTC.
    function weekOf(uint64 timestamp) public pure returns (uint64) {
        return (timestamp + MONDAY_SHIFT) / 1 weeks;
    }

    /// @notice The first second of a week index.
    function weekStart(uint64 week) public pure returns (uint64) {
        return week * 1 weeks - MONDAY_SHIFT;
    }

    /// @notice Adds to a strategy's pool for a week. The caller must have
    /// approved the amount. A settled week cannot be funded.
    function fund(uint64 week, bytes32 strategy, uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        if (settled[week][strategy]) revert AlreadySettled(week, strategy);
        if (!token.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        pool[week][strategy] += amount;
        emit Funded(week, strategy, msg.sender, amount, pool[week][strategy]);
    }

    /// @notice Publishes a week's winners once the week is over. Amounts must
    /// fit in the pool; what is not allocated carries over to the next week
    /// of the same strategy, so a quiet week does not lose its money.
    function settle(
        uint64 week,
        bytes32 strategy,
        address[] calldata winners,
        uint256[] calldata amounts,
        int128[] calldata pnls
    ) external onlySettler {
        if (week >= weekOf(uint64(block.timestamp))) revert WeekNotOver(week);
        if (settled[week][strategy]) revert AlreadySettled(week, strategy);
        if (winners.length != amounts.length || winners.length != pnls.length) revert LengthMismatch();
        uint256 total;
        for (uint256 i = 0; i < winners.length; i++) {
            total += amounts[i];
        }
        uint256 available = pool[week][strategy];
        if (total > available) revert ExceedsPool(total, available);
        for (uint256 i = 0; i < winners.length; i++) {
            prizes[week][strategy][winners[i]] += amounts[i];
        }
        uint256 carried = available - total;
        pool[week][strategy] = total;
        settled[week][strategy] = true;
        _carry(week, strategy, carried);
        emit Settled(week, strategy, winners, amounts, pnls, carried);
    }

    function _carry(uint64 week, bytes32 strategy, uint256 carried) internal {
        if (carried == 0) return;
        uint64 next = week + 1;
        pool[next][strategy] += carried;
        emit Funded(next, strategy, address(this), carried, pool[next][strategy]);
    }

    /// @notice Pays the caller their prize for a settled week.
    function claim(uint64 week, bytes32 strategy) external {
        if (!settled[week][strategy]) revert NotSettled(week, strategy);
        uint256 amount = prizes[week][strategy][msg.sender];
        if (amount == 0 || claimed[week][strategy][msg.sender]) revert NothingToClaim();
        claimed[week][strategy][msg.sender] = true;
        if (!token.transfer(msg.sender, amount)) revert TransferFailed();
        emit Claimed(week, strategy, msg.sender, amount);
    }

    /// @notice A wallet's prize and whether it was taken.
    function prizeOf(uint64 week, bytes32 strategy, address wallet) external view returns (uint256 amount, bool taken) {
        return (prizes[week][strategy][wallet], claimed[week][strategy][wallet]);
    }
}
