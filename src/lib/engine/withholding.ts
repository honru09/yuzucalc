/**
 * withholding.ts — income-tax withholding lookups.
 *
 * Monthly: the official 月額表 grid (bands / single points / formula bands),
 * ingested in full from NTA's official Excel (gaps §8.1). A = pay after
 * social-insurance deduction. Dependents above 7 subtract the statutory
 * per-person amount from the 7-person figure (floor ¥0).
 *
 * Bonus: the 算出率 grid keyed by the PRIOR month's A and dependent count.
 * Fallback (no prior-month salary, prior A <= 0, or bonus > 10x prior
 * month's A): monthly-table method, divisor 6 (12 when the bonus basis
 * period exceeds 6 months) — 財務省告示第115号 備考4 (gaps G7).
 * Bonus tax itself truncates to whole yen.
 */
import {
  monthlyTables,
  bonusTable,
  type Column,
  type MonthlyTable,
  type WithholdingVersion,
} from './params.ts';

function kouAt(table: MonthlyTable, kou: number[], dependents: number): number {
  const dep = Math.min(dependents, 7);
  let v = kou[dep];
  if (dependents > 7) v -= table.extraDependentDeduction * (dependents - 7);
  return Math.max(0, v);
}

function otsuFormulaAt(table: MonthlyTable, A: number): number {
  for (const f of table.otsuFormulas) {
    if (A > f.from && (f.to === null || A < f.to)) {
      return f.anchorTax + Math.floor(((A - f.from) * f.ratePct) / 100);
    }
  }
  throw new Error(`no otsu formula for A=${A}`);
}

export function monthlyWithholding(
  A: number,
  column: Column,
  dependents: number,
  version: WithholdingVersion = 'r8',
): number {
  const table = monthlyTables[version];
  if (A <= 0) return 0;
  if (A < table.firstBand.under) {
    return column === 'otsu' ? Math.floor((A * table.firstBand.otsuRatePct) / 100) : 0;
  }
  for (const p of table.points) {
    if (p.at === A) {
      return column === 'kou' ? kouAt(table, p.kou, dependents) : p.otsu ?? otsuFormulaAt(table, A);
    }
  }
  for (const b of table.bands) {
    if (A >= b.from && A < b.to) {
      return column === 'kou' ? kouAt(table, b.kou, dependents) : (b.otsu as number);
    }
  }
  for (const f of table.formulas) {
    if (A > f.from && (f.to === null || A < f.to)) {
      if (column === 'otsu') return otsuFormulaAt(table, A);
      const anchor = table.points.find((p) => p.at === f.from);
      if (!anchor) throw new Error(`missing formula anchor at ${f.from}`);
      const dep = Math.min(dependents, 7);
      let v = anchor.kou[dep] + Math.floor(((A - f.from) * f.ratePct) / 100);
      if (dependents > 7) v -= table.extraDependentDeduction * (dependents - 7);
      return Math.max(0, v);
    }
  }
  throw new Error(`monthly table lookup failed for A=${A}`);
}

const inBandK = (k: number, fromK: number | null, toK: number | null) =>
  (fromK === null || k >= fromK) && (toK === null || k < toK);

export function bonusRatePct(
  priorMonthA: number,
  column: Column,
  dependents: number,
): number {
  const k = priorMonthA / 1000;
  for (const row of bonusTable.rows) {
    if (column === 'otsu') {
      if (row.otsu && inBandK(k, row.otsu.fromK, row.otsu.toK)) return row.ratePct;
    } else {
      const band = row.kou[Math.min(dependents, 7)];
      if (inBandK(k, band.fromK, band.toK)) return row.ratePct;
    }
  }
  throw new Error(`bonus rate lookup failed for priorA=${priorMonthA}`);
}

export interface BonusWithholdingInput {
  bonusAfterPremiums: number;
  /** Prior month's (pay - social insurance). null = no prior-month salary. */
  priorMonthA: number | null;
  column: Column;
  dependents: number;
  /** Bonus basis period in months (default 6); > 6 switches the fallback divisor to 12. */
  basisMonths?: number;
  version?: WithholdingVersion;
}

export function bonusWithholding(input: BonusWithholdingInput): number {
  const { bonusAfterPremiums, priorMonthA, column, dependents } = input;
  if (bonusAfterPremiums <= 0) return 0;
  const useFallback =
    priorMonthA === null || priorMonthA <= 0 || bonusAfterPremiums > 10 * priorMonthA;
  if (useFallback) {
    const divisor = (input.basisMonths ?? 6) > 6 ? 12 : 6;
    const perMonth = Math.floor(bonusAfterPremiums / divisor);
    return monthlyWithholding(perMonth, column, dependents, input.version ?? 'r8') * divisor;
  }
  const rate = bonusRatePct(priorMonthA, column, dependents);
  return Math.floor((bonusAfterPremiums * rate) / 100);
}
