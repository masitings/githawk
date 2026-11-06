type L = { origin: string; text: string };

export const TAB = 4;

const column = (text: string, end: number) => {
  let col = 0;
  for (let i = 0; i < end; i++) col = text[i] === "\t" ? col + TAB - (col % TAB) : col + 1;
  return col;
};

// ponytail: common prefix/suffix per paired line, not a token LCS; two separate edits on one line highlight everything between them
/** Visual column range of the changed part of each paired -/+ line, keyed by index in `lines`. */
export function changedSpans(lines: L[]): Map<number, [number, number]> {
  const out = new Map<number, [number, number]>();
  for (let i = 0; i < lines.length; ) {
    if (lines[i].origin === " ") {
      i++;
      continue;
    }
    const del: number[] = [];
    const add: number[] = [];
    while (i < lines.length && lines[i].origin !== " ") (lines[i].origin === "-" ? del : add).push(i++);
    for (let j = 0; j < Math.min(del.length, add.length); j++) {
      const a = lines[del[j]].text;
      const b = lines[add[j]].text;
      let pre = 0;
      while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
      let suf = 0;
      while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
      if (pre + suf === 0) continue;
      for (const [k, t] of [[del[j], a], [add[j], b]] as const)
        if (pre < t.length - suf) out.set(k, [column(t, pre), column(t, t.length - suf)]);
    }
  }
  return out;
}
