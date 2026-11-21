import { expect } from "chai";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { USDC, PX, STOCK, deploy } from "./helpers";
import { runKeeper, lastAtOrBefore, firstAtOrAfter } from "../scripts/lib/keeper";

describe("keeper", () => {
  async function withPositions() {
    const f = await deploy();
    await time.increaseTo(f.ep.sellOpen);
    await f.market.connect(f.buyer).buy(0, STOCK, 0, USDC(10_000), USDC(50));
    await f.market.connect(f.other).buy(0, STOCK, 2, USDC(5_000), USDC(18));
    // a realistic Friday: several rounds, then the feed freezes
    await f.feed.pushRound(PX(101), f.ep.close - 7200);
    await f.feed.pushRound(PX(100.5), f.ep.close - 3600);
    await f.feed.pushRound(PX(100), f.ep.close - 600);
    return f;
  }

  it("finds the right rounds", async () => {
    const f = await withPositions();
    await f.feed.pushRound(PX(92), f.ep.reopen + 30);
    await f.feed.pushRound(PX(93), f.ep.reopen + 900);
    expect((await lastAtOrBefore(f.feed as any, f.ep.close))!.id & 0xffffn).to.equal(3n);
    expect((await firstAtOrAfter(f.feed as any, f.ep.reopen))!.id & 0xffffn).to.equal(4n);
  });

  it("does nothing before close, then walks the whole lifecycle", async () => {
    const f = await withPositions();
    const k = () => runKeeper(f.market as any, f.adapter as any);

    expect(await k()).to.deep.equal([]); // sales still open

    await time.increaseTo(f.ep.close + 5);
    expect((await k()).map((a) => a.kind)).to.deep.equal(["reference"]);
    expect((await f.market.book(0, STOCK)).refPrice).to.equal(PX(100));

    await time.increaseTo(f.ep.reopen + 10);
    const waiting = await k(); // feed has not resumed yet
    expect(waiting[0].kind).to.equal("skip");

    await f.feed.pushRound(PX(92), f.ep.reopen + 30);
    await f.feed.pushRound(PX(95), f.ep.reopen + 900);
    await time.increaseTo(f.ep.reopen + 1000);
    expect((await k()).map((a) => a.kind)).to.deep.equal(["settlement"]);
    expect((await f.market.book(0, STOCK)).settlePrice).to.equal(PX(92)); // first, not latest

    const before = await f.usdc.balanceOf(f.buyer.address);
    expect((await k()).map((a) => a.kind)).to.deep.equal(["redeem"]);
    expect((await f.usdc.balanceOf(f.buyer.address)) - before).to.equal(USDC(500)); // 97 -> 92
    expect(await f.vault.locked()).to.equal(0);
    expect(await k()).to.deep.equal([]); // all done
  });

  it("voids and refunds when the feed never resumes", async () => {
    const f = await withPositions();
    await time.increaseTo(f.ep.close + 5);
    await runKeeper(f.market as any, f.adapter as any);
    await time.increaseTo(f.ep.reopen + 72 * 3600);
    expect((await runKeeper(f.market as any, f.adapter as any)).map((a) => a.kind)).to.deep.equal(["void"]);
    const before = await f.usdc.balanceOf(f.buyer.address);
    await runKeeper(f.market as any, f.adapter as any);
    expect((await f.usdc.balanceOf(f.buyer.address)) - before).to.equal(USDC(50));
  });

  it("dry run proposes actions without sending", async () => {
    const f = await withPositions();
    await time.increaseTo(f.ep.close + 5);
    const a = await runKeeper(f.market as any, f.adapter as any, { send: false });
    expect(a[0].kind).to.equal("reference");
    expect((await f.market.book(0, STOCK)).status).to.equal(0);
  });
});
