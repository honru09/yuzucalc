/**
 * annual.ts — annual income tax （年末調整・確定申告 basis).
 *
 * Year-versioned 給与所得控除 and 基礎控除 (annual.json; gaps §2).
 * Final tax: quick-calculation table, x 1.021 reconstruction surtax
 * (the combined surtax stays 2.1% through the 2027 defense-surtax swap,
 * gaps §3), truncated to ¥100. Taxable income truncated to ¥1,000.
 */
import { annualParams, type TaxYear } from './params.ts';

export type DependentType =
  | 'general'
  | 'specific' // 特定扶養 (ages 19-22)
  | 'elderly' // 老人扶養 (non-cohabiting)
  | 'elderlyCohabit'; // 同居老親等

interface Band {
  upTo: number | null;
  flat?: number;
  ratePct?: number;
  plus?: number;
  amount?: number;
}

function bandFor(bands: Band[], value: number): Band {
  for (const b of bands) if (b.upTo === null || value <= b.upTo) return b;
  throw new Error('no band');
}

export function salaryDeduction(grossSalary: number, year: TaxYear): number {
  const band = bandFor(annualParams.salaryDeduction[year] as Band[], grossSalary);
  if (band.flat != null) return band.flat;
  return Math.floor((grossSalary * (band.ratePct as number)) / 100) + (band.plus as number);
}

export function salaryIncome(grossSalary: number, year: TaxYear): number {
  return grossSalary - salaryDeduction(grossSalary, year);
}

export function basicDeduction(totalIncome: number, year: TaxYear): number {
  return bandFor(annualParams.basicDeduction[year] as Band[], totalIncome).amount as number;
}

const depKey: Record<DependentType, string> = {
  general: 'dependentGeneral',
  specific: 'dependentSpecific',
  elderly: 'dependentElderly',
  elderlyCohabit: 'dependentElderlyCohabit',
};

export function dependentDeductionIncomeTax(type: DependentType): number {
  return (annualParams.familyDeductions.incomeTax as Record<string, number>)[depKey[type]];
}
export function dependentDeductionResident(type: DependentType): number {
  return (annualParams.familyDeductions.residentTax as Record<string, number>)[depKey[type]];
}
export function adjustmentDiff(type: DependentType | 'spouse'): number {
  return (annualParams.familyDeductions.adjustmentDiffs as Record<string, number>)[
    type === 'spouse' ? 'spouse' : depKey[type]
  ];
}

export function spouseDeductionIncomeTax(taxpayerTotalIncome: number): number {
  return bandFor(
    annualParams.familyDeductions.incomeTax.spouseByTaxpayerIncome as Band[],
    taxpayerTotalIncome,
  ).amount as number;
}
export function spouseDeductionResident(taxpayerTotalIncome: number): number {
  return bandFor(
    annualParams.familyDeductions.residentTax.spouseByTaxpayerIncome as Band[],
    taxpayerTotalIncome,
  ).amount as number;
}

export interface AnnualTaxInput {
  grossSalary: number;
  socialInsurance: number;
  /** Spouse qualifying for 配偶者控除 (spouse total income <= ¥480,000 assumed). */
  spouse?: boolean;
  dependents?: DependentType[];
  year?: TaxYear;
}

export interface AnnualTaxResult {
  salaryIncome: number;
  basicDeduction: number;
  familyDeductions: number;
  taxableIncome: number;
  taxBeforeSurtax: number;
  tax: number;
  marginalRatePct: number;
  effectiveRatePct: number;
}

export function annualIncomeTax(input: AnnualTaxInput): AnnualTaxResult {
  const year = input.year ?? 'r8';
  const si = salaryIncome(input.grossSalary, year);
  const basic = basicDeduction(si, year);
  let family = 0;
  if (input.spouse) family += spouseDeductionIncomeTax(si);
  for (const d of input.dependents ?? []) family += dependentDeductionIncomeTax(d);
  const taxableRaw = si - input.socialInsurance - basic - family;
  const taxable = Math.max(0, Math.floor(taxableRaw / 1000) * 1000);
  const bracket = bandFor(annualParams.brackets as Band[], taxable);
  const rate = bracket.ratePct as number;
  const taxBeforeSurtax =
    taxable === 0 ? 0 : Math.floor((taxable * rate) / 100) - (bracket as { deduction: number }).deduction;
  const tax = Math.floor((taxBeforeSurtax * 1021) / 1000 / 100) * 100;
  return {
    salaryIncome: si,
    basicDeduction: basic,
    familyDeductions: family,
    taxableIncome: taxable,
    taxBeforeSurtax,
    tax: Math.max(0, tax),
    marginalRatePct: rate,
    effectiveRatePct: input.grossSalary > 0 ? (Math.max(0, tax) / input.grossSalary) * 100 : 0,
  };
}
