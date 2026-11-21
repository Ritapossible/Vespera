# Build plan

Today: **Sat 2026-11-21**. Deadline: **Fri 2026-12-05**. 14 days.

Hard date: contracts + buy flow live on **Base Sepolia by Wed 2026-11-25**, before the
Thanksgiving closure (US markets closed Thu 11-26, early close Fri 11-27). The feed resumes
**Sun 11-29 20:00 ET (Mon 11-30 01:00 UTC)** — that is the live settlement moment (see D9).

## Milestones

| # | Milestone | Done when | Due |
| --- | --- | --- | --- |
| M0 | Facts verified | `docs/VERIFY.md` §Critical all resolved or worked around | ✅ Sat 11-21 |
| M1 | Dataset + rate card | Gap CSV with provenance; rate card generated | ✅ Sat 11-21 (10 stocks × 15 weekends) |
| M2 | Core contracts | Vault, Market, positions, adapter, settle/void, mandates — tests green | ✅ Sat 11-21 (26 tests) |
| M3 | Sepolia live | Deployed, verified, buy flow in web app, first purchase | **Wed 11-25** |
| M4 | Live weekend | Positions open over Thanksgiving; settled Mon 11-30 | Mon 11-30 |
| M5 | Replay harness | Fork + mock feed + time warp; scan mode; above/below strike reproducible | Mon 11-30 |
| M6 | Agent | Mandate contract + Bankr flow + no-numbers guardrail test | Wed 12-02 |
| M7 | Evidence | Backtest published, health-factor panel, edge-case demos | Thu 12-03 |
| M8 | Submission | Video, README, posts, submit | Thu 12-04 (Fri buffer) |

## Day by day

### Sat 11-21 — done (ahead of plan)
- [x] Pitch refined, application submitted, repo + docs.
- [x] VERIFY §Critical: feeds, B20 multiplier, Aave V4 listing, Bankr submit endpoint (see VERIFY.md).
- [x] Discovered feed schedule (Fri 20:00 ET → Sun 20:00 ET) from on-chain history → D9.
- [x] `packages/pricing`: `gaps.ts` (dataset from the settlement oracle) + `ratecard.ts`.
- [x] Contracts: adapter, vault, market (incl. `buyFor` mandates), mocks — 26 tests green.
- [x] Scripts: `deploy.ts`, `epoch.ts`, `mirror.ts` — verified end-to-end on a local node.
- [ ] Choose launch stocks — proposal: TSLA, NVDA, MSTR (deploy config).
- [ ] Post #1: problem thread.

### Sun 11-22
- [ ] **Needs user:** a funded Base Sepolia deployer key (see README → Deploy).
- [ ] Deploy to Base Sepolia; verify contracts; seed vaults; create Thanksgiving epoch.
- [ ] Freeze `SETTLEMENT_RULES.md` v1. Post #2: settlement rules + first dataset findings.
- [ ] Invariant/fuzz tests (`locked ≤ assets`, payout ≤ maxPayout) and a few more edge tests.

### Mon 11-23 / Tue 11-24
- [ ] `apps/web` (pulled forward): quote card, buy, positions, vault deposit.
- [ ] Mirror running on a schedule; keeper script for record/settle/redeem.

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

### Sun 11-29 evening ET / Mon 11-30 01:00 UTC
- [ ] **Live settlement** right after the feed resumes. Screen-record. Post #4.

### Tue 12-01
- [x] Mandates + `buyFor` (done early, in the market contract, tested).
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
