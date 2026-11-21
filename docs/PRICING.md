# Pricing

Goal: premiums that are **explainable from a named dataset**, protect writers against informed
buyers, and are published before sales open.

## Dataset

- Per launch stock: daily OHLC history from a public source (**choose + check licence**,
  record in `data/*.meta.json`).
- Derived rows: last session close before each market closure → first open after it.
  `gap = open / close − 1`. Tag `closureType` (`weekend`, `holiday-long`).
- Committed to the repo with provenance so anyone can recompute every premium.

Note: the oracle settles on the first Chainlink print after reopen, which may differ from the
official open. Document the difference and, where possible, estimate it.

## Rate card

For each (stock, band):

```
u = upper / 1e4, l = lower / 1e4
E[payout] = mean over historical closures of clamp(u − (1 + gap), 0, u − l)   // per unit notional
premiumBps = max(floorBps, E[payout] × load) + eventSurcharge
```

- `load` (start 1.5–2.0×) covers model error and adverse selection; tuned by backtest.
- `floorBps` — minimum premium regardless of history.
- Holiday-long closures priced from the holiday subset (or weekend × √(days) scaling if too few
  samples; state which).
- Recent-volatility adjustment (optional): scale by ratio of recent realized vol to long-run vol.

## Risk controls (writer protection)

- **Purchase cutoff** before close (no buying after the reference is known).
- **Open-interest cap** per stock per epoch: `locked ≤ capBps × vault assets` (start 50%).
- **Event pause**: no rate card (no sales) for a stock when a known event falls inside the
  window — earnings date, scheduled macro release. Event calendar source recorded.
- **Vault frozen** outside OPEN phase so LPs can't front-run weekends.

## What every quote shows

Premium · max payout · collateral locked · historical frequency of any payout and of max payout
(with sample size and dataset link) · feed address · link to settlement rules ·
**what we can't guarantee**: halts, unscheduled closures, unhandled corporate actions, oracle
failure (→ void), and that the protected health factor is our estimate.

## Backtest (published regardless of result)

Run every historical closure through the same rate-card logic:
- writer return per epoch and cumulative; **worst epoch**; max drawdown
- buyer hit rate (any payout / max payout)
- for a set of illustrative loan positions: liquidations that protection would have offset
- sensitivity: load × floor grid; show where writers lose money

If writers lose at a candidate setting, publish that and the adjusted setting.
