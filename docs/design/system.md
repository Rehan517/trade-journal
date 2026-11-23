# Design system: Night desk

Status: draft, awaiting review · Brief: [vision](../product/vision.md) · Last
updated: 2026-11-23

## Summary

A dark, quiet workspace where the numbers are the brightest thing on screen.
The home screen is a month of trading days, each shaded by its net P&L, so
good and bad days show at a glance. Logging a trade opens a dialog over the
calendar, and the calendar updates when the trade is saved.

The calendar is the one bold idea. Everything around it stays calm: a
near-black background, one sans-serif face for words, one monospace face for
money and prices, and green and red kept for results.

This doc covers tokens, components and motion. Screens get their layout in
their own spec (`docs/spec/`), built from the parts here. The home screen is
in [calendar.md](../spec/calendar.md) and the New trade dialog in
[trades.md](../spec/trades.md#quick-entry-form-7).

## Directions considered

### Night desk (chosen, 2026-11-23)

A dark month calendar as the home screen, with the trade form in a dialog.
Designed on a canvas and approved by look:
<https://claude.ai/artifact/1utV8cnnBpVHpMD9sBqLNX>.

```
DESKTOP  home
┌────────────────────────────────────────────────────────────────────┐
│ ▣ Trade Journal   Calendar                      [+ New trade]  Sign out │
├────────────────────────────────────────────────────────────────────┤
│ October 2026  [‹][›][Today]                     Loss ■■■□■■■ Profit │
│ ┌NET P&L──┐┌DAY WIN RATE┐┌TRADES──┐┌BEST DAY──┐┌WORST DAY─┐        │
│ │+$3,805.49││67%         ││56      ││+$640.59  ││−$526.83  │        │
│ └──────────┘└────────────┘└────────┘└──────────┘└──────────┘        │
│ ┌ MON   TUE   WED   THU   FRI   SAT   SUN   WEEK ───────────────┐   │
│ │ 28    29    30   ▓1    ▓2     3     4    Week 1 +$578.67      │   │
│ │ ▓5   ▓6   ░7   ▓8   ░9    10    11   Week 2 +$1,002.55       │   │
│ │ …                                                              │   │
│ └────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────┘
```

### Pit card (replaced)

The first approved direction (2026-11-19): each trade a printed paper
ticket on a blue-grey desk, Archivo throughout, ruled cells with fill lines,
light and dark themes. It was built for the quick-entry form (#7). Once
it was live, Rehan found it didn't look good, and wanted the calendar as the
home screen. Rules kept from it are marked **(kept)** below.

## Principles

1. **Results are the loudest thing.** Money, prices and R use a monospace
   face at a heavier weight. Labels are small and muted.
2. **Green and red mean gain and loss.** They appear on P&L, R, calendar
   shading and the Long and Short toggle (long is the bet on a gain).
   Nothing else is green or red: errors use the loss colour only with text
   that says what to fix.
3. **Colour is never alone (kept).** Every money value carries its sign (`+`
   or `−`). Long and Short keep their ▲ and ▼ glyphs and their words.
   Calendar days show the signed amount, not just a shade.
4. **Honest numbers don't animate (kept).** P&L never counts up, ticks or
   pulses. It changes the moment the inputs change.
5. **Desktop first, phone always works (kept).** Each screen is designed at
   desktop width first. Narrower screens get fewer columns of the same
   content, never a different screen, missing features or sideways
   scrolling. Targets stay thumb-sized at every width.
6. **Keyboard first (kept).** Every screen works from the keyboard alone.
   Logging a trade never needs the mouse.

## Colour

Dark only. Tokens are CSS custom properties on `:root`, named for their
role, so a light theme can be added later by redefining them under a
`[data-theme="light"]` selector. The page sets `color-scheme: dark`, so
native date pickers and scrollbars are dark too.

### Surfaces and lines

| Token           | Hex                  | Role                                                         |
| --------------- | -------------------- | ------------------------------------------------------------ |
| `--bg`          | `#0B0E13`            | Page background; input wells                                 |
| `--bar`         | `#0E1218`            | Top bar, dialog result strip                                 |
| `--surface`     | `#12161D`            | Cards, calendar panel, dialog, week totals                   |
| `--cell`        | `#151A21`            | Calendar day with no trades; ghost buttons                   |
| `--cell-future` | `#11151B`            | Calendar day after today                                     |
| `--cell-off`    | `#0D1015`            | Calendar day outside the month                               |
| `--raised`      | `#1A2029`            | Active nav item, icon button background                      |
| `--line`        | `#1E242D`            | Card borders and dividers (decorative, about 1.2:1)          |
| `--line-strong` | `#262E3A`            | Dialog border, ghost button border, segmented control border |
| `--field-edge`  | `#5E6B82`            | Input border. At least 3:1 on every surface, so fields show  |
| `--scrim`       | `rgb(5 7 10 / 0.74)` | Behind an open dialog                                        |

### Text and accents

| Token            | Hex       | Role                                                     |
| ---------------- | --------- | -------------------------------------------------------- |
| `--ink`          | `#E6EBF1` | Headings, values, body text                              |
| `--ink-label`    | `#9AA6B5` | Field labels, unselected toggle text                     |
| `--ink-muted`    | `#8B97A6` | Secondary text: stat context, uppercase labels, nav, "—" |
| `--ink-faint`    | `#7D8896` | Hints, "optional", shortcut hints, future day numbers    |
| `--accent`       | `#2F63D8` | Primary button, Today badge, logo tile                   |
| `--accent-hover` | `#3A6FE6` | Primary button hover                                     |
| `--link`         | `#AFC6FF` | Text links                                               |
| `--on-fill`      | `#FFFFFF` | Text and icons on `--accent` and on the shades           |
| `--focus`        | `#8FB0FF` | Focus ring                                               |
| `--today`        | `#5B8CFF` | Today's outline on the calendar                          |
| `--gain`         | `#3DDC97` | Positive P&L and R as text                               |
| `--loss`         | `#FF6B7A` | Negative P&L and R as text; field error text and border  |

### Calendar shading

Three steps each way, chosen by the size of the day's net P&L (rule in
[calendar.md](../spec/calendar.md#shading)). Day amounts sit on them in white.

| Token      | Hex       | White text | Use                                  |
| ---------- | --------- | ---------- | ------------------------------------ |
| `--gain-1` | `#0E3B2E` | 12.5       | Small winning day                    |
| `--gain-2` | `#11553F` | 8.8        | Medium winning day                   |
| `--gain-3` | `#157052` | 6.0        | Big winning day; selected **▲ Long** |
| `--loss-1` | `#43191F` | 15.0       | Small losing day                     |
| `--loss-2` | `#62202A` | 11.9       | Medium losing day                    |
| `--loss-3` | `#852836` | 8.9        | Big losing day; selected **▼ Short** |

A breakeven day (net exactly `0`) uses `--cell` with its amount in `--ink`.

### Contrast (checked)

| Pair                                           | Ratio              |
| ---------------------------------------------- | ------------------ |
| `--ink` on `--bg` / `--surface` / `--cell`     | 16.1 / 15.1 / 14.6 |
| `--ink-label` on `--surface`                   | 7.3                |
| `--ink-muted` on `--surface` / `--cell`        | 6.1 / 5.9          |
| `--ink-faint` on `--surface` / `--cell-future` | 5.0 / 5.1          |
| `--gain` on `--surface`                        | 10.3               |
| `--loss` on `--surface`                        | 6.6                |
| `--link` on `--bg`                             | 11.4               |
| White on `--accent` / `--accent-hover`         | 5.4 / 4.6          |
| `--bg` text on `--ink` (selected Stock/Future) | 16.1               |
| White on the shades                            | 6.0 to 15.0        |
| `--field-edge` on `--surface` / `--bg`         | 3.4 / 3.6          |
| `--focus` on `--bg`                            | 9.0                |
| `--today` on `--cell`                          | 5.5                |

Rules:

- Text pairs are at least 4.5:1. Input borders are at least 3:1 against
  what's around them (WCAG 1.4.11).
- `--line` and `--line-strong` only group content. They never mark
  something editable on their own.
- Days outside the month are disabled and repeat dates from the next or
  previous month, so their numbers may sit below 4.5:1 (`#3A4350` on
  `--cell-off`). Every other day number passes.
- Any new pair is checked before it's used.

## Typography

### Typefaces

- **Inter** (400, 500, 600, 700) for words: headings, labels, body, buttons.
- **JetBrains Mono** (500, 600) for money, prices, quantities, R and the
  symbol. Monospace digits line up in the calendar and week totals and read
  as "the numbers".

Load both in one Google Fonts request:
`family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600&display=swap`.
Fallbacks: `Inter, system-ui, sans-serif` and
`"JetBrains Mono", ui-monospace, monospace`.

### Scale

| Token         | Size / line | Face  | Weight  | Use                                              |
| ------------- | ----------- | ----- | ------- | ------------------------------------------------ |
| `--t-heading` | 28 / 34     | Inter | 700     | Month title (`letter-spacing: -0.02em`)          |
| `--t-stat`    | 22 / 28     | Mono  | 600     | Stat card values                                 |
| `--t-title`   | 20 / 26     | Inter | 700     | Dialog title                                     |
| `--t-figure`  | 18 / 24     | Mono  | 600     | Dialog result strip values                       |
| `--t-day`     | 16 / 20     | Mono  | 600     | Calendar day amount; numeric field values        |
| `--t-field`   | 16 / 20     | Inter | 400     | Text, time and notes field values                |
| `--t-brand`   | 16 / 20     | Inter | 700     | "Trade Journal" in the top bar                   |
| `--t-week`    | 15 / 20     | Mono  | 600     | Week total                                       |
| `--t-body`    | 14 / 20     | Inter | 400–600 | Body, buttons (600), nav (500)                   |
| `--t-hint`    | 13 / 18     | Inter | 400–600 | Dialog subtitle, day number (600), sign out      |
| `--t-label`   | 12 / 16     | Inter | 600     | Field labels (sentence case), stat context (400) |
| `--t-caps`    | 11 / 14     | Inter | 600     | Uppercase labels: stat names, weekdays, "Week 1" |

Rules:

- **Field values are 16px**, so phones never zoom on focus (iOS zooms below
  16px). The canvas drew 14–15px inputs; the build uses 16px.
- Uppercase is only for `--t-caps` labels that name a figure or a column
  (`NET P&L`, `MON`, `WEEK 1`), with `letter-spacing: 0.06–0.08em`. Field
  labels in forms are sentence case.
- Numbers use `font-variant-numeric: tabular-nums`. Numbers in tables are
  right aligned; stat cards and calendar days are left aligned, because each
  is read on its own.
- The minus sign is the true minus `−` (U+2212) (kept).

### Number formatting (kept)

- Money: sign, `$`, thousands separators, two decimals: `+$3,805.49`,
  `−$526.83`, `$0.00`. Shared maths returns exact strings, and only the
  display layer rounds (trades spec, decision 2). On a phone calendar day,
  whole dollars: `+$334`.
- R: sign, two decimals, a narrow no-break space (U+202F) and `R`:
  `+1.31 R`. Planned reward to risk: `1 : 2.50`.
- Prices: as entered, no thousands separator (`5012.25`).
- Times: local time zone via `Intl.DateTimeFormat`. Short dates: `Oct 8`,
  with the year added when it isn't the current year. Calendar days are New
  York trading days ([calendar.md](../spec/calendar.md#trading-days)).

## Spacing and shape

### Spacing

A 4px base: `--s-1` 4, `--s-2` 8, `--s-3` 12, `--s-4` 16, `--s-5` 20,
`--s-6` 24, `--s-7` 28, `--s-8` 32, `--s-12` 48. Two named exceptions: the
calendar grid gap is 6px and a segmented control's inner gap is 4px.

| Where                            | Space            |
| -------------------------------- | ---------------- |
| Page side gutter                 | 24 (16 on phone) |
| Between home sections            | 20               |
| Inside a stat card               | 16 × 18          |
| Inside a calendar day            | 10 × 12          |
| Dialog padding                   | 24 (16 on phone) |
| Between field rows in the dialog | 12               |
| Between fields in a row          | 14               |
| Label to input                   | 6                |

Content `max-width` is 1360px (85rem), centred. Beyond that, the background
shows.

### Radius

| Element                                                   | Radius |
| --------------------------------------------------------- | ------ |
| Dialog, calendar panel                                    | 16px   |
| Stat card                                                 | 12px   |
| Buttons, inputs, day cells, week cells, segmented control | 10px   |
| Segment inside a segmented control                        | 7px    |
| Legend swatch                                             | 4px    |
| Today badge                                               | 999px  |

### Elevation

Only an open dialog has a shadow: `0 24px 64px rgb(0 0 0 / 0.55)`, over the
scrim. Cards are separated from the background by tone and a `--line`
border, never a shadow.

## Components

### Top bar

`--bar` background, `--line` bottom border, the same `max-width` as the
content. Left: a 32px `--accent` tile with a rising-line icon, then "Trade
Journal" (`--t-brand`). Then the nav. Right: the **New trade** primary
button (with a + icon) and **Sign out** as a quiet link.

- Nav items are links, 44px tall, `--ink-muted`, `--raised` background and
  `--ink` text when current (`aria-current="page"`). The nav shows only
  pages that exist.
- The bar wraps on narrow screens in DOM order (brand, nav, New trade, Sign
  out), so the Tab order always matches what's on screen. It never scrolls
  sideways.
- Nav items: Calendar (`/`) and Trades (`/trades`), real links with
  `aria-current="page"` on the current one.

### Buttons

| Kind    | Look                                                                      | Use                                     |
| ------- | ------------------------------------------------------------------------- | --------------------------------------- |
| Primary | `--accent` fill, white text, 600, hover `--accent-hover`                  | One per view: "New trade", "Save trade" |
| Ghost   | `--cell` fill, 1px `--line-strong` border, `--ink` text; hover `--raised` | Month arrows, "Today", "Cancel"         |
| Icon    | Ghost, 44 × 44, `aria-label` names the action                             | ‹ › month arrows, dialog close ×        |
| Quiet   | Text only in `--link` or `--ink-muted`, underlined on hover               | "Sign out", "Retry"                     |
| Danger  | Ghost with `--loss` text                                                  | "Discard", "Delete trade" (#9)          |

All are at least 44px tall with a 10px radius. Labels say what happens, and
the result uses the same verb: "Save trade" gives "Trade saved" (kept).

### Stat card

```
┌────────────────┐
│ NET P&L        │  --t-caps, --ink-muted
│ +$3,805.49     │  --t-stat, --gain / --loss / --ink
│ October to date│  --t-label 400, --ink-muted
└────────────────┘
```

- `--surface`, 1px `--line` border, 12px radius.
- The context line gives the count behind the number, so a 100% win rate
  on one day looks like what it is (kept).
- Cards sit in a grid of `repeat(auto-fit, minmax(150px, 1fr))` with a 12px
  gap: five across on desktop and tablet, two on a phone.
- Each card is a size container, and its value is
  `clamp(14px, 13cqi, 22px)`: 22px when there's room, smaller in a narrow
  card, so a figure like `+$13,082.44` never breaks mid-number.
- Empty: the value is "—" in `--ink` and the context line says what to do.

### Calendar

A `--surface` panel, 1px `--line` border, 16px radius, 12px padding. A grid
of eight columns: seven days (Monday to Sunday), then a 150px week column.
Gaps are 6px. A header row of `--t-caps` weekday names.

**Day cell** (a `<button>`, min height 112px, 10px radius):

```
┌──────────────┐
│ 8     TODAY  │  day number --t-hint 600; Today badge
│              │
│ +$640.59     │  --t-day, white
│ 5 trades     │  --t-label 400, white at 80%
└──────────────┘
```

| State                    | Background                                                                                                                         | Day number    | Content                   |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------- |
| Traded, gain             | `--gain-1/2/3`                                                                                                                     | white at 88%  | Amount and trade count    |
| Traded, loss             | `--loss-1/2/3`                                                                                                                     | white at 88%  | Amount and trade count    |
| Breakeven                | `--cell`                                                                                                                           | `--ink`       | `$0.00` and trade count   |
| Open trades only         | `--cell`                                                                                                                           | `--ink`       | "1 open" in `--ink-muted` |
| No trades                | `--cell`                                                                                                                           | `--ink`       | Empty                     |
| After today              | `--cell-future`                                                                                                                    | `--ink-faint` | Empty, disabled           |
| After today, with trades | as Traded                                                                                                                          | white at 88%  | Amount and trade count    |
| Outside the month        | `--cell-off`                                                                                                                       | `#3A4350`     | Empty, disabled           |
| Today (any state)        | as above, plus a 2px inset `--today` ring and an `--accent` "Today" badge (compact layout: a 6px `--ink` dot instead of the badge) |               |                           |

- Hover brightens the cell (`filter: brightness(1.2)`), 120ms. No movement.
- The cell's `aria-label` reads the whole day: "Oct 8: +$640.59, 5
  trades", or "Oct 10: no trades. Log a trade".
- **Week cell:** `--surface`, `--line` border, 10px radius. "WEEK 2"
  (`--t-caps`, `--ink-muted`), the total (`--t-week`, gain/loss, or "—" in
  `--ink-muted`), and the trade count.
- **Legend:** "Loss", seven 14px swatches (`--loss-3` to `--loss-1`,
  `--cell`, `--gain-1` to `--gain-3`), "Profit". It's decoration
  (`aria-hidden`); the amounts carry the meaning.

Phone layout is in [calendar.md](../spec/calendar.md#phone).

### Dialog

```
┌ New trade                                  [×] ┐  --t-title; subtitle --t-hint --ink-muted
│ Leave exit blank if the position is still open.│
│ [fields]                                       │
├──────────┬──────────┬────────────┬─────────────┤  --line dividers, --bar cells
│ NET P&L  │ RISK     │ R MULTIPLE │ PLANNED R:R │  --t-caps; values --t-figure
├──────────┴──────────┴────────────┴─────────────┤
│ ⌘ Enter to save · Esc to close   [Cancel][Save trade] │
└────────────────────────────────────────────────┘
```

- A native `<dialog>` opened with `showModal()`: the page behind is inert,
  focus stays inside, Esc closes it. `aria-labelledby` points at the title.
- 600px wide (`max-width: 100%`), `--surface`, 1px `--line-strong` border,
  16px radius, the shadow above, over `--scrim`. It sits 24px from the top,
  so Save trade stays on screen in an 800px-high window. Its header, result
  strip and footer stay put; only the field area scrolls. In a window under
  600px high (a laptop at 200% zoom), the whole form scrolls instead with
  the footer pinned, so Save trade is always in reach.
- On open, focus goes to the first field. On close, focus returns to the
  button that opened it.
- **Phone (< 640px):** the dialog fills the screen (no radius, no border),
  the header, fields and result strip scroll together, and only the footer
  with Save trade is pinned to the bottom, inside thumb reach, never
  covering the focused field. That keeps room for the fields when the
  keyboard is up.

### Forms

#### Field

```
Entry price              ← --t-label, --ink-label, a real <label>
┌──────────────────────┐
│ 189.40               │ ← --t-day (16px), --ink; --bg well, 1px --field-edge, 10px radius, 44px tall
└──────────────────────┘
```

| State    | Treatment                                                                               |
| -------- | --------------------------------------------------------------------------------------- |
| Empty    | Placeholder shows the format, not instructions (`0.00`), in `--ink-faint`               |
| Focus    | 2px `--focus` outline, 2px offset                                                       |
| Filled   | Value in `--ink`                                                                        |
| Optional | "optional" right-aligned in the label row, `--ink-faint`                                |
| Error    | Border `--loss`. Message under the input in `--t-label`, `--loss`, saying how to fix it |
| Disabled | Label and value in `--ink-faint`, border dashed                                         |

Kept from #7: prices, quantity and fees are `type="text"` with
`inputmode="decimal"`; Enter in a single-line field moves to the next field
and never submits; Ctrl+Enter (⌘+Enter on Mac) runs the primary action from
any field; errors appear on blur or on save, never per keystroke, in the
trade's own terms.

#### Segmented control

A radio group in a `--bg` well with a 1px `--line-strong` border, 10px
radius and 4px padding. Each segment is 44px tall with a 7px radius.

| Control        | Selected segment            |
| -------------- | --------------------------- |
| Stock / Future | `--ink` fill, `--bg` text   |
| ▲ Long         | `--gain-3` fill, white text |
| ▼ Short        | `--loss-3` fill, white text |

Unselected segments are plain with `--ink-label` text. Arrow keys move
between segments (kept). The glyphs and words stay, so the choice reads
without colour.

#### Tag chips (setup, mistake)

Decided by #12. Starting point: 32px tall, 8px radius, `--cell` fill, 1px
`--line-strong` border, `--t-label`; selected gets an `--ink` fill, `--bg`
text and a ✓. Mistakes look the same as setups: a mistake is a fact to
count, not an alarm, so it isn't red (kept).

### Tables

For the trade list (#8, [trades.md](../spec/trades.md#trade-list-8)) and
the stats tables (#18).

- A semantic `<table>` in one `--surface` panel with a 16px radius, with a
  screen-reader caption and `scope="col"` headers.
- Header row: `--t-caps`, `--ink-muted`, a `--line` rule below, sticky at
  the top while the page scrolls.
- Rows 44px with `--line` between them, `--t-body`. Text columns left
  aligned; numbers in mono with tabular figures, right aligned. P&L and R
  in gain/loss with their sign; "—" for a value that doesn't exist yet.
- Side is `▲ Long` / `▼ Short` in `--ink`, never filled: in a table, green
  and red mean money only.
- Status is a text badge: **Open** in `--link`, "Closed" in `--ink-muted`.
- Below 640px the rows become cards (a `<ol>` of `--surface` boxes, 12px
  radius, two lines each); the table is hidden with `display: none`. A
  table never scrolls sideways.
- More rows load with a ghost **Load more** button under the panel, never
  by infinite scroll.

### Feedback

- **Toast:** a small `--surface` card with a `--line-strong` border at
  bottom left (desktop) or bottom centre (phone), `--t-body`. Past tense:
  "Trade saved". Gone after 4s, kept while hovered or focused, announced
  through `aria-live="polite"` (kept).
- **Alert:** inline above the footer or the calendar, `--surface` with a
  `--loss` 1px border and `--ink` text, `role="alert"`.
- **Loading:** the calendar keeps its grid and shows day cells in `--cell`
  without amounts, with "Loading…" read to screen readers. No spinners or
  skeleton shimmer.

## Motion

Motion only answers something the trader did. Nothing moves on its own.

| Token        | Value                        | Use                                     |
| ------------ | ---------------------------- | --------------------------------------- |
| `--m-fast`   | 120ms                        | Hover, press, toggle, focus             |
| `--m-dialog` | 240ms                        | Dialog and scrim enter                  |
| `--ease-out` | `cubic-bezier(0.2, 0, 0, 1)` | Things arriving                         |
| `--ease-in`  | `cubic-bezier(0.4, 0, 1, 1)` | Things leaving (and 0.75× the duration) |

- The dialog fades in and rises 8px over `--m-dialog`; the scrim fades in.
  On phone the sheet slides up from the bottom. Closing is instant: the
  native `close()` doesn't wait for an exit animation.
- **Numbers never animate (kept).** No count-ups, ticking or flashing.
- **No entrance animations** on page load or month change. A new month
  appears ready.
- **No hover motion.** Hover changes colour or brightness, never position
  or size.
- **Reduced motion** (`prefers-reduced-motion: reduce`): the dialog appears
  in place with a 120ms fade.
- Animate only `transform`, `opacity` and `filter`.

## Accessibility floor (kept)

- Focus is always visible: a 2px `--focus` outline with a 2px offset, from
  the keyboard (`:focus-visible`).
- Every screen works from the keyboard alone, in reading order. The dialog
  traps focus while open and returns it on close.
- Tap targets are at least 44 × 44px. One exception: calendar days on a
  phone, about 35 × 64px at 320px wide, which still clears WCAG 2.5.8's
  24px ([calendar.md](../spec/calendar.md#phone)).
- Contrast is as tabled above.
- Gain and loss are never colour alone (signs, ▲ and ▼, words).
- Every field has a real `<label>`. Errors are linked with
  `aria-describedby`, and the input gets `aria-invalid="true"`.
- Calendar days are buttons with labels that read the whole day.
- Layout works at 320px wide and at 200% zoom without sideways scrolling.

## Open questions

- Chip styling for setup and mistake tags (#12).
- Should the trade list (#8) open trades in the same dialog (#9 edit) or a
  side panel (#13 detail)?
- A light theme later? The tokens are ready for one; nothing is designed.
