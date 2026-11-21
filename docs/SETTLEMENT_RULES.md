# Settlement rules — v0 (draft)

**Status: DRAFT.** Freeze as v1 before the first sale (target Sun 2026-11-22). After freezing,
changes apply only to epochs created afterwards and get a new version number. Contracts
implement this document; if they disagree, the document is the bug report.

## Definitions

- **Epoch** — one market closure (a weekend, or a holiday-extended weekend). Fixed at
  creation: `sellOpen`, `cutoff`, `close`, `reopen`, `voidAfter`.
- **Reference price `R`** — price of the last valid oracle round with `updatedAt ≤ close`.
- **Settlement price `S`** — price of the first valid oracle round with `updatedAt ≥ reopen`.
- **Valid round** — a round the feed does not flag as stale, paused or invalid, with a positive
  price. (Exact semantics depend on the feed — see `VERIFY.md`.)
- **Band** — `upper` and `lower` as bps of `R`, e.g. 9700 / 8500.
- **Notional `N`** — USDC value protected.

## Payout

```
Ku = R × upper / 10000
Kl = R × lower / 10000
payout = N × clamp((Ku − S) / R, 0, (Ku − Kl) / R)
maxPayout = N × (upper − lower) / 10000        // locked at purchase
```

## Rules

1. **Sales window.** Sales are accepted only in `[sellOpen, cutoff)`. `cutoff` is before the
   scheduled close so no one buys after the reference price is known.
2. **Fixed schedule.** All epoch timestamps, including holiday reopen dates, are written at
   epoch creation and cannot be changed by anyone afterwards.
3. **Reference.** Anyone may record `R` after `close` by pointing at a round; the contract
   accepts it only if that round is valid, has `updatedAt ≤ close`, and the next round (if any)
   has `updatedAt > close`.
4. **Settlement.** Anyone may settle after `reopen` by pointing at a round; the contract
   accepts it only if it is valid, has `updatedAt ≥ reopen`, and no earlier valid round has
   `updatedAt ≥ reopen`. The same `S` applies to every position in that (epoch, stock).
5. **Paused or stale feed at reopen.** Settlement waits for the first valid round at or after
   `reopen`, up to `voidAfter = reopen + 72h`.
6. **No valid round by `voidAfter`.** Every open position in that (epoch, stock) is **voided**:
   premium refunded to the position holder, collateral released to the vault. No one profits
   from an oracle failure.
7. **Multiplier change** (e.g. split) between `close` and the settlement round: `R`, `Ku`, `Kl`
   are rescaled by `m1 / m0`. If the token exposes no multiplier, or any other corporate action
   affects the window, the position is **voided** (rule 6 payout).
8. **Unscheduled closure** (market does not open at `reopen`): handled by rules 5–6 — the first
   valid round after `reopen` settles, otherwise void at `voidAfter`.
9. **Who is paid.** The holder of the position NFT at the moment of settlement or void.
10. **No discretion.** No party — including the Vespera team — can settle at a different price,
    void a position outside rules 6–7, or withhold a payout.

## Worked examples (band 9700 / 8500, N = 10,000 USDC, R = 100)

| S | Ku − S | payout | Notes |
| --- | --- | --- | --- |
| 101 | < 0 | 0 | Expires worthless; writer keeps premium |
| 97 | 0 | 0 | At upper strike |
| 93 | 4 | 400 | Inside band |
| 80 | 17 → capped 12 | 1,200 | Max payout |
| — (feed paused 72h) | — | void | Premium refunded |

## Open questions (resolve before v1)
- Exact validity semantics for the chosen feeds (market-status flag? heartbeat?).
- 72h void window — long enough for a halted stock, short enough for writers?
- Should a minimum notional exist to prevent dust positions?
