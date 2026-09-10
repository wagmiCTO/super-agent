// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {StrategyLeaderboard} from "../src/StrategyLeaderboard.sol";

contract StrategyLeaderboardTest is Test {
    StrategyLeaderboard board;
    address settler = address(0xA11CE);
    address alice = address(0xA);
    address bob = address(0xB);
    bytes32 constant DIRECTION = keccak256("direction");
    bytes32 constant MA_CROSS = keccak256("ma-cross");

    // Thursday 2026-09-10 12:00:00 UTC; its week starts Monday 2026-09-07.
    uint64 constant THU = 1789041600;
    uint64 constant MON = 1788739200;

    function setUp() public {
        board = new StrategyLeaderboard(settler);
    }

    function test_weeksStartOnMondayUTC() public view {
        uint64 week = board.weekOf(THU);
        assertEq(board.weekStart(week), MON);
        assertEq(board.weekOf(MON), week);
        assertEq(board.weekOf(MON - 1), week - 1);
        assertEq(board.weekOf(MON + 7 days - 1), week);
        assertEq(board.weekOf(MON + 7 days), week + 1);
    }

    function test_recordAggregatesByWalletAndStrategy() public {
        vm.startPrank(settler);
        board.recordTrade(DIRECTION, alice, 3_000000, THU, keccak256("t1"));
        board.recordTrade(DIRECTION, bob, -1_000000, THU + 60, keccak256("t2"));
        board.recordTrade(MA_CROSS, bob, 5_000000, THU + 120, keccak256("t3"));
        vm.stopPrank();

        uint64 week = board.weekOf(THU);
        (int128 pnl, uint64 trades) = board.totalOf(week, DIRECTION);
        assertEq(pnl, 2_000000);
        assertEq(trades, 2);
        (pnl, trades) = board.scoreOf(week, DIRECTION, alice);
        assertEq(pnl, 3_000000);
        assertEq(trades, 1);
        (pnl, trades) = board.scoreOf(week, MA_CROSS, bob);
        assertEq(pnl, 5_000000);
        assertEq(trades, 1);
        (pnl, trades) = board.totalOf(week - 1, DIRECTION);
        assertEq(pnl, 0);
        assertEq(trades, 0);
    }

    function test_refIsIdempotent() public {
        vm.startPrank(settler);
        board.recordTrade(DIRECTION, alice, 1, THU, keccak256("same"));
        vm.expectRevert(abi.encodeWithSelector(StrategyLeaderboard.AlreadyRecorded.selector, keccak256("same")));
        board.recordTrade(DIRECTION, alice, 1, THU, keccak256("same"));
        vm.stopPrank();
    }

    function test_onlySettlerRecords() public {
        vm.expectRevert(StrategyLeaderboard.NotSettler.selector);
        board.recordTrade(DIRECTION, alice, 1, THU, keccak256("x"));
        board.setSettler(address(this), true);
        board.recordTrade(DIRECTION, alice, 1, THU, keccak256("x"));
    }

    function test_onlyOwnerSetsSettler() public {
        vm.prank(alice);
        vm.expectRevert(StrategyLeaderboard.NotOwner.selector);
        board.setSettler(alice, true);
    }

    function test_batchRecordsAndChecksLengths() public {
        bytes32[] memory s = new bytes32[](2);
        address[] memory w = new address[](2);
        int128[] memory p = new int128[](2);
        uint64[] memory t = new uint64[](2);
        bytes32[] memory r = new bytes32[](2);
        s[0] = DIRECTION;
        s[1] = DIRECTION;
        w[0] = alice;
        w[1] = alice;
        p[0] = 2;
        p[1] = -1;
        t[0] = THU;
        t[1] = THU;
        r[0] = keccak256("b1");
        r[1] = keccak256("b2");
        vm.prank(settler);
        board.recordTrades(s, w, p, t, r);
        (int128 pnl, uint64 trades) = board.scoreOf(board.weekOf(THU), DIRECTION, alice);
        assertEq(pnl, 1);
        assertEq(trades, 2);

        bytes32[] memory short = new bytes32[](1);
        vm.prank(settler);
        vm.expectRevert(StrategyLeaderboard.LengthMismatch.selector);
        board.recordTrades(s, w, p, t, short);
    }

    function test_emitsTradeRecorded() public {
        uint64 week = board.weekOf(THU);
        vm.expectEmit(true, true, true, true);
        emit StrategyLeaderboard.TradeRecorded(week, DIRECTION, alice, 7, THU, keccak256("e"));
        vm.prank(settler);
        board.recordTrade(DIRECTION, alice, 7, THU, keccak256("e"));
    }
}
