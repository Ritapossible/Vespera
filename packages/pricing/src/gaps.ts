/**
 * Extract every weekend gap from the on-chain Chainlink feeds that Vespera settles against.
 *
 *   R = last round with updatedAt <= Friday 20:00 ET   (feed's end of week)
 *   S = first round with updatedAt >= Sunday 20:00 ET  (feed's reopen)
 *   gap = S / R - 1
 *
 * These are exactly the reference/settlement rules in docs/SETTLEMENT_RULES.md, so the dataset
 * and the product use the same source and the same definitions.
 *
 * Usage: npx tsx src/gaps.ts [--rpc URL] [--out ../../data]
 */
import { ethers } from "ethers";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { FEEDS, FEED_ABI } from "./feeds";
import { weekendBounds, iso } from "./time";

const args = process.argv.slice(2);
const arg = (k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const RPC = arg("--rpc", process.env.BASE_RPC_URL ?? "https://mainnet.base.org");
const OUT = arg("--out", join(__dirname, "../../../data"));

type Round = { id: bigint; price: bigint; ts: number };

class Feed {
  private cache = new Map<bigint, Round | null>();
  phases: { phase: bigint; max: bigint }[] = [];
  constructor(public c: ethers.Contract) {}

  async get(id: bigint): Promise<Round | null> {
    if (this.cache.has(id)) return this.cache.get(id)!;
    let r: Round | null = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        await new Promise((res) => setTimeout(res, 60)); // stay under public RPC rate limits
        const x = await this.c.getRoundData(id);
        r = Number(x[3]) === 0 ? null : { id, price: x[1], ts: Number(x[3]) };
        break;
      } catch (e: any) {
        const msg = String(e?.shortMessage ?? e?.message ?? "");
        if (msg.includes("revert") || msg.includes("CALL_EXCEPTION")) { r = null; break; }
        await new Promise((res) => setTimeout(res, 1000 * (attempt + 1)));
      }
    }
    this.cache.set(id, r);
    return r;
  }

  /** Discover [1..max] for every phase from the current one down to 1. */
  async init() {
    const [latest] = await this.c.latestRoundData();
    const cur = latest >> 64n;
    this.phases.push({ phase: cur, max: latest & ((1n << 64n) - 1n) });
    for (let p = cur - 1n; p >= 1n; p--) {
      const base = p << 64n;
      if (!(await this.get(base | 1n))) continue;
      let hi = 1n;
      while (await this.get(base | (hi * 2n))) hi *= 2n;
      let lo = hi, top = hi * 2n; // lo exists, top doesn't
      while (top - lo > 1n) {
        const mid = (lo + top) / 2n;
        if (await this.get(base | mid)) lo = mid; else top = mid;
      }
      this.phases.push({ phase: p, max: lo });
    }
    this.phases.reverse(); // oldest phase first
  }

  /** Flattened index -> round id across phases. */
  idAt(i: bigint): bigint {
    for (const { phase, max } of this.phases) {
      if (i < max) return (phase << 64n) | (i + 1n);
      i -= max;
    }
    throw new Error("index out of range");
  }
  get size(): bigint {
    return this.phases.reduce((s, p) => s + p.max, 0n);
  }

  /** Last round with ts <= t (or null). */
  async lastAtOrBefore(t: number): Promise<Round | null> {
    let lo = -1n, hi = this.size; // invariant: idx lo has ts<=t (or -1), idx hi has ts>t (or size)
    while (hi - lo > 1n) {
      const mid = (lo + hi) / 2n;
      const r = await this.get(this.idAt(mid));
      if (r && r.ts <= t) lo = mid; else hi = mid;
    }
    return lo < 0n ? null : this.get(this.idAt(lo));
  }

  /** First round with ts >= t (or null). */
  async firstAtOrAfter(t: number): Promise<Round | null> {
    let lo = -1n, hi = this.size; // idx lo has ts<t, idx hi has ts>=t
    while (hi - lo > 1n) {
      const mid = (lo + hi) / 2n;
      const r = await this.get(this.idAt(mid));
      if (r && r.ts >= t) hi = mid; else lo = mid;
    }
    return hi >= this.size ? null : this.get(this.idAt(hi));
  }
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC, 8453, { staticNetwork: true, batchMaxCount: 1 });
  mkdirSync(OUT, { recursive: true });
  const rows: string[] = ["ticker,friday,close_utc,reopen_utc,ref_round,ref_ts,ref_price,set_round,set_ts,set_price,gap"];
  const now = Math.floor(Date.now() / 1000);

  for (const [ticker, addr] of Object.entries(FEEDS)) {
    const feed = new Feed(new ethers.Contract(addr, FEED_ABI, provider));
    await feed.init();
    const first = await feed.get(feed.idAt(0n));
    if (!first) continue;
    // every Friday from the feed's first round until now
    const d = new Date(first.ts * 1000);
    d.setUTCDate(d.getUTCDate() + ((5 - d.getUTCDay() + 7) % 7));
    let n = 0;
    for (; ; d.setUTCDate(d.getUTCDate() + 7)) {
      const [close, reopen] = weekendBounds(d);
      if (reopen > now) break;
      const R = await feed.lastAtOrBefore(close);
      const S = await feed.firstAtOrAfter(reopen);
      if (!R || !S || R.ts < first.ts) continue;
      const gap = Number(S.price) / Number(R.price) - 1;
      rows.push([
        ticker, d.toISOString().slice(0, 10), iso(close), iso(reopen),
        R.id, iso(R.ts), ethers.formatUnits(R.price, 8),
        S.id, iso(S.ts), ethers.formatUnits(S.price, 8), gap.toFixed(6),
      ].join(","));
      n++;
    }
    console.log(`${ticker}: ${n} weekends (phases ${feed.phases.map((p) => `${p.phase}:${p.max}`).join(" ")})`);
  }

  writeFileSync(join(OUT, "weekend-gaps.csv"), rows.join("\n") + "\n");
  writeFileSync(
    join(OUT, "weekend-gaps.meta.json"),
    JSON.stringify(
      {
        source: "Chainlink data feeds for Coinbase tokenized stocks on Base mainnet (chainId 8453), read via getRoundData",
        feeds: FEEDS,
        feedListSource: "https://docs.base.org/base-chain/asset-issuance/tokenized-stocks-on-base",
        definitions: {
          close: "Friday 20:00 America/New_York (feed end of week, observed on-chain)",
          reopen: "Sunday 20:00 America/New_York (feed resumes, observed on-chain)",
          ref: "last round with updatedAt <= close",
          settle: "first round with updatedAt >= reopen",
          gap: "settle / ref - 1",
        },
        caveats: [
          "Feed values are total-return values, not raw equity prices (per Base docs); ratios are what matters for payouts.",
          "Holiday-extended closures are not yet special-cased: a Friday holiday shows up as a normal weekend row with an older ref.",
          "Short history: the feeds went live in 2026, so the sample is small. See docs/PRICING.md.",
        ],
        generatedAt: new Date().toISOString(),
        rpc: RPC.replace(/\/\/.*@/, "//***@"),
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`wrote ${rows.length - 1} rows to ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
