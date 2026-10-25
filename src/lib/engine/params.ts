/**
 * params.ts — versioned parameter store access.
 *
 * Versioning (prelaunch §0, gaps §3):
 *  - Monthly withholding tables are keyed by PAYMENT DATE: r8 for payments
 *    up to 2026-12, r9 from 2027-01 (the Jan-2027 cliff).
 *  - Social insurance premiums are keyed by FISCAL year (Apr-Mar).
 *  - Annual income tax parameters are keyed by CALENDAR year (r7/r8/r9/r10).
 */
import monthlyR8 from '../../data/params/withholding-monthly-r8.generated.json' with { type: 'json' };
import monthlyR9 from '../../data/params/withholding-monthly-r9.generated.json' with { type: 'json' };
import bonusR8 from '../../data/params/bonus-rates-r8.generated.json' with { type: 'json' };
import social from '../../data/params/social-insurance.generated.json' with { type: 'json' };
import annual from '../../data/params/annual.json' with { type: 'json' };
import resident from '../../data/params/resident-tax.json' with { type: 'json' };
import deviations from '../../data/params/resident-deviations.generated.json' with { type: 'json' };

export interface MonthlyTable {
  version: string;
  label: string;
  firstBand: { under: number; otsuRatePct: number };
  bands: { from: number; to: number; kou: number[]; otsu: number | null }[];
  points: { at: number; kou: number[]; otsu: number | null }[];
  formulas: { from: number; to: number | null; ratePct: number }[];
  otsuFormulas: { from: number; anchorTax: number; ratePct: number; to: number | null }[];
  extraDependentDeduction: number;
  source: string;
}

export interface BonusTable {
  version: string;
  rows: {
    ratePct: number;
    kou: { fromK: number | null; toK: number | null }[];
    otsu: { fromK: number | null; toK: number | null } | null;
  }[];
  source: string;
}

export type WithholdingVersion = 'r8' | 'r9';
export type TaxYear = 'r7' | 'r8' | 'r9' | 'r10';
export type Column = 'kou' | 'otsu';

export const monthlyTables: Record<WithholdingVersion, MonthlyTable> = {
  r8: monthlyR8 as MonthlyTable,
  r9: monthlyR9 as MonthlyTable,
};

/** Payment-date keying: r8 through Dec 2026, r9 from Jan 2027. */
export function withholdingVersionFor(year: number, _month: number): WithholdingVersion {
  return year >= 2027 ? 'r9' : 'r8';
}

export const bonusTable = bonusR8 as BonusTable;

export interface Prefecture {
  ja: string;
  en: string;
  slug: string;
  healthRatePct: number | null;
}

export const socialParams = social;
export const prefectures = social.prefectures as Prefecture[];
export function prefectureBySlug(slug: string): Prefecture {
  const p = prefectures.find((x) => x.slug === slug);
  if (!p) throw new Error(`unknown prefecture: ${slug}`);
  return p;
}

export const annualParams = annual;
export const residentParams = resident;

export interface ResidentDeviation {
  municipality: string;
  prefecture: string;
  shotokuwariTotalPct: number | null;
  kintowariCity: number | null;
  kintowariPref: number | null;
  forestEnvTax: number | null;
  totalFlat: number | null;
  note: string;
  source: string;
}
export const residentDeviations = deviations as ResidentDeviation[];
