# Design system: Pit card

Status: draft, awaiting review · Brief: [vision](../product/vision.md) · Last
updated: 2026-11-19

## Summary

Each trade is a **ticket**, modelled on the paper cards pit traders filled in
by hand. A ticket is a printed form: ruled boxes, each holding one field, with
field labels in blue "print" ink and values in black. Logging a trade means
filling in a ticket. The trade list is a stack of tickets. Stats are tickets
too.

The ticket is the one bold idea. Everything around it stays quiet: a plain
blue-grey desk, one typeface, and colour used for money and nothing else.

This doc covers tokens, components and motion. Screens get their layout in
their own spec (`docs/spec/`), built from the parts here.

## Directions considered

Two directions were sketched. **A was chosen.**

### A: Pit card (chosen)

Trades as printed tickets on a desk. The form is the card. Ruled cells make
each field a clear, large tap target on a phone, and the double-ruled result
strip at the bottom shows the net P&L and R while the ticket is filled in.

```
PHONE  log a ticket
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
┌──────────────────────────────┐
│ Ticket               19 Nov  │
├──────────┬───────────────────┤
│ Side     │ Symbol            │
│ ▲ Long   │ MES   $5/pt       │
├──────────┼─────────┬─────────┤
│ Qty      │ Entry   │ Exit    │
│ 2        │ 5012.25 │ 5016.50 │
├──────────┼─────────┴─────────┤
│ Stop     │ Target            │
│ 5009.00  │ 5020.00           │
├──────────┴───────────────────┤
│ Setup   (ORB) (VWAP) (+)     │
│ Mistake (FOMO) (+)           │
╞══════════════════════════════╡
│  +$42.50          +1.31 R    │
└──────────────────────────────┘
        [ Save ticket ]

DESKTOP  stack of tickets
┌ MES ▲2 ─────┐┌ NQ ▼1 ──────┐┌ AAPL ▲50 ───┐
│ 09:41–09:52 ││ 10:03–10:05 ││ 10:30  open │
│ (ORB)       ││ (VWAP)(FOMO)││ (Pullback)  │
│ +$42.50 1.3R││ −$61.00 −1.4││ open        │
└─────────────┘└─────────────┘└─────────────┘
```

### B: R-ruler (not chosen)

Every trade drawn on one shared R-multiple axis, with a heavy line at −1R that
losses past the planned stop break through. White and slate, IBM Plex Sans.

```
               P&L     R   −2R −1R   0   +1R  +2R  +3R
09:41 MES ▲2  +42.50 +1.31      ┃    ██████▌
10:03 NQ  ▼1  −61.00 −1.42   ▒▒┃████
10:30 MES ▲1   −8.75 −0.27      ┃   █
```

Its R bar is a good chart. It can come back later as a **chart inside a
ticket** (see [Charts](#charts)), but it doesn't set the visual language.

## Principles

1. **One field, one box.** Every input sits in its own ruled cell with its
   label printed above it. The rules are the form's structure, not
   decoration: a rule means "a field boundary" or "a section of the ticket".
2. **Colour means money.** Green and red appear only on P&L, R and win/loss.
   Side (long or short) is never shown with colour. It's a glyph and a word:
   ▲ Long, ▼ Short.
3. **Colour is never alone.** Every money value carries its sign (`+` or
   `−`), so it reads the same in greyscale and for colour-blind traders.
4. **Numbers are the loudest type.** Prices, P&L and R use wide, heavy,
   tabular numerals. Labels use narrow, light ones. The width axis carries
   the hierarchy, so most screens need only one or two sizes.
5. **Honest numbers don't animate.** P&L never counts up, ticks or pulses.
   It changes the moment the inputs change.
6. **Phone first for logging, desk first for review.** The ticket is sized
   for a thumb. Review screens on a laptop add columns, not decoration.

## Colour

Tokens are CSS custom properties on `:root`, redefined for dark mode. Names
describe the role, not the hue.

### Light: day desk

| Token          | Hex       | Role                                                    |
| -------------- | --------- | ------------------------------------------------------- |
| `--desk`       | `#E3E8EE` | Page background, the desk the tickets lie on            |
| `--ticket`     | `#FFFFFF` | Ticket, sheet and table surface                         |
| `--ink`        | `#1C2733` | Values, body text, headings                             |
| `--ink-muted`  | `#566475` | Secondary text: timestamps, hints, calculated values    |
| `--print`      | `#2C55C7` | Field labels, links, focus ring, primary button, "open" |
| `--gain`       | `#0F7052` | Positive P&L and R, win filter                          |
| `--loss`       | `#B33524` | Negative P&L and R, loss filter, field errors           |
| `--rule-field` | `#7E8C9C` | Fill line under an editable value (input boundary)      |
| `--rule`       | `#C9D2DC` | Cell and section dividers inside a ticket               |

### Dark: night desk

US sessions can fall late at night, and the phone is often what logs the
trade, so dark mode is a full theme, not an inversion.

| Token          | Hex       |
| -------------- | --------- |
| `--desk`       | `#151B23` |
| `--ticket`     | `#1F2731` |
| `--ink`        | `#E7ECF2` |
| `--ink-muted`  | `#9AA7B6` |
| `--print`      | `#93ADF5` |
| `--gain`       | `#43C08F` |
| `--loss`       | `#F27A64` |
| `--rule-field` | `#6F7E90` |
| `--rule`       | `#334050` |

The theme follows `prefers-color-scheme`, with a manual override stored per
device.

### Contrast (checked)

| Pair                      | Light           | Dark           |
| ------------------------- | --------------- | -------------- |
| `--ink` on ticket         | 15.1            | 12.7           |
| `--ink-muted` on ticket   | 6.0             | 6.2            |
| `--print` on ticket       | 6.5             | 6.9            |
| `--gain` on ticket / desk | 6.1 / 4.9       | 6.6 / 7.6      |
| `--loss` on ticket / desk | 6.1 / 4.9       | 5.6 / 6.4      |
| `--rule-field` on ticket  | 3.4             | 3.6            |
| Button text on `--print`  | 6.5 (`#FFFFFF`) | 7.9 (`--desk`) |

Rules:

- Text pairs are at least 4.5:1. `--rule-field` is at least 3:1 against the
  ticket, so editable fields are identifiable (WCAG 1.4.11).
- `--rule` is deliberately faint (about 1.5:1). It only groups content and
  never on its own marks something that can be edited.
- Fields live on tickets, never directly on the desk.
- In dark mode, the primary button uses `--desk` for its text, not white.

## Typography

### Typeface

**Archivo**, variable, from Google Fonts: weight 100–900 and width 62–125.
One family for everything. The width axis does the work a second typeface
would usually do:

- **Narrow (`wdth` 75–85)** for labels, table headers and timestamps. They're
  quiet and fit more in a column.
- **Normal (`wdth` 100)** for body text and headings.
- **Wide (`wdth` 112–125)** for values, prices, P&L and R. Wide numerals are
  easier to check at a glance, and they read as the "filled in" part of the
  form.

Numbers always use `font-variant-numeric: tabular-nums lining-nums`, so
columns of prices line up digit for digit.

Load: `family=Archivo:wdth,wght@62..125,100..900&display=swap`. Fallback
stack: `Archivo, "Arial Narrow", system-ui, sans-serif`. The narrow fallback
keeps labels from reflowing badly before the font loads.

### Scale

The classic typographic scale (12, 14, 16, 18, 21, 24, 36, 48), in rem with
a 16px base. Sizes outside the scale aren't used.

| Token          | Size / line | Width | Weight | Use                                               |
| -------------- | ----------- | ----- | ------ | ------------------------------------------------- |
| `--t-figure`   | 48 / 52     | 125   | 750    | Result strip net P&L (desktop), headline stat     |
| `--t-figure-s` | 36 / 40     | 125   | 750    | Result strip net P&L (phone), stat strip values   |
| `--t-heading`  | 24 / 30     | 100   | 650    | Screen title                                      |
| `--t-title`    | 21 / 28     | 100   | 600    | Ticket header, sheet title                        |
| `--t-value`    | 18 / 24     | 112   | 600    | Typed field values, list P&L and R                |
| `--t-body`     | 16 / 24     | 100   | 400    | Notes, paragraphs, helper text                    |
| `--t-label`    | 14 / 18     | 80    | 550    | Field labels (in `--print`), table headers, chips |
| `--t-small`    | 12 / 16     | 85    | 450    | Timestamps, point value hint, fine print          |

Rules:

- Field values are 18px, so phones never zoom on focus (iOS zooms below
  16px) and typed digits are easy to check.
- Labels are sentence case. No all-caps and no letter-spacing tricks. A
  narrow width and the print colour already separate a label from its value.
- Body text in notes and trade detail keeps lines under 70 characters
  (`max-width: 38rem`).
- Text is left aligned. Numbers in tables and stat strips are right aligned,
  so decimal points line up. The result strip puts P&L left and R right.
- The minus sign is the true minus `−` (U+2212), not a hyphen. It's the
  same width as `+` in tabular figures.

### Number formatting

- Money: sign, currency symbol, two decimals: `+$42.50`, `−$61.00`, `$0.00`.
  Shared maths returns exact strings, and only the display layer rounds
  (trades spec, decision 2).
- R: sign, two decimals, a narrow no-break space (U+202F) and `R`: `+1.31 R`.
  In tight table columns the `R` moves into the header.
- Prices: as entered, no thousands separator (`5012.25`). Traders read
  prices the way the chart shows them.
- Times: local time zone, using the locale's 12- or 24-hour format via
  `Intl.DateTimeFormat`. Dates are short: `19 Nov`, with the year added when
  it isn't the current year.

## Spacing and layout

### Spacing scale

A 4px base. Tokens: `--s-1` 4, `--s-2` 8, `--s-3` 12, `--s-4` 16, `--s-6` 24,
`--s-8` 32, `--s-12` 48, `--s-16` 64. Nothing else.

| Where                           | Space                      |
| ------------------------------- | -------------------------- |
| Inside a field cell             | 12 vertical, 16 horizontal |
| Label to value                  | 4                          |
| Between chips                   | 8                          |
| Ticket edge to desk edge, phone | 12                         |
| Between tickets in a stack      | 16 (phone), 24 (desktop)   |
| Between screen sections         | 32 (phone), 48 (desktop)   |

### Shape

Radius follows hierarchy, so it isn't one value everywhere:

| Element                 | Radius              | Why                                  |
| ----------------------- | ------------------- | ------------------------------------ |
| Ticket                  | 6px                 | Card stock: slightly rounded corners |
| Cells inside a ticket   | 0                   | Printed boxes share their rules      |
| Buttons, inputs on desk | 4px                 | A tool, not a card                   |
| Chips                   | 4px                 | Matches buttons; tags aren't pills   |
| Focus ring              | follows its element |                                      |

Tickets have no shadow by default. The desk-to-ticket tone change separates
them. A ticket that is picked up (being dragged, or open as a sheet) gets
one shadow: `0 8px 24px rgb(21 27 35 / 0.18)`. That makes elevation mean
something.

### Layout

- **Phone (< 640px):** one column. The ticket spans the width with a 12px
  desk margin. The primary action sits in a bar pinned to the bottom, inside
  thumb reach.
- **Tablet and laptop (≥ 640px):** the new-ticket form is one ticket,
  `max-width: 34rem`, left aligned in the content area. It isn't centred:
  it's a document on a desk.
- **Review (≥ 1024px):** a left rail (filters, date range) of 16rem plus
  content. The trade list chooses between **Stack** (ticket grid,
  `minmax(16rem, 1fr)` columns) and **Sheet** (table). Sheet is the default
  at scalping volume. The choice is remembered per device.
- Content `max-width` is 80rem. Beyond that, the desk shows.

## Components

### Ticket

The base container for a trade, a form or a group of stats.

```
┌ header ───────────────────────┐  title (--t-title), meta right (--t-small)
├──────────┬────────────────────┤  --rule
│ cell     │ cell               │
├──────────┴────────────────────┤
│ cell                          │
╞═══════════════════════════════╡  double rule: result strip follows
│ result strip                  │
└───────────────────────────────┘
```

- Header: what the ticket is ("New trade", "MES ▲ 2") and one piece of meta
  (date, or "Open").
- Body: a grid of cells. Cells share rules, with no gaps between them.
- Result strip: optional, under a 3px double rule in `--ink`. It holds the
  numbers the ticket adds up to. Only one per ticket.
- States: **open** trade shows "Open" in `--print` in the header and the
  result strip shows unrealised fields as "–". **Closed** shows net P&L and
  R in gain or loss colours.

### Forms

#### Field cell

```
┌────────────────────┐
│ Entry              │  label: --t-label, --print
│ 5012.25            │  value: --t-value, --ink
│ ────────────────── │  fill line: 1px --rule-field
└────────────────────┘
```

| State      | Treatment                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------- |
| Empty      | Fill line only. Placeholder shows format, not instructions (`0.00`), in `--ink-muted`                   |
| Focus      | Fill line becomes 2px `--print`. 2px `--print` outline inset on the cell                                |
| Filled     | Value in `--ink`                                                                                        |
| Calculated | Read-only value in `--ink-muted` with "Calculated" as its hint. No fill line, so it can't look editable |
| Error      | Fill line 2px `--loss`. Message under the value in `--t-small`, `--loss`, saying how to fix it          |
| Disabled   | Label and value in `--ink-muted`, fill line dashed                                                      |

- The whole cell is the tap target (at least 44px tall), and tapping
  anywhere in it focuses the input.
- Prices, quantity and fees use `inputmode="decimal"` and
  `enterkeyhint="next"`, so the phone keyboard moves through the ticket in
  reading order.
- Errors appear on blur or on save, never on each keystroke. Copy says what
  to change, using the trade's own terms: "Stop must be below entry for a
  long trade." "Exit time can't be before entry time." No apologies.
- A symbol cell shows the remembered point value as a hint: `MES  $5/pt`.
  Tapping the hint edits it.

#### Side toggle

A two-segment control in one cell: `▲ Long | ▼ Short`. The selected segment
is filled `--ink` with ticket-coloured text. The other is plain. No green or
red (principle 2). Arrow keys switch between them. It's a radio group.

#### Tag chips (setup, mistake)

```
Setup    [ORB ✓] [VWAP reclaim] [+ New]
```

- 4px radius, 1px `--rule-field` border, `--t-label`.
- Selected: filled `--print`, ticket-coloured text, and a ✓. The tick keeps
  the state visible without colour.
- Mistake chips look the same as setup chips. A mistake is a fact to count,
  not an alarm, so they aren't red.
- "+ New" opens an inline field in the chip row. Enter saves the tag.
- The row wraps. It never scrolls sideways.

#### Buttons

| Kind      | Look                                                   | Use                             |
| --------- | ------------------------------------------------------ | ------------------------------- |
| Primary   | Filled `--print`, 4px radius, `--t-value` at width 100 | One per screen: "Save trade"    |
| Secondary | 1px `--rule-field` border, `--ink` text                | "Close trade", "Add screenshot" |
| Quiet     | Text only in `--print`                                 | "Cancel", "Edit"                |
| Danger    | Secondary with `--loss` text and border                | "Delete trade". Always confirms |

Labels say what happens, and the result uses the same verb: "Save trade"
gives "Trade saved", and "Delete trade" gives "Trade deleted". Min height
44px. No trailing arrows or icons in labels.

#### Screenshot slot

A cell with a dashed `--rule-field` border, "Add screenshot" as a quiet
button, and thumbnails at 4:3 in a row. Paste from the clipboard works on
desktop.

### Tables (Sheet view)

The ticket grid stretched sideways: one ticket, a header row, and the trades
as rows.

```
┌──────────────────────────────────────────────────────────────────────┐
│ Time    Symbol  Side   Qty   Setup      Mistakes      Net P&L      R │
├──────────────────────────────────────────────────────────────────────┤
│ 09:41   MES     ▲ Long   2   ORB                       +42.50  +1.31 │
│ 10:03   NQ      ▼ Short  1   VWAP       FOMO           −61.00  −1.42 │
│ 10:30   AAPL    ▲ Long  50   Pullback                    Open      – │
└──────────────────────────────────────────────────────────────────────┘
```

- Header: `--t-label` in `--print`, narrow width, sentence case, with a 1px
  `--ink` rule below it. Sticky on scroll.
- Rows: 1px `--rule` between them. Row height 44px, or 36px in compact mode
  on desktop only.
- Text columns are left aligned. Numeric columns are right aligned with
  tabular figures. P&L and R are `--t-value` and coloured. Everything else
  is `--t-body`.
- The whole row links to the trade detail. Hover and focus give the row a
  2px `--print` bar on its left edge. No background wash.
- Sorting: the active column's header gets a ▲ or ▼ and `aria-sort`.
- Below 640px the Sheet reflows to Stack. It never scrolls sideways. On
  desktop, if columns overflow, Mistakes and Qty hide first.
- The same pattern serves **By setup** and **By mistake** stats: label column
  left, then Trades, Win rate, Net P&L and Avg R right aligned.

### Stat strip (stat cards)

Stats aren't a row of floating cards. They're **cells of one ticket**,
sharing rules, like the totals box on a form.

```
┌──────────────┬──────────────┬──────────────┬──────────────┐
│ Net P&L      │ Win rate     │ Profit factor│ Expectancy   │
│ +$318.40     │ 58%          │ 1.42         │ +0.21 R      │
│ 42 trades    │ 24 of 42     │              │ per trade    │
└──────────────┴──────────────┴──────────────┴──────────────┘
```

- Label: `--t-label`, `--print`. Value: `--t-figure-s`, `--ink`, or
  gain/loss for money and R only. Context line: `--t-small`, `--ink-muted`,
  giving the count behind the number, so a 100% win rate on one trade looks
  like what it is.
- 4 cells across on desktop, 2 × 2 on phone. Values are left aligned in the
  strip, because each cell is read on its own, not compared down a column.
- No icons, sparklines or trend arrows unless that stat's spec asks for
  one.
- Empty range: the value is "–" and the context line says what to do: "No
  closed trades in this range. Widen the dates or log a trade."

### Charts

Charts (equity curve, P&L by setup) sit inside a ticket like any other
content. Chart colours use `--gain`, `--loss` and `--ink` only, with `--rule`
gridlines. Detailed chart rules are set in the stats spec. Direction B's R
bar is a candidate there.

### Feedback

- **Toast:** a small ticket at bottom centre (phone) or bottom left
  (desktop), `--t-body`. It names the action in the past tense ("Trade
  saved"). Undo is offered for delete. Gone after 4s, kept while hovered or
  focused, announced through `aria-live="polite"`.
- **Empty list:** one ticket outline with dashed rules, and "Log your first
  trade" as a primary button.

## Motion

Motion only answers something the trader did. Nothing moves on its own.

### Tokens

| Token        | Value                        | Use                                     |
| ------------ | ---------------------------- | --------------------------------------- |
| `--m-fast`   | 120ms                        | Press, toggle, chip select, focus       |
| `--m-base`   | 180ms                        | Expand or collapse, row reveal          |
| `--m-sheet`  | 240ms                        | Sheet or dialog enter and exit          |
| `--ease-out` | `cubic-bezier(0.2, 0, 0, 1)` | Things arriving                         |
| `--ease-in`  | `cubic-bezier(0.4, 0, 1, 1)` | Things leaving (and 0.75× the duration) |

### The one orchestrated moment: filing a ticket

When "Save trade" succeeds, the ticket is filed:

1. The ticket shrinks to the height of its header (its stub) over 240ms.
2. The stub moves to the top of the stack or sheet, and the list below
   moves down to make room.
3. The new row or card shows a 2px `--print` outline that fades out over
   1.2s, so the eye finds what was just added.

This is the only multi-step animation in the app. It shows where the trade
went, and it marks the habit the app exists for.

### Rules

- **Numbers never animate.** No count-ups, ticking or flashing on change.
  The result strip updates as soon as an input changes.
- **No entrance animations** on page load, scroll or section reveal. Screens
  appear ready.
- **No hover motion.** Hover changes a colour or a rule, never position or
  size. Tickets don't lift.
- Press feedback: buttons and chips darken for `--m-fast`. No scale.
- Expanding a trade's notes or filter groups animates height and opacity
  over `--m-base`. Content inside doesn't move separately.
- Phone sheets (tag picker, filters) slide up over `--m-sheet` and can be
  dismissed by dragging down. A drag that is let go part way snaps back.
- **Reduced motion** (`prefers-reduced-motion: reduce`): no movement or
  resizing. Filing becomes a 120ms crossfade, and the outline highlight still
  shows, without the fade. Sheets appear in place.
- Animate only `transform` and `opacity`, apart from the expand height.
  Nothing animates layout properties every frame.

## Accessibility floor

- Focus is always visible: a 2px `--print` outline with a 2px offset,
  everywhere, from the keyboard (`:focus-visible`).
- Tap targets are at least 44 × 44px.
- Contrast is as tabled above. Any new colour pair is checked before it's
  used.
- Gain and loss are never colour alone (signs, ✓, ▲ and ▼ carry meaning).
- Every field has a real `<label>`. Errors are linked with
  `aria-describedby`.
- Layout works at 320px wide and at 200% zoom without sideways scrolling.

## Checked against generic defaults

The plan was compared with what a generic trading dashboard would get, and
these changes came out of that:

- **No black screen with neon green.** The usual trading-terminal look. The
  desk is blue-grey, and dark mode is a "night desk", not a terminal.
- **Rules carry meaning.** A printed form could drift into a newspaper look
  with hairlines everywhere. Here a rule marks a field boundary or a ticket
  section. Tickets keep rounded corners, and the cells are square.
- **Stats are one ticket.** Separate floating stat cards with icons and
  shadows were replaced by cells of one ticket that share rules.
- **No monospace for numbers.** Archivo's tabular figures align columns, so
  a second, code-like face isn't needed.
- **Mistakes aren't red.** Red is kept for money, so mistake tags use the
  same chip as setups.

## Open questions

- Point value hint: should tapping `$5/pt` edit it in place, or open the
  symbol settings from issue #10?
- Stack or Sheet as the default list view on desktop. The proposal is Sheet;
  revisit after a week of logging.
- Do screenshots show in the Stack view, or only in the trade detail?
