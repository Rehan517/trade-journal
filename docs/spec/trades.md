# Spec: trades

Status: draft, awaiting review · Issues: #5 (later sections: #6, #7, #8, #9,
#10) · Last updated: 2026-11-19

## Summary

The trade record and the maths built on it. Issue #5 adds the MVP fields to
`TradeSchema` and pure functions for gross P&L, net P&L, initial risk,
R-multiple and outcome. Every later trade screen and the stats use them.

This spec grows with each trade issue. #5 fills in **Fields** and **Maths**.
The later issues add their sections (API, form, list, edit and delete, symbol
settings) here and don't change the earlier sections without updating them.

| Issue | Section             | Status  |
| ----- | ------------------- | ------- |
| #5    | Fields, Maths       | This PR |
| #6    | API                 | Later   |
| #7    | Quick-entry form    | Later   |
| #8    | Trade list          | Later   |
| #9    | Edit, close, delete | Later   |
| #10   | Symbol point values | Later   |

## Additions beyond issue #5

The issue doesn't ask for these, but they belong with the fields and are
cheap to add now. Strike any I don't want before the code starts.

| Addition                                                  | Why                                                       |
| --------------------------------------------------------- | --------------------------------------------------------- |
| A planned target on the wrong side of entry is rejected   | Same mistake as a wrong-side stop                         |
| A stock trade with a point value is rejected              | One way to store a stock trade, so nothing reads it wrong |
| A futures quantity must be a whole number                 | Contracts don't trade in fractions                        |
| `closedAt` can't be before `openedAt`                     | Holding time (#13) and time stats would go negative       |
| Maths functions take a partial trade, not a whole `Trade` | The form's live preview (#7) runs before there's an `id`  |

## Decisions

1. **Decimal arithmetic: scaled `BigInt`, written in-house.** A decimal string
   is parsed to an integer coefficient and a scale (`"5000.25"` →
   `500025n`, scale 2). Add, subtract and multiply are exact. The only
   division is the R-multiple, which rounds to 2 decimal places. No value
   ever passes through a JS `number`.
   - The other option is `big.js` (about 6 KB). It's well tested, but it adds
     a dependency to both the web and Lambda bundles for four operations
     that are about 60 lines with `BigInt`. The worked examples below are the
     safety net.
   - The arithmetic lives in `packages/shared/src/decimal.ts`, next to the
     existing validation.
2. **Money results are exact.** P&L and risk are never rounded in the shared
   functions. `0.25` shares × `3.333` gives `"0.83325"`. Stats sum exact
   values, and the UI rounds for display.
3. **Result format.** Money results are signed decimal strings in canonical
   form: no trailing fractional zeros, no trailing `.`, never `"-0"`. So
   `"100"`, `"98.76"`, `"-21.62"`, `"0"`. The R-multiple always has exactly
   2 decimal places: `"1.98"`, `"2.00"`, `"-1.08"`, `"0.00"`.
4. **Rounding the R-multiple.** Round half away from zero: `1.005` → `"1.01"`,
   `-1.005` → `"-1.01"`. A value that rounds to zero is `"0.00"`, never
   `"-0.00"`.
5. **Net P&L is the headline number.** R-multiple and outcome use net P&L,
   after fees. The vision says honest numbers include fees, so a scratch trade
   with fees is a small loss, not breakeven.
6. **Initial risk leaves fees out.** It's the distance from entry to planned
   stop, × quantity × multiplier. That's the risk planned when entering, and
   matches how traders size positions.
7. **One currency.** All money is in the account currency (USD for US stocks
   and CME futures). Fees are in the same currency. Multi-currency is out of
   scope.
8. **Multiplier.** Futures use `pointValue` (dollars per 1.00 point per
   contract, e.g. MES = `"5"`). Stocks use 1. Stocks store no point value.
9. **Schema shape.** The plain object is exported as `TradeFieldsSchema`, and
   the cross-field rules as a `superRefine` function `checkTrade`.
   `TradeSchema` is `TradeFieldsSchema.superRefine(checkTrade)`. Later schemas
   (for example #6's create body without `id`) can then derive from the base
   object and reuse the same rules. Zod doesn't allow `.omit` on a refined
   object.
10. **Comparisons use the decimal module**, not `Number()`. That includes the
    stop and target side checks.

## Fields

`TradeSchema` in `packages/shared/src/trade.ts`. The fields marked new are
added by #5. The rest are unchanged.

| Field            | Type                               | Required         | Notes                                                        |
| ---------------- | ---------------------------------- | ---------------- | ------------------------------------------------------------ |
| `id`             | UUID                               | Yes              |                                                              |
| `symbol`         | string, trimmed, upper-cased, 1–12 | Yes              |                                                              |
| `instrumentType` | `"stock"` \| `"future"`            | Yes              | **New**                                                      |
| `side`           | `"long"` \| `"short"`              | Yes              |                                                              |
| `quantity`       | positive decimal string            | Yes              | Shares or contracts. Whole number for futures (**new rule**) |
| `pointValue`     | positive decimal string            | Futures only     | **New.** Required for futures, rejected for stocks           |
| `entryPrice`     | positive decimal string            | Yes              |                                                              |
| `exitPrice`      | positive decimal string            | With `closedAt`  | Absent while the trade is open                               |
| `openedAt`       | UTC ISO 8601                       | Yes              |                                                              |
| `closedAt`       | UTC ISO 8601                       | With `exitPrice` | Not before `openedAt` (**new rule**)                         |
| `fees`           | non-negative decimal string        | Defaults `"0"`   | **New.** Total fees and commissions for the round trip       |
| `plannedStop`    | positive decimal string            | No               | **New.** Must be on the losing side of entry                 |
| `plannedTarget`  | positive decimal string            | No               | **New.** Must be on the winning side of entry                |
| `notes`          | string, max 5000                   | No               |                                                              |

- `fees` uses `.default('0')`: the parsed `Trade` always has it, and input may
  leave it out. Paper trades log `"0"`.
- Fees can be recorded on an open trade (the entry commission). They count
  once the trade closes.
- New `NonNegativeDecimalStringSchema` in `decimal.ts`: the same format as
  `PositiveDecimalStringSchema`, but `"0"` and `"0.00"` are allowed.
- A new `InstrumentTypeSchema` and `InstrumentType` type.

### Validation rules

Each rule reports one issue at the path shown.

| Rule                                  | Path            | Message                                              |
| ------------------------------------- | --------------- | ---------------------------------------------------- |
| `exitPrice` and `closedAt` together   | `closedAt`      | `exitPrice and closedAt must be provided together`   |
| `closedAt` ≥ `openedAt`               | `closedAt`      | `closedAt must not be before openedAt`               |
| Future without `pointValue`           | `pointValue`    | `pointValue is required for futures`                 |
| Stock with `pointValue`               | `pointValue`    | `pointValue is only allowed for futures`             |
| Future with a fractional `quantity`   | `quantity`      | `quantity must be a whole number for futures`        |
| Long: `plannedStop` ≥ `entryPrice`    | `plannedStop`   | `plannedStop must be below entryPrice for a long`    |
| Short: `plannedStop` ≤ `entryPrice`   | `plannedStop`   | `plannedStop must be above entryPrice for a short`   |
| Long: `plannedTarget` ≤ `entryPrice`  | `plannedTarget` | `plannedTarget must be above entryPrice for a long`  |
| Short: `plannedTarget` ≥ `entryPrice` | `plannedTarget` | `plannedTarget must be below entryPrice for a short` |

A stop equal to entry is rejected because it makes the risk zero, and the
R-multiple would divide by zero. `"2.0"` counts as a whole number of
contracts.

## Maths

`packages/shared/src/trade-math.ts`. All functions are pure and exported from
the package index.

```ts
type TradeMathInput = Pick<Trade, 'instrumentType' | 'side' | 'quantity' | 'entryPrice'> &
  Partial<Pick<Trade, 'pointValue' | 'exitPrice' | 'fees' | 'plannedStop'>>;

type TradeOutcome = 'win' | 'loss' | 'breakeven';

grossPnl(t: TradeMathInput): string | undefined;
netPnl(t: TradeMathInput): string | undefined;
initialRisk(t: TradeMathInput): string | undefined;
rMultiple(t: TradeMathInput): string | undefined;
tradeOutcome(t: TradeMathInput): TradeOutcome | undefined;
```

With `multiplier` = `pointValue` for futures and 1 for stocks, and
`direction` = +1 for long and −1 for short:

| Function       | Result                                                                 | Absent when                        |
| -------------- | ---------------------------------------------------------------------- | ---------------------------------- |
| `grossPnl`     | (`exitPrice` − `entryPrice`) × `direction` × `quantity` × `multiplier` | No `exitPrice` (open)              |
| `netPnl`       | `grossPnl` − `fees` (missing fees count as `"0"`)                      | No `exitPrice`                     |
| `initialRisk`  | \|`entryPrice` − `plannedStop`\| × `quantity` × `multiplier`           | No `plannedStop`                   |
| `rMultiple`    | `netPnl` ÷ `initialRisk`, 2 dp (decisions 3, 4)                        | No `exitPrice` or no `plannedStop` |
| `tradeOutcome` | `win` if `netPnl` > 0, `loss` if < 0, `breakeven` if = 0               | No `exitPrice`                     |

- An open trade with a planned stop still has an `initialRisk`. The form
  preview (#7) shows it before the exit is known.
- The functions expect values that passed `TradeSchema`. A future with no
  `pointValue`, or a malformed decimal, throws. That's a programming error,
  not user input.
- A trade can have an R of `"0.00"` and still be a `loss`, for example a net
  loss of `0.004` on a risk of `1`. The outcome follows net P&L, not the
  rounded R.

### Worked examples

These are the unit tests. All fees, P&L and risk are in dollars.

| #   | Trade                                                                     | Gross     | Net       | Risk  | R       | Outcome   |
| --- | ------------------------------------------------------------------------- | --------- | --------- | ----- | ------- | --------- |
| A   | Future long, 2 MES (pv 5), 5000 → 5010, fees 1.24, stop 4995              | `100`     | `98.76`   | `50`  | `1.98`  | win       |
| B   | Future short, 1 MNQ (pv 2), 18000.25 → 18010.75, fees 0.62, stop 18010.25 | `-21`     | `-21.62`  | `20`  | `-1.08` | loss      |
| C   | Stock long, 10 AAPL, 187.50 → 190.00, no fees, no stop                    | `25`      | `25`      | —     | —       | win       |
| D   | Stock short, 100 TSLA, 250.50 → 248.25, fees 2, stop 251.50               | `225`     | `223`     | `100` | `2.23`  | win       |
| E   | Stock long, 10 @ 100 → 100, no fees                                       | `0`       | `0`       | —     | —       | breakeven |
| F   | Same as E with fees 1                                                     | `0`       | `-1`      | —     | —       | loss      |
| G   | Stock long, 0.25 @ 187.123 → 190.456, no fees                             | `0.83325` | `0.83325` | —     | —       | win       |
| H   | Future long, 2 MES (pv 5), open at 5000, fees 0.62, stop 4995             | —         | —         | `50`  | —       | —         |
| I   | Stock long, 100 @ 50 → 51.005, no fees, stop 49 (rounds up)               | `100.5`   | `100.5`   | `100` | `1.01`  | win       |
| J   | Stock short, 100 @ 50 → 51.005, no fees, stop 51 (rounds away from zero)  | `-100.5`  | `-100.5`  | `100` | `-1.01` | loss      |
| K   | Stock long, 1 @ 10 → 10, fees 0.004, stop 9 (no negative zero)            | `0`       | `-0.004`  | `1`   | `0.00`  | loss      |

Example A is the one from issue #5: (5010 − 5000) × 2 × 5 = 100, less 1.24
fees = 98.76. Its risk is (5000 − 4995) × 2 × 5 = 50, so R = 98.76 ÷ 50 =
1.9752 → `1.98`.

## Automated tests (#5)

Vitest, in `packages/shared`.

- **Decimal arithmetic** (`decimal.test.ts`): add, subtract, multiply and
  compare across different scales, negative results, canonical output (no
  trailing zeros, no `-0`), and rounded division including the half-way and
  negative cases. No test compares against a JS float result.
- **Schema** (`trade.test.ts`): every rule in the validation table, both the
  rejection (path and message) and the boundary that passes. Also: `fees`
  defaults to `"0"`, a negative or float `fees` is rejected, and the existing
  tests still pass with `instrumentType` added to the fixtures.
- **Maths** (`trade-math.test.ts`): every worked example, each function on its
  own. An open trade gives `undefined` for everything but `initialRisk`. No
  planned stop gives no R.

## Out of scope for #5

- Storing trades, the API and any UI. Those are #6 onward.
- Remembering point values per symbol (#10).
- Stats over many trades (#17–#19). They will reuse the decimal module.
- Several fills per trade (#26), other instruments (#29), and other
  currencies.

## Open questions

- Should breakeven allow a small tolerance, such as net P&L within ±fees?
  This spec says no: only exactly zero is breakeven. #17's stats spec can
  revisit it.
