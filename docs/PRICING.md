# Pricing

Goal: premiums that are **explainable from a named dataset**, protect writers against informed
buyers, and are published before sales open.

## Dataset — the settlement oracle itself

`packages/pricing/src/gaps.ts` reads the Base mainnet Chainlink feeds (the same ones positions
settle against) and, for every weekend since each feed went live, finds:

- `R` = last round with `updatedAt ≤ Friday 20:00 ET`
- `S` = first round with `updatedAt ≥ Sunday 20:00 ET`
- `gap = S / R − 1`

These are exactly the definitions in `SETTLEMENT_RULES.md`. Output: `data/weekend-gaps.csv` +
`data/weekend-gaps.meta.json` (provenance). Anyone can rerun it.

```
cd packages/pricing && npm i && npx tsx src/gaps.ts
```

### First results (2026-11-21, 15 weekends × 10 stocks)

| Ticker | sd of weekend gap | worst | weekends < −3% |
| --- | --- | --- | --- |
| AAPL | 0.31% | −0.69% | 0 |
| AMZN | 0.50% | −1.39% | 0 |
| GOOGL | 0.40% | −0.67% | 0 |
| META | 0.45% | −1.02% | 0 |
| MSFT | 0.35% | −0.75% | 0 |
| MSTR | 2.08% | **−5.37%** | 1 |
| NVDA | 1.07% | −2.62% | 0 |
| SNDK | 1.61% | −3.76% | 1 |
| SPCX | 0.86% | −0.97% | 0 |
| TSLA | 0.50% | −1.01% | 0 |

Honest reading: in this short, calm sample, mega-cap weekend gaps are small and a 97% strike
never paid. The product is **tail insurance** — its value is in weekends this sample doesn't
contain (macro shocks, weekend news). Lead with higher-volatility names and offer a near band.

## Rate card (`packages/pricing/src/ratecard.ts` → `data/ratecard.json`)

Per (stock, band `[u, l]`):

```
payoff(g) = clamp(u − (1 + g), 0, u − l)            per unit notional
E_emp     = mean payoff over observed weekends
E_model   = E[payoff], g ~ Student-t(ν = 3) scaled to sd = max(sample sd, 1%)
premium   = max(floor, load × max(E_emp, E_model))   (defaults: floor 10 bps, load 2)
```

- **Why the model term:** 15 weekends contain no tail event. A normal model says a 3% weekend
  drop essentially never happens; a t(3) with a 1% volatility floor does not.
- **Why the empirical term:** if history is worse than the model (MSTR), history wins.
- Defaults are placeholders until the backtest (Dec 3) tunes `load`, `floor` and the sigma floor.

Current output (premium in bps of notional, per weekend):

| Ticker | 99→95 | 97→90 | 97→85 |
| --- | --- | --- | --- |
| AAPL / AMZN / GOOGL / META / MSFT / SPCX / TSLA | 13 | 10 | 10 |
| NVDA | 25 | 10 | 10 |
| SNDK | 59 | 11 | 11 |
| MSTR | 93 | 32 | 32 |

## Risk controls (writer protection)

- **Purchase cutoff** before the cash close (default Friday 11:00 ET); `R` is the last print
  before Friday 20:00 ET, so the buyer never knows `R` when buying.
- **Open-interest cap** per stock: `locked ≤ 50% × vault assets`.
- **Event pause**: no rate card for a stock with a known event in the window (earnings, scheduled
  macro release).
- **Vault frozen** during sales and while any position is open.

## What every quote shows

Premium · max payout · collateral locked · historical frequency of any payout and of max payout
(with sample size and dataset link) · feed address · link to settlement rules ·
**what we can't guarantee**: halts, unscheduled closures, corporate actions (→ void), oracle
failure (→ void), and that the protected health factor is our estimate.

## Backtest (published regardless of result)

Run every historical weekend through the same rate-card logic (leave-one-out so a weekend is not
priced with its own data):
- writer return per epoch and cumulative; **worst epoch**; max drawdown
- buyer hit rate (any payout / max payout)
- illustrative Aave positions: liquidations protection would have offset
- sensitivity grid over load × floor × sigma floor; show where writers lose money
- supplement with long-run equity close-to-open history for tail weekends (source + licence TBD)
