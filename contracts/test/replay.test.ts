import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { replay, scan, salesWindow, Weekend, DEFAULT_REPLAY } from "../scripts/lib/replay";

/** Synthetic weekends in the future (tests run without REPLAY_START). */
async function futureFridays(n: number): Promise<string[]> {
  const now = await time.latest();
  const d = new Date((now + 3 * 86400) * 1000);
  d.setUTCDate(d.getUTCDate() + ((5 - d.getUTCDay() + 7) % 7));
  return Array.from({ length: n }, (_, i) => {
    const x = new Date(d);
    x.setUTCDate(d.getUTCDate() + 7 * i);
    return x.toISOString().slice(0, 10);
  });
}

function weekend(ticker: string, friday: string, R: number, S: number): Weekend {
  const w = salesWindow(friday);
  return {
    ticker, friday, close: w.close, reopen: w.reopen,
    refTs: w.close - 3600, refPrice: ethers.parseUnits(String(R), 8),
    setTs: w.reopen + 20, setPrice: ethers.parseUnits(String(S), 8),
    gap: S / R - 1,
  };
}

describe("replay harness", () => {
  it("scan picks the worst weekend and the calmest weekend of the same stock", async () => {
    const [f1, f2, f3] = await futureFridays(3);
    const all = [weekend("A", f1, 100, 99), weekend("B", f1, 100, 94), weekend("B", f2, 100, 100.1), weekend("B", f3, 100, 97)];
    const s = scan(all);
    expect([s.drop.ticker, s.drop.friday]).to.deep.equal(["B", f1]);
    expect([s.calm.ticker, s.calm.friday]).to.deep.equal(["B", f2]);
  });

  it("settles each weekend through the real contracts with walk-forward prices", async () => {
    const [f1, f2] = await futureFridays(2);
    const calm = weekend("X", f1, 100, 100.2);
    const drop = weekend("X", f2, 100, 93);
    const reports = await replay([calm, drop], [calm, drop], DEFAULT_REPLAY);

    expect(reports.map((r) => r.outcome)).to.deep.equal(["settled", "settled"]);
    // calm: nothing pays, writer keeps premiums
    expect(reports[0].positions.map((p) => p.payoutUsdc)).to.deep.equal([0, 0]);
    expect(reports[0].writerPnlUsdc).to.be.greaterThan(0);
    // walk-forward: the first weekend has no history, the second sees exactly one
    expect(reports[0].positions[0].pricedFromWeekends).to.equal(0);
    expect(reports[1].positions[0].pricedFromWeekends).to.equal(1);
    // drop 7%: 97%->85% pays (97-93)% of 10,000 = 400; 99%->95% pays its max 400
    expect(reports[1].positions.map((p) => p.payoutUsdc)).to.deep.equal([400, 400]);
    expect(reports[1].lending.liquidatableAtReopen).to.equal(true);
  });
});
