# Vespera

**Weekend gap protection for tokenized stocks on Base.**

> Markets close, but onchain loans don't. Vespera sells fully collateralized weekend
> protection per stock: the payout is locked when you buy, and the first Chainlink print at
> market reopen decides it. Nobody can refuse to pay.

Built for Base **Stocks Maxxing** (track: *Programmable Stock Markets*, partner: Bankr).
Submission deadline: **Friday, Dec 5, 2026**.

## The problem

Tokenized stocks on Base can be used as lending collateral, but the underlying market closes.
From Friday close to Monday open the oracle price is frozen while news keeps happening. On
Monday the price can gap straight through a borrower's liquidation point with no chance to
react. Crypto collateral trades 24/7 and never has this problem; stock collateral always does.

## The product

- A buyer picks a **stock**, a **protection band** (e.g. 97% → 85% of Friday's reference
  price) and a **notional**, pays a USDC premium, and receives a transferable position (NFT).
- The position is a **cash-settled put spread**. Max payout = band width × notional (12% in
  the example), locked from a per-stock writer vault at purchase. 100% collateralized.
- Anyone can settle. Payouts use the **first Chainlink print after the feed resumes (Sunday
  20:00 ET)**, under rules published before any sale. No admin settlement key.
- A **Bankr agent** can buy protection every weekend under a user-signed mandate (max premium,
  strike band, notional, expiry) that the contract enforces.

## Repository map

| Path | What |
| --- | --- |
| [`CLAUDE.md`](CLAUDE.md) | Project memory: context, decisions, conventions, current state. Read first. |
| [`docs/PITCH.md`](docs/PITCH.md) | Full pitch |
| [`docs/PLAN.md`](docs/PLAN.md) | Day-by-day build plan, milestones, cut list |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System design: contracts, off-chain services, data flow |
| [`docs/SETTLEMENT_RULES.md`](docs/SETTLEMENT_RULES.md) | Normative settlement spec |
| [`docs/PRICING.md`](docs/PRICING.md) | Pricing method, dataset, risk controls, backtest |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Decision log (ADR-style) |
| [`docs/VERIFY.md`](docs/VERIFY.md) | Claims not yet verified — nothing here goes in public copy until checked |

## Status

- Contracts written and tested (26 tests): `contracts/`.
- Weekend-gap dataset from the mainnet settlement feeds: `data/weekend-gaps.csv` (10 stocks ×
  15 weekends) and rate card `data/ratecard.json`.
- Next: Base Sepolia deployment, web app, agent. See `docs/PLAN.md`.

## Run

```
cd contracts && npm i --legacy-peer-deps && npx hardhat test
cd packages/pricing && npm i && npx tsx src/gaps.ts && npx tsx src/ratecard.ts
```

## Deploy (Base Sepolia)

```
cd contracts
export DEPLOYER_PRIVATE_KEY=0x...        # testnet-only key with Base Sepolia ETH
npx hardhat run scripts/deploy.ts --network baseSepolia
FRIDAY=2026-11-27 CUTOFF_ET=11:00 npx hardhat run scripts/epoch.ts --network baseSepolia
npx hardhat run scripts/mirror.ts --network baseSepolia   # repeat every few minutes
```

## Disclaimer

Hackathon prototype. Testnet / disclosed simulation. Not financial advice, not an offer of
securities or derivatives.
