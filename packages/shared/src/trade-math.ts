import {
  type Decimal,
  absDecimal,
  decimalToString,
  divideDecimal,
  formatDecimalFixed,
  multiplyDecimal,
  negateDecimal,
  parseDecimal,
  signDecimal,
  subtractDecimal,
} from './decimal.js';
import type { Trade } from './trade.js';

export type TradeMathInput = Pick<
  Trade,
  'instrumentType' | 'side' | 'quantity' | 'entryPrice'
> &
  Partial<
    Pick<
      Trade,
      'pointValue' | 'exitPrice' | 'fees' | 'plannedStop' | 'plannedTarget'
    >
  >;

export type TradeOutcome = 'win' | 'loss' | 'breakeven';

/** quantity x multiplier (point value for futures, 1 for stocks). */
function size(t: TradeMathInput): Decimal {
  const quantity = parseDecimal(t.quantity);
  if (t.instrumentType === 'stock') return quantity;
  if (t.pointValue === undefined) {
    throw new Error('pointValue is required for futures');
  }
  return multiplyDecimal(quantity, parseDecimal(t.pointValue));
}

function grossValue(t: TradeMathInput): Decimal | undefined {
  if (t.exitPrice === undefined) return undefined;
  const move = subtractDecimal(
    parseDecimal(t.exitPrice),
    parseDecimal(t.entryPrice),
  );
  return multiplyDecimal(
    t.side === 'long' ? move : negateDecimal(move),
    size(t),
  );
}

function netValue(t: TradeMathInput): Decimal | undefined {
  const gross = grossValue(t);
  if (gross === undefined) return undefined;
  return subtractDecimal(gross, parseDecimal(t.fees ?? '0'));
}

function riskValue(t: TradeMathInput): Decimal | undefined {
  if (t.plannedStop === undefined) return undefined;
  const distance = absDecimal(
    subtractDecimal(parseDecimal(t.entryPrice), parseDecimal(t.plannedStop)),
  );
  return multiplyDecimal(distance, size(t));
}

export function grossPnl(t: TradeMathInput): string | undefined {
  const v = grossValue(t);
  return v && decimalToString(v);
}

export function netPnl(t: TradeMathInput): string | undefined {
  const v = netValue(t);
  return v && decimalToString(v);
}

export function initialRisk(t: TradeMathInput): string | undefined {
  const v = riskValue(t);
  return v && decimalToString(v);
}

/** Net P&L / initial risk, exactly 2 dp, rounded half away from zero. */
export function rMultiple(t: TradeMathInput): string | undefined {
  const net = netValue(t);
  const risk = riskValue(t);
  if (net === undefined || risk === undefined) return undefined;
  return formatDecimalFixed(divideDecimal(net, risk, 2), 2);
}

/** |target - entry| / |entry - stop|, exactly 2 dp, half away from zero. */
export function plannedRewardRisk(t: TradeMathInput): string | undefined {
  if (t.plannedStop === undefined || t.plannedTarget === undefined) {
    return undefined;
  }
  const entry = parseDecimal(t.entryPrice);
  const reward = absDecimal(
    subtractDecimal(parseDecimal(t.plannedTarget), entry),
  );
  const risk = absDecimal(subtractDecimal(entry, parseDecimal(t.plannedStop)));
  return formatDecimalFixed(divideDecimal(reward, risk, 2), 2);
}

export function tradeOutcome(t: TradeMathInput): TradeOutcome | undefined {
  const net = netValue(t);
  if (net === undefined) return undefined;
  const sign = signDecimal(net);
  return sign > 0 ? 'win' : sign < 0 ? 'loss' : 'breakeven';
}
