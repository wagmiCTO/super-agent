// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title StrategyLeaderboard
/// @notice The weekly board of every strategy, settled on-chain one trade at
/// a time so anyone can verify it against the venue instead of trusting the
/// platform's database.
///
/// The platform's settler records each closed round trip: which strategy, which
/// wallet, the realized result in collateral micros (6 decimals, fees
/// included) and when it closed. The contract aggregates by ISO week (Monday
/// 00:00 UTC), per wallet and per strategy. A `ref` — the hash of the venue's
/// order ids for the round trip — makes every record idempotent and lets a
/// reader tie it back to the exchange.
///
/// Thousands of small writes a minute is exactly the workload the chain is
/// built for; the board is never computed off-chain and pushed as a summary.
contract StrategyLeaderboard {
    struct Score {
        int128 pnl; // collateral micros, signed
        uint64 trades;
    }

    address public owner;
    mapping(address => bool) public settlers;

    /// week => strategy => wallet => score
    mapping(uint64 => mapping(bytes32 => mapping(address => Score))) public scores;
    /// week => strategy => aggregate over every wallet
    mapping(uint64 => mapping(bytes32 => Score)) public totals;
    /// every trade is recorded at most once
    mapping(bytes32 => bool) public recorded;

    event TradeRecorded(
        uint64 indexed week, bytes32 indexed strategy, address indexed wallet, int128 pnl, uint64 closedAt, bytes32 ref
    );
    event SettlerSet(address indexed settler, bool allowed);
    event OwnerSet(address indexed owner);

    error NotOwner();
    error NotSettler();
    error AlreadyRecorded(bytes32 ref);
    error LengthMismatch();

    /// Unix epoch is a Thursday; shifting by three days makes weeks start on Monday.
    uint64 private constant MONDAY_SHIFT = 3 days;

    constructor(address settler) {
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

    /// @notice Records one closed round trip.
    function recordTrade(bytes32 strategy, address wallet, int128 pnl, uint64 closedAt, bytes32 ref)
        external
        onlySettler
    {
        _record(strategy, wallet, pnl, closedAt, ref);
    }

    /// @notice Records several round trips in one transaction.
    function recordTrades(
        bytes32[] calldata strategy,
        address[] calldata wallet,
        int128[] calldata pnl,
        uint64[] calldata closedAt,
        bytes32[] calldata ref
    ) external onlySettler {
        uint256 n = strategy.length;
        if (wallet.length != n || pnl.length != n || closedAt.length != n || ref.length != n) revert LengthMismatch();
        for (uint256 i = 0; i < n; i++) {
            _record(strategy[i], wallet[i], pnl[i], closedAt[i], ref[i]);
        }
    }

    function _record(bytes32 strategy, address wallet, int128 pnl, uint64 closedAt, bytes32 ref) internal {
        if (recorded[ref]) revert AlreadyRecorded(ref);
        recorded[ref] = true;
        uint64 week = weekOf(closedAt);
        Score storage s = scores[week][strategy][wallet];
        s.pnl += pnl;
        s.trades += 1;
        Score storage t = totals[week][strategy];
        t.pnl += pnl;
        t.trades += 1;
        emit TradeRecorded(week, strategy, wallet, pnl, closedAt, ref);
    }

    /// @notice A wallet's line on a strategy's board for a week.
    function scoreOf(uint64 week, bytes32 strategy, address wallet) external view returns (int128 pnl, uint64 trades) {
        Score storage s = scores[week][strategy][wallet];
        return (s.pnl, s.trades);
    }

    /// @notice What a strategy made for everyone in a week.
    function totalOf(uint64 week, bytes32 strategy) external view returns (int128 pnl, uint64 trades) {
        Score storage t = totals[week][strategy];
        return (t.pnl, t.trades);
    }
}
