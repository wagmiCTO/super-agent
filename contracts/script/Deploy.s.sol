// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {StrategyLeaderboard} from "../src/StrategyLeaderboard.sol";

/// Deploys the board with the platform's settler as the first authorised
/// writer. The deployer becomes the owner.
///
///   SETTLER=0x... forge script script/Deploy.s.sol --rpc-url monad_testnet \
///     --private-key $DEPLOYER_KEY --broadcast
contract Deploy is Script {
    function run() external {
        address settler = vm.envAddress("SETTLER");
        vm.startBroadcast();
        StrategyLeaderboard board = new StrategyLeaderboard(settler);
        vm.stopBroadcast();
        console.log("StrategyLeaderboard deployed at", address(board));
    }
}
