# Spec: calendar home

Status: draft, awaiting review · Issues: #40 (API date range), #41 (new
look and dialog), #42 (calendar) · Design: [Night desk](../design/system.md) ·
Last updated: 2026-11-23

## Summary

The signed-in home screen becomes a month calendar. Each New York trading
day is shaded green or red by that day's net P&L, with weekly totals beside
each week and five month stats above. A **New trade** button in the top bar
opens the trade form ([trades.md, #7](trades.md#quick-entry-form-7)) in a
dialog, and the calendar refreshes when a trade is saved.

The vision listed the P&L calendar as a later feature (#22). It moves into
the MVP as the home screen. #22 keeps the time-of-day and day-of-week stats.

The work ships in three PRs, in this order:

| Issue | Area        | Contents                                                                                |
| ----- | ----------- | --------------------------------------------------------------------------------------- |
| #40   | api, shared | `from` / `to` on `GET /trades` ([trades.md](trades.md#date-range)); `plannedRewardRisk` |
| #41   | web         | New look, top bar, the trade form in a dialog                                           |
| #42   | web         | This calendar                                                                           |

## Additions beyond the canvas

The canvas (<https://claude.ai/artifact/1utV8cnnBpVHpMD9sBqLNX>) set the
look. Building it for real needs these too:

| Addition                                                         | Why                                                                         |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Days are New York trading days                                   | A Melbourne clock puts a Friday US session on Saturday                      |
| `GET /trades` takes a date range                                 | The calendar needs one month's trades, not every trade                      |
| The nav shows only Calendar for now                              | Trades (#8) and Stats (#17) don't exist yet; no dead links                  |
| Days with only open trades say "1 open" and aren't shaded        | An open trade has no P&L yet                                                |
| A compact phone layout                                           | The canvas grid needed 820px and scrolled sideways on a phone               |
| Loading, empty, error and session-expired states                 | The canvas only drew a full month                                           |
| Inputs are 16px, the week "—" and future day numbers are lighter | Phone zoom and contrast ([system.md](../design/system.md#contrast-checked)) |

## Decisions

1. **A trade belongs to the New York date of its `openedAt`.** US stocks
   and CME futures trade on New York time, so this matches the broker and
   TradingView, and it stays right through daylight-saving changes in
   either city. Computed in the browser with
   `Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' })`. No
   date library.
2. **The month is fetched by its New York bounds.** `from` is New York
   midnight on the 1st, `to` is New York midnight on the 1st of the next
   month, both sent as UTC (`2026-10-01T04:00:00.000Z` to
   `2026-11-01T04:00:00.000Z` for October 2026). `to` is exclusive.
3. **All sums are exact.** Day, week and month totals add `metrics.netPnl`
   strings with the shared decimal module. No value passes through a JS
   `number`. Only the display rounds (trades decision 2).
4. **Open trades count as trades but have no P&L.** They add to a day's
   trade count and to the Trades stat, and never to a total or a shade.
5. **No router yet.** The home screen is the only page. #8 adds the Trades
   page and decides on routing.
6. **The calendar always opens on the current New York month.** The month
   shown isn't remembered or put in the URL.
7. **Clicking a day logs a trade on that day.** It opens the dialog with
   entry time set to 09:30 New York time on that date, shown in local time.
   Today's cell uses now instead. A day with trades does the same until a
   day view exists (#13).
8. **The calendar refetches after a save**, rather than adding the returned
   trade locally. One source of truth, and the month is one or two
   requests.

## Top bar

Built in PR 2, per [system.md](../design/system.md#top-bar).

```
[▣] Trade Journal   (Calendar)                    [+ New trade]  Sign out
```

- "Calendar" is the only nav item, marked `aria-current="page"`.
- **New trade** opens the dialog with entry time set to now. It's the
  page's primary button.
- **Sign out** works as today ([AuthView.tsx](../../apps/web/src/AuthView.tsx)).
- Below 640px the bar wraps: brand and New trade on the first row, nav and
  Sign out on the second.

## Trading days

A small module, `apps/web/src/tradingDay.ts`:

```ts
type NyDate = { year: number; month: number; day: number }; // month 1–12

nyDateOf(instant: string | Date): NyDate;
nyMidnightUtc(date: NyDate): string; // UTC ISO 8601
monthRange(year: number, month: number): { from: string; to: string };
nyToday(now: Date): NyDate;
localInputAtNy(date: NyDate, hour: number, minute: number): string; // datetime-local value
```

- `nyMidnightUtc` finds New York's UTC offset at that date with
  `Intl.DateTimeFormat` (`timeZoneName: 'longOffset'`). New York midnight
  never falls in a DST gap (the change is at 02:00), so there's exactly one
  answer.
- `localInputAtNy` turns 09:30 New York on a date into the device's
  `datetime-local` value, so the form's existing local → UTC step
  (trades decision 7) sends the right instant.

### Examples (unit tests)

| Input                                                                     | Result                                                                           |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `nyDateOf("2026-10-09T13:45:00Z")`                                        | 2026-10-09 (09:45 EDT)                                                           |
| `nyDateOf("2026-10-10T03:30:00Z")`                                        | 2026-10-09 (23:30 EDT Friday)                                                    |
| `nyDateOf("2026-11-23T14:30:00Z")`, logged at 01:30 Melbourne on the 24th | 2026-11-23                                                                       |
| `nyMidnightUtc(2026-10-01)`                                               | `2026-10-01T04:00:00.000Z` (EDT)                                                 |
| `nyMidnightUtc(2026-12-01)`                                               | `2026-12-01T05:00:00.000Z` (EST)                                                 |
| `monthRange(2026, 11)`                                                    | `2026-11-01T04:00:00.000Z` → `2026-12-01T05:00:00.000Z` (spans the 1 Nov change) |
| `monthRange(2026, 12)`                                                    | `to` is `2027-01-01T05:00:00.000Z`                                               |
| `localInputAtNy(2026-10-08, 9, 30)` with `TZ=America/New_York`            | `2026-10-08T09:30`                                                               |

The web test script runs with `TZ=America/New_York`, which would hide a
bug that mixes up local and New York time. Tests assert from explicit UTC
instants, never from local `Date` getters. At least one test checks
`localInputAtNy` against a value computed with an explicit
`Australia/Melbourne` formatter, so a device in another zone is covered.

## Month model

A pure function in `apps/web/src/calendarModel.ts`:

```ts
buildMonth(trades: TradeView[], year: number, month: number, today: NyDate): MonthView;
```

- **Weeks** run Monday to Sunday. The grid starts on the Monday on or
  before the 1st and ends on the Sunday on or after the last day: 4 to 6
  rows.
- **Days** outside the month are placeholders: no trades are loaded for
  them, they're disabled, and they don't count anywhere.
- **Day:** `net` = exact sum of `metrics.netPnl` of its closed trades;
  `closed` and `open` counts; `outcome` = gain (net > 0), loss (net < 0),
  breakeven (net = 0, with closed trades) or none.
- **Week:** sum and trade count of its days in the month. Week 1 of October
  2026 counts 1–4 October only.
- **Month stats:**

| Stat         | Value                                        | Context line                                        |
| ------------ | -------------------------------------------- | --------------------------------------------------- |
| Net P&L      | Sum of every closed trade's net              | "October to date" (current month) or "October 2026" |
| Day win rate | Gain days ÷ days with closed trades, whole % | "12 green · 6 red days"                             |
| Trades       | Every trade in the month, open included      | "18 trading days", plus " · 2 open" if any          |
| Best day     | Largest gain day                             | Its date, "Oct 8"                                   |
| Worst day    | Largest loss day                             | Its date, "Oct 9"                                   |

- No closed trades: every value is "—". Net P&L's context line says "No
  trades in October. Log a trade." with "Log a trade" as a quiet button
  that opens the dialog.
- No gain day: Best day is "—", "No winning days". Same for Worst day.
- The win rate's percentage is counts, not money, so it may use `number`.

### Shading

The shade step compares each day with the month's largest absolute day
`max`, using decimal multiply and compare:

| Condition               | Step |
| ----------------------- | ---- |
| \|net\| × 3 ≤ `max`     | 1    |
| \|net\| × 3 ≤ `max` × 2 | 2    |
| otherwise               | 3    |

So the biggest day of the month is always step 3, and a month with one
trading day shades it at step 3. Gain days use `--gain-1/2/3` and loss days
`--loss-1/2/3`.

### Examples (unit tests)

| Month                                                | Result                                                    |
| ---------------------------------------------------- | --------------------------------------------------------- |
| Oct 2026 (starts Thursday), no trades                | 5 weeks, first row Mon 28 Sep to Sun 4 Oct, stats all "—" |
| Feb 2027 (starts Monday, 28 days)                    | 4 weeks, no placeholders                                  |
| Aug 2026 (starts Saturday, 31 days)                  | 6 weeks                                                   |
| Day with trades `98.76` and `-21.62`                 | net `77.14`, gain, 2 trades                               |
| Day with `0.1` and `0.2`                             | net `0.3` exactly                                         |
| Day with one open trade                              | outcome none, "1 open", not shaded                        |
| Day with `-1` and `1`                                | breakeven, `$0.00`, not shaded                            |
| Days `+600`, `+200`, `-250`, `+150`                  | steps 3, 1, 2, 1 (`max` 600; 200 × 3 = 600 is step 1)     |
| A trade at `2026-11-01T03:59:59Z` (31 Oct 23:59 EDT) | belongs to October, not November                          |

## Calendar page

`apps/web/src/CalendarPage.tsx`, laid out per
[system.md](../design/system.md#calendar):

```
October 2026  [‹] [›] [Today]                         Loss ■■■□■■■ Profit
[NET P&L] [DAY WIN RATE] [TRADES] [BEST DAY] [WORST DAY]
┌ MON TUE WED THU FRI SAT SUN │ WEEK ┐
│ day cells …                 │ week │
└──────────────────────────────────────┘
```

- The month title is the page's `<h1>`.
- ‹ and › are icon buttons labelled "Previous month" and "Next month".
  Today returns to the current New York month. All three move without
  limits; future months just show future days.
- Each day is a `<button>` with an `aria-label` reading the whole day
  ([system.md](../design/system.md#calendar)). After-today and outside-month
  days are `disabled`.
- The calendar panel is a `<section>` labelled "Daily profit and loss".

### Loading

`listTrades(apiUrl, token, { from, to, limit: 100, cursor? })` in
[api.ts](../../apps/web/src/api.ts), parsed with
`ListTradesResponseSchema`. The page follows `nextCursor` until it's
absent, so a busy month loads in full.

- Each month change aborts the previous month's requests
  (`AbortController`), so a slow September can't overwrite October.
- At most 50 pages (5,000 trades) per month. Past that, the error state
  shows; nobody logs that much by hand.
- While loading, the grid shows with no amounts and stats show "—";
  `aria-busy="true"` on the panel. The previous month's figures are never
  shown under the new month's title.

### Errors

| Case                        | Shows                                                                              |
| --------------------------- | ---------------------------------------------------------------------------------- |
| 401                         | Alert "Your session has expired. Sign in again." with a Sign in button             |
| Network, 5xx, or a bad body | Alert "Couldn't load your trades. Check your connection and try again." with Retry |

The grid stays visible behind the alert, empty.

### After a save

The dialog calls `onSaved(trade)`. The page closes the dialog, shows the
"Trade saved" toast and refetches the month on screen. If the trade
belongs to another month, the calendar stays where it is.

## Phone

Below 640px:

- **Stat cards:** `repeat(auto-fit, minmax(140px, 1fr))`, so two across at
  375px.
- **Grid:** 7 equal columns, 4px gaps, panel padding 8px. Weekday headers
  are single letters (`M T W T F S S`) inside `<abbr>` with the full name.
- **Day cells:** min height 64px, 6px padding. The day number (12px), and
  for traded days a compact amount: sign and whole dollars below 1,000
  (`+334`, `−56`), else thousands to one decimal (`+1.3k`), and above
  10,000 whole thousands (`+13k`). No `$` and no trade count, so it fits a
  35px column at 320px. The `aria-label` still reads the exact amount.
- **Week totals** move below the grid as a list: "Week 2 · +$1,002.55 · 17
  trades", one row each.
- Nothing scrolls sideways at 320px or at 200% zoom.
- Day cells at 320px are about 35 × 64px. That's under the design system's
  44px but above WCAG 2.5.8's 24px minimum. The 4px gaps keep neighbours
  from being hit by mistake. This is the only exception to the 44px rule.

## Automated tests

Vitest and Testing Library in `apps/web`, with a stubbed `fetch`.

- **`tradingDay`** — every example in [Trading days](#examples-unit-tests).
- **`buildMonth`** — every example in [Month model](#examples-unit-tests-1),
  plus: no float sums (a test with `0.1 + 0.2`), weeks at the month's
  edges, stats context lines, best and worst with no gain or loss days.
- **`listTrades`** — sends `from`, `to`, `limit` and `cursor`; parses a
  page; throws `ApiError` on 400, 401 and a bad body.
- **Page:**
  - Loads the current New York month (fake timers): one request per page,
    following `nextCursor`, with that month's `from` and `to`.
  - Renders day amounts, trade counts, the "1 open" day, today's badge,
    week totals and stats from a fixture month.
  - ‹ › and Today fetch the right ranges; a slow previous month's response
    is ignored after moving on.
  - Loading, empty, error with Retry, and the 401 alert.
  - Clicking a past day opens the dialog with entry time 09:30 New York on
    that date; clicking today uses now; future and outside days are
    disabled.
  - Saving in the dialog closes it, shows "Trade saved" and refetches.
  - Every day button has an accessible name that includes its amount.

## Manual check

- **Desktop** (1280 × 800): matches the canvas. Keyboard only: Tab to a day,
  Enter opens the dialog, fill in a trade, ⌘Enter saves, the day updates.
- **Phone** (375px and 320px, then a real phone): compact cells, week list
  below, the dialog as a full-screen sheet, nothing scrolls sideways.
- **Time zone:** on the deployed site from Melbourne, log a trade opened at
  01:30 local; it lands on the previous New York date.

## Out of scope

- A day view listing that day's trades (#13), and opening trades from the
  calendar.
- Filters on the calendar (symbol, setup, account).
- Time-of-day and day-of-week stats (#22).
- Remembering the month shown, or a URL per month (routing comes with #8).
- A light theme.

## Open questions

- CME futures sessions open at 18:00 New York on Sunday. A Sunday-evening
  trade lands on Sunday here. Should it count towards Monday, as the
  exchange does? Revisit if futures trades show up on Sundays.
- Should clicking a day with trades show them instead of opening a new
  trade? That's #13's call.
