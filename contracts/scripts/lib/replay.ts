/**
 * Replay harness: runs real historical weekends through the real contracts and the real keeper.
 *
 * - Prices: the actual mainnet Chainlink rounds (R = last before close, S = first after reopen)
 *   from data/weekend-gaps.csv, pushed into a MockAggregator with their original timestamps.
 * - Time: the chain is started at a past date (Hardhat `initialDate`, env REPLAY_START), so every
 *   epoch runs at its real wall-clock times. Nothing is shifted.
 * - Pricing: walk-forward. A weekend's rate card uses only weekends *before* it — no lookahead.
 * - Settlement: done by the same keeper that runs on testnet.
 *
 * What is NOT real: the feed contract is a mock (the prices and timestamps are real), USDC is a
 * mock, and the lending position used for the health-factor comparison is illustrative.
 */
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { readFileSync } from "node:fs";
import { runKeeper } from "./keeper";
import { quoteBand, DEFAULT_PARAMS, PricingParams } from "../../../packages/pricing/src/ratecard";

// ------------------------------------------------------------------ data

export type Weekend = {
  ticker: string;
  friday: string; // YYYY-MM-DD
  close: number;
  reopen: number;
  refTs: number;
  refPrice: bigint; // 8 dp
  setTs: number;
  setPrice: bigint; // 8 dp
  gap: number;
};

const unix = (iso: string) => Math.floor(Date.parse(iso) / 1000);

export function loadWeekends(csvPath: string): Weekend[] {
  const [head, ...lines] = readFileSync(csvPath, "utf8").trim().split("\n");
  const h = head.split(",");
  const col = (c: string[], k: string) => c[h.indexOf(k)];
  return lines.map((l) => {
    const c = l.split(",");
    return {
      ticker: col(c, "ticker"),
      friday: col(c, "friday"),
      close: unix(col(c, "close_utc")),
      reopen: unix(col(c, "reopen_utc")),
      refTs: unix(col(c, "ref_ts")),
      refPrice: ethers.parseUnits(col(c, "ref_price"), 8),
      setTs: unix(col(c, "set_ts")),
      setPrice: ethers.parseUnits(col(c, "set_price"), 8),
      gap: Number(col(c, "gap")),
    };
  });
}

// ------------------------------------------------------------------ scan mode

/** Pick demo weekends by a fixed, published rule instead of by hand:
 *   drop = the weekend with the most negative gap across all stocks
 *   calm = the same stock's weekend with the smallest absolute gap                       */
export function scan(all: Weekend[]) {
  const drop = all.reduce((a, b) => (b.gap < a.gap ? b : a));
  const same = all.filter((w) => w.ticker === drop.ticker && w.friday !== drop.friday);
  const calm = same.reduce((a, b) => (Math.abs(b.gap) < Math.abs(a.gap) ? b : a));
  const rule =
    "drop = most negative weekend gap across all stocks in data/weekend-gaps.csv; " +
    "calm = smallest |gap| for the same stock";
  return { drop, calm, rule };
}

// ------------------------------------------------------------------ replay

export type ReplayOptions = {
  bands: { upperBps: number; lowerBps: number }[];
  notionalUsdc: number; // per position
  vaultUsdc: number; // writer capital per stock
  pricing: PricingParams;
  /** Illustrative lending position for the health-factor view (NOT Aave's real parameters). */
  borrower: { liquidationThreshold: number; healthFactorFriday: number };
  log?: (s: string) => void;
};

export const DEFAULT_REPLAY: ReplayOptions = {
  bands: [
    { upperBps: 9700, lowerBps: 8500 },
    { upperBps: 9900, lowerBps: 9500 },
  ],
  notionalUsdc: 10_000,
  vaultUsdc: 100_000,
  pricing: DEFAULT_PARAMS,
  borrower: { liquidationThreshold: 0.7, healthFactorFriday: 1.03 },
};

export type PositionReport = {
  upperBps: number;
  lowerBps: number;
  premiumBps: number;
  premiumUsdc: number;
  maxPayoutUsdc: number;
  payoutUsdc: number;
  pricedFromWeekends: number;
};

export type WeekendReport = {
  ticker: string;
  friday: string;
  close: string;
  reopen: string;
  R: { round: string; at: string; price: number };
  S: { round: string; at: string; price: number } | null;
  gapPct: number;
  outcome: "settled" | "voided";
  positions: PositionReport[];
  writerPnlUsdc: number;
  lending: {
    note: string;
    healthFactorFriday: number;
    healthFactorAtReopen: number;
    liquidatableAtReopen: boolean;
    protectedHealthFactorEstimate: number; // if the first band's payout repaid debt
    liquidatableIfProtected: boolean;
  };
};

const ny = (t: number) =>
  new Date(t * 1000).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" }) + " ET";

function nyToUnix(y: number, m: number, d: number, hh: number, mm = 0): number {
  let t = Date.UTC(y, m - 1, d, hh, mm);
  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    }).formatToParts(new Date(t));
    const g = (k: string) => Number(parts.find((p) => p.type === k)!.value);
    t = Date.UTC(y, m - 1, d, hh, mm) - (Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute")) - t);
  }
  return Math.floor(t / 1000);
}

const usd = (x: bigint) => Number(ethers.formatUnits(x, 6));

/**
 * Replay `selected` weekends (any stocks) in chronological order through one deployment.
 * `history` is the full dataset, used for walk-forward pricing.
 */
export async function replay(selected: Weekend[], history: Weekend[], o: ReplayOptions = DEFAULT_REPLAY) {
  const log = o.log ?? (() => {});
  const [deployer, writer, buyer] = await ethers.getSigners();
  const tickers = [...new Set(selected.map((w) => w.ticker))];
  const fridays = [...new Set(selected.map((w) => w.friday))].sort();

  // chain must start before the first sales window
  const firstSellOpen = Math.min(...fridays.map((f) => salesWindow(f).sellOpen));
  const now = await time.latest();
  if (now >= firstSellOpen) {
    const d = new Date((firstSellOpen - 3 * 86400) * 1000).toISOString().slice(0, 10);
    throw new Error(`Chain time is after the first replayed weekend. Run with REPLAY_START=${d} (or earlier).`);
  }

  // ---- deploy
  const usdc = await ethers.deployContract("MockUSDC");
  const adapter = await ethers.deployContract("ChainlinkAdapter", [deployer.address]);
  const market = await ethers.deployContract("VesperaMarket", [
    await usdc.getAddress(), await adapter.getAddress(), deployer.address, 5000, ethers.parseUnits("10", 6),
  ]);
  const stocks: Record<string, { id: number; feed: any; vault: any }> = {};
  for (const [i, t] of tickers.entries()) {
    const feed = await ethers.deployContract("MockAggregator", [8, deployer.address]);
    const token = await ethers.deployContract("MockB20", [`${t} (replay)`, `${t}c`, deployer.address]);
    await adapter.setSource(i, await feed.getAddress(), await token.getAddress());
    const vault = await ethers.deployContract("VesperaVault", [
      await usdc.getAddress(), await market.getAddress(), i, `Vespera ${t} writers`, `v${t}`,
    ]);
    await market.listStock(i, await vault.getAddress());
    await usdc.mint(writer.address, ethers.parseUnits(String(o.vaultUsdc), 6));
    await usdc.connect(writer).approve(await vault.getAddress(), ethers.MaxUint256);
    await vault.connect(writer).deposit(ethers.parseUnits(String(o.vaultUsdc), 6), writer.address);
    stocks[t] = { id: i, feed, vault };
  }
  await usdc.mint(buyer.address, ethers.parseUnits("100000000", 6));
  await usdc.connect(buyer).approve(await market.getAddress(), ethers.MaxUint256);
  const keeper = () => runKeeper(market as any, adapter as any, { log: (s) => log(`  keeper: ${s}`) });

  const reports: WeekendReport[] = [];
  for (const friday of fridays) {
    const wks = selected.filter((w) => w.friday === friday);
    const win = salesWindow(friday);
    if (wks.some((w) => w.close !== win.close || w.reopen !== win.reopen)) {
      throw new Error(`dataset window for ${friday} does not match Fri/Sun 20:00 ET`);
    }
    log(`\n=== weekend of ${friday}: sales ${ny(win.sellOpen)} → ${ny(win.cutoff)}, close ${ny(win.close)}, reopen ${ny(win.reopen)}`);

    // ---- epoch + walk-forward rate cards
    await market.createEpoch(win.sellOpen, win.cutoff, win.close, win.reopen);
    const epochId = Number(await market.epochCount()) - 1;
    const quotes: Record<string, ReturnType<typeof quoteBand>[]> = {};
    for (const w of wks) {
      const past = history.filter((h) => h.ticker === w.ticker && h.friday < friday).map((h) => h.gap);
      quotes[w.ticker] = o.bands.map((b) => quoteBand(past, b.upperBps, b.lowerBps, o.pricing));
      await market.postRateCard(epochId, stocks[w.ticker].id, quotes[w.ticker].map((q) => ({
        upperBps: q.upperBps, lowerBps: q.lowerBps, premiumBps: q.premiumBps,
      })));
    }

    // ---- Friday: buy one position per band per stock
    await time.increaseTo(win.sellOpen);
    const ids: Record<string, bigint[]> = {};
    const notional = ethers.parseUnits(String(o.notionalUsdc), 6);
    for (const w of wks) {
      ids[w.ticker] = [];
      for (let b = 0; b < o.bands.length; b++) {
        await market.connect(buyer).buy(epochId, stocks[w.ticker].id, b, notional, ethers.MaxUint256);
        ids[w.ticker].push((await market.nextPositionId()) - 1n);
      }
      log(`  ${w.ticker}: bought ${o.bands.map((b, i) => `${b.upperBps / 100}%→${b.lowerBps / 100}% @ ${quotes[w.ticker][i].premiumBps}bps`).join(", ")}`);
    }

    // ---- the feed's last Friday print (real round, real timestamp), then close
    await time.increaseTo(Math.max(win.cutoff, ...wks.map((w) => w.refTs)) + 1);
    for (const w of wks) await stocks[w.ticker].feed.pushRound(w.refPrice, w.refTs);
    await time.increaseTo(win.close + 60);
    await keeper();

    // ---- the feed resumes: first real round after reopen
    const lastSet = Math.max(...wks.map((w) => w.setTs));
    await time.increaseTo(lastSet + 1);
    for (const w of wks) await stocks[w.ticker].feed.pushRound(w.setPrice, w.setTs);
    await time.increaseTo(lastSet + 60);
    const balBefore: Record<string, bigint> = {};
    for (const w of wks) balBefore[w.ticker] = await usdc.balanceOf(await stocks[w.ticker].vault.getAddress());
    await keeper(); // settle
    await keeper(); // redeem

    // ---- report
    for (const w of wks) {
      const st = stocks[w.ticker];
      const bk = await market.book(epochId, st.id);
      const settled = Number(bk.status) === 2;
      const positions: PositionReport[] = [];
      for (const [i, id] of ids[w.ticker].entries()) {
        const p = await market.position(id);
        const ev = (await market.queryFilter(market.filters.Redeemed(id)))[0] as any;
        positions.push({
          upperBps: o.bands[i].upperBps,
          lowerBps: o.bands[i].lowerBps,
          premiumBps: quotes[w.ticker][i].premiumBps,
          premiumUsdc: usd(p.premium),
          maxPayoutUsdc: usd(p.maxPayout),
          payoutUsdc: usd(ev.args.payout),
          pricedFromWeekends: quotes[w.ticker][i].stats.n,
        });
      }
      const premiums = positions.reduce((a, p) => a + p.premiumUsdc, 0);
      const payouts = positions.reduce((a, p) => a + p.payoutUsdc, 0);
      const ratio = Number(w.setPrice) / Number(w.refPrice);
      const { liquidationThreshold: lt, healthFactorFriday: hf0 } = o.borrower;
      const V = o.notionalUsdc, D = (V * lt) / hf0;
      const hf1 = hf0 * ratio;
      const hfp = (V * ratio * lt) / (D - positions[0].payoutUsdc);
      const r: WeekendReport = {
        ticker: w.ticker,
        friday,
        close: ny(win.close),
        reopen: ny(win.reopen),
        R: { round: bk.referenceRound.toString(), at: ny(w.refTs), price: Number(ethers.formatUnits(bk.refPrice, 8)) },
        S: settled ? { round: bk.settlementRound.toString(), at: ny(w.setTs), price: Number(ethers.formatUnits(bk.settlePrice, 8)) } : null,
        gapPct: w.gap * 100,
        outcome: settled ? "settled" : "voided",
        positions,
        writerPnlUsdc: premiums - payouts,
        lending: {
          note: `Illustrative position: ${V} USDC of ${w.ticker} collateral, liquidation threshold ${lt}, health factor ${hf0} on Friday. Not Aave's actual parameters. The protected figure is Vespera's estimate assuming the ${positions[0].upperBps / 100}%→${positions[0].lowerBps / 100}% payout repays debt; Aave does not recognize Vespera positions.`,
          healthFactorFriday: hf0,
          healthFactorAtReopen: hf1,
          liquidatableAtReopen: hf1 < 1,
          protectedHealthFactorEstimate: hfp,
          liquidatableIfProtected: hfp < 1,
        },
      };
      // reconcile: vault balance change must equal −payouts (premiums arrived on Friday)
      const delta = usd((await usdc.balanceOf(await st.vault.getAddress())) - balBefore[w.ticker]);
      if (Math.abs(delta + payouts) > 1e-6) throw new Error(`vault reconciliation failed for ${w.ticker} ${friday}`);
      reports.push(r);
      log(`  ${w.ticker}: R ${r.R.price} (${r.R.at}) → S ${r.S?.price ?? "—"} (${r.S?.at ?? "void"}), gap ${r.gapPct.toFixed(2)}%`);
      for (const p of positions) {
        log(`    ${p.upperBps / 100}%→${p.lowerBps / 100}%: premium ${p.premiumUsdc.toFixed(2)}, payout ${p.payoutUsdc.toFixed(2)} (max ${p.maxPayoutUsdc.toFixed(2)})`);
      }
      log(`    lending (illustrative): HF ${hf0.toFixed(3)} → ${hf1.toFixed(3)}${hf1 < 1 ? " LIQUIDATABLE" : ""}; with protection ≈ ${hfp.toFixed(3)}${hfp < 1 ? " still liquidatable" : ""}`);
    }
  }
  return reports;
}

/** Sales window used by replay and testnet: Fri 09:00–11:00 ET; close Fri 20:00 ET; reopen Sun 20:00 ET. */
export function salesWindow(friday: string) {
  const [y, m, d] = friday.split("-").map(Number);
  const sun = new Date(Date.UTC(y, m - 1, d + 2));
  return {
    sellOpen: nyToUnix(y, m, d, 9),
    cutoff: nyToUnix(y, m, d, 11),
    close: nyToUnix(y, m, d, 20),
    reopen: nyToUnix(sun.getUTCFullYear(), sun.getUTCMonth() + 1, sun.getUTCDate(), 20),
  };
}
