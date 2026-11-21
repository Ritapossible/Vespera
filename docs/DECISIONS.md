# Decision log

Newest last. Format: context → decision → consequences. Don't edit past entries; supersede them.

### D1 — Put spread, not a plain put (2026-11-21)
A fully collateralized 97% put locks ~97% of notional for a weekend premium; writer yield is
negligible. **Decision:** sell a band (e.g. 97% → 85%). Locks only band width.
**Consequence:** protection is capped; buyers below the lower strike are unprotected — shown on
every quote.

### D2 — Settlement against the first valid Chainlink print at/after reopen (2026-11-21)
**Decision:** permissionless settle with a verified round hint; same `S` per (epoch, stock).
**Consequence:** depends on feed semantics we must verify; abstracted behind `IOracleAdapter`.

### D3 — Void instead of guess (2026-11-21)
**Decision:** no valid print by reopen + 72h, or an unhandled corporate action ⇒ void with full
premium refund. **Consequence:** buyers lose protection in the rare failure case, but no one is
paid on a bad price.

### D4 — Pricing has a principal; settlement doesn't (2026-11-21)
**Decision:** operator posts the rate card before sales open; frozen afterwards. Disclosed.
**Consequence:** honest trust model; a fully on-chain pricer is out of scope for the hackathon.

### D5 — Replay harness is the primary demo (2026-11-21)
Only one live closure (Thanksgiving) fits before the deadline. **Decision:** real contracts on a
Base fork, fed real historical weekends, with a scan mode choosing weekends by rule.

### D6 — Single track: Programmable Stock Markets; partner Bankr (2026-11-21)
Form allows one track. Agent flow is a feature (mandate-bounded purchases), not a second entry.

### D7 — LLM never types numbers (2026-11-21)
**Decision:** model picks quote IDs and writes placeholder prose; validator discards any raw
figure. Enforced by test. Pattern borrowed from Portfolio Weight Agent (Binance Agent OS
winner).

### D8 — No upgradeability (2026-11-21)
Simpler trust story; redeploy per version.

### D9 — "Reopen" is the feed's Sunday 20:00 ET resumption (2026-11-21)
On-chain history shows the feed resumes Sunday 20:00 ET, not at the Monday cash open, and its
week ends Friday 20:00 ET. **Decision:** epoch `close` = Fri 20:00 ET, `reopen` = Sun 20:00 ET.
**Consequence:** settlement happens exactly when a lending market on the same feed can start
liquidating — the moment that matters to the buyer. Pitch copy must say "reopen", not "Monday
open".

### D10 — Void on any multiplier change; no rescaling (2026-11-21)
Supersedes the rescale idea in SETTLEMENT_RULES v0.1. The feed freezes through corporate actions,
so a changed multiplier means R and S are not comparable. Simpler and safer.

### D11 — Hardhat instead of Foundry (2026-11-21)
The Foundry installer could not run in the build environment; Hardhat is installable from npm.
Tests in TypeScript (ethers v6, chai). `viaIR` on. Revisit only if it slows us down.

### D12 — Vaults deployed separately, registered with `listStock` (2026-11-21)
Embedding vault creation pushed the market over the 24KB limit. `listStock` checks the vault
points at this market, stock and USDC.

### D13 — Pricing data comes from the settlement oracle itself (2026-11-21)
`packages/pricing/src/gaps.ts` binary-searches the Base mainnet feeds' round history for every
weekend's R and S using the exact settlement definitions. No licensing issue, identical
definitions, anyone can recompute. Limitation: only ~15 weekends of history, so the rate card
also uses a fat-tailed (Student-t, ν = 3) model with a volatility floor.

### D14 — Testnet mirrors mainnet prices (2026-11-21)
Base Sepolia has no stock feeds. `scripts/mirror.ts` copies real mainnet rounds (answer and
`updatedAt`) into `MockAggregator`s, so the Thanksgiving settlement on testnet uses real prices.
Disclosed: the mirror key is trusted on testnet only.

### D15 — Default bands follow the data (2026-11-21)
Observed weekend moves for mega-caps are small (sd 0.3–0.5%); a 97% strike never paid in the
sample. Offer a near band (99%→95%) alongside 97%→90% and 97%→85%, and lead the demo with the
higher-volatility names (MSTR, NVDA, SNDK). The pitch says honestly that this is tail insurance.

### D16 — Backend before web app (2026-11-21)
Requested by the project owner. The web app is built only after the contracts are hardened and
the keeper, replay harness, backtest and agent backend work and are tested from scripts. Early
purchases go through scripts, the agent, or a block explorer.

### D17 — Replay on a local chain started in the past, not a Base fork (2026-11-21)
Hardhat `initialDate` lets historical weekends run at their real timestamps. A fork would add
public-RPC latency and rate limits for no gain, since the feed must be a mock filled with real
rounds either way. Premiums in replay are walk-forward (no lookahead).

### D18 — Pricing code has one source of truth (2026-11-21)
`quoteBand` in `packages/pricing/src/ratecard.ts` is used by the rate-card CLI, the replay harness
and (next) the backtest, so published premiums and tested premiums cannot drift apart.
