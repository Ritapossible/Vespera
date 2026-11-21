# Claims to verify

Nothing listed under *Unverified* may appear in public copy (posts, video, README claims) until
it is checked and moved to *Verified* with a source link and date.

## Unverified — Important

- [ ] Official judging criteria and weights (is traction really ~50%?).
- [ ] Bankr partner prize size and terms.
- [ ] Bankr `/agent/submit` exact request schema and whether the Bankr wallet is an EOA or a
      smart account (affects mandate signatures — contract already supports ERC-1271). Sources so
      far are third-party skill pages, not official docs.
- [ ] Thanksgiving feed behaviour: does the feed freeze Wed 20:00 ET → Fri, and when does the
      Friday 11-27 early-close session end? Observe live.
- [ ] B20 token addresses on mainnet (precompiles) for reading `multiplier()` — get from the
      Coinbase Tokenized Stocks API (`api.coinbase.com/v1/tokenized-stocks`).
- [ ] Aave V4 Base: exact collateral factors / liquidation thresholds per stock (reports vary,
      e.g. SPCXc 55%). Check Aave governance forum or LlamaRisk before quoting numbers.
- [ ] Regulatory framing the competition expects for derivatives on securities.
- [ ] B20 pause function signature (interface page not yet read).

## Verified

| Claim | Source | Date |
| --- | --- | --- |
| Deadline Dec 5; track 3 covers options (3.2) and stock-backed loans with overnight gap modelling (3.3) | Base "Stocks Maxxing: Ideas to Build" post | 2026-11-21 |
| Application form: single track; Bankr listed as launch partner | Application form | 2026-11-21 |
| Token standard is **B20** (ERC-20 extension, native precompiles); `multiplier()` returns WAD; dividends become shares via multiplier; scheduled updates via `updateUIMultiplier`; `OPERATOR_ROLE`, no timelock | [Base docs — tokenized stocks](https://docs.base.org/base-chain/asset-issuance/tokenized-stocks-on-base) | 2026-11-21 |
| Feeds: Chainlink V3, **8 decimals**, total-return values; 0.5% deviation / 24h heartbeat; off-hours they stop updating and hold the last value; freeze during corporate actions; docs say "never settle or liquidate against a frozen feed" | Base docs (same page) | 2026-11-21 |
| Feed addresses for AAPL, AMZN, GOOGL, META, MSFT, MSTR, NVDA, SNDK, SPCX, TSLA | Base docs; TSLA/NVDA read on-chain (`description()` = "Coinbase TSLA") | 2026-11-21 |
| Feed week ends ~Fri 20:00 ET and resumes **Sun 20:00 ET** (49–54h gaps every weekend; first round at 00:00/01:00 UTC Monday) | On-chain scan of TSLA/NVDA feeds, 2026-10-20 → 11-21; `data/weekend-gaps.csv` | 2026-11-21 |
| Holiday Monday delays resumption by 24h (Labor Day 2026) | `data/weekend-gaps.csv` (max settle lag 1441 min) | 2026-11-21 |
| Tokens trade 24/7 on DEXs; the DEX price does not feed the oracle | Base docs; [The Industry Spread](https://theindustryspread.com/coinbase-b20-tokenised-stocks-base-chainlink-24-5-feed/) | 2026-11-21 |
| Only available to persons in eligible jurisdictions outside the US | Base docs | 2026-11-21 |
| **Aave V4 on Base accepts Coinbase tokenized stocks as USDC collateral** (AAPLc, AMZNc, GOOGLc, METAc, MSFTc, NVDAc, TSLAc from 2026-09-25; SPCXc added 2026-11-04); Chainlink feeds price them | [The Block](https://www.theblock.co/news/defi/2026-09-25-aave-v4-on-base-adds-coinbase-tokenized-stocks-as-collateral-for-usdc-loans-416372), [Crypto Times](https://www.cryptotimes.io/2026/11/05/aave-v4-adds-tokenized-spacex-stock-as-usdc-collateral-on-base/) | 2026-11-21 |
| First month: ~$11.5M stock collateral, ~$5.2M USDC debt, 700+ addresses (LlamaRisk) | [LlamaRisk on X](https://x.com/LlamaRisk/status/2114777763957903782) via search summary — re-check before quoting | 2026-11-21 |
| No Base Sepolia stock tokens or feeds documented → testnet uses mirrored mock feeds | Base docs (absence) | 2026-11-21 |
| Bankr exposes `POST /agent/submit` for raw transactions (`to`, `data`, `value`, `chainId`) on Base 8453 | Third-party skill pages (bankrbot/claude-plugins) — **confirm on official docs** | 2026-11-21 |
