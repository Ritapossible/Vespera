# Vespera — project memory

Read this first in every session. Update **Current state** and **Session log** at the end of
every working session. Keep it short; detail lives in `docs/`.

## What this is

Weekend gap protection for tokenized stocks on Base: a fully collateralized, cash-settled put
spread that settles against the first valid Chainlink print at market reopen. Entry for Base
**Stocks Maxxing**, track **Programmable Stock Markets** (single-track form; submitted).
Partner selected: **Bankr**. Deadline **Fri 2026-12-05**.

One sentence (do not drift from it):
> Weekend protection for your stock collateral that nobody can refuse to pay — the payout is
> locked when you buy, and the first Chainlink print at reopen decides it.

## Non-negotiables

1. **100% collateralized.** Max payout is locked in the vault at purchase. No liquidation
   engine, no undercollateralized writing, ever.
2. **No principal can override settlement.** No admin settle, no admin void, no changing an
   epoch's timestamps or rate card after selling opens. Anyone can call `settle()`/`void()`.
3. **Settlement rules are published before code.** `docs/SETTLEMENT_RULES.md` is normative;
   contracts implement it, not the other way round. Change the doc first.
4. **The LLM never types a number.** Agent output picks quote IDs and writes prose with
   placeholders; any raw `$`, `%`, `bps` or digit-amount in model output ⇒ discard, use the
   deterministic template. This is enforced by a test, not a prompt.
5. **Honesty over polish.** The backtest is published whatever it shows. The "protected health
   factor" is labelled as our estimate — Aave does not recognize it. Testnet oracle is a mock
   and we say so.
6. **Nothing in `docs/VERIFY.md` appears in public copy until it is checked** and moved to
   *Verified* with a source.

## Key decisions (summary — full log in `docs/DECISIONS.md`)

- Put **spread**, not a plain put (capital efficiency for writers).
- **Per-stock ERC-4626 USDC vault** with epoch phases; deposits/withdrawals only in OPEN phase.
- **Rate card** posted per epoch before SELLING, frozen after (pricing has a principal;
  settlement does not — disclosed).
- Positions are **ERC-721** (transferable).
- Settlement uses a **caller-supplied round hint** that the contract verifies (first round with
  `updatedAt ≥ reopen`, previous round `< reopen`).
- **Void** if no valid print by `reopen + 72h`, or on any unhandled corporate action: premium
  back to buyer, collateral back to vault.
- **Replay harness** on a Base fork is the primary demo; the live Thanksgiving settlement is a
  bonus.
- **Reopen = feed resumption, Sun 20:00 ET; close = Fri 20:00 ET** (observed on-chain, D9).
- **Any B20 multiplier change ⇒ void** (no rescaling, D10).
- **Pricing data comes from the settlement oracle itself** (D13); Student-t model covers tails.
- **Testnet mirrors real mainnet rounds** into mock feeds (D14).
- Hardhat (not Foundry — installer blocked, D11); TypeScript off-chain.

## Conventions

- Solidity `^0.8.24`, OpenZeppelin v5, Hardhat (`viaIR`). Custom errors, no revert strings.
  Every external state-changing function has a test, including the revert paths.
- USDC amounts: 6 decimals. Prices: Chainlink feed decimals, normalized to 1e18 internally.
  Band/strike ratios in **bps of reference** (`9700` = 97%).
- Timestamps are UTC unix seconds. Never derive market hours on-chain; they are inputs to an
  epoch, fixed at creation.
- Off-chain: TypeScript, viem, strict mode. Data files carry provenance (source, fetch date,
  licence) in a sibling `*.meta.json`.
- Commits: small, imperative subject. No model identifiers in commits or code.

## Commands

```
cd contracts && npm i --legacy-peer-deps && npx hardhat test       # 26 tests
cd packages/pricing && npm i && npx tsx src/gaps.ts                # refresh dataset (public RPC, ~5 min)
npx tsx src/ratecard.ts                                            # data/ratecard.json
cd contracts && npx hardhat run scripts/deploy.ts --network baseSepolia
FRIDAY=2026-11-27 CUTOFF_ET=11:00 npx hardhat run scripts/epoch.ts --network baseSepolia
npx hardhat run scripts/mirror.ts --network baseSepolia            # schedule every few minutes
```

## Layout

```
contracts/          Hardhat project (contracts/, test/, scripts/, deployments/)
packages/pricing/   gaps.ts (dataset from mainnet feeds), ratecard.ts; backtest TODO
packages/replay/    fork + mock feed + time-warp harness, scan mode
apps/web/           Next.js + wagmi: quote, buy, positions, vault, health-factor panel
apps/agent/         Bankr integration, quote engine, mandate signing, guardrail tests
data/               gap dataset + provenance
docs/               plan, architecture, rules, pricing, decisions, verify list
```

## Current state

- 2026-11-21: Critical facts verified. Contracts + 26 tests green. Dataset (150 weekends) and
  rate card generated from mainnet feeds. Deploy/epoch/mirror scripts work on a local node.
- **Next:** deploy to Base Sepolia (needs a funded deployer key from the user), create the
  Thanksgiving epoch, run the mirror, then `apps/web`.
- Watch: Thanksgiving feed behaviour (VERIFY.md). Pitch copy must say "reopen (Sun 8pm ET)",
  not "Monday open".
- Finding to use honestly: mega-cap weekend gaps were tiny in the sample; lead with MSTR/NVDA.

## Session log

| Date | What happened |
| --- | --- |
| 2026-11-21 | Idea refined (spread, settlement rules, replay demo, Bankr mandate). Application submitted (Programmable Stock Markets, Bankr). Repo scaffolded with docs. |
| 2026-11-21 | Verified feeds/B20/Aave V4/Bankr. Found feed schedule on-chain (D9). Built contracts (market, vault, adapter, mandates) + 26 tests; gaps + rate-card pipeline; deploy/epoch/mirror scripts. |
