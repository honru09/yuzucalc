#!/usr/bin/env node
/**
 * validate.mjs — the pre-registered validation gate (BUILD.md §4).
 *
 * Runs the production engine against the official worked-example set from
 * prelaunch §2-3 with the gaps §8.3 CORRECTED expectations (the R8 monthly
 * table was revised by 財務省告示第122号; pre-revision figures are banned).
 * Prints PASS/FAIL per case; exit code 1 on any failure. A calculator that
 * fails twice is barred from launch (FINAL-V3 build red line).
 *
 * Results are written to src/data/validation-results.json for the public
 * methodology page.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  monthlyTakeHome,
  employeeShare,
  healthGrade,
  pensionGrade,
  monthlyWithholding,
  bonusWithholding,
  bonusRatePct,
  bonusPremiums,
  annualIncomeTax,
  residentTax,
} from '../src/lib/engine/index.ts';

const cases = [];
function check(id, label, fn, expected) {
  let actual, pass;
  try {
    actual = fn();
    pass = JSON.stringify(actual) === JSON.stringify(expected);
  } catch (e) {
    actual = `ERROR: ${e.message}`;
    pass = false;
  }
  cases.push({ id, label, expected, actual, pass });
}

/* ---- A4: official premium-table row (Osaka, grade ¥360,000) ---- */
check('A4-grade', 'A4 grade: ¥355,000 remuneration -> health grade 25 / pension grade 22, amount ¥360,000',
  () => [healthGrade(355000).grade, healthGrade(355000).amount, pensionGrade(355000).grade, pensionGrade(355000).amount],
  [25, 360000, 22, 360000]);
check('A4', 'A4 premiums: health ¥18,234 / health+care ¥21,150 / child ¥414 / pension ¥32,940',
  () => [
    employeeShare(360000, 10.13),
    employeeShare(360000, 11.75),
    employeeShare(360000, 0.23),
    employeeShare(360000, 18.3),
  ],
  [18234, 21150, 414, 32940]);

/* ---- A1 / A1b: monthly withholding (R8 grid, corrected) ---- */
check('A1', 'A1 (NTA 設例 inputs, R8 grid): pay ¥374,000, SI ¥58,008, dep 2 -> tax ¥5,310',
  () => monthlyWithholding(374000 - 58008, 'kou', 2), 5310);
check('A1b', 'A1b (NTA R8 求め方 example): A ¥356,600, dep 2 -> tax ¥7,020',
  () => monthlyWithholding(356600, 'kou', 2), 7020);
check('X1', 'X1 (NTA R8 乙欄 example): A ¥80,750 first band -> ¥2,473',
  () => monthlyWithholding(80750, 'otsu', 0), 2473);

/* ---- A2 / A3: bonus withholding ---- */
check('A2', 'A2 (NTA bonus 設例): after-SI ¥469,404, prior A ¥196,616, dep 2 -> tax ¥9,585, net ¥459,819',
  () => {
    const tax = bonusWithholding({ bonusAfterPremiums: 469404, priorMonthA: 196616, column: 'kou', dependents: 2 });
    return [tax, 554000 - 84596 - tax];
  },
  [9585, 459819]);
check('X2', 'X2 (rate-table cross-check): prior A ¥196,616, dep 0 -> 4.084%',
  () => bonusRatePct(196616, 'kou', 0), 4.084);
check('A3', 'A3 (no-prior-month fallback, re-anchored to R8 grid): after-SI ¥788,771, dep 1 -> tax ¥0, net ¥788,771',
  () => {
    const tax = bonusWithholding({ bonusAfterPremiums: 788771, priorMonthA: null, column: 'kou', dependents: 1, basisMonths: 6 });
    return [tax, 907800 - 119029 - tax];
  },
  [0, 788771]);

/* ---- B1-B6: full monthly compositions (corrected taxes, gaps §8.3) ---- */
const monthlyCase = (id, label, input, expected) =>
  check(id, label, () => {
    const r = monthlyTakeHome(input);
    return [r.premiums.total, r.incomeTax, r.net];
  }, expected);

monthlyCase('B1', 'B1 Tokyo 35 dep0 ¥340,000: SI ¥49,946 / tax ¥7,610 / net ¥282,444',
  { grossPay: 340000, prefectureSlug: 'tokyo', age: 35, dependents: 0, column: 'kou' },
  [49946, 7610, 282444]);
monthlyCase('B2', 'B2 Tokyo 45 (care) dep2 ¥360,000: SI ¥55,800 / tax ¥4,820 / net ¥299,380',
  { grossPay: 360000, prefectureSlug: 'tokyo', age: 45, dependents: 2, column: 'kou' },
  [55800, 4820, 299380]);
monthlyCase('B3', 'B3 Osaka 30 dep0 ¥355,000: SI ¥53,363 / tax ¥7,930 / net ¥293,707',
  { grossPay: 355000, prefectureSlug: 'osaka', age: 30, dependents: 0, column: 'kou' },
  [53363, 7930, 293707]);
monthlyCase('B4', 'B4 Saga 50 (care) dep0 ¥345,000: SI ¥53,915 / tax ¥7,610 / net ¥283,475',
  { grossPay: 345000, prefectureSlug: 'saga', age: 50, dependents: 0, column: 'kou' },
  [53915, 7610, 283475]);
monthlyCase('B5', 'B5 Aichi 28 dep2 ¥350,000: SI ¥52,978 / tax ¥4,590 / net ¥292,432',
  { grossPay: 350000, prefectureSlug: 'aichi', age: 28, dependents: 2, column: 'kou' },
  [52978, 4590, 292432]);
monthlyCase('B6', 'B6 Otsu-ran Tokyo 35 ¥340,000: SI ¥49,946 / tax ¥50,000 / net ¥240,054',
  { grossPay: 340000, prefectureSlug: 'tokyo', age: 35, dependents: 0, column: 'otsu' },
  [49946, 50000, 240054]);

/* ---- B7: bonus composition ---- */
check('B7', 'B7 bonus ¥600,000 Tokyo dep2: SI ¥88,140 / tax ¥10,452 / net ¥501,408',
  () => {
    const prem = bonusPremiums(600000, { prefectureSlug: 'tokyo', careApplies: false });
    const tax = bonusWithholding({ bonusAfterPremiums: 600000 - prem.total, priorMonthA: 200000, column: 'kou', dependents: 2 });
    return [prem.total, tax, 600000 - prem.total - tax];
  },
  [88140, 10452, 501408]);

/* ---- B8 / B9: annual income tax, two years (permanent regression pair) ---- */
// B8 CORRECTION (2026-10-25, build): the prelaunch B8 text applies the 10%
// quick-calc row to a ¥1,800,000 taxable income, but the official 速算表
// (NTA No.2260, reproduced in prelaunch §1.1 itself) puts ¥1,800,000 in the
// 5% row: 1,800,000 x 5% = ¥90,000 -> x1.021 -> ¥91,800. The engine follows
// the official table; the Type-B example's expected value is corrected here
// (same treatment as the gaps §8.3 addendum). B9 below is unaffected.
check('B8', 'B8 annual R8: salary ¥5,000,000, SI ¥720,000, single -> tax ¥91,800 (expected value corrected: 5% bracket per NTA No.2260)',
  () => annualIncomeTax({ grossSalary: 5000000, socialInsurance: 720000, year: 'r8' }).tax, 91800);
check('B9', 'B9 annual R7 (regression): same inputs -> tax ¥120,900',
  () => annualIncomeTax({ grossSalary: 5000000, socialInsurance: 720000, year: 'r7' }).tax, 120900);

/* ---- B10: resident tax ---- */
check('B10', 'B10 resident tax: prior salary ¥4,800,000, SI ¥700,000 -> annual ¥229,500, ¥19,100 x11 + June ¥19,400',
  () => {
    const r = residentTax({ grossSalary: 4800000, socialInsurance: 700000, incomeYear: 'r7' });
    return [r.annual, r.monthlyInstalment, r.juneInstalment];
  },
  [229500, 19100, 19400]);

/* ---- report ---- */
let fails = 0;
for (const c of cases) {
  if (!c.pass) fails++;
  console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.id.padEnd(9)} ${c.label}`);
  if (!c.pass) console.log(`         expected ${JSON.stringify(c.expected)} but got ${JSON.stringify(c.actual)}`);
}
console.log(`\n${cases.length - fails}/${cases.length} passed${fails ? ` — ${fails} FAILED (gate: failing calculators are barred from launch)` : ''}`);

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data');
writeFileSync(join(outDir, 'validation-results.json'), JSON.stringify({
  generatedAt: new Date().toISOString(),
  total: cases.length,
  passed: cases.length - fails,
  cases: cases.map(({ id, label, expected, actual, pass }) => ({ id, label, expected, actual, pass })),
}, null, 1));
process.exit(fails ? 1 : 0);
