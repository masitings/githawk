/** Subsequence match; higher is better, null when `q` is not a subsequence of `text`. */
export function fuzzy(q: string, text: string): number | null {
  if (!q) return 0;
  const t = text.toLowerCase();
  const needle = q.toLowerCase();
  let score = 0;
  let ti = 0;
  let streak = 0;
  for (const ch of needle) {
    if (ch === " ") continue;
    const found = t.indexOf(ch, ti);
    if (found < 0) return null;
    streak = found === ti ? streak + 1 : 0;
    const boundary = found === 0 || "/ -_.".includes(t[found - 1]);
    score += 1 + streak * 2 + (boundary ? 3 : 0) - Math.min(found - ti, 5) * 0.1;
    ti = found + 1;
  }
  return score - t.length * 0.01;
}
