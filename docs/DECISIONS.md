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
