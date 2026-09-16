// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {TestToken} from "./TestToken.sol";
import {IERC20, StrategyPrizePool} from "../src/StrategyPrizePool.sol";

contract StrategyPrizePoolTest is Test {
    TestToken ausd;
    StrategyPrizePool pool;
    address settler = address(0xA11CE);
    address platform = address(0x9A7);
    address alice = address(0xA);
    address bob = address(0xB);
    bytes32 constant DIRECTION = keccak256("direction");

    // Thursday 2026-09-10 12:00:00 UTC, in week W; W ends Monday 2026-09-14 00:00 UTC.
    uint64 constant THU = 1789041600;
    uint64 constant NEXT_MON = 1789344000;

    function setUp() public {
        ausd = new TestToken();
        pool = new StrategyPrizePool(IERC20(address(ausd)), settler);
        ausd.mint(platform, 1_000_000000);
        vm.prank(platform);
        ausd.approve(address(pool), type(uint256).max);
        vm.warp(THU);
        wk = pool.weekOf(THU);
    }

    uint64 wk;

    function week() internal view returns (uint64) {
        return wk;
    }

    function test_fundGrowsThePool() public {
        vm.startPrank(platform);
        pool.fund(week(), DIRECTION, 10_000000);
        pool.fund(week(), DIRECTION, 5_000000);
        vm.stopPrank();
        assertEq(pool.pool(week(), DIRECTION), 15_000000);
        assertEq(ausd.balanceOf(address(pool)), 15_000000);
    }

    function test_cannotSettleBeforeTheWeekEnds() public {
        vm.prank(platform);
        pool.fund(week(), DIRECTION, 10_000000);
        address[] memory w = new address[](1);
        uint256[] memory a = new uint256[](1);
        int128[] memory p = new int128[](1);
        w[0] = alice;
        a[0] = 10_000000;
        vm.prank(settler);
        vm.expectRevert(abi.encodeWithSelector(StrategyPrizePool.WeekNotOver.selector, week()));
        pool.settle(week(), DIRECTION, w, a, p);
    }

    function test_settleThenClaim_andCarryOver() public {
        vm.prank(platform);
        pool.fund(week(), DIRECTION, 10_000000);
        vm.warp(NEXT_MON);

        address[] memory w = new address[](2);
        uint256[] memory a = new uint256[](2);
        int128[] memory p = new int128[](2);
        w[0] = alice;
        w[1] = bob;
        a[0] = 5_000000;
        a[1] = 3_000000;
        p[0] = 12_000000;
        p[1] = 4_000000;
        vm.prank(settler);
        pool.settle(week(), DIRECTION, w, a, p);

        assertTrue(pool.settled(week(), DIRECTION));
        // 2 AUSD unallocated carry into next week.
        assertEq(pool.pool(week() + 1, DIRECTION), 2_000000);

        vm.prank(alice);
        pool.claim(week(), DIRECTION);
        assertEq(ausd.balanceOf(alice), 5_000000);
        (uint256 amount, bool taken) = pool.prizeOf(week(), DIRECTION, alice);
        assertEq(amount, 5_000000);
        assertTrue(taken);

        vm.prank(alice);
        vm.expectRevert(StrategyPrizePool.NothingToClaim.selector);
        pool.claim(week(), DIRECTION);

        // The settler cannot settle twice, nor fund a settled week.
        vm.prank(settler);
        vm.expectRevert(abi.encodeWithSelector(StrategyPrizePool.AlreadySettled.selector, week(), DIRECTION));
        pool.settle(week(), DIRECTION, w, a, p);
        vm.prank(platform);
        vm.expectRevert(abi.encodeWithSelector(StrategyPrizePool.AlreadySettled.selector, week(), DIRECTION));
        pool.fund(week(), DIRECTION, 1);
    }

    /// Money is carried once: what week W did not pay reaches W+1, and if
    /// W+1 does not pay it either it is retained for the owner, not carried
    /// again. W+1's own contributions still travel on.
    function test_carriesOnlyOnce_thenRetains() public {
        vm.prank(platform);
        pool.fund(week(), DIRECTION, 10_000000);
        vm.warp(NEXT_MON);
        address[] memory none = new address[](0);
        uint256[] memory noAmounts = new uint256[](0);
        int128[] memory noPnls = new int128[](0);
        vm.prank(settler);
        pool.settle(week(), DIRECTION, none, noAmounts, noPnls);
        assertEq(pool.pool(week() + 1, DIRECTION), 10_000000);
        assertEq(pool.carriedIn(week() + 1, DIRECTION), 10_000000);

        // Week W+1 gathers 4 of its own and pays 3 of them to alice.
        vm.prank(platform);
        pool.fund(week() + 1, DIRECTION, 4_000000);
        vm.warp(NEXT_MON + 7 days);
        address[] memory w = new address[](1);
        uint256[] memory a = new uint256[](1);
        int128[] memory p = new int128[](1);
        w[0] = alice;
        a[0] = 3_000000;
        p[0] = 1_000000;
        vm.prank(settler);
        pool.settle(week() + 1, DIRECTION, w, a, p);
        // 11 left. The prize is paid out of the oldest money first, so all
        // 4 of the week's own travel on and 7 of the 10 that had already
        // travelled once are retained.
        assertEq(pool.pool(week() + 2, DIRECTION), 4_000000);
        assertEq(pool.retained(), 7_000000);
        assertEq(pool.pool(week() + 1, DIRECTION), 3_000000);

        vm.prank(alice);
        pool.claim(week() + 1, DIRECTION);
        assertEq(ausd.balanceOf(alice), 3_000000);

        // Only the owner sweeps, and only what was retained.
        vm.prank(settler);
        vm.expectRevert(StrategyPrizePool.NotOwner.selector);
        pool.sweep(settler);
        pool.sweep(bob);
        assertEq(ausd.balanceOf(bob), 7_000000);
        assertEq(pool.retained(), 0);
        vm.expectRevert(StrategyPrizePool.ZeroAmount.selector);
        pool.sweep(bob);
        // The travelling 4 are still there for week W+2.
        assertEq(ausd.balanceOf(address(pool)), 4_000000);
    }

    function test_cannotAllocateMoreThanThePool() public {
        vm.prank(platform);
        pool.fund(week(), DIRECTION, 1_000000);
        vm.warp(NEXT_MON);
        address[] memory w = new address[](1);
        uint256[] memory a = new uint256[](1);
        int128[] memory p = new int128[](1);
        w[0] = alice;
        a[0] = 2_000000;
        vm.prank(settler);
        vm.expectRevert(abi.encodeWithSelector(StrategyPrizePool.ExceedsPool.selector, 2_000000, 1_000000));
        pool.settle(week(), DIRECTION, w, a, p);
    }

    function test_onlySettlerSettles_onlyOwnerAppoints() public {
        vm.warp(NEXT_MON);
        address[] memory w;
        uint256[] memory a;
        int128[] memory p;
        vm.prank(alice);
        vm.expectRevert(StrategyPrizePool.NotSettler.selector);
        pool.settle(week(), DIRECTION, w, a, p);
        vm.prank(alice);
        vm.expectRevert(StrategyPrizePool.NotOwner.selector);
        pool.setSettler(alice, true);
    }

    function test_claimBeforeSettleFails() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(StrategyPrizePool.NotSettled.selector, week(), DIRECTION));
        pool.claim(week(), DIRECTION);
    }
}
