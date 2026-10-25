/**
 * calculators.ts — the five launch calculators, composed from the
 * validated primitives. All money in whole yen.
 */
import type { Column, WithholdingVersion } from './params.ts';
import {
  monthlyPremiums,
  bonusPremiums,
  careAppliesForAge,
  type MonthlyPremiums,
  type BonusPremiums,
} from './social-insurance.ts';
import { monthlyWithholding, bonusWithholding } from './withholding.ts';
import { annualIncomeTax, type AnnualTaxResult, type DependentType } from './annual.ts';
import { residentTax, type ResidentTaxResult } from './resident-tax.ts';

/* ---------------- 1. Monthly take-home ---------------- */

export interface MonthlyInput {
  grossPay: number;
  prefectureSlug: string;
  age: number;
  dependents: number;
  column: Column;
  /** Monthly resident tax actually deducted (optional; resident tax is a prior-year levy). */
  residentTaxMonthly?: number;
  healthRateOverridePct?: number | null;
  version?: WithholdingVersion;
}

export interface MonthlyResult {
  premiums: MonthlyPremiums;
  taxableA: number;
  incomeTax: number;
  residentTax: number;
  net: number;
  annualNetEstimate: number;
}

export function monthlyTakeHome(input: MonthlyInput): MonthlyResult {
  const premiums = monthlyPremiums(input.grossPay, {
    prefectureSlug: input.prefectureSlug,
    careApplies: careAppliesForAge(input.age),
    healthRateOverridePct: input.healthRateOverridePct ?? null,
  });
  const taxableA = input.grossPay - premiums.total;
  const incomeTax = monthlyWithholding(taxableA, input.column, input.dependents, input.version ?? 'r8');
  const residentTax = input.residentTaxMonthly ?? 0;
  const net = input.grossPay - premiums.total - incomeTax - residentTax;
  return { premiums, taxableA, incomeTax, residentTax, net, annualNetEstimate: net * 12 };
}

/** Bidirectional solving (Copy #9): smallest gross whose net >= target. Net is non-decreasing in gross (grades and tax bands are step functions with marginal take < 100%). */
export function solveGrossForNet(targetNet: number, input: Omit<MonthlyInput, 'grossPay'>): number {
  let lo = 0;
  let hi = 10_000_000;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (monthlyTakeHome({ ...input, grossPay: mid }).net >= targetNet) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/* ---------------- 2. Bonus take-home ---------------- */

export interface BonusInput {
  bonus: number;
  prefectureSlug: string;
  age: number;
  dependents: number;
  column: Column;
  /** Prior month's gross pay; null = no prior-month salary (fallback method). */
  priorMonthGross: number | null;
  basisMonths?: number;
  healthRateOverridePct?: number | null;
  version?: WithholdingVersion;
}

export interface BonusResult {
  premiums: BonusPremiums;
  priorMonthA: number | null;
  bonusAfterPremiums: number;
  incomeTax: number;
  net: number;
}

export function bonusTakeHome(input: BonusInput): BonusResult {
  const care = careAppliesForAge(input.age);
  const premiums = bonusPremiums(input.bonus, {
    prefectureSlug: input.prefectureSlug,
    careApplies: care,
    healthRateOverridePct: input.healthRateOverridePct ?? null,
  });
  let priorMonthA: number | null = null;
  if (input.priorMonthGross !== null) {
    const pm = monthlyPremiums(input.priorMonthGross, {
      prefectureSlug: input.prefectureSlug,
      careApplies: care,
      healthRateOverridePct: input.healthRateOverridePct ?? null,
    });
    priorMonthA = input.priorMonthGross - pm.total;
  }
  const bonusAfterPremiums = input.bonus - premiums.total;
  const incomeTax = bonusWithholding({
    bonusAfterPremiums,
    priorMonthA,
    column: input.column,
    dependents: input.dependents,
    basisMonths: input.basisMonths ?? 6,
    version: input.version ?? 'r8',
  });
  return { premiums, priorMonthA, bonusAfterPremiums, incomeTax, net: input.bonus - premiums.total - incomeTax };
}

/* ---------------- 3. Annual view ---------------- */

export interface AnnualViewInput {
  monthlyGross: number;
  bonusAnnual: number;
  bonusPayments: number;
  prefectureSlug: string;
  age: number;
  dependents: number;
  spouse: boolean;
  dependentTypes: DependentType[];
  column: Column;
  healthRateOverridePct?: number | null;
}

export interface AnnualViewResult {
  grossAnnual: number;
  socialInsuranceAnnual: number;
  incomeTax: AnnualTaxResult;
  residentTaxNextYear: ResidentTaxResult;
  netAnnual: number;
}

export function annualView(input: AnnualViewInput): AnnualViewResult {
  const care = careAppliesForAge(input.age);
  const premInput = {
    prefectureSlug: input.prefectureSlug,
    careApplies: care,
    healthRateOverridePct: input.healthRateOverridePct ?? null,
  };
  const monthly = monthlyPremiums(input.monthlyGross, premInput);
  let siAnnual = monthly.total * 12;
  if (input.bonusAnnual > 0 && input.bonusPayments > 0) {
    const each = Math.floor(input.bonusAnnual / input.bonusPayments);
    const bp = bonusPremiums(each, premInput);
    siAnnual += bp.total * input.bonusPayments;
  }
  const grossAnnual = input.monthlyGross * 12 + input.bonusAnnual;
  const incomeTax = annualIncomeTax({
    grossSalary: grossAnnual,
    socialInsurance: siAnnual,
    spouse: input.spouse,
    dependents: input.dependentTypes,
    year: 'r8',
  });
  const residentTaxNextYear = residentTax({
    grossSalary: grossAnnual,
    socialInsurance: siAnnual,
    spouse: input.spouse,
    dependents: input.dependentTypes,
    incomeYear: 'r8',
  });
  return {
    grossAnnual,
    socialInsuranceAnnual: siAnnual,
    incomeTax,
    residentTaxNextYear,
    netAnnual: grossAnnual - siAnnual - incomeTax.tax,
  };
}

/* ---------------- 5. Furusato nozei limit ---------------- */

export interface FurusatoInput {
  grossSalary: number;
  /** Annual social insurance; when null, estimated as 15% of gross is NOT used — callers should pass the annual-view estimate. */
  socialInsurance: number;
  spouse: boolean;
  dependentTypes: DependentType[];
  municipality?: string;
}

export interface FurusatoResult {
  resident: ResidentTaxResult;
  marginalRatePct: number;
  /** Donation at which the self-burden is exactly ¥2,000 (full-benefit limit). */
  limit: number;
  breakdown: { shotokuwariCap: number; denominator: number };
}

/**
 * Full-benefit limit D solves:
 *   (D - 2000) x (1 - 0.10 - marginalRate x 1.021) = 0.20 x shotokuwari
 * (income-tax saving + resident basic credit + resident special credit,
 * the special credit capped at 20% of the resident income levy).
 */
export function furusatoLimit(input: FurusatoInput): FurusatoResult {
  const resident = residentTax({
    grossSalary: input.grossSalary,
    socialInsurance: input.socialInsurance,
    spouse: input.spouse,
    dependents: input.dependentTypes,
    municipality: input.municipality,
    incomeYear: 'r8',
  });
  const annual = annualIncomeTax({
    grossSalary: input.grossSalary,
    socialInsurance: input.socialInsurance,
    spouse: input.spouse,
    dependents: input.dependentTypes,
    year: 'r8',
  });
  const denom = 0.9 - (annual.marginalRatePct * 1.021) / 100;
  const cap = 0.2 * resident.shotokuwari;
  const limit = denom > 0 ? 2000 + Math.floor(cap / denom) : 2000;
  return { resident, marginalRatePct: annual.marginalRatePct, limit, breakdown: { shotokuwariCap: cap, denominator: denom } };
}
