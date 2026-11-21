# Vespera — pitch

**Hackathon:** Base Stocks Maxxing · **Track:** Programmable Stock Markets (3.2 options, 3.3
stock-backed loans) · **Partner:** Bankr · **Deadline:** 2026-12-05

## One line
> Weekend protection for your stock collateral that nobody can refuse to pay — the payout is
> locked when you buy, and the first Chainlink print at reopen decides it.

## Problem
Tokenized stocks on Base can be lending collateral, but the stock market closes. From Friday
close to Monday open the oracle price is frozen while news keeps happening, and Monday's price
can gap straight through a liquidation point. Crypto collateral trades 24/7; stock collateral
doesn't. Nothing on Base hedges this today.

## Product
Pick a stock, a protection band (e.g. 97% → 85% of Friday's reference) and a notional; pay a
USDC premium; receive a transferable position NFT. It's a cash-settled put spread:

```
payout = N × clamp((Ku − S) / R, 0, (Ku − Kl) / R)
```

Max payout (12% of notional in the example) is locked from a per-stock writer vault at
purchase. 100% collateralized, no liquidation engine, no counterparty risk.

## Nobody can refuse to pay
- Collateral locked at purchase; writers can't withdraw it mid-weekend.
- Epoch schedule (incl. holiday reopen) fixed at creation.
- No admin settlement key — anyone can call `settle()`; the round is verified on-chain.
- Rules for paused feeds, corporate actions and oracle failure are published before any sale
  (`SETTLEMENT_RULES.md`). If no valid print arrives within 72h, the position is voided and the
  premium refunded.

## Pricing tied to a named dataset
Premiums come from a committed dataset of historical close-to-open gaps per stock, with a floor,
an open-interest cap, a pre-close purchase cutoff, and sales paused around known events. Every
quote shows premium, max payout, collateral locked, historical hit frequency (cited), the feed
address, and what we can't guarantee.

## Lending view (honest)
We read the user's Aave-on-Base position and show **Aave health factor** next to **protected
health factor (our estimate)**. Aave does not recognize Vespera positions; we say so on screen.

## Agent (Bankr)
"Protect my TSLA collateral every weekend, max $5 premium" becomes an EIP-712 mandate the user
signs. A deterministic engine produces quotes with IDs; the model only picks an ID and writes
placeholder prose — it can't type a number (tested). The contract rejects any purchase outside
the mandate, even from a compromised agent. Every decision leaves a public trace.

## Demo — one moment
Replay harness: real contracts on a Base fork, fed real historical weekends, chosen by a scan
rule. Side by side on a big-gap weekend: the Aave position crosses liquidation at Monday open;
the Vespera position settles in the same block as the first valid print. Then a calm weekend:
expires worthless, writer keeps the premium. Plus edge cases: paused feed → void, multiplier
change, refused stock.

Live bonus: real settlement on Base Sepolia across the Thanksgiving closure (reopen Mon 11-30).

### Video script (≤3 min)
1. 0:00 Problem in one sentence + a frozen-price chart over a weekend.
2. 0:20 Buy flow: quote card, everything disclosed.
3. 0:50 Replay: big-gap weekend side by side. **The moment.**
4. 1:30 Calm weekend; writer vault P&L.
5. 1:50 Paused-feed void; refused stock.
6. 2:10 Bankr agent buys under mandate; out-of-mandate attempt reverts.
7. 2:35 Backtest headline incl. worst weekend; disclosures; live Sepolia settlement clip.

## Honest backtest
Every historical closure run through the same pricing: writer return, worst weekend, hit rate,
liquidations offset. Published whatever it shows.

## Known weaknesses (disclosed)
- Testnet oracle is a mock; replay uses historical prices.
- Protected health factor is our estimate, not recognized by Aave.
- Derivatives on securities carry regulatory limits; this is a disclosed simulation.
- Demand is unproven — a small set of stock-collateral borrowers today.
- Informed buyers can still beat historical pricing; caps and pauses reduce, not remove, this.
- The core idea isn't unique to Base; its fit comes from Base's tokenized stocks, Aave on Base,
  and Base-native agent and payment flows.
