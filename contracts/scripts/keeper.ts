/**
 * Run the keeper against a deployment once, or forever with LOOP_SECONDS.
 *
 *   DEPLOYER_PRIVATE_KEY=0x.. [LOOP_SECONDS=120] [DRY_RUN=1] \
 *     npx hardhat run scripts/keeper.ts --network baseSepolia
 */
import { ethers, network } from "hardhat";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runKeeper } from "./lib/keeper";

async function main() {
  const dep = JSON.parse(readFileSync(join(__dirname, `../deployments/${network.name}.json`), "utf8"));
  const market = await ethers.getContractAt("VesperaMarket", dep.market);
  const adapter = await ethers.getContractAt("ChainlinkAdapter", dep.adapter);
  const loop = Number(process.env.LOOP_SECONDS ?? 0);
  const send = !process.env.DRY_RUN;

  do {
    const actions = await runKeeper(market as any, adapter as any, {
      send,
      log: (s) => console.log(`${new Date().toISOString()} ${s}`),
    });
    if (!actions.length) console.log(`${new Date().toISOString()} nothing to do`);
    if (!send) console.log(JSON.stringify(actions, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
    if (loop) await new Promise((r) => setTimeout(r, loop * 1000));
  } while (loop);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
