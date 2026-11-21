/**
 * Create the next weekend epoch and post rate cards from data/ratecard.json.
 *
 *   FRIDAY=2026-11-27 CUTOFF_ET=11:00 SELL_IN_MIN=10 \
 *     npx hardhat run scripts/epoch.ts --network baseSepolia
 *
 * Times follow the feed's observed schedule: close = Friday 20:00 ET, reopen = Sunday 20:00 ET.
 * The cutoff is before the cash close so nobody buys after the day's moves are known.
 */
import { ethers, network } from "hardhat";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function nyToUnix(y: number, m: number, d: number, hh: number, mm = 0): number {
  let t = Date.UTC(y, m - 1, d, hh, mm);
  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    }).formatToParts(new Date(t));
    const g = (k: string) => Number(parts.find((p) => p.type === k)!.value);
    const off = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute")) - t;
    t = Date.UTC(y, m - 1, d, hh, mm) - off;
  }
  return Math.floor(t / 1000);
}

async function main() {
  const dep = JSON.parse(readFileSync(join(__dirname, `../deployments/${network.name}.json`), "utf8"));
  const card = JSON.parse(readFileSync(join(__dirname, "../../data/ratecard.json"), "utf8"));
  const market = await ethers.getContractAt("VesperaMarket", dep.market);

  const [y, m, d] = (process.env.FRIDAY ?? "").split("-").map(Number);
  if (!y) throw new Error("set FRIDAY=YYYY-MM-DD");
  const [ch, cm] = (process.env.CUTOFF_ET ?? "11:00").split(":").map(Number);
  const now = Math.floor(Date.now() / 1000);
  const sellOpen = now + 60 * Number(process.env.SELL_IN_MIN ?? "10");
  const cutoff = nyToUnix(y, m, d, ch, cm);
  const close = nyToUnix(y, m, d, 20);
  const sun = new Date(Date.UTC(y, m - 1, d + 2));
  const reopen = nyToUnix(sun.getUTCFullYear(), sun.getUTCMonth() + 1, sun.getUTCDate(), 20);

  const tx = await market.createEpoch(sellOpen, cutoff, close, reopen);
  await tx.wait();
  const epochId = Number(await market.epochCount()) - 1;
  console.log(`epoch ${epochId}: sellOpen ${new Date(sellOpen * 1000).toISOString()} cutoff ${new Date(cutoff * 1000).toISOString()} close ${new Date(close * 1000).toISOString()} reopen ${new Date(reopen * 1000).toISOString()}`);

  for (const [ticker, s] of Object.entries<any>(dep.stocks)) {
    const bands = (card.stocks[ticker] ?? []).map((b: any) => ({ upperBps: b.upperBps, lowerBps: b.lowerBps, premiumBps: b.premiumBps }));
    if (!bands.length) continue;
    await (await market.postRateCard(epochId, s.stockId, bands)).wait();
    console.log(`  ${ticker}: ${bands.map((b: any) => `${b.upperBps}/${b.lowerBps}@${b.premiumBps}bps`).join("  ")}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
