# Spec: trades

Status: #5, #6, #7 and #8 approved; redesign changes approved in #43;
#9 edit, close and delete awaiting review · Issues: #5, #6, #7,
#40, #41, #8, #9 (later: #10) · Last updated: 2026-11-24

## Summary

The trade record and the maths built on it. Issue #5 adds the MVP fields to
`TradeSchema` and pure functions for gross P&L, net P&L, initial risk,
R-multiple and outcome. Every later trade screen and the stats use them.

This spec grows with each trade issue. #5 fills in **Fields** and **Maths**.
The later issues add their sections (API, form, list, edit and delete, symbol
settings) here and don't change the earlier sections without updating them.

| Issue    | Section                                                                       | Status  |
| -------- | ----------------------------------------------------------------------------- | ------- |
| #5       | Fields, Maths                                                                 | Done    |
| #6       | API                                                                           | Done    |
| #7       | Quick-entry form                                                              | Done    |
| #40, #41 | Redesign: date range, planned R:R, form in a dialog ([calendar](calendar.md)) | Done    |
| #8       | Trade list                                                                    | Done    |
| #9       | Edit, close, delete                                                           | This PR |
| #10      | Symbol point values                                                           | Later   |

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
  Partial<Pick<Trade, 'pointValue' | 'exitPrice' | 'fees' | 'plannedStop' | 'plannedTarget'>>;

type TradeOutcome = 'win' | 'loss' | 'breakeven';

grossPnl(t: TradeMathInput): string | undefined;
netPnl(t: TradeMathInput): string | undefined;
initialRisk(t: TradeMathInput): string | undefined;
rMultiple(t: TradeMathInput): string | undefined;
tradeOutcome(t: TradeMathInput): TradeOutcome | undefined;
plannedRewardRisk(t: TradeMathInput): string | undefined; // redesign
```

With `multiplier` = `pointValue` for futures and 1 for stocks, and
`direction` = +1 for long and −1 for short:

| Function            | Result                                                                                       | Absent when                            |
| ------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------- |
| `grossPnl`          | (`exitPrice` − `entryPrice`) × `direction` × `quantity` × `multiplier`                       | No `exitPrice` (open)                  |
| `netPnl`            | `grossPnl` − `fees` (missing fees count as `"0"`)                                            | No `exitPrice`                         |
| `initialRisk`       | \|`entryPrice` − `plannedStop`\| × `quantity` × `multiplier`                                 | No `plannedStop`                       |
| `rMultiple`         | `netPnl` ÷ `initialRisk`, 2 dp (decisions 3, 4)                                              | No `exitPrice` or no `plannedStop`     |
| `tradeOutcome`      | `win` if `netPnl` > 0, `loss` if < 0, `breakeven` if = 0                                     | No `exitPrice`                         |
| `plannedRewardRisk` | \|`plannedTarget` − `entryPrice`\| ÷ \|`entryPrice` − `plannedStop`\|, 2 dp (decisions 3, 4) | No `plannedStop` or no `plannedTarget` |

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

### Planned reward to risk (redesign)

The plan as it stood at entry: how far the target is from entry, in units
of how far the stop is. It doesn't depend on quantity, point value, fees or
the exit, so an open trade has one too. It gives the target field a use
(vision principle 5), and the New trade dialog shows it as "Planned R:R"
(`1 : 4.00`). It's computed on read and added to `metrics` like the others
(API decision 8), as `plannedRewardRisk`.

| #   | Trade                                                  | Planned R:R |
| --- | ------------------------------------------------------ | ----------- |
| L   | Example A with target 5020                             | `4.00`      |
| M   | Example B with target 17985.25 (short)                 | `1.50`      |
| N   | Example D with target 247.00 (short)                   | `3.50`      |
| O   | Stock long @ 100, stop 97, target 101                  | `0.33`      |
| P   | Stock long @ 100, stop 99, target 101.005 (rounds up)  | `1.01`      |
| Q   | Example A, no target                                   | —           |
| R   | Example C (target, no stop): long @ 187.50, target 195 | —           |

L: \|5020 − 5000\| ÷ \|5000 − 4995\| = 20 ÷ 5 = `4.00`. The schema already
puts the stop and target on opposite sides of entry and rejects a stop
equal to entry, so the divisor is never zero.

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

## API (#6)

Three authenticated routes on the existing HTTP API, behind the Cognito JWT
authorizer. Handlers live in `apps/api`, request and response schemas in
`packages/shared/src/trade-api.ts`, and the routes and table changes in
`infra`.

| Route              | Lambda                | Success | DynamoDB action |
| ------------------ | --------------------- | ------- | --------------- |
| `POST /trades`     | `CreateTradeFunction` | 201     | `PutItem`       |
| `GET /trades/{id}` | `GetTradeFunction`    | 200     | `GetItem`       |
| `GET /trades`      | `ListTradesFunction`  | 200     | `Query`         |

### Decisions (#6)

1. **One Lambda per route.** Each role is granted only its one action: create
   and get on the Trades table ARN, list on the `byOpenedAt` index ARN only
   (a Query on an index is authorized against the index). No `grantReadData` or
   `grantReadWriteData`, because those add `Scan`, `BatchGetItem` and others.
2. **The caller is the Cognito `sub` from an access token.** The same check
   as `GET /me` (`token_use` must be `access`, `sub` a non-empty string),
   moved into a shared helper in `apps/api/src/lib/auth.ts`. Anything else is 401. The user ID never comes from the path, query or body.
3. **Keys.** `pk = USER#<sub>`, `sk = TRADE#<id>`. Every read uses the
   caller's `pk`, so another user's trade simply isn't found.
4. **Newest first means newest `openedAt`**, not newest created. Back-filling
   last week's trades puts them in date order, which is what the list (#8)
   shows. Ties are broken by `id`.
5. **Ordering uses a local secondary index**, `byOpenedAt`, on `pk` and
   `openedAtKey`. `openedAtKey` is `openedAt` with its fraction padded to 9
   digits, then `#<id>`, e.g. `2026-11-19T01:30:00.000000000Z#<uuid>`.
   Padding makes string order match time order (`"…00Z"` sorts after
   `"…00.5Z"` otherwise).
   - Digits past the 9th (nanoseconds) are dropped from the key, so two
     trades that differ only there sort by `id`. Nobody logs trades that
     precisely.
   - An LSI caps each user's data at 10 GB. Far more than a personal journal
     needs.
   - An LSI, not a GSI, so the list is strongly consistent: a trade shows in
     the list straight after it's created. When #9 edits `openedAt`, the
     index follows the item.
   - An LSI can only be added when a table is created, so this change
     **replaces the dev Trades table**. It holds no trades yet (this is the
     first route that writes), so nothing is lost. Adding it later would lose
     data.
     - Adding the index alone doesn't replace it: CloudFormation updates a
       `GlobalTable` in place, and DynamoDB rejects the new `openedAtKey`
       attribute (the first deploy failed and rolled back). The table's
       construct ID is now `TradesTable` (was `Trades`). The new logical ID
       makes CloudFormation create a new table, then delete the old one.
   - Putting `openedAt` in `sk` instead would mean `GET /trades/{id}` can't
     find a trade by ID alone.
6. **The server sets `id`, `createdAt` and `updatedAt`.** `id` is
   `crypto.randomUUID()`. `createdAt` and `updatedAt` are UTC ISO 8601 from
   `new Date().toISOString()`; they're equal on create. #9 updates
   `updatedAt`.
7. **Unknown body keys are rejected**, including `id`, `createdAt` and
   `updatedAt`. A typo such as `planedStop` would otherwise be dropped
   silently and the trade saved without its stop.
8. **Metrics are computed on read, never stored.** Each response runs the
   shared maths functions. A future fix to the maths then applies to every
   trade, and there's no stored copy to go stale.
9. **Decimals stay strings in DynamoDB** (attribute type `S`), exactly as
   validated. Nothing is converted to a DynamoDB number or a JS `number`.
10. **Items read back are parsed with `TradeSchema`.** An item that fails is
    a server bug: it's logged and the request returns 500, rather than
    sending a malformed trade to the UI.
11. **SDK.** `@aws-sdk/client-dynamodb` and `@aws-sdk/lib-dynamodb`. The
    Node 22 Lambda runtime includes them, and `NodejsFunction` leaves
    `@aws-sdk/*` out of the bundle by default.

### Request and response

`POST /trades` body: `CreateTradeRequestSchema`, which is
`TradeFieldsSchema.omit({ id: true }).strict().superRefine(checkTrade)`. All
the field rules and the validation table above apply unchanged.

Every trade in a response is a `TradeView`:

```ts
type TradeMetrics = {
  grossPnl?: string;
  netPnl?: string;
  initialRisk?: string;
  rMultiple?: string;
  outcome?: TradeOutcome;
  plannedRewardRisk?: string; // redesign
};

type TradeView = Trade & {
  createdAt: string; // UTC ISO 8601
  updatedAt: string; // UTC ISO 8601
  metrics: TradeMetrics;
};
```

- `metrics` is always present. A key is left out (not `null`) when the maths
  function returns `undefined`, so an open trade without a stop has
  `metrics: {}`.
- `POST /trades` → 201 with the `TradeView`.
- `GET /trades/{id}` → 200 with the `TradeView`.
- `GET /trades` → 200 with `{ items: TradeView[], nextCursor?: string }`.

All responses have `content-type: application/json` and
`cache-control: no-store`, like `GET /me`.

### Pagination

- `limit`: whole number 1–100, default 25.
- `cursor`: opaque. It's base64url JSON of the last item's `sk` and
  `openedAtKey`. The server adds the caller's `pk` when it rebuilds
  `ExclusiveStartKey`, so a cursor can't point into another user's trades.
- `nextCursor` is present only when DynamoDB returns a `LastEvaluatedKey`.
  As DynamoDB does, the last page can come back with `nextCursor` and the
  next request then returns `{ items: [] }`.
- A malformed `cursor` or out-of-range `limit` is 400.

### Date range

Added by the redesign for the calendar ([calendar.md](calendar.md),
decision 2). `GET /trades` takes two more optional query parameters:

| Param  | Format       | Meaning                              |
| ------ | ------------ | ------------------------------------ |
| `from` | UTC ISO 8601 | Only trades with `openedAt` ≥ `from` |
| `to`   | UTC ISO 8601 | Only trades with `openedAt` < `to`   |

- Either can be used alone. With both, `from` must be before `to`;
  otherwise 400 with `fieldErrors.to` = `to must be after from`. The
  order is compared exactly, like `closedAt` and `openedAt`: sub-millisecond
  digits count and nothing goes through `Date.parse`. It's only checked
  when both values are valid, so a bad `from` reports only on `from`.
- Validated with `z.iso.datetime()`, so a UTC `Z` time is required and an
  offset such as `+11:00` is 400. The calendar always sends UTC. A bound
  with more than 9 fractional digits is 400
  (`Use at most 9 fractional second digits`): stored keys keep 9, so a
  finer bound would be cut and could let in a trade just outside it.
- The range goes into the `byOpenedAt` key condition, so DynamoDB reads
  only that range (no filter expression, no extra read cost). Bounds are
  padded the same way as `openedAtKey` (decision 5), with no `#<id>` suffix:

  | Params | `KeyConditionExpression`                         |
  | ------ | ------------------------------------------------ |
  | `from` | `pk = :pk AND openedAtKey >= :from`              |
  | `to`   | `pk = :pk AND openedAtKey < :to`                 |
  | both   | `pk = :pk AND openedAtKey BETWEEN :from AND :to` |

  `BETWEEN` is inclusive, but a stored key is `<time>#<id>`, which sorts
  after the bare bound `<time>`. So a trade opened exactly at `from` is in
  and a trade opened exactly at `to` is out, as the table says.

- Order and paging are unchanged: newest first, `limit` and `nextCursor`.
  The client sends the same `from` and `to` with every page.
- A cursor from outside the range is 400 `cursor is not valid`, not 500.
  Both stores check the cursor's `openedAtKey` against the range with the
  same rule before querying, so the 400 doesn't depend on DynamoDB's error
  wording. A `ValidationException` about the start key from DynamoDB maps
  to the same 400 as a fallback.
- No IAM change: the list role is already allowed `Query` on the index.

### Errors

| Case                                                | Status | Body                                                    |
| --------------------------------------------------- | ------ | ------------------------------------------------------- |
| No access token, ID token, or no `sub`              | 401    | `{ message: "Unauthorized" }`                           |
| Body isn't JSON                                     | 400    | `{ message: "Body must be valid JSON" }`                |
| Body fails `CreateTradeRequestSchema`               | 400    | `{ message: "Invalid trade", fieldErrors, formErrors }` |
| Bad `limit`, `cursor`, `from` or `to`               | 400    | `{ message: "Invalid query", fieldErrors, formErrors }` |
| Trade not found, another user's, or a non-UUID `id` | 404    | `{ message: "Trade not found" }`                        |
| DynamoDB error or a stored item fails parsing       | 500    | `{ message: "Internal error" }`                         |

- `fieldErrors` and `formErrors` come from `z.flattenError`:
  `fieldErrors` maps a field name to its messages, so the form (#7) can show
  each one next to its input. `formErrors` holds body-level problems, such as
  an unknown key or a body that isn't an object.
- A non-UUID `id` is 404, not 400: the answer is the same as for a trade
  that belongs to someone else.
- 500 bodies never include the error. The detail goes to the log.

### Infra

- `TABLE_NAME` environment variable on all three functions.
- CORS `allowMethods` adds `POST`.
- `GET /health` stays public and `GET /me` is unchanged.

### Automated tests (#6)

- **Handlers** (`apps/api`, Vitest). Handlers take a `TradeStore` interface,
  so the tests use an in-memory store with the same keys and ordering.
  - Round trip: create, then get it by ID, then find it in the list, with
    the same fields and metrics. Example A from the maths table comes back
    with `netPnl` `"98.76"` and `rMultiple` `"1.98"`.
  - Another user's ID: user B gets 404 for a trade user A created, and B's
    list doesn't include it.
  - 400 with `fieldErrors` for: a future without `pointValue`, a stop on the
    wrong side, an unknown key, `id` in the body, and a body that isn't
    JSON.
  - List order is newest `openedAt` first, including a trade back-filled
    after a newer one. Paging with `limit` and `nextCursor` returns every
    trade exactly once. Bad `limit` and `cursor` are 400.
  - Each handler returns 401 for the cases in the `GET /me` tests.
- **DynamoDB store** (`aws-sdk-client-mock`): the commands sent. `PutItem`
  has `attribute_not_exists(sk)`, `GetItem` uses the caller's `pk`, `Query`
  uses `byOpenedAt` with `ScanIndexForward: false`, and decimals are stored
  as strings.
- **Infra** (`infra/test/api.test.ts`): the three routes use the JWT
  authorizer; each role has exactly its one DynamoDB action (create and get
  on the table, list on the index only) and nothing else; `/health` and `/me` roles still have
  no policies; the table has the `byOpenedAt` LSI; CORS allows `POST`.

### Automated tests (date range)

- **Handlers** (in-memory store): `from` alone, `to` alone and both; a
  trade exactly at `from` is included and one exactly at `to` isn't; a
  month spanning a DST change; paging through a range returns each trade
  in it exactly once and none outside it; `from` after `to`, `from` equal
  to `to`, a non-ISO value and an offset time are 400 with the right
  `fieldErrors`; a cursor from outside the range is 400.
- **DynamoDB store** (`aws-sdk-client-mock`): the three key conditions
  above with padded bounds; a `ValidationException` about the start key
  becomes the cursor error.
- **Maths** (`trade-math.test.ts`): planned reward to risk examples L–R,
  and `computeTradeMetrics` includes it.

### Out of scope for #6

- Edit, close and delete (#9).
- Filtering or searching the list (later stats and review issues). The
  date range above is the first filter.
- The form (#7) and list page (#8).

## Quick-entry form (#7)

The "New trade" ticket from the design system (Direction A). It's the screen
used most. **Desktop first**: trades are mostly logged at the desk, so the
main layout is a wide ticket that fits on one screen and can be filled in
from the keyboard alone. It stays fully usable at phone width, with one
column, big cells and numeric keyboards. Everything lives in `apps/web`.
**No API or shared schema changes.** The form posts to `POST /trades` (#6)
and validates with `CreateTradeRequestSchema` before it sends.

Issue #7 was written phone first ("fast on a phone between trades"). This
spec changes its first acceptance criterion to: _I can log a closed MES
trade in under a minute on desktop using only the keyboard, and the form is
still usable at phone width._

### Redesign (2026-11-23)

The form shipped as the Pit card ticket and filled the signed-in screen.
The redesign ([Night desk](../design/system.md), [calendar](calendar.md))
moves it into a **New trade dialog** over the calendar and restyles it.
Its fields, validation, error copy, keyboard behaviour, remembered defaults
and saving rules don't change. The parts below that do are decision 1,
[Fields and layout](#fields-and-layout), the result strip (adds Planned
R:R), saving step 3, [Styling](#styling) and the tests. The [dialog
behaviour](#dialog) is new.

### Additions beyond issue #7

| Addition                                                                                                        | Why                                                                                                            |
| --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| A **point value** cell, shown only for futures                                                                  | The schema requires `pointValue` for a future, so a future can't be saved without it                           |
| Point value is remembered with instrument type and side                                                         | An MES trader types `5` once, not every trade. #10 replaces this with per-symbol values                        |
| Typing an exit price fills a blank exit time with now                                                           | Logging just after closing is the common case. One field instead of two                                        |
| The signed-in home screen becomes the form (redesign: now a dialog over the calendar); the `/me` debug lines go | The walking-skeleton text (token and API user IDs) isn't useful on the main screen. `GET /me` stays in the API |
| Ctrl+Enter (⌘+Enter on Mac) saves from any field                                                                | Keyboard-only logging on desktop, without tabbing down to the button                                           |

### Decisions (#7)

1. **The form opens in a dialog** (redesign; it was "the signed-in screen
   is the form"). The signed-in screen is the calendar
   ([calendar.md](calendar.md)). "New trade" in the top bar, or a calendar
   day, opens the dialog. There's no router yet; #8 adds the list and
   decides on routing.
2. **Validation runs `CreateTradeRequestSchema` in the browser.** The same
   schema as the API, so the form can't accept what the server rejects. The
   form turns its text fields into a request body (below), parses it, and
   maps each issue's `path[0]` to the field cell it belongs to.
3. **Error copy is the form's, not the schema's.** The schema's messages are
   written for developers
   (`plannedStop must be below entryPrice for a long`). The form maps them
   to the design system's copy (table below). An unmapped message is shown
   as is, so nothing is ever hidden. A field's generic copy ("Enter a
   price…") replaces only field-level messages: zod's built-in ones
   ("Invalid…", "Too small…", "Too big…") and the shared decimal schemas'.
   A test checks every message in the
   validation table has a mapping, so a renamed message fails a test
   instead of falling back silently.
4. **Errors show on blur or on save, never per keystroke** (design system).
   Once a field has shown an error, it re-checks as it changes, so the error
   clears as soon as it's fixed.
5. **Server errors are handled too.** A 400's `fieldErrors` go to their
   cells through the same mapping, and `formErrors` go in an alert above the
   save button. That should only happen if the browser and server disagree.
6. **Remembered defaults live in `localStorage`**, key
   `tradeJournal.lastTrade.v1`, holding
   `{ instrumentType, side, pointValue? }`. Written after a successful save.
   Read with a zod schema, and anything missing or malformed falls back to
   stock / long. Wrapped in `try`, so private browsing still works. Per
   device, not per account: that's fine for a personal journal.
7. **Times are `datetime-local` inputs, to the minute.** Values are entered
   and shown in the device's time zone and sent as UTC
   (`new Date(local).toISOString()`, e.g. `2026-11-19T09:41` in Melbourne →
   `2026-11-18T22:41:00.000Z`). Seconds aren't entered: phone pickers handle
   them badly, and a minute is precise enough for the journal. A local time
   that doesn't exist (the spring-forward hour) is shifted by the browser.
   That's acceptable for a manual log.
8. **Entry time defaults to now**, rounded down to the minute, when the form
   opens and after each save.
9. **Open or closed is decided by the exit fields.** Both empty → open
   trade. Exit price and exit time → closed. One without the other is the
   schema's "together" rule. There's no separate open/closed switch.
10. **Live preview uses the shared maths**, never local arithmetic. The
    result strip runs `netPnl`, `rMultiple` and `initialRisk` on the current
    values only when the fields they read pass their own field schemas
    (decimal format, a point value for a future, a whole quantity for a
    future). Otherwise the cell shows "–". The maths functions throw on bad
    input, so they are never called with it.
11. **Display rounding** uses `formatDecimalFixed(parseDecimal(x), 2)` from
    shared, then the design system's format: `+$98.76`, `−$21.62`, `$0.00`,
    `+1.98 R`. Values are exact strings until that last step.
12. **Empty optional fields are left out of the body**, not sent as `""`.
    Fees left empty are left out too, and the schema defaults them to `"0"`.
    Symbol is sent as typed; the schema trims and upper-cases it.
13. **No local stores of trades.** After a save the form only knows the
    `TradeView` the API returned. The list is #8.
14. **Keyboard.** Tab follows reading order, which is DOM order at every
    width (CSS grid places cells, it never reorders them). Arrow keys move
    within the Type and Side radio groups. **Enter in a single-line field
    moves focus to the next field and never submits**: a native form would
    submit on Enter, so the form handles `keydown` itself. Enter in Notes
    adds a line. **Ctrl+Enter or ⌘+Enter saves** from any field, Notes
    included. The save button shows the shortcut as a hint
    (`--t-small`, `--ink-muted`) at ≥ 1024px only.

### Fields and layout

The form sits in the New trade dialog ([system.md](../design/system.md#dialog)).
Fields are boxed inputs in rows. A CSS grid places them, so DOM order (and
Tab order) is the field table's order at every width. Labels stay as in the
field table, so the tests that find inputs by label still hold.

**Desktop and tablet (≥ 640px).** The dialog is 600px wide, centred, 24px
from the top. Its header, result strip and footer stay put, and only the
field area scrolls if the window is too short, so Save trade is always on
screen. At 1280 × 800 nothing scrolls.

```
┌ New trade                                     Open   [×] ┐
│ Leave exit blank if the position is still open.          │
│ Type   [ Stock | Future ]     Side  [ ▲ Long | ▼ Short ] │
│ Symbol [MES     ]  Point value [$ 5 /pt]  Qty [2       ] │
│ Entry  [5000    ]  Exit [5010         ]   Fees [1.24   ] │
│ Entry time [19/11/2026 09:30]   Exit time [19/11 09:45]  │
│ Stop  [4995     ] optional      Target [5020   ] optional│
│ Notes [                                                ] │
├ NET P&L ─────┬ RISK ───────┬ R MULTIPLE ─┬ PLANNED R:R ──┤
│ +$98.76      │ $50.00      │ +1.98 R     │ 1 : 4.00      │
├──────────────┴─────────────┴─────────────┴───────────────┤
│ Ctrl+Enter to save · Esc to close   [Cancel] [Save trade]│
└──────────────────────────────────────────────────────────┘
```

- Rows: Type | Side; Symbol | Point value | Qty; Entry | Exit | Fees;
  Entry time | Exit time; Stop | Target; Notes (3 rows). Row gap 12px,
  column gap 14px.
- For a stock, Point value is removed and Symbol spans its two columns, so
  Qty stays where it was when Type changes.
- The header shows "Open" (`--link`) beside the close button while the
  trade is open (no exit fields), as before.

**Phone (< 640px).** The dialog fills the screen as a sheet. Fields go two
across: Type | Side, Symbol | Point value (Symbol alone for a stock), Qty |
Entry, Exit | Fees, Entry time (full row), Exit time (full row), Stop |
Target, Notes. A `datetime-local` value is cut off at half width, so the
times take full rows. Below 360px, Type and Side take full rows too, so the
toggle labels don't wrap. The result strip is 2 × 2 and scrolls with the
fields and header. Only the footer with Save trade is pinned to the bottom,
inside thumb reach, and scroll padding equal to it keeps it from covering
the focused field.

| Cell        | Body field       | Input                                                                                    | Required         |
| ----------- | ---------------- | ---------------------------------------------------------------------------------------- | ---------------- |
| Type        | `instrumentType` | Radio group, "Stock" / "Future". Remembered                                              | Yes              |
| Side        | `side`           | Radio group, "▲ Long" / "▼ Short". Remembered. Filled `--gain-3` / `--loss-3` (redesign) | Yes              |
| Symbol      | `symbol`         | `text`, `autocapitalize="characters"`, `autocomplete="off"`, `spellcheck=false`, max 12  | Yes              |
| Point value | `pointValue`     | `inputmode="decimal"`, `$` prefix and `/pt` suffix. Futures only. Remembered             | Futures          |
| Qty         | `quantity`       | `inputmode="decimal"`                                                                    | Yes              |
| Entry       | `entryPrice`     | `inputmode="decimal"`, placeholder `0.00`                                                | Yes              |
| Exit        | `exitPrice`      | `inputmode="decimal"`, placeholder `0.00`                                                | With exit time   |
| Fees        | `fees`           | `inputmode="decimal"`, placeholder `0.00`                                                | No (empty → `0`) |
| Entry time  | `openedAt`       | `datetime-local`, defaults to now                                                        | Yes              |
| Exit time   | `closedAt`       | `datetime-local`. Filled with now when an exit price is typed and it's blank             | With exit price  |
| Stop        | `plannedStop`    | `inputmode="decimal"`                                                                    | No               |
| Target      | `plannedTarget`  | `inputmode="decimal"`                                                                    | No               |
| Notes       | `notes`          | `textarea`, max 5000                                                                     | No               |

- Every single-line input has `enterkeyhint="next"`, so the phone keyboard
  labels Enter as "Next", and Enter does move to the next field (decision
  14). The last single-line field before Notes (Target) moves to Notes. The
  whole cell is the click and tap target.
- Switching Type to Stock hides the point value cell and leaves `pointValue`
  out of the body. Switching back restores what was typed.
- Number inputs are `type="text"` with `inputmode="decimal"`, not
  `type="number"`. A number input turns `5012.` into `""` and can't hold a
  decimal string exactly.
- Every field has a real `<label>`. An error is linked with
  `aria-describedby` and the input gets `aria-invalid="true"`.
- Nothing scrolls sideways at 320px or at 200% zoom.

### Result strip

| Value       | Shown when                                                     | Otherwise |
| ----------- | -------------------------------------------------------------- | --------- |
| Net P&L     | `netPnl` is defined (closed, inputs valid)                     | "–"       |
| Risk        | `initialRisk` is defined (stop, inputs valid)                  | "–"       |
| R           | `rMultiple` is defined                                         | "–"       |
| Planned R:R | `plannedRewardRisk` is defined (stop and target, inputs valid) | "–"       |

- Net P&L and R use `--gain` / `--loss` with their sign. Zero is `--ink`.
  Risk and Planned R:R are `--ink`: they're plans, not results.
- Planned R:R shows as `1 : 4.00`.
- An open trade shows "Open" in `--link` in the dialog header.
- The strip has `aria-live="polite"` so screen readers hear the result
  settle. Numbers never animate.

### Error copy

Schema message (or field and issue) → what the form shows under the cell.

| Field / schema message                                 | Form shows                                                             |
| ------------------------------------------------------ | ---------------------------------------------------------------------- |
| `symbol` missing                                       | Enter a symbol, like MES or AAPL.                                      |
| `symbol` too long                                      | Symbols are 12 characters or fewer.                                    |
| `quantity` missing or not a positive decimal           | Enter a quantity above 0, like 2.                                      |
| `entryPrice`, `exitPrice` not a positive decimal       | Enter a price, like 5012.25.                                           |
| `plannedStop`, `plannedTarget` not a positive decimal  | Enter a price, like 5012.25.                                           |
| `pointValue` not a positive decimal                    | Enter dollars per point, like 5.                                       |
| `fees` not a non-negative decimal                      | Enter fees as an amount, like 1.24, or leave blank.                    |
| `openedAt` missing                                     | Enter the entry time.                                                  |
| `exitPrice and closedAt …together`, exit time missing  | Add an exit time, or clear the exit price. (Shown on Exit time)        |
| `exitPrice and closedAt …together`, exit price missing | Add an exit price, or clear the exit time. (Shown on Exit)             |
| `closedAt must not be before openedAt`                 | Exit time can't be before entry time.                                  |
| `pointValue is required for futures`                   | Enter dollars per point, like 5.                                       |
| `pointValue is only allowed for futures`               | (Can't happen: the cell is hidden for stocks. Shown as is if it does.) |
| `quantity must be a whole number for futures`          | Futures quantity must be a whole number.                               |
| `plannedStop must be below entryPrice for a long`      | Stop must be below entry for a long trade.                             |
| `plannedStop must be above entryPrice for a short`     | Stop must be above entry for a short trade.                            |
| `plannedTarget must be above entryPrice for a long`    | Target must be above entry for a long trade.                           |
| `plannedTarget must be below entryPrice for a short`   | Target must be below entry for a short trade.                          |
| `notes` too long                                       | Notes are 5000 characters or fewer.                                    |

### Saving

1. "Save trade" (primary button, `type="submit"`) validates the whole form.
   If anything fails, errors show on their cells and focus moves to the
   first invalid field. Nothing is sent.
2. Valid → `POST {apiUrl}/trades` with `Authorization: Bearer <token>`
   (the access token) and the JSON body. The button reads "Saving…" and is
   disabled, and the shortcut does nothing while a save is in flight, so a
   double click or a repeated Ctrl+Enter can't create two trades.
3. **201**: the response is parsed with `TradeViewSchema`. The toast says
   "Trade saved". Type, side and point value are remembered (decision 6).
   The dialog closes and calls `onSaved(trade)`, so the calendar refetches,
   and focus returns to the button or day that opened it. The next open
   starts from the remembered type, side and point value with everything
   else blank.
4. **400**: errors go on their cells (decision 5). The values stay.
5. **401**: alert "Your session has expired. Sign in again." with a "Sign
   in" button. The values stay in the form until the redirect.
6. **Anything else** (5xx, network error, a 201 body that fails parsing):
   alert "Couldn't save the trade. Check your connection and try again."
   The values stay. For the bad 201 body the trade may well be saved, so the
   alert says "The trade may have been saved. Check the list before saving
   again." instead.

The toast and the calendar day updating are the confirmation. (The Pit
card's "filing a ticket" animation is gone with it.)

`apps/web/src/api.ts` gains
`createTrade(apiUrl, token, body, fetchFn?, signal?)` returning the
`TradeView`, or throwing `ApiError` with the status and, for a 400, the
parsed `ErrorBody`.

### Dialog

New with the redesign. `apps/web/src/TradeDialog.tsx` wraps `TradeForm`
in a native `<dialog>` opened with `showModal()` (see
[system.md](../design/system.md#dialog)).

- **Props:** `open`, `initialOpenedAt` (a `datetime-local` value; now when
  absent), `onSaved(trade)` and `onClose()`. `TradeForm` gains the first
  two as props and its other props are unchanged.
- **Opening:** the form starts blank from the remembered defaults, with
  entry time `initialOpenedAt`. Focus goes to Symbol.
- **Closing without saving:** Esc, Cancel and × close it. If anything other
  than Type and Side has been changed since it opened, the footer first
  asks "Discard this trade?" with **Keep editing** (focused) and
  **Discard** (danger). Esc on that question keeps editing. Nothing is
  kept after a discard.
- Clicking the scrim does nothing, so a stray click never loses a trade.
- While a save is in flight, Esc, Cancel and × do nothing.
- On close, focus returns to the element that opened it.
- The shortcut hint in the footer reads "⌘ Enter to save · Esc to close"
  on a Mac, "Ctrl+Enter to save · Esc to close" elsewhere, at ≥ 1024px
  only.

### Styling

Rewritten for the redesign. `index.css` replaces the Pit card tokens and
pieces with the [Night desk](../design/system.md) ones: colour, type,
spacing, radius and motion tokens, Inter and JetBrains Mono from Google
Fonts, the top bar, buttons, boxed field, segmented control, dialog, result
strip, alert and toast. The calendar adds its own pieces. Nothing outside
the design system's tokens is added. Gaps found while building are
reported in the PR.

### Automated tests (#7)

Vitest and Testing Library in `apps/web`, with a stubbed `fetch`. The web
test script runs with `TZ=America/New_York`, so the local → UTC conversion
is really tested (and covers a zone with DST).

- **Submit, closed trade**: fill in worked example A (MES, future, long,
  pv 5, qty 2, 5000 → 5010, fees 1.24, stop 4995, times 09:30 → 09:45 local)
  and save. One `POST /trades` with the bearer token and exactly this body,
  times in UTC. "Trade saved" shows, and the form resets with Future, Long
  and point value 5 kept.
- **Submit, open trade**: no exit fields. The body has no `exitPrice` or
  `closedAt`, the header shows "Open", and the strip shows Risk `$50.00`
  with "–" for net P&L and R (example H).
- **Live preview**: example A shows `+$98.76` and `+1.98 R` as the last field
  is typed; example B shows `−$21.62` and `−1.08 R`. Clearing the exit price
  returns them to "–".
- **Validation**: each shows next to its own field and blocks the request:
  missing symbol, a bad price, a future without point value, a fractional
  futures quantity, a stop on the wrong side (long and short), exit price
  without exit time, exit time before entry time. Errors appear on blur, not
  while typing, and clear once fixed. Focus goes to the first invalid field
  on save.
- **Error copy coverage**: every message in the validation table has a
  mapping.
- **Server errors**: a 400 with `fieldErrors.plannedStop` shows on Stop; a
  401 shows the session alert; a 500 and a network failure show the retry
  alert, and the values are kept in each case. The button is disabled
  while saving and a second click sends nothing.
- **Defaults**: entry time is now (fake timers). Type, side and point value
  come from `localStorage`; a malformed or missing entry falls back to
  stock / long; a throwing `localStorage` doesn't break the form.
- **Exit time fill**: typing an exit price fills a blank exit time with now,
  and doesn't overwrite one already set.
- **`createTrade`** (`api.test.ts`): the request it sends, a 201 parsed to a
  `TradeView`, a 400 carrying its `ErrorBody`, and a malformed 201.
- **Keyboard**: Enter in a single-line field moves focus to the next field
  and sends nothing; Enter in Notes doesn't save; Ctrl+Enter and ⌘+Enter
  save from any field, Notes included; a second Ctrl+Enter while saving
  sends nothing. Tab order matches the field table above (the layout's reading order).
- **Accessibility**: every input is found by its label, and an errored input
  has `aria-invalid` and is described by its message.
- **Planned R:R** (redesign): example L shows `1 : 4.00`; clearing the
  target returns it to "–".
- **Dialog** (redesign; jsdom has no `showModal`, so the test setup stubs
  `showModal` and `close`): New trade opens it with focus on Symbol and
  entry time now; `initialOpenedAt` sets entry time; Esc, Cancel and ×
  close a blank form at once; with a typed symbol they ask "Discard this
  trade?", and Keep editing keeps the values while Discard closes; the
  scrim doesn't close it; nothing closes it while saving; a 201 closes it,
  calls `onSaved` with the `TradeView` and returns focus to the opener; a
  400, 401 or 500 keeps it open with the values. The existing form tests
  run against the form inside the dialog.

### Manual check

- **Desktop** (a 1280 × 800 window): the open dialog and Save trade are on
  screen without scrolling. From the calendar, log a closed MES trade in
  under a minute with the keyboard only (Tab to New trade, Enter, then
  Tab, Enter, arrows, Ctrl+Enter), and see its day update.
- **Tablet and phone** (768px and 375px wide, then a real phone): the
  dialog layout, the full-screen sheet with the pinned save bar on phone,
  and the decimal keypad for prices, quantity, fees and point value.
  Nothing scrolls sideways at 320px.

### Out of scope for #7

- The trade list (#8).
- Editing, closing an open trade later, and delete (#9).
- Point values per symbol and symbol suggestions (#10).
- Setup and mistake tags, emotion notes and screenshots (later issues).
- A light theme. The redesign is dark only.

## Trade list (#8)

A **Trades** page: every trade, newest first, as a table on desktop and as
cards on a phone. It's the second page, so this issue also adds routing.
Everything lives in `apps/web`. **No API or schema changes**: the page uses
`GET /trades` (#6) as it is, without `from` or `to`, and the `listTrades`
client from the calendar.

### Additions beyond issue #8

| Addition                                                   | Why                                                                                      |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| A small in-house router, with `/` (Calendar) and `/trades` | Two pages need real URLs, back and forward, and nav links that open in a new tab         |
| "Trades" in the top bar's nav                              | The nav only lists pages that exist (calendar decision 5)                                |
| **Load more** button rather than infinite scroll           | Works from the keyboard and with a screen reader, and never loads pages nobody asked for |
| The list refreshes after a save from the Trades page       | The new trade shows straight away, the same way the calendar refreshes                   |

### Decisions (#8)

1. **Routing is in-house, about 40 lines.** A `useRoute()` hook reads
   `location.pathname`, listens to `popstate`, and a `navigate(path)`
   helper calls `history.pushState`. Two routes don't justify React
   Router's bundle and API. If routes get nested or need parameters (#13's
   detail view), this is revisited there.
   - `/` is the Calendar, `/trades` is Trades. Any other path shows the
     Calendar and is replaced with `/` (`history.replaceState`).
   - Nav items are real `<a href>` links. A plain left click is handled in
     the app (`pushState`, no reload); a click with Ctrl, ⌘, Shift or Alt,
     or a middle click, is left to the browser, so "open in new tab"
     works.
   - CloudFront already serves `index.html` for unknown paths
     (`infra/lib/web-hosting.ts`), so a reload or a shared link to
     `/trades` works with no infra change.
   - On a route change the page scrolls to the top and focus moves to its
     `<h1>` (`tabIndex={-1}`), so screen readers announce the new page.
     `document.title` becomes "Trades · Trade Journal" or "Calendar · Trade
     Journal".
   - Signing in always returns to `/` (the OIDC `redirect_uri` is the
     origin). Keeping the path through sign-in is out of scope.
   - Back or forward while the New trade dialog is open changes the page
     behind it but leaves the dialog and its values alone. Focus stays in
     the dialog, and on close it goes to the new page's `<h1>` if the
     button that opened the dialog has gone.
2. **The list is the API's order: newest `openedAt` first** (API decision
   4). There's no sorting control. Filters are #16.
3. **25 trades per page.** The first page loads when the page opens.
   **Load more** fetches the next page with `nextCursor` and appends it.
   The button is shown only while the last page returned a `nextCursor`
   and at least one trade (as DynamoDB does, the last page can come back
   with a cursor and the next one empty).
4. **After a save, the list reloads its first page.** Pages loaded with
   Load more are dropped. One source of truth, like the calendar (its
   decision 8), and a back-filled trade lands in its right place. The old
   rows stay on screen until the new page arrives; Load more waits while
   that reload is in flight, and a Load more from before it is discarded.
   A silent sign-in renewal doesn't reload the list.
5. **Times are local** (vision: shown in the user's time zone), unlike the
   calendar's New York days. The date is short (`Nov 19`, with the year
   when it isn't the current year) and the time uses the locale's 12- or
   24-hour clock, both from `Intl.DateTimeFormat`.
6. **Rows don't open anything yet.** The trade detail (#13) and editing
   (#9) decide what a row does. Until then a row isn't a link or a button,
   so it doesn't look clickable. _Replaced by #9 decision 8: a row's
   symbol opens the trade for editing._

### Columns

| Column  | Shows                                                 | Align | Notes                                          |
| ------- | ----------------------------------------------------- | ----- | ---------------------------------------------- |
| Opened  | `Nov 19 · 09:41` (local)                              | Left  | `<time datetime="…">` with the UTC `openedAt`  |
| Symbol  | `MES`                                                 | Left  | Mono                                           |
| Side    | `▲ Long` / `▼ Short`                                  | Left  | Glyph and word in `--ink`; no fill or colour   |
| Qty     | `2`                                                   | Right | As stored; mono                                |
| Net P&L | `+$98.76`, `−$21.62`, `$0.00`; "—" when open          | Right | `formatMoney`, gain/loss colour, always signed |
| R       | `+1.98 R`, `−1.08 R`; "—" without a stop or when open | Right | `formatR`                                      |
| Status  | **Open** badge (`--link`) or "Closed" (`--ink-muted`) | Left  | The badge is text, so it reads without colour  |

- Side isn't coloured in the list: green and red there mean money, and a
  column of filled Long and Short badges would compete with P&L.
- Wins and losses read without colour: every amount carries its sign
  (design principle 3), and an open trade says "Open" and shows "—".

### Layout

**Desktop and tablet (≥ 640px).** A semantic `<table>` in one `--surface`
panel with a 16px radius, inside the page's `max-width`:

```
Trades
┌──────────────────────────────────────────────────────────────────────┐
│ OPENED          SYMBOL  SIDE      QTY      NET P&L        R   STATUS │
├──────────────────────────────────────────────────────────────────────┤
│ Nov 19 · 09:41  MES     ▲ Long      2      +$98.76   +1.98 R  Closed │
│ Nov 19 · 10:03  MNQ     ▼ Short     1      −$21.62   −1.08 R  Closed │
│ Nov 19 · 10:30  AAPL    ▲ Long     50            —         —  [Open] │
└──────────────────────────────────────────────────────────────────────┘
                              [ Load more ]
```

- Header row: `--t-caps`, `--ink-muted`, a `--line` rule below, sticky at
  the top of the page while scrolling (`position: sticky`).
- Rows 44px, `--line` between them, `--t-body`; numbers in mono with
  tabular figures; P&L and R at `--t-week` (15px) weight 600, so a wide
  figure fits the column. "—" is `--ink-muted`. Status has 24px of space
  on its left, so it never runs into R.
- The table has a caption for screen readers ("Your trades, newest first")
  and `scope="col"` headers.
- Between 640px and 899px, Qty and Status narrow first, Symbol may wrap,
  and Opened breaks onto two lines (date, then time). The table never
  scrolls sideways, even with a 12-character symbol, a past-year date and
  a 7-figure P&L.

**Phone (< 640px).** An ordered list of cards, one per trade, in the same
order. Each card is a standalone `--surface` box with a 12px radius and a
`--line` border, 8px apart, with no panel around the list:

```
┌──────────────────────────────┐
│ MES ▲ Long          +$98.76  │
│ Nov 19 · 09:41 · 2   +1.98 R │
└──────────────────────────────┘
┌──────────────────────────────┐
│ AAPL ▲ Long  [Open]        — │
│ Nov 19 · 10:30 · 50        — │
└──────────────────────────────┘
```

- Line 1: symbol, side, and the Open badge for an open trade; net P&L on
  the right.
- Line 2: date and time, then quantity; R on the right.
- The table and the card list are both rendered; CSS shows one and hides
  the other with `display: none`, so only one is announced.
- Nothing scrolls sideways at 320px.

### States

| State                  | Shows                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| First load             | The panel with its header and "Loading…" in a persistent `role="status"` outside it         |
| Trades                 | The rows, and Load more while there's a next page                                           |
| No trades              | An empty panel: "No trades yet." and a **Log a trade** button (ghost) that opens the dialog |
| Loading more           | Load more reads "Loading…" with `aria-busy`, and its rows append when they arrive           |
| 401                    | Alert "Your session has expired. Sign in again." with a Sign in button                      |
| Other first-load error | Alert "Couldn't load your trades. Check your connection and try again." with Retry          |
| Load more error        | The rows stay; the same alert sits under them with Retry, which tries that page again       |

- Leaving the page aborts its requests, so a slow response never lands on
  the other page.
- After Load more, focus stays on the button (or moves to the first new
  row if the button disappears), so keyboard users keep their place. After
  Retry on a failed Load more it returns to the button, and a session
  alert under the rows takes focus on its Sign in button.
- Metrics the page formats (`netPnl`, `rMultiple`) are checked as decimal
  strings when a page arrives; a malformed one is a bad response (the
  error alert), never a crash.

### Top bar

The nav gains **Trades** after Calendar. The current page's link has
`aria-current="page"`. **New trade** works the same on both pages; saving
from the Trades page reloads the list (decision 4) and saving from the
Calendar refreshes the month.

### Automated tests (#8)

Vitest and Testing Library in `apps/web`, with a stubbed `fetch`.

- **Router**: `/trades` renders Trades and `/` the Calendar; an unknown
  path renders the Calendar and is replaced with `/`; clicking a nav link
  pushes the path without a reload, and a click with ⌘ or Ctrl doesn't;
  back and forward (`popstate`) switch pages; focus moves to the new `<h1>`
  and `document.title` changes; `aria-current` follows the page.
- **List**: the first request is `GET /trades?limit=25` with the bearer
  token; rows render in order with every column formatted as above
  (closed win, closed loss, breakeven, open, no stop, a future, a short).
- **Load more**: appends the next page with the cursor; hides when there's
  no `nextCursor` or a page comes back empty; a failed Load more keeps the
  rows and Retry fetches the same page again; focus stays on the button.
- **States**: loading, empty (Log a trade opens the dialog), 401 (Sign in),
  error with Retry.
- **Saving**: a save from the Trades page closes the dialog, shows "Trade
  saved" and reloads the first page.
- **Accessibility**: the table has a caption and column headers; an open
  trade's row reads "Open" and "—"; amounts carry their sign.

### Manual check

- Desktop: the table at 1280px with a mix of trades; Load more; back and
  forward between Calendar and Trades; open Trades in a new tab with
  ⌘-click; reload on `/trades`.
- Phone (375px and 320px): cards, no sideways scroll.

### Out of scope for #8

- Filters and search (#16), and sorting.
- Opening a trade: detail (#13), edit, close and delete (#9).
- A total count of trades (the API doesn't return one).
- Keeping the path through sign-in.

## Edit, close and delete (#9)

A trade can be changed after it's logged: any field edited, an open trade
closed by adding its exit, or the trade deleted. Two new routes,
`PATCH /trades/{id}` and `DELETE /trades/{id}`, and the trade list opens a
trade in the same dialog as New trade, filled in. Areas: `packages/shared`,
`apps/api`, `infra` (two routes and their roles) and `apps/web`.

### Additions beyond issue #9

| Addition                                                                      | Why                                                                                          |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Clearing both exit fields reopens a closed trade                              | Open or closed is decided by the exit fields (#7 decision 9). A mistaken close can be undone |
| Delete lives inside the edit dialog, not on the row                           | One deliberate step before the confirmation, and no destructive button beside every row      |
| A write that races another write on the same trade is 409, never lost         | Two tabs, or a double-sent request, could otherwise overwrite each other silently            |
| The issue's "infra" work: two Lambdas, their routes and CORS `PATCH`/`DELETE` | The issue lists api and web only, but the routes can't exist without them                    |

### Decisions (#9)

1. **`PATCH` is a merge patch** (in the style of RFC 7396). The body holds
   only the fields that change. A field set to `null` is removed. Absent
   fields are left as they are.
   - Fields that can be removed: `exitPrice`, `closedAt`, `pointValue`,
     `plannedStop`, `plannedTarget` and `notes`. The required fields and
     `fees` can't be `null`. Fees go back to `"0"`, not to nothing.
   - The body must change at least one field. `{}` is 400.
   - Unknown keys are rejected, as on create (#6 decision 7). That includes
     `id`, `createdAt`, `updatedAt` and `metrics`.
2. **The rules run on the merged trade, not on the patch.** The handler
   reads the stored trade, applies the patch and parses the result with
   `TradeSchema`. Every rule in the validation table applies, with errors at
   the same paths. A patch of `{ "exitPrice": "5010" }` on an open trade is
   therefore 400 on `closedAt` ("together"). Switching a future to a stock
   needs `"pointValue": null` in the same patch.
3. **Closing a trade is an ordinary edit** that adds `exitPrice` and
   `closedAt`. Reopening one is an edit that sets both to `null`. There's no
   separate close route and no status field.
4. **The whole item is rewritten with `PutItem`**, not `UpdateItem`. The
   handler already has the full merged trade. A put removes cleared
   attributes without a `REMOVE` clause, and it recomputes `openedAtKey`. A
   changed `openedAt` then moves the trade in the `byOpenedAt` index (the
   LSI follows the item, #6 decision 5). `id` and `createdAt` are kept and
   `updatedAt` is set to now. If now isn't later than the stored
   `updatedAt` (two writes in one millisecond, or a clock behind the last
   writer's), it's set 1 ms after the stored value instead. The next write
   is conditional on `updatedAt`, so it must change on every write.
5. **Concurrent writes fail rather than overwrite.** The read uses
   `ConsistentRead`, and the put is conditional on
   `attribute_exists(sk) AND updatedAt = :readUpdatedAt`. If the condition
   fails, the trade is read once more. If it's gone, the answer is 404.
   Otherwise it's 409 `{ message: "Trade changed while saving" }`. Clients
   don't send a version yet (out of scope below). Because the form sends
   only changed fields, edits from two tabs to different fields both
   survive.
6. **Delete is permanent.** `DeleteItem` is conditional on
   `attribute_exists(sk)`. A failed condition is 404, so deleting twice is
   404 the second time. Success is **204** with no body. There's no undo or
   soft delete: the confirmation is the safeguard (open questions).
7. **Another user's trade is 404 on both routes**, exactly as on
   `GET /trades/{id}`. Every key uses the caller's `pk`, so another user's
   trade is never found, and a non-UUID `id` is 404 too.
8. **The list opens trades.** This replaces #8 decision 6. Each row's
   symbol is a button that opens the trade in the **Edit trade** dialog,
   and the button's hit area stretches over the whole row or card. An open
   trade's row also has a **Close** button that opens the same dialog in
   close mode.
   - When #13 adds the trade detail, the row button opens the detail
     instead, and Edit moves there. Until then, editing is the only thing a
     trade can be opened for.
   - The calendar doesn't open trades. A day still opens New trade
     (calendar decision 7) until #13's day view.
9. **Close mode is the edit dialog with focus on Exit.** Nothing else is
   different, so fees can be topped up with the exit commission in the same
   step. There's no smaller exit-only dialog. Typing an exit price fills a
   blank exit time with now (#7), so closing a trade just after exiting
   takes one field and ⌘ Enter.
10. **The form sends only what changed.** It still validates the whole form
    with `CreateTradeRequestSchema` first (#7 decision 2). Then it builds
    the body for the original values and the body for the current values
    (`buildBody`) and diffs them:
    - A key whose value differs is sent.
    - A key that was in the original body and isn't in the current one is
      sent as `null`. Cleared fees are sent as `"0"`.
    - With no changes, Save changes closes the dialog without a request or
      a toast.
11. **Times keep their stored precision unless edited.** Stored times are
    shown to the minute in local time (#7 decision 7). An untouched time
    isn't in the diff, so a `openedAt` of `09:41:30.250Z` isn't rounded by
    an edit to the notes. An edited time is sent to the minute, like a new
    trade's. In one edge case the browser passes and the server rejects:
    an exit time edited to `09:41` against an untouched entry of
    `09:41:30`. The 400 lands on Exit time through the usual mapping.
12. **Remembered defaults aren't touched.** An edit doesn't write
    `tradeJournal.lastTrade.v1` (#7 decision 6). Those defaults are for the
    next new trade.
13. **After a save or a delete, the list reloads its first page**, as after
    a new trade (#8 decision 4). The reload brings back every metric
    recomputed by the server, so P&L and R are updated wherever they're
    shown. The calendar fetches its month each time it's shown, so it
    picks the change up too.

### API

| Route                 | Lambda                | Success       | DynamoDB actions                  |
| --------------------- | --------------------- | ------------- | --------------------------------- |
| `PATCH /trades/{id}`  | `UpdateTradeFunction` | 200 TradeView | `GetItem`, `PutItem` on the table |
| `DELETE /trades/{id}` | `DeleteTradeFunction` | 204, no body  | `DeleteItem` on the table         |

- **Schema** (`packages/shared/src/trade-api.ts`): `UpdateTradeRequestSchema`.
  Every field of `TradeFieldsSchema` except `id` becomes optional, and the
  removable fields (decision 1) are also `.nullable()`. The object is
  `.strict()`, with a refinement that rejects `{}`:
  `formErrors` = `Body must change at least one field`. It has no
  cross-field rules of its own, because they run on the merged trade
  (decision 2).
- **`applyTradePatch(trade, patch): unknown`** is in shared too. It returns
  the stored trade with the patch applied and the `null` keys deleted,
  ready for `TradeSchema.safeParse`. It's pure, so both the handler and the
  tests use it.
- **Store** (`TradeStore`):
  - `replace(userId, record, expectedUpdatedAt)` throws `TradeNotFoundError`
    or `TradeConflictError` (decision 5).
  - `delete(userId, id): Promise<boolean>` returns false when there was
    nothing to delete.
  - The in-memory store enforces the same conditions.
- The body is decoded as on create (base64 when `isBase64Encoded`). Ids are
  lowercased before use, as in get-trade.

| Case                                                                       | Status | Body                                                    |
| -------------------------------------------------------------------------- | ------ | ------------------------------------------------------- |
| No access token, ID token, or no `sub`                                     | 401    | `{ message: "Unauthorized" }`                           |
| Body isn't JSON                                                            | 400    | `{ message: "Body must be valid JSON" }`                |
| Body fails `UpdateTradeRequestSchema`                                      | 400    | `{ message: "Invalid trade", fieldErrors, formErrors }` |
| Merged trade fails `TradeSchema`                                           | 400    | `{ message: "Invalid trade", fieldErrors, formErrors }` |
| Not found, another user's, a non-UUID `id`, or a delete of a deleted trade | 404    | `{ message: "Trade not found" }`                        |
| `PATCH` lost a race with another write (decision 5)                        | 409    | `{ message: "Trade changed while saving" }`             |
| DynamoDB error or a stored item fails parsing                              | 500    | `{ message: "Internal error" }`                         |

- The id is checked before the body is parsed. A `PATCH` with a non-UUID
  id is 404 even when its body is bad.
- A 204 has no `content-type`. Every other response has the same headers
  as #6.

### Infra (#9)

- `UpdateTradeFunction` is allowed `dynamodb:GetItem` and
  `dynamodb:PutItem` on the table ARN. `DeleteTradeFunction` is allowed
  `dynamodb:DeleteItem` on the table ARN. Nothing else, and no `grant*`
  helpers (#6 decision 1). Both get `TABLE_NAME`.
- Routes: `PATCH /trades/{id}` and `DELETE /trades/{id}`, behind the JWT
  authorizer.
- CORS `allowMethods` adds `PATCH` and `DELETE`.
- No table change.

### Dialog modes

`TradeDialog` gains `mode: 'new' | 'edit' | 'close'` and `trade?: TradeView`
(required for edit and close). New trade is unchanged.

| Part          | New trade                          | Edit trade                                                       | Close trade  |
| ------------- | ---------------------------------- | ---------------------------------------------------------------- | ------------ |
| Title         | New trade                          | Edit trade                                                       | Close trade  |
| Starts from   | Remembered defaults, entry now     | The trade's values, times in local time                          | Same as Edit |
| Focus on open | Symbol                             | Symbol                                                           | Exit         |
| Save button   | Save trade                         | Save changes                                                     | Save changes |
| Request       | `POST /trades`                     | `PATCH /trades/{id}` with the diff (decision 10)                 | Same as Edit |
| Toast         | Trade saved                        | Changes saved; **Trade closed** if it was open and is now closed | Same as Edit |
| Discard ask   | Anything but Type and Side changed | Anything changed, Type and Side included                         | Same as Edit |
| Discard copy  | Discard this trade?                | Discard changes?                                                 | Same as Edit |
| Delete        | —                                  | **Delete trade** under Notes                                     | Same as Edit |

- The fields, layout, validation, error copy, keyboard and result strip are
  exactly #7's. The result strip shows the edited trade's numbers live, and
  the header's "Open" follows the exit fields.
- **Delete trade** is a danger button
  ([system.md](../design/system.md#buttons)) on its own row at the end of
  the field area, left aligned. It's kept out of the footer, so it is
  never next to Save, and the phone footer keeps its two buttons.
- **Confirming:** Delete trade swaps the footer for the question **Delete
  this trade? This can't be undone.** with **Keep trade** (ghost, focused)
  and **Delete trade** (danger). Esc and Keep trade go back to the form,
  with its values kept and focus on the first Delete trade button. This is
  the discard question's pattern.
- **Deleting:** the danger button reads "Deleting…", and nothing closes the
  dialog until the request settles.
  - **204**, or a 404 (it's gone either way): the dialog closes, the toast
    says **Trade deleted**, and the list reloads.
  - **401**: the session alert.
  - **Anything else:** the alert "Couldn't delete the trade. Check your
    connection and try again." The question stays, so it can be tried
    again.
- **Saving an edit** follows #7's Saving steps with these differences:
  - **200** is parsed with `TradeViewSchema`.
  - **404**: the alert "This trade has been deleted." Save changes is
    disabled, and closing the dialog reloads the list.
  - **409**: the alert "This trade changed while you were saving. Close it
    and open it again to see the latest." The values stay.
  - A 200 body that fails parsing gets the "may have been saved" alert,
    worded for an edit: "The changes may have been saved. Check the list
    before saving again."
- `apps/web/src/api.ts` gains
  `updateTrade(apiUrl, token, id, patch, fetchFn?, signal?)`, which returns
  the `TradeView`, and `deleteTrade(apiUrl, token, id, fetchFn?, signal?)`.
  `deleteTrade` resolves on a 204 or a 404 and throws `ApiError` otherwise.

### Trade list changes

```
│ Nov 19 · 09:41  MES     ▲ Long      2      +$98.76   +1.98 R  Closed       │
│ Nov 19 · 10:30  AAPL    ▲ Long     50            —         —  [Open] Close │
```

- **Symbol is a button.** Its text stays the symbol in mono, and its
  accessible name is "Edit MES long trade, Nov 19 · 09:41". A `::after`
  stretches its hit area over the row (desktop) or the card (phone), and a
  hover gives the row `--raised`. A table row isn't made a button itself,
  so the cells still read as a table.
- **Close** is a quiet button (`--link`) after the Open badge, above the
  stretched area. Its name is "Close AAPL long trade, Nov 19 · 10:30". On a
  phone it sits at the end of line 1, after the badge. Closed trades have
  no Close.
- Tab order per row: the symbol button, then Close if there is one. Both
  are at least 44px tall.
- **Focus after the dialog:**
  - After an edit or a cancel, focus returns to the button that opened the
    dialog.
  - If the reload then drops that trade, for example when its new
    `openedAt` moves it past the first page, focus moves to the `<h1>`.
  - After a delete, focus goes to the `<h1>`. The toast announces "Trade
    deleted".
- The table caption becomes "Your trades, newest first. Choose a symbol to
  edit."

### Automated tests (#9)

- **Shared** (`trade-api.test.ts`):
  - `UpdateTradeRequestSchema` accepts a single field, and `null` for each
    removable field.
  - It rejects `null` for a required field and for `fees`, `{}`, an
    unknown key, and `id`, `createdAt`, `updatedAt` and `metrics`.
  - `applyTradePatch` sets values, deletes `null` keys and leaves absent
    keys alone.
- **Handlers** (in-memory store):
  - Edit worked example A's exit to 5015. The 200 has `netPnl` `"148.76"`
    and `rMultiple` `"2.98"`, and a following `GET` and the list show the
    same.
  - Close example H with `exitPrice` 5010 and `closedAt`. It gets
    metrics, and `outcome` `win`.
  - Reopen a closed trade with both exit fields `null`. `netPnl` and
    `rMultiple` are gone.
  - Changing `openedAt` moves the trade in the list order.
  - `updatedAt` changes, and `createdAt` and `id` don't.
  - **Another user's trade:** user B gets 404 for `PATCH` and `DELETE` on
    user A's trade, and A's trade is unchanged afterwards and still listed.
  - 400 for: exit price without exit time on an open trade, a stock with
    a point value, a stop moved to the wrong side, `{}`, an unknown key, a
    body that isn't JSON.
  - A non-UUID id is 404 on both routes.
  - Delete is 204 with no body, then `GET` is 404 and a second delete is 404.
  - 409 when the store reports a conflict, and 404 when the trade vanished
    between the read and the write.
  - Each route is 401 for the `GET /me` cases.
- **DynamoDB store** (`aws-sdk-client-mock`):
  - `replace` sends `PutItem` with the caller's `pk`, a recomputed
    `openedAtKey`, no cleared attributes and the `updatedAt` condition.
  - `delete` sends `DeleteItem` with `attribute_exists(sk)`.
  - `ConditionalCheckFailedException` maps to not-found or conflict as
    described in decision 5.
- **Infra:**
  - Both routes use the JWT authorizer.
  - The update role has exactly `GetItem` and `PutItem`, and the delete
    role exactly `DeleteItem`, all on the table only.
  - The existing roles are unchanged.
  - CORS allows `PATCH` and `DELETE`.
- **Web:**
  - **Opening:** the symbol button opens Edit trade filled with the
    trade's values, times shown in local time (`TZ=America/New_York`).
    Close opens Close trade with focus on Exit. Close isn't shown for a
    closed trade.
  - **Diff:** changing only the stop sends exactly
    `{ "plannedStop": "…" }`. Clearing the target sends
    `"plannedTarget": null`. Switching a future to a stock sends
    `"instrumentType": "stock", "pointValue": null`. Clearing fees sends
    `"0"`. Untouched times aren't sent. With no changes, nothing is sent.
  - **Closing:** typing an exit price fills the exit time. ⌘ Enter sends
    `exitPrice` and `closedAt`. The toast says "Trade closed" and the list
    reloads with the row's new P&L and R.
  - **Delete:** the question appears with Keep trade focused. Esc and Keep
    trade send nothing. Delete trade sends one `DELETE`, closes on 204 and
    on 404, says "Trade deleted", reloads the list and focuses the `<h1>`.
    A 500 keeps the question with the alert.
  - **Errors:** a 400 lands on its field, a 404 shows "This trade has been
    deleted." and disables Save, a 409 shows its alert with the values
    kept, and a 401 shows the session alert.
  - **Discard:** changing Side on an edit asks "Discard changes?".
  - **Defaults:** saving an edit leaves `localStorage` untouched.
  - **`updateTrade` and `deleteTrade`** (`api.test.ts`): the method, URL,
    body and bearer token sent, and the handling of each status above.
  - **Accessibility:** the row buttons have the names above, and Tab
    order is symbol, then Close.

### Manual check

- Desktop: edit a closed trade's exit and see P&L and R change in the list
  and on the calendar. Close an open trade from its row with the keyboard
  only. Reopen it. Delete a trade, then cancel a delete with Esc.
- Phone (375px and 320px): tap a card to edit it, and use Close on an open
  card. The delete question fits without sideways scroll.

### Out of scope for #9

- Undo for delete, or a soft delete.
- Version checks from the client (`If-Match` on `updatedAt`), so an edit
  made in another tab while a dialog is open can be detected. Field-level
  diffs cover the common case (decision 5).
- Opening trades from the calendar, and the trade detail (#13).
- Bulk edit and bulk delete.
- Edit history or an audit log.

## Open questions

- Should breakeven allow a small tolerance, such as net P&L within ±fees?
  This spec says no: only exactly zero is breakeven. #17's stats spec can
  revisit it.
- Should delete be undoable? This spec says no (decision 6): a
  confirmation is enough for a personal journal, and an undo needs a soft
  delete that every query has to skip. Revisit if a trade is ever lost by
  mistake.
