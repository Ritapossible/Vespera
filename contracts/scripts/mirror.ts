/**
 * Mirror real Chainlink rounds from Base mainnet into the Sepolia MockAggregators, keeping the
 * original answer and updatedAt. This lets the testnet deployment settle against real prices
 * over a real weekend. Disclosed trust assumption: on testnet, the mirror key could lie; on
 * mainnet the adapter reads Chainlink directly and there is no mirror.
 *
 *   MAINNET_RPC=https://mainnet.base.org DEPLOYER_PRIVATE_KEY=0x.. \
 *     npx hardhat run scripts/mirror.ts --network baseSepolia
 *
 * Runs once and exits; schedule it (cron / loop) every few minutes.
 */
import { ethers, network } from "hardhat";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MAINNET_FEEDS: Record<string, string> = {
  TSLA: "0xFaf869185383a24F8cb00e27BdA6b63B9905DCb4",
  NVDA: "0x04689a41629776563E6822F76f2e57D148d28513",
  MSTR: "0xB3cE282CD188b35DA0E38D8Bc7d58e33173D202a",
};
const ABI = [
  "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)",
  "function getRoundData(uint80) view returns (uint80,int256,uint256,uint256,uint80)",
];
const MAX_BACKFILL = 50n;

async function main() {
  const dep = JSON.parse(readFileSync(join(__dirname, `../deployments/${network.name}.json`), "utf8"));
  const mainnet = new ethers.JsonRpcProvider(process.env.MAINNET_RPC ?? "https://mainnet.base.org", 8453, { staticNetwork: true });

  for (const [ticker, s] of Object.entries<any>(dep.stocks)) {
    const src = new ethers.Contract(MAINNET_FEEDS[ticker], ABI, mainnet);
    const dst = await ethers.getContractAt("MockAggregator", s.feed);
    const latestLocal = await dst.latest();
    const lastTs = latestLocal === 0n ? 0 : Number((await dst.latestRoundData())[3]);

    const [rid] = await src.latestRoundData();
    // walk back to the first mainnet round newer than what we have (same phase only)
    const pending: { answer: bigint; ts: number }[] = [];
    for (let i = 0n; i < MAX_BACKFILL && (rid - i) & ((1n << 64n) - 1n); i++) {
      const r = await src.getRoundData(rid - i);
      if (Number(r[3]) <= lastTs) break;
      pending.push({ answer: r[1], ts: Number(r[3]) });
      if (lastTs === 0) break; // first run: just seed the latest round
    }
    pending.reverse();
    for (const p of pending) {
      await (await dst.pushRound(p.answer, p.ts)).wait();
      console.log(`${ticker}: pushed ${ethers.formatUnits(p.answer, 8)} @ ${new Date(p.ts * 1000).toISOString()}`);
    }
    if (!pending.length) console.log(`${ticker}: up to date`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
