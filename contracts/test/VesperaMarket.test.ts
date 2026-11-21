import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";

const USDC = (n: number | string) => ethers.parseUnits(String(n), 6);
const PX = (n: number | string) => ethers.parseUnits(String(n), 8);
const STOCK = 0;
const DAY = 24 * 3600;

async function deploy() {
  const [owner, writer, buyer, agent, other] = await ethers.getSigners();

  const usdc = await ethers.deployContract("MockUSDC");
  const feed = await ethers.deployContract("MockAggregator", [8, owner.address]);
  const token = await ethers.deployContract("MockB20", ["Tesla (tokenized)", "TSLAc", owner.address]);
  const adapter = await ethers.deployContract("ChainlinkAdapter", [owner.address]);
  await adapter.setSource(STOCK, await feed.getAddress(), await token.getAddress());

  const market = await ethers.deployContract("VesperaMarket", [
    await usdc.getAddress(),
    await adapter.getAddress(),
    owner.address,
    5000, // cap: 50% of vault assets locked per stock
    USDC(10), // min notional
  ]);
  const vault = await ethers.deployContract("VesperaVault", [
    await usdc.getAddress(),
    await market.getAddress(),
    STOCK,
    "Vespera TSLA writers",
    "vTSLA",
  ]);
  await market.listStock(STOCK, await vault.getAddress());

  for (const s of [writer, buyer, other]) {
    await usdc.mint(s.address, USDC(1_000_000));
    await usdc.connect(s).approve(await market.getAddress(), ethers.MaxUint256);
    await usdc.connect(s).approve(await vault.getAddress(), ethers.MaxUint256);
  }
  await vault.connect(writer).deposit(USDC(100_000), writer.address);

  const now = await time.latest();
  const ep = {
    sellOpen: now + 100,
    cutoff: now + 1_000,
    close: now + 2_000,
    reopen: now + 2_000 + 2 * DAY,
  };
  await market.createEpoch(ep.sellOpen, ep.cutoff, ep.close, ep.reopen);
  await market.postRateCard(0, STOCK, [
    { upperBps: 9700, lowerBps: 8500, premiumBps: 50 }, // band 0: 97% -> 85%, 0.5% premium
    { upperBps: 9500, lowerBps: 9000, premiumBps: 20 }, // band 1
  ]);

  return { owner, writer, buyer, agent, other, usdc, feed, token, adapter, market, vault, ep };
}

/** Bought one 10,000 USDC band-0 position, Friday reference round pushed, now past close. */
async function boughtAndClosed() {
  const f = await deploy();
  await time.increaseTo(f.ep.sellOpen);
  await f.market.connect(f.buyer).buy(0, STOCK, 0, USDC(10_000), USDC(50));
  await f.feed.pushRound(PX(100), f.ep.close - 600); // last print before close
  await time.increaseTo(f.ep.close + 1);
  await f.market.recordReference(0, STOCK, (1n << 64n) | 1n);
  return f;
}

const round = (n: number) => (1n << 64n) | BigInt(n);

describe("VesperaMarket", () => {
  describe("epochs and rate cards", () => {
    it("rejects badly ordered or overlapping epochs", async () => {
      const { market, ep } = await loadFixture(deploy);
      const now = await time.latest();
      await expect(market.createEpoch(now + 10, now + 5, now + 20, now + 30)).to.be.revertedWithCustomError(market, "BadEpoch");
      await expect(market.createEpoch(ep.sellOpen + 1, ep.cutoff, ep.close, ep.reopen + 10)).to.be.revertedWithCustomError(market, "BadEpoch");
    });

    it("locks the rate card: no repost, nothing after sales open", async () => {
      const { market } = await loadFixture(deploy);
      const band = [{ upperBps: 9700, lowerBps: 8500, premiumBps: 1 }];
      await expect(market.postRateCard(0, STOCK, band)).to.be.revertedWithCustomError(market, "RateCardLocked");
    });

    it("only the owner can create epochs or post rate cards", async () => {
      const { market, other } = await loadFixture(deploy);
      await expect(market.connect(other).createEpoch(1, 2, 3, 4)).to.be.revertedWithCustomError(market, "OwnableUnauthorizedAccount");
    });
  });

  describe("buying", () => {
    it("rejects purchases outside the sales window", async () => {
      const { market, buyer, ep } = await loadFixture(deploy);
      await expect(market.connect(buyer).buy(0, STOCK, 0, USDC(1000), USDC(10))).to.be.revertedWithCustomError(market, "SalesClosed");
      await time.increaseTo(ep.cutoff);
      await expect(market.connect(buyer).buy(0, STOCK, 0, USDC(1000), USDC(10))).to.be.revertedWithCustomError(market, "SalesClosed");
    });

    it("charges the premium, locks max payout, mints the position", async () => {
      const { market, vault, usdc, buyer, ep } = await loadFixture(deploy);
      await time.increaseTo(ep.sellOpen);
      await expect(market.connect(buyer).buy(0, STOCK, 0, USDC(10_000), USDC(50)))
        .to.emit(market, "Bought")
        .withArgs(1, buyer.address, 0, STOCK, 0, USDC(10_000), USDC(50), USDC(1_200), ethers.ZeroAddress);
      expect(await market.ownerOf(1)).to.equal(buyer.address);
      expect(await vault.locked()).to.equal(USDC(1_200));
      expect(await usdc.balanceOf(await vault.getAddress())).to.equal(USDC(100_050));
    });

    it("enforces slippage, minimum notional, band id and the open-interest cap", async () => {
      const { market, buyer, ep } = await loadFixture(deploy);
      await time.increaseTo(ep.sellOpen);
      await expect(market.connect(buyer).buy(0, STOCK, 0, USDC(10_000), USDC(49))).to.be.revertedWithCustomError(market, "PremiumTooHigh");
      await expect(market.connect(buyer).buy(0, STOCK, 0, USDC(9), USDC(1))).to.be.revertedWithCustomError(market, "NotionalTooSmall");
      await expect(market.connect(buyer).buy(0, STOCK, 5, USDC(1000), USDC(10))).to.be.revertedWithCustomError(market, "BadBandId");
      // 50% cap of ~100k vault => ~50k lockable => notional ~416k at 12% width
      await expect(market.connect(buyer).buy(0, STOCK, 0, USDC(500_000), USDC(2_500))).to.be.revertedWithCustomError(market, "CapExceeded");
    });
  });

  describe("vault freezing", () => {
    it("closes deposits and withdrawals during sales and while positions are open", async () => {
      const { market, vault, writer, buyer, ep } = await loadFixture(deploy);
      await time.increaseTo(ep.sellOpen);
      expect(await vault.maxDeposit(writer.address)).to.equal(0);
      await expect(vault.connect(writer).deposit(USDC(1), writer.address)).to.be.revertedWithCustomError(vault, "ERC4626ExceededMaxDeposit");
      await market.connect(buyer).buy(0, STOCK, 0, USDC(10_000), USDC(50));
      await time.increaseTo(ep.cutoff + 1);
      expect(await vault.maxWithdraw(writer.address)).to.equal(0);
    });

    it("only the market can lock, release or pay", async () => {
      const { vault, other } = await loadFixture(deploy);
      await expect(vault.connect(other).lock(1)).to.be.revertedWithCustomError(vault, "OnlyMarket");
      await expect(vault.connect(other).payLocked(other.address, 1)).to.be.revertedWithCustomError(vault, "OnlyMarket");
    });
  });

  describe("reference price (rules §3)", () => {
    it("must be the last valid round at or before close, and fresh", async () => {
      const f = await loadFixture(deploy);
      await f.feed.pushRound(PX(99), f.ep.close - 900);
      await f.feed.pushRound(PX(100), f.ep.close - 600);
      await expect(f.market.recordReference(0, STOCK, round(2))).to.be.revertedWithCustomError(f.market, "TooEarly");
      await time.increaseTo(f.ep.close + 1);
      await expect(f.market.recordReference(0, STOCK, round(1))).to.be.revertedWithCustomError(f.market, "NotLastBeforeClose");
      await expect(f.market.recordReference(0, STOCK, round(9))).to.be.revertedWithCustomError(f.market, "RoundMissing");
      await f.market.recordReference(0, STOCK, round(2));
      expect((await f.market.book(0, STOCK)).refPrice).to.equal(PX(100));
      await expect(f.market.recordReference(0, STOCK, round(2))).to.be.revertedWithCustomError(f.market, "WrongStatus");
    });

    it("rejects a round after close and a stale round", async () => {
      const f = await loadFixture(deploy);
      await f.feed.pushRound(PX(100), f.ep.close - 2 * DAY); // frozen feed: older than 26h
      await f.feed.pushRound(PX(101), f.ep.close + 10);
      await time.increaseTo(f.ep.close + 20);
      await expect(f.market.recordReference(0, STOCK, round(2))).to.be.revertedWithCustomError(f.market, "NotLastBeforeClose");
      await expect(f.market.recordReference(0, STOCK, round(1))).to.be.revertedWithCustomError(f.market, "StaleReference");
    });
  });

  describe("settlement (rules §4) and payouts", () => {
    // Band 97% -> 85%, N = 10,000, R = 100 — the worked examples in SETTLEMENT_RULES.md
    const cases: [number, number][] = [
      [101, 0],
      [97, 0],
      [93, 400],
      [80, 1_200],
    ];
    for (const [s, expected] of cases) {
      it(`S = ${s} pays ${expected} USDC`, async () => {
        const f = await loadFixture(boughtAndClosed);
        await f.feed.pushRound(PX(s), f.ep.reopen + 60);
        await time.increaseTo(f.ep.reopen + 120);
        await f.market.recordSettlement(0, STOCK, round(2));
        expect(await f.market.payoutOf(1)).to.equal(USDC(expected));
        const before = await f.usdc.balanceOf(f.buyer.address);
        await f.market.connect(f.other).redeem(1); // permissionless; pays the holder
        expect((await f.usdc.balanceOf(f.buyer.address)) - before).to.equal(USDC(expected));
        expect(await f.vault.locked()).to.equal(0);
      });
    }

    it("must be the first round at or after reopen", async () => {
      const f = await loadFixture(boughtAndClosed);
      await f.feed.pushRound(PX(90), f.ep.reopen + 60);
      await f.feed.pushRound(PX(95), f.ep.reopen + 600);
      await expect(f.market.recordSettlement(0, STOCK, round(2))).to.be.revertedWithCustomError(f.market, "BeforeReopen");
      await time.increaseTo(f.ep.reopen + 700);
      await expect(f.market.recordSettlement(0, STOCK, round(3))).to.be.revertedWithCustomError(f.market, "NotFirstAfterReopen");
      await expect(f.market.recordSettlement(0, STOCK, round(1))).to.be.revertedWithCustomError(f.market, "NotFirstAfterReopen");
      await f.market.recordSettlement(0, STOCK, round(2));
      expect((await f.market.book(0, STOCK)).settlePrice).to.equal(PX(90));
    });

    it("pays whoever holds the position NFT at redemption", async () => {
      const f = await loadFixture(boughtAndClosed);
      await f.market.connect(f.buyer).transferFrom(f.buyer.address, f.other.address, 1);
      await f.feed.pushRound(PX(80), f.ep.reopen + 60);
      await time.increaseTo(f.ep.reopen + 120);
      await f.market.recordSettlement(0, STOCK, round(2));
      await expect(f.market.redeem(1)).to.emit(f.market, "Redeemed").withArgs(1, f.other.address, USDC(1_200), 0);
      await expect(f.market.redeem(1)).to.be.revertedWithCustomError(f.market, "AlreadyRedeemed");
    });

    it("cannot redeem before resolution", async () => {
      const f = await loadFixture(boughtAndClosed);
      await expect(f.market.redeem(1)).to.be.revertedWithCustomError(f.market, "Unresolved");
    });

    it("unfreezes the vault after all positions resolve; writers keep premium minus payouts", async () => {
      const f = await loadFixture(boughtAndClosed);
      await f.feed.pushRound(PX(93), f.ep.reopen + 60);
      await time.increaseTo(f.ep.reopen + 120);
      await f.market.recordSettlement(0, STOCK, round(2));
      await f.market.redeem(1);
      expect(await f.vault.maxWithdraw(f.writer.address)).to.be.closeTo(USDC(100_000 + 50 - 400), 1);
    });
  });

  describe("void (rules §6–7)", () => {
    it("voids when no valid settlement arrives within 72h, refunding the premium", async () => {
      const f = await loadFixture(boughtAndClosed);
      await time.increaseTo(f.ep.reopen + 72 * 3600 - 10);
      await expect(f.market.voidBook(0, STOCK)).to.be.revertedWithCustomError(f.market, "TooEarly");
      await time.increaseTo(f.ep.reopen + 72 * 3600);
      await f.feed.pushRound(PX(80), f.ep.reopen + 72 * 3600); // too late to count
      await expect(f.market.recordSettlement(0, STOCK, round(2))).to.be.revertedWithCustomError(f.market, "TooLate");
      await f.market.voidBook(0, STOCK);
      await expect(f.market.redeem(1)).to.emit(f.market, "Redeemed").withArgs(1, f.buyer.address, 0, USDC(50));
      expect(await f.vault.locked()).to.equal(0);
      expect(await f.vault.maxWithdraw(f.writer.address)).to.be.closeTo(USDC(100_000), 1);
    });

    it("voids if no reference could be recorded", async () => {
      const f = await loadFixture(deploy);
      await time.increaseTo(f.ep.sellOpen);
      await f.market.connect(f.buyer).buy(0, STOCK, 0, USDC(10_000), USDC(50));
      await time.increaseTo(f.ep.reopen + 72 * 3600);
      await f.market.voidBook(0, STOCK);
      expect((await f.market.book(0, STOCK)).status).to.equal(3); // Voided
    });

    it("voids instead of settling if the B20 multiplier changed", async () => {
      const f = await loadFixture(boughtAndClosed);
      await f.token.setMultiplier(ethers.parseEther("1.02"));
      await f.feed.pushRound(PX(80), f.ep.reopen + 60);
      await time.increaseTo(f.ep.reopen + 120);
      await expect(f.market.recordSettlement(0, STOCK, round(2))).to.emit(f.market, "BookVoided");
      await expect(f.market.redeem(1)).to.emit(f.market, "Redeemed").withArgs(1, f.buyer.address, 0, USDC(50));
    });

    it("cannot void a settled book", async () => {
      const f = await loadFixture(boughtAndClosed);
      await f.feed.pushRound(PX(99), f.ep.reopen + 60);
      await time.increaseTo(f.ep.reopen + 120);
      await f.market.recordSettlement(0, STOCK, round(2));
      await time.increaseTo(f.ep.reopen + 72 * 3600);
      await expect(f.market.voidBook(0, STOCK)).to.be.revertedWithCustomError(f.market, "WrongStatus");
    });
  });

  describe("agent mandates (buyFor)", () => {
    async function withMandate() {
      const f = await deploy();
      const net = await ethers.provider.getNetwork();
      const domain = { name: "Vespera", version: "1", chainId: net.chainId, verifyingContract: await f.market.getAddress() };
      const types = {
        Mandate: [
          { name: "owner", type: "address" },
          { name: "agent", type: "address" },
          { name: "stockMask", type: "uint256" },
          { name: "maxPremiumPerEpoch", type: "uint128" },
          { name: "maxNotional", type: "uint128" },
          { name: "minUpperBps", type: "uint16" },
          { name: "maxUpperBps", type: "uint16" },
          { name: "expiry", type: "uint64" },
          { name: "nonce", type: "uint256" },
        ],
      };
      const mandate = {
        owner: f.buyer.address,
        agent: f.agent.address,
        stockMask: 1n << BigInt(STOCK),
        maxPremiumPerEpoch: USDC(60),
        maxNotional: USDC(10_000),
        minUpperBps: 9600,
        maxUpperBps: 9800,
        expiry: f.ep.reopen,
        nonce: 0n,
      };
      const sig = await f.buyer.signTypedData(domain, types, mandate);
      await time.increaseTo(f.ep.sellOpen);
      return { ...f, mandate, sig, domain, types };
    }

    it("buys for the owner with the owner's USDC", async () => {
      const f = await loadFixture(withMandate);
      await expect(f.market.connect(f.agent).buyFor(f.mandate, f.sig, 0, STOCK, 0, USDC(10_000), USDC(50)))
        .to.emit(f.market, "Bought")
        .withArgs(1, f.buyer.address, 0, STOCK, 0, USDC(10_000), USDC(50), USDC(1_200), f.agent.address);
      expect(await f.market.ownerOf(1)).to.equal(f.buyer.address);
    });

    it("rejects anything outside the mandate", async () => {
      const f = await loadFixture(withMandate);
      const m = f.market.connect(f.agent);
      await expect(f.market.connect(f.other).buyFor(f.mandate, f.sig, 0, STOCK, 0, USDC(1000), USDC(5))).to.be.revertedWithCustomError(f.market, "NotAgent");
      await expect(m.buyFor(f.mandate, f.sig, 0, STOCK, 1, USDC(1000), USDC(5))).to.be.revertedWithCustomError(f.market, "OutsideMandate"); // band 95% not allowed
      await expect(m.buyFor(f.mandate, f.sig, 0, STOCK, 0, USDC(10_001), USDC(51))).to.be.revertedWithCustomError(f.market, "OutsideMandate"); // notional
      await expect(m.buyFor(f.mandate, f.sig, 0, 1, 0, USDC(1000), USDC(5))).to.be.revertedWithCustomError(f.market, "OutsideMandate"); // stock
      await expect(m.buyFor({ ...f.mandate, maxNotional: USDC(1e6) }, f.sig, 0, STOCK, 0, USDC(1000), USDC(5))).to.be.revertedWithCustomError(f.market, "BadSignature");
    });

    it("caps total premium per epoch across purchases", async () => {
      const f = await loadFixture(withMandate);
      const m = f.market.connect(f.agent);
      await m.buyFor(f.mandate, f.sig, 0, STOCK, 0, USDC(10_000), USDC(50)); // 50 spent
      await expect(m.buyFor(f.mandate, f.sig, 0, STOCK, 0, USDC(4_000), USDC(20))).to.be.revertedWithCustomError(f.market, "OutsideMandate"); // +20 > 60
      await m.buyFor(f.mandate, f.sig, 0, STOCK, 0, USDC(2_000), USDC(10)); // exactly 60
    });

    it("stops working after revocation or expiry", async () => {
      const f = await loadFixture(withMandate);
      await f.market.connect(f.buyer).revokeMandates();
      await expect(f.market.connect(f.agent).buyFor(f.mandate, f.sig, 0, STOCK, 0, USDC(1000), USDC(5))).to.be.revertedWithCustomError(f.market, "MandateRevoked");
      const short = { ...f.mandate, nonce: 1n, expiry: BigInt(f.ep.sellOpen + 5) };
      const sig2 = await f.buyer.signTypedData(f.domain, f.types, short);
      await time.increaseTo(f.ep.sellOpen + 5);
      await expect(f.market.connect(f.agent).buyFor(short, sig2, 0, STOCK, 0, USDC(1000), USDC(5))).to.be.revertedWithCustomError(f.market, "MandateExpired");
    });
  });
});
