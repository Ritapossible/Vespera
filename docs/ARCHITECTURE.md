# Architecture

## Overview

```
                 ┌───────────── off-chain ─────────────┐
 gap dataset ──▶ │ pricing: rate card per epoch        │──post (before SELLING)──┐
                 │ replay: fork + mock feed + warp     │                         │
                 │ agent: quote engine + Bankr + LLM   │──buyFor(mandate)──┐     │
                 └─────────────────────────────────────┘                   │     │
                                                                           ▼     ▼
 user wallet ──buy()──────────────────────────────────────────────▶ VesperaMarket
                                                                    │  │   │
                         ┌──────────────────────────────────────────┘  │   │
                         ▼                                             ▼   ▼
                  VesperaVault (per stock, ERC-4626 USDC)      ERC-721 pos. ChainlinkAdapter
                  lock / release / pay                         (ERC-721)    (real or mock feed)
                                                                            + token multiplier
 anyone ──recordReference / recordSettlement / voidBook / redeem──▶ VesperaMarket
```

## On-chain

> Implemented: `contracts/contracts/` (Hardhat, Solidity 0.8.24, OZ v5, viaIR). 26 tests in
> `contracts/test/VesperaMarket.test.ts`. Struct fields below are indicative; the code is the
> source of truth.

### `VesperaMarket` (core, one deployment)
Owns epochs, rate cards, positions (it *is* the ERC-721), settlement, and agent mandates.

```solidity
struct Epoch {
    uint64 sellOpen;      // sales start
    uint64 cutoff;        // sales end (before close)
    uint64 close;         // scheduled market close (reference taken at/before this)
    uint64 reopen;        // scheduled reopen (settlement at/after this)
    uint64 voidAfter;     // reopen + 72h
}
struct Band { uint16 upperBps; uint16 lowerBps; uint32 premiumBps; } // of notional
struct Position {
    uint32 epochId; uint32 stockId; uint8 bandId;
    uint128 notional;     // USDC 6dp
    uint128 premium;      // paid
    uint128 maxPayout;    // locked = notional × (upper − lower) / 1e4
    Status status;        // Open | Settled | Voided
}
```

Functions:
- `createEpoch(Epoch)` — operator; must be created before `sellOpen`; **immutable after**.
- `postRateCard(epochId, stockId, Band[])` — operator (pricer); only before `sellOpen`;
  **immutable after**. Disclosed principal: pricing, not settlement.
- `listStock(stockId, vault)` — operator; registers a separately deployed vault (checked to
  point at this market/stock/USDC). Set once.
- `buy(epochId, stockId, bandId, notional, maxPremium)` — during `[sellOpen, cutoff)`.
  Checks OI cap, pulls premium, asks vault to `lock(maxPayout)`, mints NFT.
- `buyFor(Mandate, sig, …)` — same, via `MandateRegistry` checks (agent path).
- `recordReference(epochId, stockId, roundHint)` — anyone, after `close`. Verifies the hint
  is the last round with `updatedAt ≤ close`. Stores `R` and multiplier `m0`.
- `recordSettlement(epochId, stockId, roundHint)` — anyone, in `[reopen, voidAfter)`. Verifies
  the hint is the first round with `updatedAt ≥ reopen`; voids the book instead if the B20
  multiplier changed. One `S` per (epoch, stock).
- `voidBook(epochId, stockId)` — anyone, after `voidAfter` if not settled.
- `redeem(positionId)` / `redeemMany(ids)` — anyone; pays the current NFT holder (payout if
  settled, premium refund if voided) and releases the rest of the collateral.

Invariants (fuzz/invariant tests):
- `vault.locked ≤ vault.balance` always.
- `payout ≤ maxPayout` for every position.
- A position transitions Open → (Settled | Voided) exactly once.
- No function lets any role change `Epoch` or `Band` after `sellOpen`.

### `VesperaVault` (one per stock, ERC-4626 over USDC)
- Phases derived from the active epoch's timestamps: **OPEN** (deposit/withdraw allowed, no
  sales) → **SELLING** → **LOCKED** (after cutoff) → **SETTLING** → OPEN once all positions in
  the epoch are settled or voided.
- Deposits/withdrawals only in OPEN, so nobody enters or exits with knowledge of a weekend.
- `lock(amount)`, `release(amount)`, `pay(to, amount)` — `onlyMarket`.
- Premiums accrue to the vault (share price rises); payouts reduce it.
- `maxWithdraw` respects `locked` even in OPEN (defensive).
- OI cap: `totalLockedThisEpoch ≤ capBps × totalAssets()` at time of sale.

### Positions (ERC-721, built into the market)
Transferable; the holder at redemption is paid. On-chain SVG `tokenURI` is a nice-to-have
(not yet built).

### `OracleAdapter`
Abstracts the price source so the market never touches a specific feed directly.

```solidity
interface IOracleAdapter {
    function roundAt(uint32 stockId, uint80 roundId)
        external view returns (int256 price, uint64 updatedAt, bool valid);
    function previousRound(uint32 stockId, uint80 roundId) external view returns (uint80);
    function multiplier(uint32 stockId) external view returns (uint256); // 1e18 = 1×
}
```
- `ChainlinkAdapter`: wraps the Chainlink proxy (`getRoundData`, try/catch → "round
  missing"). The feed has no pause flag; a frozen feed just produces no new rounds. Round ids are
  `(phase << 64) | n`; `prevRoundId` reverts at a phase boundary (that weekend would void —
  accepted, disclosed). Feed and token per stock are set once, never changed.
- Multiplier: B20 `multiplier()` (WAD) read from the stock token.
- Tests, Sepolia and replay use `MockAggregator` (owner-pushed rounds with explicit
  `updatedAt`) behind the same `ChainlinkAdapter` — one code path everywhere.

### Agent mandates (`buyFor`, built into the market)
EIP-712 typed mandate signed by the owner (EOA or ERC-1271 smart account):
```
Mandate { owner, agent, stockMask, maxPremiumPerEpoch, maxNotional,
          minUpperBps, maxUpperBps, expiry, nonce }
```
`buyFor` verifies signature, agent == msg.sender, epoch premium spent ≤ cap, band within
range, not expired; pulls premium from owner (allowance/permit); mints position to owner.
Owner can revoke by bumping nonce. **The contract rejects out-of-mandate buys even if the
agent is compromised.**

## Off-chain

### `packages/pricing`
- `gaps.ts` (built): binary-searches each mainnet feed's round history for every weekend's
  R and S → `data/weekend-gaps.csv` + provenance.
- `ratecard.ts` (built): empirical + Student-t model → `data/ratecard.json`, consumed by
  `contracts/scripts/epoch.ts`.
- `backtest`: replays every historical closure through the same pricing; writer P&L series,
  worst weekend, hit rate, drawdown.

### Contract scripts (built: `contracts/scripts/`)
- `deploy.ts` — MockUSDC, adapter, market, and per stock a MockAggregator + MockB20 + vault.
- `epoch.ts` — creates the weekend epoch (Fri 20:00 ET / Sun 20:00 ET) and posts rate cards.
- `mirror.ts` — copies real mainnet Chainlink rounds into the Sepolia mocks (run on a schedule).

### `packages/replay`
- Starts a Hardhat node forking Base; deploys contracts with `MockAggregator` feeds.
- Feeds a chosen historical weekend: sets reference round, warps to reopen, pushes open round,
  calls `settle`. Prints a before/after table (and the Aave HF comparison).
- `--scan`: no chain needed; finds weekends where gap crosses a band (and calm ones), so the
  demo is chosen by rule, not cherry-picked by hand.

### `apps/web` (Next.js + wagmi/viem)
Pages: **Quote/Buy**, **My positions** (settle button), **Vaults** (deposit/withdraw,
history), **Collateral** (Aave HF vs protected HF estimate, clearly labelled).
Quote card shows: premium, max payout, collateral locked, historical hit frequency (with
dataset link), feed address, settlement rules link, "what we can't guarantee".

### `apps/agent`
1. Deterministic **quote engine**: given mandate + current epoch → list of quotes with IDs.
2. LLM receives quotes as a fact sheet; returns `{ quoteId | null, reason, prose }` where
   prose uses `{{PLACEHOLDERS}}`.
3. Validator: `quoteId` ∈ engine set; prose contains no raw number/currency/percent ⇒
   otherwise discard and render deterministic template labelled as such.
4. Executes `buyFor` via Bankr's wallet/agent rails (**VERIFY** integration surface).
5. Writes a public decision trace (JSON) per purchase/refusal.

## Trust model (stated publicly)

| Actor | Can | Cannot |
| --- | --- | --- |
| Operator | create future epochs, post rate cards before sales | change an epoch or rate card after sales open; settle; void; move vault funds |
| Writer (vault LP) | deposit/withdraw in OPEN phase | withdraw locked collateral; exit during a weekend |
| Buyer | buy, transfer, settle | get paid more than `maxPayout` |
| Agent | buy within a signed mandate | exceed mandate; buy for anyone but the owner |
| Anyone | snapshot, settle, void (per rules) | choose the settlement price (round is verified) |
| Oracle | provides price | — single point of trust; failure ⇒ void path |

## Security notes
- Reentrancy guard on buy/settle/void; checks-effects-interactions; USDC via SafeERC20.
- Round-hint verification must reject: hint before reopen, a later round when an earlier
  valid one exists, cross-phase gaps without proof.
- No upgradeability for the hackathon build (simpler trust story); redeploy per version.
