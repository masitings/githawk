export type Choice = "ours" | "theirs" | "both" | null;
export type Seg = { text: string } | { ours: string; base: string | null; theirs: string; oursLabel: string; theirsLabel: string };

export function parseConflicts(text: string): Seg[] {
  const segs: Seg[] = [];
  const lines = text.split(/(?<=\n)/);
  let plain = "";
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("<<<<<<<")) {
      plain += lines[i];
      continue;
    }
    const oursLabel = lines[i].slice(7).trim();
    let ours = "";
    let base: string | null = null;
    let theirs = "";
    let part: "ours" | "base" | "theirs" = "ours";
    let j = i + 1;
    let theirsLabel = "";
    for (; j < lines.length; j++) {
      const l = lines[j];
      if (part === "ours" && l.startsWith("|||||||")) {
        part = "base";
        base = "";
      } else if (part !== "theirs" && l.startsWith("=======")) {
        part = "theirs";
      } else if (part === "theirs" && l.startsWith(">>>>>>>")) {
        theirsLabel = l.slice(7).trim();
        break;
      } else if (part === "ours") ours += l;
      else if (part === "base") base += l;
      else theirs += l;
    }
    if (j >= lines.length) {
      plain += lines.slice(i).join("");
      break;
    }
    if (plain) segs.push({ text: plain });
    plain = "";
    segs.push({ ours, base, theirs, oursLabel, theirsLabel });
    i = j;
  }
  if (plain) segs.push({ text: plain });
  return segs;
}

export function compose(segs: Seg[], choices: Choice[]) {
  let k = 0;
  return segs
    .map((s) => {
      if ("text" in s) return s.text;
      const c = choices[k++];
      if (c === "ours") return s.ours;
      if (c === "theirs") return s.theirs;
      if (c === "both") return s.ours + s.theirs;
      return `<<<<<<< ${s.oursLabel}\n${s.ours}=======\n${s.theirs}>>>>>>> ${s.theirsLabel}\n`;
    })
    .join("");
}
