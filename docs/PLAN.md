# Build plan

Today: **Sat 2026-11-21**. Deadline: **Fri 2026-12-05**. 14 days.

Hard date: contracts + buy flow live on **Base Sepolia by Wed 2026-11-25**, before the
Thanksgiving closure (US markets closed Thu 11-26, early close Fri 11-27, reopen Mon 11-30).

## Milestones

| # | Milestone | Done when | Due |
| --- | --- | --- | --- |
| M0 | Facts verified | `docs/VERIFY.md` §Critical all resolved or worked around | Sun 11-22 |
| M1 | Dataset + rate card | Gap CSV with provenance; rate card generated for 3–5 stocks | Sun 11-22 |
| M2 | Core contracts | Vault, Market, Position NFT, Oracle adapter, settle/void — tests green | Tue 11-24 |
| M3 | Sepolia live | Deployed, verified, buy flow in web app, first purchase | **Wed 11-25** |
| M4 | Live weekend | Positions open over Thanksgiving; settled Mon 11-30 | Mon 11-30 |
| M5 | Replay harness | Fork + mock feed + time warp; scan mode; above/below strike reproducible | Mon 11-30 |
| M6 | Agent | Mandate contract + Bankr flow + no-numbers guardrail test | Wed 12-02 |
| M7 | Evidence | Backtest published, health-factor panel, edge-case demos | Thu 12-03 |
| M8 | Submission | Video, README, posts, submit | Thu 12-04 (Fri buffer) |

## Day by day

### Sat 11-21
- [x] Pitch refined, application submitted, repo + docs.
- [ ] Work through `docs/VERIFY.md` §Critical (feeds, token interface, Aave listing, Bankr).
- [ ] Choose 3–5 launch stocks (must have feed + ideally Aave listing).
- [ ] Post #1: "Building weekend gap protection for tokenized stocks on Base" + problem thread.

### Sun 11-22
- [ ] `packages/pricing`: fetch daily OHLC, compute Friday-close → next-open gaps incl.
      holiday closures; write `data/gaps.csv` + `.meta.json` provenance.
- [ ] Rate-card generator (see `PRICING.md`), output JSON per epoch.
- [ ] Freeze `SETTLEMENT_RULES.md` v1. Post #2: settlement rules.

### Mon 11-23
- [ ] Foundry init. `OracleAdapter` (+ `MockAggregator`), `PositionNFT`, `VesperaVault`
      (ERC-4626 + phases + collateral lock).
- [ ] Unit tests: round-hint verification, stale/paused handling, multiplier rescale.

### Tue 11-24
- [ ] `VesperaMarket`: epochs, rate card, `buy`, `snapshotReference`, `settle`, `void`,
      OI caps. Full test suite incl. revert paths and invariant: `locked ≤ vault assets`.
- [ ] Deploy script.

### Wed 11-25 — **Sepolia deadline**
- [ ] Deploy + verify on Base Sepolia. Seed vaults with test USDC.
- [ ] `apps/web`: connect, quote card (premium, max payout, collateral, hit-rate, feed
      address, "can't guarantee" list), buy, my positions.
- [ ] First purchases (self + testers). Post #3: first purchase.

### Thu 11-26 / Fri 11-27 (holiday)
- [ ] Recruit 2–3 real stock-collateral borrowers / Base builders to buy before cutoff.
- [ ] `packages/replay`: anvil fork of Base, mock feed from dataset, time warp.

### Sat 11-28 / Sun 11-29
- [ ] Replay scan mode: find one big-gap weekend and one calm weekend; script both.
- [ ] Health-factor panel (read Aave position; show Aave HF and "protected HF (estimate)").

### Mon 11-30
- [ ] **Live settlement** after reopen. Screen-record. Post #4: first real settlement.

### Tue 12-01
- [ ] `MandateRegistry` (EIP-712) + `buyFor`. Tests: out-of-mandate purchase reverts.
- [ ] `apps/agent`: deterministic quote engine with IDs.

### Wed 12-02
- [ ] Bankr integration; LLM picks quote ID; placeholder prose; **guardrail test**.
- [ ] Post #5: agent demo clip.

### Thu 12-03
- [ ] Backtest across all weekends; publish results (writer return, worst weekend, hit
      rate, liquidations avoided). Post #6.
- [ ] Edge-case demos: paused feed → void, multiplier change, refused stock.

### Fri 12-04
- [ ] Video (≤3 min, script in `PITCH.md` §Demo), README polish, submit.

### Sat 12-05
- Buffer. Submit if not already.

## Cut list (cut in this order if behind)

1. Mainnet deployment (never promised).
2. Agent auto-renew — keep a one-off agent purchase under mandate.
3. Corporate-action rescaling — replace with "any multiplier change ⇒ void".
4. Health-factor panel reads live Aave — fall back to user-entered position.
5. Web app polish — scripts + block explorer are acceptable for settlement steps.

**Never cut:** full collateralization, permissionless settle/void, replay demo above/below
strike, published backtest, honest disclosures.

## Build-in-public schedule

| # | When | Post |
| --- | --- | --- |
| 1 | Sat 11-21 | Problem: markets close, loans don't |
| 2 | Sun 11-22 | Settlement rules, published before code |
| 3 | Wed 11-25 | Live on Base Sepolia, first purchase |
| 4 | Mon 11-30 | First real settlement over the Thanksgiving closure |
| 5 | Wed 12-02 | Agent buys protection under a signed mandate |
| 6 | Thu 12-03 | Backtest — including where writers lose |
| 7 | Fri 12-04 | Demo video + submission |

Tag @buildonbase and @bankrbot where relevant. Every post dated.
