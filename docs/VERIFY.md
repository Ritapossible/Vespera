# Claims to verify

Nothing listed under *Unverified* may appear in public copy (posts, video, README claims) until
it is checked and moved to *Verified* with a source link and date.

## Unverified — Critical (blocks design)

- [ ] **Chainlink feeds for tokenized stocks on Base**: which tickers exist, addresses
      (mainnet + Sepolia), decimals, heartbeat, and how they behave on weekends/holidays — do
      they freeze, mark stale, expose a market-status flag, or update pre/post-market?
- [ ] **Stock token interface** (the name "B20" and its multiplier/pause mechanics): is there an
      on-chain multiplier getter? How are splits/dividends represented? Can transfers pause?
- [ ] **Aave on Base**: which tokenized stocks are listed as collateral, their LTV /
      liquidation thresholds, and which oracle Aave uses for them.
- [ ] **Bankr integration surface**: API/SDK for agent-initiated transactions, whether it can
      call arbitrary contracts (`buyFor`) or only swaps/transfers, auth model.
- [ ] **Testnet availability**: are there Sepolia versions of the stock tokens/feeds, or must we
      mock both? (Assume mock until proven otherwise.)

## Unverified — Important (affects pitch)

- [ ] Official judging criteria and weights (is traction really ~50%?).
- [ ] Bankr partner prize size and terms.
- [ ] Whether tokenized stocks trade on Base DEXs over weekends (affects information leakage
      before cutoff and the "frozen price" framing).
- [ ] Dataset source + licence for historical OHLC.
- [ ] Regulatory framing the competition expects for derivatives on securities ("disclosed
      simulation" wording in the brief).

## Verified

| Claim | Source | Date |
| --- | --- | --- |
| Deadline Dec 5; three tracks; track 3 includes options (3.2) and stock-backed loans with overnight gap modelling (3.3) | Base "Stocks Maxxing: Ideas to Build" post | 2026-11-21 |
| Application form: single track choice; Bankr listed as launch partner | Application form | 2026-11-21 |
| US markets closed Thu 2026-11-26 (Thanksgiving), early close Fri 11-27 | NYSE holiday calendar — **re-check exact early-close time** | — |
