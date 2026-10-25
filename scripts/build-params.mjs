#!/usr/bin/env node
/**
 * build-params.mjs — converts official-source CSVs in data-source/ into the
 * versioned parameter JSONs under src/data/params/.
 *
 * Sources (all primary official, see ../../prelaunch/calculator-gaps.md):
 *  - monthly_table_r8.csv            NTA official Excel (zeigakuhyo2026/data/01-07.xls)
 *  - monthly_table_r9_statutory.csv  + monthly_table_r9_statutory_rows.json (e-Gov statute text)
 *  - bonus_rate_table_r8.csv         NTA pamphlet pp.15-16 (zeigakuhyo2026/data/15-16.pdf)
 *  - resident_tax_deviations.csv     municipality overrides from official city/pref pages
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'data-source');
const outDir = join(root, 'src', 'data', 'params');
mkdirSync(outDir, { recursive: true });

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false; }
      else cell += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); cell = ''; rows.push(row); row = []; }
    else if (c !== '\r') cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
const num = (s) => (s === '' || s == null ? null : Number(s));
const table = (name) => {
  const rows = parseCsv(readFileSync(join(srcDir, name), 'utf8'));
  const hdr = rows[0];
  return rows.slice(1).filter((r) => r.length > 1).map((r) =>
    Object.fromEntries(hdr.map((h, i) => [h, r[i] ?? ''])));
};

/* ---------- Monthly withholding table, generic shape ----------
 * { firstBand:{under, otsuRatePct}, bands:[{from,to,kou[8],otsu}],
 *   points:[{at,kou[8],otsu}], formulas:[{from,to,ratePct}] (kou, anchored at `from` point),
 *   otsuFormulas:[{from,anchorTax,ratePct,to}], extraDependentDeduction } */
function buildR8() {
  const t = table('monthly_table_r8.csv');
  const bands = [], points = [], formulas = [], otsuFormulas = [];
  let firstBand = null, extra = null;
  for (const r of t) {
    const from = num(r.amount_from), to = num(r.amount_to);
    const kou = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => num(r[`kou_${i}`]));
    if (r.note && r.note.includes('ADJUSTMENT')) {
      const m = r.note.match(/subtract ¥([\d,]+) per additional dependent/);
      if (m) extra = Number(m[1].replace(/,/g, ''));
      continue;
    }
    if (from === 0 && to === 105000) {
      const m = r.otsu_formula.match(/([\d.]+)%/);
      firstBand = { under: to, otsuRatePct: Number(m[1]) };
      continue;
    }
    if (r.kou_formula) {
      const m = r.kou_formula.match(/tax_at_(\d+) \+ ([\d.]+)%/);
      formulas.push({ from, to, ratePct: Number(m[2]) });
      continue;
    }
    if (from === to) { // single point
      points.push({ at: from, kou, otsu: num(r.otsu) });
      if (r.otsu_formula) {
        const m = r.otsu_formula.match(/(\d+) \+ ([\d.]+)% \* \(A - (\d+)\)/);
        if (m) {
          const until = r.otsu_formula.match(/superseded at (\d+)/);
          otsuFormulas.push({ from, anchorTax: Number(m[1]), ratePct: Number(m[2]), to: until ? Number(until[1]) : null });
        }
      }
      continue;
    }
    bands.push({ from, to, kou, otsu: num(r.otsu) });
  }
  return {
    version: 'r8', label: '令和8年分', firstBand, bands, points, formulas, otsuFormulas,
    extraDependentDeduction: extra,
    source: '国税庁 給与所得の源泉徴収税額表（月額表）令和8年分 (official Excel, zeigakuhyo2026/data/01-07.xls)',
  };
}

function buildR9() {
  const t = table('monthly_table_r9_statutory.csv');
  const bands = t.map((r) => ({
    from: num(r.amount_from), to: num(r.amount_to),
    kou: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => num(r[`kou_${i}`])), otsu: num(r.otsu),
  }));
  const raw = JSON.parse(readFileSync(join(srcDir, 'monthly_table_r9_statutory_rows.json'), 'utf8'));
  const points = [], formulas = [], otsuFormulas = [];
  const yen = (s) => Number(String(s).replace(/[円,]/g, ''));
  for (const r of raw) {
    const c = r.cells;
    if (/^[\d,]+円$/.test(c[0] || '') && c.length >= 9 && /^[\d,]+$/.test(c[1] || '')) {
      points.push({ at: yen(c[0]), kou: c.slice(1, 9).map(yen), otsu: c[9] ? yen(c[9]) : null });
      continue;
    }
    const m = (c[0] || '').match(/^([\d,]+)円を超え([\d,]+)円に満たない金額$/);
    const mTop = (c[0] || '').match(/^([\d,]+)円を超える金額$/);
    const kouCell = c[1] || '';
    const rateM = kouCell.match(/の([\d.]+)％に相当/);
    if ((m || mTop) && rateM) {
      const from = yen((m || mTop)[1]);
      const to = m ? yen(m[2]) : null;
      formulas.push({ from, to, ratePct: Math.round(Number(rateM[1]) * 1.021 * 1000) / 1000 }); // statutory base rate × combined surtax 1.021
      const otsuCell = c[2] || '';
      const om = otsuCell.match(/^([\d,]+)円に、.*金額の([\d.]+)％に相当/);
      if (om) otsuFormulas.push({ from, anchorTax: yen(om[1]), ratePct: Math.round(Number(om[2]) * 1.021 * 1000) / 1000, to: null });
    }
  }
  // An otsu formula runs from its anchor until the next otsu anchor (independent of kou band edges).
  otsuFormulas.sort((a, b) => a.from - b.from);
  otsuFormulas.forEach((f, i) => { f.to = i + 1 < otsuFormulas.length ? otsuFormulas[i + 1].from : null; });
  // first-band otsu: statutory 3% × 1.021 combined surtax = 3.063% (same effective rate as R8 published table)
  return {
    version: 'r9', label: '令和9年分', firstBand: { under: 105000, otsuRatePct: 3.063 },
    bands, points, formulas, otsuFormulas, extraDependentDeduction: 1580,
    source: '所得税法別表第二 (e-Gov 法令API) — R9 table as legislated; formula-band base rates ×1.021 combined surtax',
  };
}

function buildBonus() {
  const t = table('bonus_rate_table_r8.csv');
  const rows = t.map((r) => {
    const kou = [];
    for (let d = 0; d <= 7; d++) {
      const from = num(r[`kou${d}_from_k`]), to = num(r[`kou${d}_to_k`]);
      kou.push({ fromK: from, toK: to });
    }
    const of = num(r.otsu_from_k), ot = num(r.otsu_to_k);
    return { ratePct: Number(r.rate_pct), kou, otsu: (of == null && ot == null) ? null : { fromK: of, toK: ot } };
  });
  return {
    version: 'r8', label: '令和8年分', rows,
    source: '国税庁 令和8年分 賞与に対する源泉徴収税額の算出率の表 (zeigakuhyo2026/data/15-16.pdf)',
  };
}

function buildResidentDeviations() {
  const t = table('resident_tax_deviations.csv');
  return t.map((r) => ({
    municipality: r.municipality, prefecture: r.prefecture,
    shotokuwariTotalPct: num(r.shotokuwari_total_pct),
    kintowariCity: num(r.kintowari_city_jpy), kintowariPref: num(r.kintowari_pref_jpy),
    forestEnvTax: num(r.forest_env_tax_jpy), totalFlat: num(r.total_flat_jpy),
    note: r.note, source: r.source,
  }));
}

/**
 * Social insurance: merge the hand-authored base (rates structure, caps,
 * FY2025 reference) with the official 47-prefecture health-rate table and
 * the official grade tables (Kyokai Kenpo FY2026 premium-table PDF).
 * FAILS the build if any prefecture rate or grade row is missing — the
 * site must never ship with a partial rate table.
 */
function buildSocial() {
  const base = JSON.parse(readFileSync(join(root, 'src', 'data', 'params', 'social-insurance.json'), 'utf8'));
  const health = JSON.parse(readFileSync(join(srcDir, 'health_rates_fy2026.json'), 'utf8'));
  const grades = JSON.parse(readFileSync(join(srcDir, 'grade_tables.json'), 'utf8'));
  const rateBySlug = new Map(health.rates.map((r) => [r.slug, r.rate_pct]));
  const prefectures = base.prefectures.map((p) => {
    const rate = rateBySlug.get(p.slug);
    if (rate == null) throw new Error(`health rate missing for prefecture: ${p.slug}`);
    return { ...p, healthRatePct: rate };
  });
  if (prefectures.length !== 47) throw new Error(`expected 47 prefectures, got ${prefectures.length}`);
  if (grades.health.length !== 50 || grades.pension.length !== 32) {
    throw new Error(`grade tables incomplete: health=${grades.health.length} pension=${grades.pension.length}`);
  }
  const clean = (rows) => rows.map((g) => ({ grade: g.grade, amount: g.amount, from: g.from, to: g.to }));
  return {
    ...base,
    healthRatesComplete: true,
    prefectures,
    grades: { health: clean(grades.health), pension: clean(grades.pension) },
    healthRateSource: health.source_url,
    gradeSource: grades.source_url,
  };
}

const outputs = {
  'withholding-monthly-r8.generated.json': buildR8(),
  'withholding-monthly-r9.generated.json': buildR9(),
  'bonus-rates-r8.generated.json': buildBonus(),
  'resident-deviations.generated.json': buildResidentDeviations(),
  'social-insurance.generated.json': buildSocial(),
};
for (const [name, data] of Object.entries(outputs)) {
  writeFileSync(join(outDir, name), JSON.stringify(data, null, 1));
  console.log('wrote', name);
}
const r8 = outputs['withholding-monthly-r8.generated.json'];
console.log(`r8: bands=${r8.bands.length} points=${r8.points.length} formulas=${r8.formulas.length} otsuFormulas=${JSON.stringify(r8.otsuFormulas)} extra=${r8.extraDependentDeduction}`);
const r9 = outputs['withholding-monthly-r9.generated.json'];
console.log(`r9: bands=${r9.bands.length} points=${r9.points.length} formulas=${r9.formulas.length} otsuFormulas=${JSON.stringify(r9.otsuFormulas)} extra=${r9.extraDependentDeduction}`);
