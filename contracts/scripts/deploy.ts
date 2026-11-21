/**
 * Deploy Vespera to Base Sepolia (or a local node).
 *
 * Base Sepolia has no tokenized-stock tokens or feeds, so each stock gets a MockAggregator
 * (fed by scripts/mirror.ts from the real mainnet Chainlink feed) and a MockB20 for the
 * multiplier. This is disclosed: on testnet the mirror key is a trusted party.
 *
 *   DEPLOYER_PRIVATE_KEY=0x.. npx hardhat run scripts/deploy.ts --network baseSepolia
 */
import { ethers, network } from "hardhat";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const STOCKS = [
  { id: 0, ticker: "TSLA" },
  { id: 1, ticker: "NVDA" },
  { id: 2, ticker: "MSTR" },
];
const CAP_BPS = 5000;
const MIN_NOTIONAL = ethers.parseUnits("10", 6);

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`network ${network.name}, deployer ${deployer.address}`);

  const usdc = await ethers.deployContract("MockUSDC");
  await usdc.waitForDeployment();
  const adapter = await ethers.deployContract("ChainlinkAdapter", [deployer.address]);
  await adapter.waitForDeployment();
  const market = await ethers.deployContract("VesperaMarket", [
    await usdc.getAddress(),
    await adapter.getAddress(),
    deployer.address,
    CAP_BPS,
    MIN_NOTIONAL,
  ]);
  await market.waitForDeployment();

  const stocks: Record<string, any> = {};
  for (const s of STOCKS) {
    const feed = await ethers.deployContract("MockAggregator", [8, deployer.address]);
    await feed.waitForDeployment();
    const token = await ethers.deployContract("MockB20", [`${s.ticker} (mock B20)`, `${s.ticker}c`, deployer.address]);
    await token.waitForDeployment();
    await (await adapter.setSource(s.id, await feed.getAddress(), await token.getAddress())).wait();
    const vault = await ethers.deployContract("VesperaVault", [
      await usdc.getAddress(),
      await market.getAddress(),
      s.id,
      `Vespera ${s.ticker} writers`,
      `v${s.ticker}`,
    ]);
    await vault.waitForDeployment();
    await (await market.listStock(s.id, await vault.getAddress())).wait();
    stocks[s.ticker] = {
      stockId: s.id,
      feed: await feed.getAddress(),
      token: await token.getAddress(),
      vault: await vault.getAddress(),
    };
    console.log(`${s.ticker}: vault ${stocks[s.ticker].vault}`);
  }

  const out = {
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    usdc: await usdc.getAddress(),
    adapter: await adapter.getAddress(),
    market: await market.getAddress(),
    capBps: CAP_BPS,
    minNotional: MIN_NOTIONAL.toString(),
    stocks,
  };
  const dir = join(__dirname, "../deployments");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${network.name}.json`), JSON.stringify(out, null, 2) + "\n");
  console.log(`market ${out.market} — written to deployments/${network.name}.json`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
