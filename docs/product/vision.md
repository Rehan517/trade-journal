# Product vision

Status: draft · Last updated: 2026-11-23

## Summary

A free trading journal for futures and stock day traders. Log each trade in
under a minute, tag the setup and the mistakes, and see which habits make
money and which lose it. No subscription.

## Who it's for

**Now: me.** A new day trader and scalper learning futures and US stocks on
TradingView paper trading. No live broker yet. Many trades per session.
Reviews on a laptop, sometimes logs from a phone.

**Later: traders like me.** Retail day traders and scalpers who want a proper
journal without a monthly subscription. The app may open to the public; how
it would be offered is still undecided (see Open questions).

## The problem

The journals worth using are behind subscriptions, and paying monthly while
still learning on paper makes no sense. Without a journal:

- **Journaling is inconsistent.** Logging is tedious, so trades go
  unrecorded, especially at scalping volume.
- **Patterns stay hidden.** There's no clear view of which setups and habits
  make or lose money.
- **Mistakes repeat.** Rule breaks such as moving a stop, FOMO entries and
  revenge trades are never caught or counted.

## Principles

1. **Free core.** Logging, tagging and stats are never paywalled.
2. **Fast to log.** Under a minute per trade, or it won't get done.
3. **Honest numbers.** P&L includes fees, and futures use contract point
   value.
4. **Private by default.** Each trader sees only their own data.
5. **Every field earns its place.** Anything captured on a trade should
   feed a stat or a review.

## MVP

Goal: replace a paid journal for my paper trading.

### Sign-in

- Sign up and sign in. Each user's trades are private to them.

### Logging trades (manual entry)

- A quick-entry form that works on desktop and phone.
- Core fields: symbol, instrument type (stock or future), long/short,
  quantity, entry price and time, exit price and time. A trade can be saved
  while open and closed later.
- Futures point value (e.g. MES = $5 per point) so P&L is correct. It is
  remembered per symbol so it isn't retyped.
- Fees and commissions per trade (zero for paper trades).
- Planned stop and target, from which the app works out initial risk and the
  R-multiple.
- Setup / strategy tags: user-defined, reusable, picked from a list.
- Mistake tags (user-defined, e.g. FOMO, moved stop, revenge trade,
  oversized) and an emotion / mindset note.
- Free-text notes.
- Chart screenshots: attach one or more images per trade.
- Edit and delete trades.
- One entry and one exit per trade.

### Reviewing trades

- **P&L calendar as the home screen:** each New York trading day of the
  month shaded green or red by net P&L, with weekly totals and month stats.
  Logging opens from it. (Moved from Later features on 2026-11-23;
  [calendar spec](../spec/calendar.md).)
- Trade list, newest first, showing P&L and R. Filter by date range,
  symbol, setup, mistake, and win/loss.
- Trade detail view with notes and screenshots.

### Stats (over a chosen date range)

- **Core performance:** net P&L after fees, win rate, average win and loss,
  profit factor, expectancy, equity curve.
- **By setup:** trades, win rate, net P&L and average R per setup tag.
- **By mistake:** how often each mistake happens and what it cost in P&L.
- **Risk & discipline:** average R, share of trades with a planned stop,
  share of losses bigger than the planned risk.

### Platform

- Responsive web app: desktop for review, phone for quick logging.
- Times stored in UTC and shown in the user's local time zone.

## Later features

Deferred from the MVP:

- **Multiple accounts** labelled paper, live or prop, with stats per
  account. Needed when moving off paper trading.
- **Time-based stats:** P&L by time of day and day of week. (The P&L
  calendar moved into the MVP.)
- **Daily journal:** a pre-market plan (bias, key levels, rules for the day)
  and an end-of-day review (what went well, what didn't, lessons), linked to
  that day's trades.

Faster data entry:

- **CSV import** from broker or platform exports, starting with whichever
  broker I choose.
- **Automatic broker sync** via broker APIs.
- **Scaling in and out:** several fills per trade (adds and partial exits).

Going public:

- Onboarding for new users.
- **Data export** of all trades to CSV, so nobody is locked in.
- More instruments (options, crypto) if users ask for them.

## Non-goals

- Placing orders or connecting to execution.
- Live market data or charting. TradingView already does this.
- Trade signals or advice.

## Success measures (MVP)

- Every paper trade logged for 30 trading days in a row.
- Logging a trade takes under a minute.
- The stats surface at least one setup or habit to drop or double down on.
- No need to pay for a journal subscription.

## Open questions

- If it goes public, how is it offered: fully free, free with paid extras,
  or something else?
- Which broker for live trading? That decides the first CSV import and sync
  target.
- Is scaling in and out needed? Revisit after a few weeks of logging.

## Next step

Each MVP feature gets its own spec in `docs/spec/` before any code is
written.
