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
                  VesperaVault (per stock, ERC-4626 USDC)      PositionNFT  OracleAdapter
                  lock / release / pay                         (ERC-721)    (Chainlink or Mock)
                                                                            + token multiplier
 anyone ──snapshotReference() / settle() / void()──▶ VesperaMarket
```

## On-chain

### `VesperaMarket` (core, one deployment)
Owns epochs, rate cards, positions, settlement.

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
- `buy(epochId, stockId, bandId, notional, maxPremium)` — during `[sellOpen, cutoff)`.
  Checks OI cap, pulls premium, asks vault to `lock(maxPayout)`, mints NFT.
- `buyFor(Mandate, sig, …)` — same, via `MandateRegistry` checks (agent path).
- `snapshotReference(epochId, stockId, roundHint)` — anyone, after `close`. Verifies the hint
  is the last round with `updatedAt ≤ close`. Stores `R` and multiplier `m0`.
- `settle(positionId, roundHint)` — anyone, after `reopen`. Verifies hint is the first valid
  round with `updatedAt ≥ reopen`. Applies multiplier rule. Pays `payout` to NFT holder from
  vault, releases remainder. Batched variant `settleAll(epochId, stockId, roundHint)` — the
  settlement price is per (epoch, stock), so it is computed once and cached.
- `void(positionId)` — anyone, after `voidAfter` with no settlement price, or when the
  multiplier rule says void. Refunds premium, releases collateral.

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

### `PositionNFT` (ERC-721)
Minted/burned by the market. `tokenURI` renders on-chain SVG with stock, band, notional,
epoch dates, status. Transferable: the holder at settlement is paid.

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
- `ChainlinkAdapter`: wraps `AggregatorV3Interface`. `valid` = not paused/stale per the
  feed's actual semantics (**see VERIFY.md** — must confirm how stock feeds signal market
  status). Handles phase boundaries in round IDs conservatively (if the previous round is in
  another phase, require the caller to prove via the proxy's `getRoundData`).
- `MockAdapter`: settable rounds, used in tests, Sepolia (if no live feed) and replay.
- Multiplier source: the stock token's multiplier getter if one exists (**VERIFY**);
  otherwise constant 1e18 and the void-on-corporate-action rule is enforced off-chain only
  (disclosed).

### `MandateRegistry` (agent path)
EIP-712 typed mandate signed by the owner:
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
- `fetchGaps`: daily OHLC per ticker from a public source → rows
  `(ticker, closeDate, closePx, reopenDate, openPx, gap, closureType)`.
  `closureType ∈ {weekend, holiday-long}`. Provenance in `data/*.meta.json`.
- `rateCard(epoch, stock)`: empirical expected payout per band × load, floor, event filter
  (see `PRICING.md`). Output JSON matching `postRateCard` args.
- `backtest`: replays every historical closure through the same pricing; writer P&L series,
  worst weekend, hit rate, drawdown.

### `packages/replay`
- Starts `anvil --fork-url <Base RPC>`; deploys contracts with `MockAdapter`.
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
