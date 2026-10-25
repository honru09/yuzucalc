/**
 * social-insurance.ts — employee social-insurance premiums.
 *
 * Official rounding (printed on every 協会けんぽ premium table; prelaunch §1.6):
 *  - Health / care / child-support / pension: the employee share is half of
 *    the total premium; a fraction of the half of <= ¥0.50 truncates,
 *    > ¥0.50 rounds up. Computed in integer basis points to stay exact.
 *  - Employment insurance: fraction < ¥0.50 truncates, >= ¥0.50 rounds up,
 *    charged on actual gross pay (no grade, no cap).
 */
import { socialParams, prefectureBySlug } from './params.ts';
import { healthGrade, pensionGrade, type GradeResult } from './grades.ts';

const bp = (ratePct: number) => Math.round(ratePct * 100); // percent -> basis points (9.85% -> 985)

/** Employee half-share with the official <=0.50-down / >0.50-up rule. */
export function employeeShare(baseAmount: number, ratePct: number): number {
  const num = baseAmount * bp(ratePct); // total premium = num / 10000 yen; half = num / 20000
  const q = Math.floor(num / 20000);
  const rem = num - q * 20000;
  return 2 * rem > 20000 ? q + 1 : q;
}

/** Employment-insurance employee premium with the >=0.50-up rule. */
export function employmentShare(grossPay: number, ratePct: number): number {
  const num = grossPay * bp(ratePct); // premium = num / 10000 yen
  const q = Math.floor(num / 10000);
  const rem = num - q * 10000;
  return 2 * rem >= 10000 ? q + 1 : q;
}

export interface MonthlyPremiums {
  healthGrade: GradeResult;
  pensionGrade: GradeResult;
  healthRatePct: number; // incl. care when careApplies
  health: number;
  childSupport: number;
  pension: number;
  employment: number;
  total: number;
}

export interface PremiumInput {
  prefectureSlug: string;
  careApplies: boolean;
  /** Manual health-rate override (union kenpo etc., gaps G5). Total rate incl. care is NOT assumed: the override replaces the 協会けんぽ health rate only; care is added on top when careApplies unless overrideIncludesCare is set. */
  healthRateOverridePct?: number | null;
  businessType?: 'general' | 'agriculture' | 'construction';
}

export function healthRatePctFor(input: PremiumInput): { ratePct: number; baseRatePct: number } {
  const base = input.healthRateOverridePct ?? prefectureBySlug(input.prefectureSlug).healthRatePct;
  if (base == null) throw new Error(`health rate not loaded for ${input.prefectureSlug}`);
  const care = input.careApplies ? socialParams.careRatePct : 0;
  return { ratePct: base + care, baseRatePct: base };
}

export function monthlyPremiums(grossPay: number, input: PremiumInput): MonthlyPremiums {
  const hg = healthGrade(grossPay);
  const pg = pensionGrade(grossPay);
  const { ratePct } = healthRatePctFor(input);
  const health = employeeShare(hg.amount, ratePct);
  const childSupport = employeeShare(hg.amount, socialParams.childSupportRatePct);
  const pension = employeeShare(pg.amount, socialParams.pensionRatePct);
  const employment = employmentShare(
    grossPay,
    socialParams.employmentRatePct[input.businessType ?? 'general'],
  );
  return {
    healthGrade: hg,
    pensionGrade: pg,
    healthRatePct: ratePct,
    health,
    childSupport,
    pension,
    employment,
    total: health + childSupport + pension + employment,
  };
}

export interface BonusPremiums {
  standardBonus: number; // bonus truncated to ¥1,000
  healthBase: number;
  pensionBase: number;
  health: number;
  childSupport: number;
  pension: number;
  employment: number;
  total: number;
}

export function bonusPremiums(
  bonus: number,
  input: PremiumInput & { healthBonusBaseYtd?: number },
): BonusPremiums {
  const standardBonus = Math.floor(bonus / 1000) * 1000;
  const { ratePct } = healthRatePctFor(input);
  const healthRoom = Math.max(
    0,
    socialParams.bonusCaps.healthCumulativeAnnual - (input.healthBonusBaseYtd ?? 0),
  );
  const healthBase = Math.min(standardBonus, healthRoom);
  const pensionBase = Math.min(standardBonus, socialParams.bonusCaps.pensionPerPayment);
  const health = employeeShare(healthBase, ratePct);
  const childSupport = employeeShare(healthBase, socialParams.childSupportRatePct);
  const pension = employeeShare(pensionBase, socialParams.pensionRatePct);
  const employment = employmentShare(
    bonus,
    socialParams.employmentRatePct[input.businessType ?? 'general'],
  );
  return {
    standardBonus,
    healthBase,
    pensionBase,
    health,
    childSupport,
    pension,
    employment,
    total: health + childSupport + pension + employment,
  };
}

/** Care insurance applies to ages 40-64 （介護保険第2号被保険者）. */
export function careAppliesForAge(age: number): boolean {
  const [lo, hi] = socialParams.careAgeRange;
  return age >= lo && age <= hi;
}
