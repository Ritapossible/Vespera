/**
 * Replay real weekends through the real contracts.
 *
 *   npm run replay:scan                       # weekends picked by the published scan rule
 *   WEEKENDS=MSTR:2026-11-13,TSLA:2026-11-06 REPLAY_START=2026-11-01 npx hardhat run scripts/replay.ts
 *   ALL=1 REPLAY_START=2026-08-01 npx hardhat run scripts/replay.ts     # every weekend (slow)
 *
 * Writes a JSON report to replays/<name>.json.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadWeekends, scan, replay, DEFAULT_REPLAY } from "./lib/replay";

async function main() {
  const all = loadWeekends(join(__dirname, "../../data/weekend-gaps.csv"));
  let selected = all;
  let name = "all";
  let rule: string | undefined;

  if (process.env.SCAN) {
    const s = scan(all);
    selected = [s.calm, s.drop];
    rule = s.rule;
    name = "scan";
    console.log(`scan rule: ${s.rule}`);
    console.log(`  drop: ${s.drop.ticker} weekend of ${s.drop.friday} (${(s.drop.gap * 100).toFixed(2)}%)`);
    console.log(`  calm: ${s.calm.ticker} weekend of ${s.calm.friday} (${(s.calm.gap * 100).toFixed(2)}%)`);
  } else if (process.env.WEEKENDS) {
    const want = process.env.WEEKENDS.split(",").map((x) => x.split(":"));
    selected = all.filter((w) => want.some(([t, f]) => t === w.ticker && f === w.friday));
    if (selected.length !== want.length) throw new Error("some WEEKENDS not found in data/weekend-gaps.csv");
    name = want.map(([t, f]) => `${t}-${f}`).join("_");
  } else if (!process.env.ALL) {
    throw new Error("set SCAN=1, WEEKENDS=TICKER:YYYY-MM-DD,... or ALL=1");
  }

  const reports = await replay(selected, all, { ...DEFAULT_REPLAY, log: console.log });
  const dir = join(__dirname, "../../replays");
  mkdirSync(dir, { recursive: true });
  const out = {
    generatedAt: new Date().toISOString(),
    rule,
    disclosure:
      "Real contracts and keeper on a local Hardhat chain started at a past date. Prices and timestamps are the real Base mainnet Chainlink rounds; the feed contract and USDC are mocks. Premiums are walk-forward (priced only from earlier weekends). Lending figures are illustrative, not Aave's parameters.",
    options: { ...DEFAULT_REPLAY, log: undefined },
    reports,
  };
  writeFileSync(join(dir, `${name}.json`), JSON.stringify(out, null, 2) + "\n");
  console.log(`\nwrote replays/${name}.json`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
