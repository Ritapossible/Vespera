import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

export const USDC = (n: number | string) => ethers.parseUnits(String(n), 6);
export const PX = (n: number | string) => ethers.parseUnits(String(n), 8);
export const STOCK = 0;
export const DAY = 24 * 3600;
export const round = (n: number) => (1n << 64n) | BigInt(n);

export const BANDS = [
  { upperBps: 9700, lowerBps: 8500, premiumBps: 50 }, // band 0: 97% -> 85%, 0.5% premium
  { upperBps: 9500, lowerBps: 9000, premiumBps: 20 }, // band 1
  { upperBps: 9900, lowerBps: 9500, premiumBps: 35 }, // band 2
];

export async function deploy() {
  const [owner, writer, buyer, agent, other, ...rest] = await ethers.getSigners();

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

  for (const s of [writer, buyer, other, ...rest.slice(0, 5)]) {
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
  await market.postRateCard(0, STOCK, BANDS);

  return { owner, writer, buyer, agent, other, rest, usdc, feed, token, adapter, market, vault, ep };
}
