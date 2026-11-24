import { describe, expect, it } from 'vitest';
import {
  formatAmount,
  formatMoney,
  formatPointValue,
  formatR,
  formatRewardRisk,
  formatShortDate,
  localToUtc,
  toLocalInputValue,
} from './format.ts';

describe('formatMoney', () => {
  it.each([
    ['98.76', '+$98.76', 'gain'],
    ['-21.62', '\u2212$21.62', 'loss'],
    ['0', '$0.00', 'neutral'],
    ['100', '+$100.00', 'gain'],
    ['0.83325', '+$0.83', 'gain'],
    ['-0.004', '$0.00', 'neutral'],
    ['-100.5', '\u2212$100.50', 'loss'],
    ['999.995', '+$1,000.00', 'gain'],
    ['3805.49', '+$3,805.49', 'gain'],
    ['-2000', '\u2212$2,000.00', 'loss'],
    ['1234567.891', '+$1,234,567.89', 'gain'],
  ])('%s -> %s', (exact, text, tone) => {
    expect(formatMoney(exact)).toEqual({ text, tone });
  });
});

describe('formatR and formatAmount', () => {
  it('uses U+202F before R and the true minus', () => {
    expect(formatR('1.98')).toEqual({ text: '+1.98\u202fR', tone: 'gain' });
    expect(formatR('-1.08')).toEqual({
      text: '\u22121.08\u202fR',
      tone: 'loss',
    });
    expect(formatR('0.00')).toEqual({ text: '0.00\u202fR', tone: 'neutral' });
  });
  it('formats risk without a sign', () => {
    expect(formatAmount('50')).toBe('$50.00');
    expect(formatAmount('1250')).toBe('$1,250.00');
  });
});

describe('times', () => {
  it('converts a local minute to UTC (America/New_York)', () => {
    expect(localToUtc('2026-11-19T09:30')).toBe('2026-11-19T14:30:00.000Z');
    expect(localToUtc('2026-07-01T09:30')).toBe('2026-07-01T13:30:00.000Z');
  });
  it('leaves a value the browser cannot read for the schema to reject', () => {
    expect(localToUtc('nope')).toBe('nope');
  });
  it('rounds down to the minute', () => {
    expect(toLocalInputValue(new Date(2026, 10, 19, 9, 30, 59))).toBe(
      '2026-11-19T09:30',
    );
  });
  it('adds the year only when it is not the current one', () => {
    expect(formatShortDate('2026-11-19T09:30', 2026)).not.toMatch(/2026/);
    expect(formatShortDate('2025-11-19T09:30', 2026)).toMatch(/2025/);
  });
});

describe('formatRewardRisk', () => {
  it.each([
    ['4.00', '1 : 4.00'],
    ['2.5', '1 : 2.50'],
    ['0', '1 : 0.00'],
    ['0.125', '1 : 0.13'],
    ['1234.5', '1 : 1234.50'],
  ])('%s -> %s', (exact, text) => {
    expect(formatRewardRisk(exact)).toBe(text);
  });
});

describe('formatPointValue', () => {
  it.each([
    ['5', '$5'],
    ['0.5', '$0.50'],
    ['0.50', '$0.50'],
    ['1000', '$1,000'],
    ['10000', '$10,000'],
    ['5.00', '$5'],
    ['0.125', '$0.125'],
    ['12.5', '$12.50'],
  ])('shows %s as %s', (exact, text) => {
    expect(formatPointValue(exact)).toBe(text);
  });
});
