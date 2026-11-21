/**
 * Randomized invariant tests. Each seed runs a full epoch with random buyers, bands, notionals,
 * NFT transfers and outcomes (settle at a random price, void by timeout, void by multiplier
 * change), redeemed in random order. After every step:
 *
 *   I1  vault.locked == sum of maxPayout of unredeemed positions
 *   I2  vault.locked <= vault USDC balance                      (fully collateralized)
 *   I3  every payout == reference formula, and <= maxPayout
 *   I4  at the end: vault balance == deposits + premiums - payouts - refunds  (exact)
 *   I5  at the end: nothing locked, no open positions, vault unfrozen, writer can exit
 */
import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { USDC, PX, STOCK, round, deploy, BANDS } from "./helpers";

const SEEDS = Number(process.env.INVARIANT_SEEDS ?? 30);
const BPS = 10_000n;

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
    return s / 2 ** 32;
  };
}

/** Mirrors VesperaMarket.payoutOf exactly (integer math). */
function refPayout(n: bigint, r: bigint, s: bigint, u: bigint, l: bigint): bigint {
  const ku = r * u, ss = s * BPS;
  if (ss >= ku) return 0n;
  let gap = ku - ss;
  const width = r * (u - l);
  if (gap > width) gap = width;
  const p = (n * gap) / (r * BPS);
  const max = (n * (u - l)) / BPS;
  return p > max ? max : p;
}

describe("invariants (randomized)", function () {
  this.timeout(600_000);

  for (let seed = 1; seed <= SEEDS; seed++) {
    it(`seed ${seed}`, async () => {
      const rand = rng(seed * 7919);
      const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
      const f = await deploy();
      const people = [f.buyer, f.other, ...f.rest.slice(0, 5)];
      const vaultAddr = await f.vault.getAddress();
      const startBal = await f.usdc.balanceOf(vaultAddr);

      const open = new Map<bigint, { max: bigint; notional: bigint; band: number; premium: bigint }>();
      let premiums = 0n;
      const check = async () => {
        const locked = await f.vault.locked();
        const sum = [...open.values()].reduce((a, p) => a + p.max, 0n);
        expect(locked, "I1").to.equal(sum);
        expect(locked <= (await f.usdc.balanceOf(vaultAddr)), "I2").to.be.true;
      };

      // ---- buys
      await time.increaseTo(f.ep.sellOpen);
      const nBuys = 1 + Math.floor(rand() * 12);
      for (let i = 0; i < nBuys; i++) {
        const who = pick(people);
        const band = Math.floor(rand() * BANDS.length);
        const notional = USDC(10 + Math.floor(rand() * 80_000));
        const b = BANDS[band];
        const premium = (notional * BigInt(b.premiumBps) + BPS - 1n) / BPS;
        const max = (notional * BigInt(b.upperBps - b.lowerBps)) / BPS;
        const assetsAfter = (await f.usdc.balanceOf(vaultAddr)) + premium;
        const cap = (assetsAfter * 5000n) / BPS;
        const tx = f.market.connect(who).buy(0, STOCK, band, notional, premium);
        if ((await f.vault.locked()) + max > cap) {
          await expect(tx).to.be.revertedWithCustomError(f.market, "CapExceeded");
          continue;
        }
        await tx;
        const id = (await f.market.nextPositionId()) - 1n;
        open.set(id, { max, notional, band, premium });
        premiums += premium;
        await check();
      }

      // ---- random NFT transfers
      for (const id of open.keys()) {
        if (rand() < 0.3) {
          const holder = await f.market.ownerOf(id);
          const signer = people.find((p) => p.address === holder)!;
          await f.market.connect(signer).transferFrom(holder, pick(people).address, id);
        }
      }

      // ---- outcome
      const R = PX(100);
      await f.feed.pushRound(R, f.ep.close - 300);
      await time.increaseTo(f.ep.close + 1);
      await f.market.recordReference(0, STOCK, round(1));
      const outcome = rand();
      let S = 0n;
      if (outcome < 0.6) {
        S = BigInt(Math.floor(70_00 + rand() * 40_00)) * 10n ** 6n; // 70.00 .. 110.00, 8 dp
        await f.feed.pushRound(S, f.ep.reopen + 30);
        await time.increaseTo(f.ep.reopen + 60);
        await f.market.recordSettlement(0, STOCK, round(2));
        expect((await f.market.book(0, STOCK)).status).to.equal(2);
      } else if (outcome < 0.8) {
        await f.token.setMultiplier(ethers.parseEther("1.01"));
        await f.feed.pushRound(PX(90), f.ep.reopen + 30);
        await time.increaseTo(f.ep.reopen + 60);
        await f.market.recordSettlement(0, STOCK, round(2));
        expect((await f.market.book(0, STOCK)).status).to.equal(3);
      } else {
        await time.increaseTo(f.ep.reopen + 72 * 3600);
        await f.market.voidBook(0, STOCK);
      }
      const settled = (await f.market.book(0, STOCK)).status === 2n;

      // ---- redeem in random order, by random callers
      let paidOut = 0n;
      const ids = [...open.keys()].sort(() => rand() - 0.5);
      for (const id of ids) {
        const p = open.get(id)!;
        const holder = await f.market.ownerOf(id);
        const b = BANDS[p.band];
        const expected = settled ? refPayout(p.notional, R, S, BigInt(b.upperBps), BigInt(b.lowerBps)) : p.premium;
        expect(expected <= (settled ? p.max : p.premium), "I3").to.be.true;
        const before = await f.usdc.balanceOf(holder);
        await f.market.connect(pick(people)).redeem(id);
        expect((await f.usdc.balanceOf(holder)) - before, "I3").to.equal(expected);
        paidOut += expected;
        open.delete(id);
        await check();
      }

      // ---- end state
      expect(await f.usdc.balanceOf(vaultAddr), "I4").to.equal(startBal + premiums - paidOut);
      expect(await f.vault.locked(), "I5").to.equal(0);
      expect(await f.market.stockOpenPositions(STOCK), "I5").to.equal(0);
      expect(await f.market.vaultFrozen(STOCK), "I5").to.be.false;
      const maxW = await f.vault.maxWithdraw(f.writer.address);
      expect(maxW, "I5").to.be.closeTo(await f.usdc.balanceOf(vaultAddr), 1);
      await f.vault.connect(f.writer).withdraw(maxW, f.writer.address, f.writer.address);
    });
  }
});
