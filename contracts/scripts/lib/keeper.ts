/**
 * Keeper: performs every permissionless step the settlement rules allow, in order.
 *
 *   status None,       close <= now < voidAfter   -> recordReference(last round <= close)
 *   status Referenced, reopen <= now < voidAfter  -> recordSettlement(first round >= reopen)
 *   status None/Referenced, now >= voidAfter      -> voidBook
 *   status Settled/Voided, open positions         -> redeemMany(open ids)
 *
 * The keeper has no special rights: anyone can run it, and the contract checks every round it
 * points at. A wrong or malicious keeper can only fail to act; it cannot choose a price.
 */
import { ethers } from "ethers";

const FEED_ABI = [
  "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)",
  "function getRoundData(uint80) view returns (uint80,int256,uint256,uint256,uint80)",
];
const PHASE_MASK = (1n << 64n) - 1n;
const MAX_WALK = 5_000;
const REDEEM_CHUNK = 50;

export type Action =
  | { kind: "reference" | "settlement"; epochId: number; stockId: number; roundId: bigint; tx?: string }
  | { kind: "void"; epochId: number; stockId: number; tx?: string }
  | { kind: "redeem"; epochId: number; stockId: number; ids: bigint[]; tx?: string }
  | { kind: "skip"; epochId: number; stockId: number; reason: string };

type Round = { id: bigint; ts: number };

async function getRound(feed: ethers.Contract, id: bigint): Promise<Round | null> {
  try {
    const r = await feed.getRoundData(id);
    return Number(r[3]) === 0 ? null : { id, ts: Number(r[3]) };
  } catch {
    return null;
  }
}

/** Last round with ts <= t, walking back from the latest round in the current phase. */
export async function lastAtOrBefore(feed: ethers.Contract, t: number): Promise<Round | null> {
  let r: Round | null;
  try {
    const l = await feed.latestRoundData();
    r = { id: l[0], ts: Number(l[3]) };
  } catch {
    return null;
  }
  for (let i = 0; r && i < MAX_WALK; i++) {
    if (r.ts <= t) return r;
    if ((r.id & PHASE_MASK) <= 1n) return null;
    r = await getRound(feed, r.id - 1n);
  }
  return null;
}

/** First round with ts >= t: the round after lastAtOrBefore(t - 1), if it exists. */
export async function firstAtOrAfter(feed: ethers.Contract, t: number): Promise<Round | null> {
  const before = await lastAtOrBefore(feed, t - 1);
  if (!before) return null; // can't prove "first" without a round before it (phase boundary)
  return getRound(feed, before.id + 1n);
}

export async function runKeeper(
  market: ethers.Contract,
  adapter: ethers.Contract,
  opts: { now?: number; send?: boolean; log?: (s: string) => void } = {},
): Promise<Action[]> {
  const send = opts.send ?? true;
  const log = opts.log ?? (() => {});
  const runner = market.runner as ethers.ContractRunner;
  const provider = (runner as any).provider ?? runner;
  const now = opts.now ?? Number((await provider.getBlock("latest")).timestamp);
  const actions: Action[] = [];

  const listed = await market.queryFilter(market.filters.StockListed());
  const stockIds = listed.map((e: any) => Number(e.args.stockId));
  const nEpochs = Number(await market.epochCount());

  for (let epochId = 0; epochId < nEpochs; epochId++) {
    const e = await market.epoch(epochId);
    const [close, reopen, voidAfter] = [Number(e.close), Number(e.reopen), Number(e.voidAfter)];
    for (const stockId of stockIds) {
      const bk = await market.book(epochId, stockId);
      const status = Number(bk.status);
      const openPositions = Number(bk.openPositions);
      if (openPositions === 0) continue; // nothing at stake in this book
      const [feedAddr] = await adapter.sources(stockId);
      const feed = new ethers.Contract(feedAddr, FEED_ABI, provider);

      if (status <= 1 && now >= voidAfter) {
        actions.push({ kind: "void", epochId, stockId });
      } else if (status === 0 && now >= close) {
        const r = await lastAtOrBefore(feed, close);
        if (r) actions.push({ kind: "reference", epochId, stockId, roundId: r.id });
        else actions.push({ kind: "skip", epochId, stockId, reason: "no round at or before close" });
      } else if (status === 1 && now >= reopen) {
        const r = await firstAtOrAfter(feed, reopen);
        if (r) actions.push({ kind: "settlement", epochId, stockId, roundId: r.id });
        else actions.push({ kind: "skip", epochId, stockId, reason: "feed has not resumed yet" });
      } else if (status >= 2) {
        const bought = await market.queryFilter(market.filters.Bought(null, null, epochId));
        const ids: bigint[] = [];
        for (const ev of bought as any[]) {
          if (Number(ev.args.stockId) !== stockId) continue;
          const p = await market.position(ev.args.positionId);
          if (Number(p.status) === 0) ids.push(ev.args.positionId);
        }
        for (let i = 0; i < ids.length; i += REDEEM_CHUNK) {
          actions.push({ kind: "redeem", epochId, stockId, ids: ids.slice(i, i + REDEEM_CHUNK) });
        }
      }
    }
  }

  if (send) {
    for (const a of actions) {
      let tx: ethers.ContractTransactionResponse | undefined;
      try {
        if (a.kind === "reference") tx = await market.recordReference(a.epochId, a.stockId, a.roundId);
        else if (a.kind === "settlement") tx = await market.recordSettlement(a.epochId, a.stockId, a.roundId);
        else if (a.kind === "void") tx = await market.voidBook(a.epochId, a.stockId);
        else if (a.kind === "redeem") tx = await market.redeemMany(a.ids);
        if (tx) {
          await tx.wait();
          (a as any).tx = tx.hash;
        }
        log(`${a.kind} epoch ${a.epochId} stock ${a.stockId}${tx ? ` ${tx.hash}` : ""}${a.kind === "skip" ? `: ${a.reason}` : ""}`);
      } catch (err: any) {
        // e.g. StaleReference: the book can then only void after voidAfter; keep going.
        log(`FAILED ${a.kind} epoch ${a.epochId} stock ${a.stockId}: ${err?.shortMessage ?? err?.message}`);
      }
    }
  }
  return actions;
}
