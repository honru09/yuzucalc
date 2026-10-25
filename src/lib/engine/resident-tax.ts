/**
 * resident-tax.ts — annual resident tax on PRIOR-year income.
 *
 * Standard rates: 所得割 10%, 均等割 ¥4,000 + 森林環境税 ¥1,000.
 * Municipality overrides come from resident-deviations.generated.json
 * (official city/prefecture sources; gaps §4/G3). Osaka City's current
 * 均等割 is unconfirmed (OPEN) and therefore NOT offered as an override.
 *
 * 調整控除: (人的控除の差 total) based formula with the ¥2,500 floor;
 * the basic-deduction diff uses the income-tax 基礎控除 of the income
 * year minus the resident ¥430,000 (e.g. R7 income at typical levels:
 * ¥680,000 - ¥430,000 = ¥250,000). Taxable income truncated to ¥1,000;
 * 所得割 truncated to ¥100. Instalments: 12 x 特別徴収, months truncated
 * to ¥100 with the remainder in June (validated by B10).
 */
import {
  residentParams,
  residentDeviations,
  type ResidentDeviation,
  type TaxYear,
} from './params.ts';
import {
  basicDeduction,
  salaryIncome,
  spouseDeductionResident,
  dependentDeductionResident,
  adjustmentDiff,
  type DependentType,
} from './annual.ts';

export interface ResidentTaxInput {
  /** Prior-year gross salary. */
  grossSalary: number;
  /** Prior-year social insurance actually paid. */
  socialInsurance: number;
  spouse?: boolean;
  dependents?: DependentType[];
  /** Municipality override name (e.g. '横浜市'); omit for the national standard. */
  municipality?: string;
  /** Income year the salary belongs to (drives salary deduction + basic diff). Default r7: the R8 levy is on R7 income. */
  incomeYear?: TaxYear;
}

export interface ResidentTaxResult {
  salaryIncome: number;
  taxableIncome: number;
  shotokuwariRatePct: number;
  shotokuwariBeforeAdjustment: number;
  adjustment: number;
  shotokuwari: number;
  kintowari: number;
  forestEnvTax: number;
  annual: number;
  monthlyInstalment: number;
  juneInstalment: number;
  municipalityApplied: string;
  override: ResidentDeviation | null;
}

export function listMunicipalities(): ResidentDeviation[] {
  return residentDeviations.filter((d) => d.totalFlat !== null && d.municipality !== '標準（全国標準）');
}

export function residentTax(input: ResidentTaxInput): ResidentTaxResult {
  const incomeYear = input.incomeYear ?? 'r7';
  const si = salaryIncome(input.grossSalary, incomeYear);
  const override = input.municipality
    ? (residentDeviations.find((d) => d.municipality === input.municipality) ?? null)
    : null;

  const residentBasic = residentParams.standard.basicDeduction;
  let familyResident = 0;
  let diffsTotal = basicDeduction(si, incomeYear) - residentBasic;
  if (input.spouse) {
    familyResident += spouseDeductionResident(si);
    diffsTotal += adjustmentDiff('spouse');
  }
  for (const d of input.dependents ?? []) {
    familyResident += dependentDeductionResident(d);
    diffsTotal += adjustmentDiff(d);
  }

  const taxableRaw = si - input.socialInsurance - residentBasic - familyResident;
  const taxable = Math.max(0, Math.floor(taxableRaw / 1000) * 1000);

  const familyCount = (input.spouse ? 1 : 0) + (input.dependents?.length ?? 0);
  const th = residentParams.nonTaxableThresholds;
  const shotokuExempt = si <= th.perPerson * (1 + familyCount) + th.shotokuBase;
  const kintoExempt = si <= th.perPerson * (1 + familyCount) + th.kintowariBase;

  const ratePct = override?.shotokuwariTotalPct ?? residentParams.standard.shotokuwariPct;
  const beforeAdj = Math.floor((taxable * ratePct) / 100);
  let adjustment = 0;
  if (taxable > 0) {
    if (taxable <= 2_000_000) {
      adjustment = Math.floor(Math.min(diffsTotal, taxable) * 0.05);
    } else {
      adjustment = Math.max(2500, Math.floor((diffsTotal - (taxable - 2_000_000)) * 0.05));
      if (diffsTotal - (taxable - 2_000_000) <= 0) adjustment = 2500;
    }
  }
  const shotokuwari = shotokuExempt
    ? 0
    : Math.max(0, Math.floor((beforeAdj - adjustment) / 100) * 100);
  const kintowari = kintoExempt
    ? 0
    : override
      ? (override.kintowariCity ?? 0) + (override.kintowariPref ?? 0)
      : residentParams.standard.kintowariTotal;
  const forest = kintoExempt ? 0 : (override?.forestEnvTax ?? residentParams.standard.forestEnvTax);
  const annualTotal = shotokuwari + kintowari + forest;
  const monthly = Math.floor(annualTotal / 12 / 100) * 100;
  const june = annualTotal - monthly * 11;
  return {
    salaryIncome: si,
    taxableIncome: taxable,
    shotokuwariRatePct: ratePct,
    shotokuwariBeforeAdjustment: beforeAdj,
    adjustment: shotokuExempt ? 0 : adjustment,
    shotokuwari,
    kintowari,
    forestEnvTax: forest,
    annual: annualTotal,
    monthlyInstalment: monthly,
    juneInstalment: june,
    municipalityApplied: override?.municipality ?? '標準（全国標準）',
    override,
  };
}
