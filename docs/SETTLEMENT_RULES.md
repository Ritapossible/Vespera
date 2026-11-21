# Settlement rules — v0.2 (draft)

**Status: DRAFT, implemented in `contracts/contracts/VesperaMarket.sol` and tested.** Freeze as
v1 before the first public sale. After freezing, changes apply only to epochs created afterwards
and get a new version number. Contracts implement this document; if they disagree, the document
is the bug report.

## The feed these rules are written for

Coinbase tokenized-stock feeds on Base (Chainlink, 8 decimals, total-return values). Observed
on-chain (see `data/weekend-gaps.csv`) and in Base docs:
- The feed runs **24/5**: its week ends **Friday 20:00 ET** and resumes **Sunday 20:00 ET**
  (01:00 UTC Monday in winter, 00:00 UTC in summer). The last Friday round is usually an
  after-hours print (19:00–23:40 UTC observed).
- Off-hours it **stops creating rounds and holds the last value**; `updatedAt` stops advancing.
  There is no market-status flag — freshness is read from `updatedAt` only.
- Rounds are created on a **0.5% deviation or a 24h heartbeat**.
- During a **corporate action** (split, dividend reinvestment via multiplier) the feed freezes
  until Coinbase confirms both price and multiplier.
- When the Monday is a holiday, the first round arrives a day later (e.g. Labor Day 2026:
  resumed Monday 20:00 ET).

So **"reopen" in Vespera means the feed's Sunday-evening resumption** — the same moment a
lending market using this feed can start liquidating. It is *not* the 09:30 Monday cash open.

## Definitions

- **Epoch** — one market closure (a weekend, or a holiday-extended weekend). Fixed at
  creation: `sellOpen`, `cutoff`, `close`, `reopen`, `voidAfter`. Default `close` = Friday
  20:00 ET, `reopen` = Sunday 20:00 ET.
- **Reference price `R`** — price of the last oracle round with `updatedAt ≤ close`, no older
  than 26h at `close`.
- **Settlement price `S`** — price of the first oracle round with `updatedAt ≥ reopen`.
- **Valid round** — an existing round with a positive answer. (The feed exposes no pause flag;
  a frozen feed simply produces no new round, which rules 5–6 handle.)
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
   accepts it only if that round is valid, has `updatedAt ≤ close`, is no older than 26h at
   `close`, and the next round (if any) has `updatedAt > close`. If no such round can be
   recorded, the epoch can only end in a void (rule 6).
4. **Settlement.** Anyone may settle after `reopen` by pointing at a round; the contract
   accepts it only if it is valid, has `updatedAt ≥ reopen`, and no earlier valid round has
   `updatedAt ≥ reopen`. The same `S` applies to every position in that (epoch, stock).
5. **Paused or stale feed at reopen.** Settlement waits for the first valid round at or after
   `reopen`, up to `voidAfter = reopen + 72h`.
6. **No valid round by `voidAfter`.** Every open position in that (epoch, stock) is **voided**:
   premium refunded to the position holder, collateral released to the vault. No one profits
   from an oracle failure.
7. **Multiplier change.** If the B20 token's `multiplier()` when `S` is recorded differs from
   its value when `R` was recorded, the book is **voided** (rule 6 payout). No rescaling: the
   feed itself freezes through corporate actions, so a changed multiplier means the two prices
   are not comparable. (v0.1 proposed rescaling; dropped as unnecessary complexity.)
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

All five rows are executed as tests in `contracts/test/VesperaMarket.test.ts`.

## Known edge: settlement must be recorded in time
`recordSettlement` is accepted only while `block.timestamp < voidAfter`. A valid round that
exists but is not recorded within 72h is lost and the book voids. Anyone can record it; the
keeper does so minutes after reopen.

## Open questions (resolve before v1)
- 72h void window — long enough for a halted stock or holiday Monday (observed lag ≤ 24h), short
  enough for writers?
- Chainlink proxy phase change exactly at reopen: `prevRoundId` reverts at a phase boundary, so
  that weekend would void. Rare; accepted and disclosed for now.
- Minimum notional: 10 USDC in the current deployment config.
