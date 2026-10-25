/** ui.ts — tiny client-side helpers shared by the calculator islands. */
export const yen = (n: number): string => '¥' + Math.round(n).toLocaleString('en-US');
export const num = (n: number): string => Math.round(n).toLocaleString('en-US');

export function setText(root: ParentNode, key: string, text: string): void {
  root.querySelectorAll(`[data-v="${key}"]`).forEach((el) => {
    el.textContent = text;
  });
}

/** Read the current query string into a plain object. */
export function queryParams(): Record<string, string> {
  const out: Record<string, string> = {};
  new URLSearchParams(location.search).forEach((v, k) => (out[k] = v));
  return out;
}

/** Replace the URL query (shareable calculator state — Copy #9) without a history entry. */
export function syncQuery(state: Record<string, string | number | null | undefined>): void {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(state)) {
    if (v !== null && v !== undefined && v !== '') p.set(k, String(v));
  }
  const qs = p.toString();
  history.replaceState(null, '', qs ? `${location.pathname}?${qs}` : location.pathname);
}

const reducedMotion = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Animate an element's text to a yen value (450ms ease-out, retargetable).
 * The raw value is tracked in data-raw so mid-flight retargets start from
 * the currently displayed figure. Instant under prefers-reduced-motion.
 */
export function countUpYen(el: Element | null, to: number): void {
  if (!el) return;
  const target = el as HTMLElement;
  const from = Number(target.dataset.raw ?? to);
  target.dataset.raw = String(to);
  if (reducedMotion() || from === to) {
    target.textContent = yen(to);
    return;
  }
  const start = performance.now();
  const dur = 450;
  const tick = (now: number) => {
    if (Number(target.dataset.raw) !== to) return; // superseded
    const p = Math.min(1, (now - start) / dur);
    const e = 1 - Math.pow(1 - p, 3);
    target.textContent = yen(Math.round(from + (to - from) * e));
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** One soft ring pulse on a result panel (skipped under reduced motion). */
export function flash(el: HTMLElement | null): void {
  if (!el || reducedMotion()) return;
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
}

export function field(form: HTMLFormElement, name: string): HTMLInputElement | HTMLSelectElement {
  return form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement;
}
export function fieldNum(form: HTMLFormElement, name: string, fallback = 0): number {
  const el = field(form, name);
  const v = parseFloat(el.value);
  return Number.isFinite(v) ? v : fallback;
}
