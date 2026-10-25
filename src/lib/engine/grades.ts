/**
 * grades.ts — 標準報酬月額 (standard monthly remuneration) grade lookup.
 *
 * Premiums are charged on the GRADE, not on actual pay (prelaunch §1.6).
 * Ranges are the OFFICIAL ones from the Kyokai Kenpo premium table
 * (data-source/grade_tables.json): each grade covers [from, to) yen of
 * remuneration; the top grade is open-ended. Official anchors:
 * remuneration ¥355,000 -> health grade 25 / pension grade 22 (¥360,000).
 */
import { socialParams } from './params.ts';

export interface GradeResult {
  grade: number; // official grade number
  amount: number;
  rangeFrom: number;
  rangeTo: number | null; // null = open-ended (top grade)
}

interface GradeEntry {
  grade: number;
  amount: number;
  from: number;
  to: number | null;
}

function gradeFor(remuneration: number, entries: GradeEntry[]): GradeResult {
  for (const e of entries) {
    if (remuneration >= e.from && (e.to === null || remuneration < e.to)) {
      return { grade: e.grade, amount: e.amount, rangeFrom: e.from, rangeTo: e.to };
    }
  }
  const last = entries[entries.length - 1];
  return { grade: last.grade, amount: last.amount, rangeFrom: last.from, rangeTo: null };
}

export function healthGrade(remuneration: number): GradeResult {
  return gradeFor(remuneration, socialParams.grades.health as GradeEntry[]);
}

export function pensionGrade(remuneration: number): GradeResult {
  return gradeFor(remuneration, socialParams.grades.pension as GradeEntry[]);
}
