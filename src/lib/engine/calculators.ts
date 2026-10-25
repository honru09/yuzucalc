/**
 * calculators.ts — the five launch calculators, composed from the
 * validated primitives. All money in whole yen.
 */
import { annualParams, type Column, type WithholdingVersion } from './params.ts';
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
 * furusatoLimit — Full-benefit donation limit D where self-burden is exactly ¥2,000.
 *
 * Statutory basis:
 * 1. Resident tax special credit (特例控除額) cap = 20% of resident income levy (所得割額).
 * 2. Resident tax basic credit (基本控除額) = (D - 2,000) x 10%, capped at 30% of total income (総所得金額等).
 * 3. Income tax deduction (寄附金控除) = (D - 2,000) x marginal rate x 1.021 (復興特別所得税),
 *    capped at 40% of total income (総所得金額等).
 *
 * Solves:
 *   (D - 2,000) x (0.90 - marginalRate x 1.021) = 0.20 x shotokuwari
 *
 * Implements:
 * (a) Statutory eligibility ceilings (30% resident, 40% income tax of 総所得金額等, plus non-negative taxable income).
 * (b) Fixed-point marginal-rate solving: solves the marginal income-tax rate consistently
 *     with post-donation taxable income for 確定申告 filers (iterates to a fixed point, falling back
 *     to the conservative rate on boundary oscillation to prevent exceeding the 20% cap).
 *
 * Notes on fidelity audit:
 * - Hardcoded vintage: evaluated under 'r8' tax schedule and resident-tax parameters.
 * - Aggregate return: returns the aggregate full-benefit limit rather than decomposing into the 3 statutory legs.
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

  const totalIncome = Math.max(0, annual.salaryIncome);
  const maxDonationResident = Math.floor(0.30 * totalIncome);
  // Income tax leg is capped at 40% of total income:
  // const maxDonationIncomeTax = Math.floor(0.40 * totalIncome);
  // Since 30% <= 40%, the 30% resident basic cap binds first.
  const cap = 0.2 * resident.shotokuwari;

  // If taxable income is zero, shotokuwari is zero, or total income cannot support ¥2,000 self-pay:
  if (annual.taxableIncome <= 0 || resident.shotokuwari <= 0 || maxDonationResident < 2000) {
    const denom = 0.9 - (annual.marginalRatePct * 1.021) / 100;
    return {
      resident,
      marginalRatePct: annual.marginalRatePct,
      limit: 2000,
      breakdown: { shotokuwariCap: cap, denominator: denom },
    };
  }

  const getBracketRate = (taxable: number): number => {
    for (const b of annualParams.brackets as { upTo: number | null; ratePct: number }[]) {
      if (b.upTo === null || taxable <= b.upTo) return b.ratePct;
    }
    return 45;
  };

  let rate = annual.marginalRatePct;
  let limit = 2000;
  let denom = 0.9 - (rate * 1.021) / 100;
  const seen = new Set<number>();

  for (let iter = 0; iter < 6; iter++) {
    denom = 0.9 - (rate * 1.021) / 100;
    const rawLimit = denom > 0 ? 2000 + Math.floor(cap / denom) : 2000;
    // Apply statutory eligibility ceilings:
    // (1) 30% of 総所得金額等 for resident basic credit
    // (2) donation deduction (limit - 2000) cannot exceed annual.taxableIncome
    limit = Math.min(rawLimit, maxDonationResident, 2000 + annual.taxableIncome);
    limit = Math.max(2000, limit);

    const deduction = limit - 2000;
    const postTaxableRaw = annual.taxableIncome - deduction;
    const postTaxable = Math.max(0, Math.floor(postTaxableRaw / 1000) * 1000);
    const postRate = getBracketRate(postTaxable);

    if (postRate === rate) {
      break;
    }

    if (seen.has(postRate)) {
      // Boundary oscillation detected: select conservative rate (lower rate => higher denom => lower limit)
      // to ensure self-burden does not exceed ¥2,000 under the statutory 20% cap.
      rate = Math.min(rate, postRate);
      denom = 0.9 - (rate * 1.021) / 100;
      const safeRaw = denom > 0 ? 2000 + Math.floor(cap / denom) : 2000;
      limit = Math.min(safeRaw, maxDonationResident, 2000 + annual.taxableIncome);
      limit = Math.max(2000, limit);
      break;
    }

    seen.add(rate);
    rate = postRate;
  }

  return {
    resident,
    marginalRatePct: rate,
    limit,
    breakdown: { shotokuwariCap: cap, denominator: denom },
  };
}
