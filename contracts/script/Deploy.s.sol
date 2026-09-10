// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IERC20, StrategyPrizePool} from "../src/StrategyPrizePool.sol";

/// Deploys the prize pool over the venue's collateral token with the
/// platform's settler as the first authorised publisher. The deployer owns it.
///
///   TOKEN=0x... SETTLER=0x... forge script script/Deploy.s.sol \
///     --rpc-url monad_testnet --private-key $DEPLOYER_KEY --broadcast
contract Deploy is Script {
    function run() external {
        address token = vm.envAddress("TOKEN");
        address settler = vm.envAddress("SETTLER");
        vm.startBroadcast();
        StrategyPrizePool pool = new StrategyPrizePool(IERC20(token), settler);
        vm.stopBroadcast();
        console.log("StrategyPrizePool deployed at", address(pool));
    }
}
