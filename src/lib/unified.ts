import type { Hunk } from "@/lib/api";

export type PatchFile = { path: string; hunks: Hunk[] };

export function parseUnified(text: string): PatchFile[] {
  const files: PatchFile[] = [];
  let file: PatchFile | null = null;
  let hunk: Hunk | null = null;
  let oldNo = 0;
  let newNo = 0;
  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ")) {
      file = { path: line.split(" b/").pop() ?? "", hunks: [] };
      files.push(file);
      hunk = null;
    } else if (line.startsWith("+++ ") && !hunk) {
      if (!file) files.push((file = { path: "", hunks: [] }));
      if (line !== "+++ /dev/null") file.path = line.slice(4).replace(/^b\//, "");
    } else if (line.startsWith("--- ") && !hunk) {
      if (!file) files.push((file = { path: "", hunks: [] }));
      if (!file.path && line !== "--- /dev/null") file.path = line.slice(4).replace(/^a\//, "");
    } else if (line.startsWith("@@") && file) {
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      oldNo = Number(m?.[1] ?? 0);
      newNo = Number(m?.[2] ?? 0);
      hunk = { header: line, lines: [] };
      file.hunks.push(hunk);
    } else if (hunk && (line[0] === " " || line[0] === "+" || line[0] === "-")) {
      const origin = line[0] as " " | "+" | "-";
      hunk.lines.push({
        origin,
        old: origin === "+" ? null : oldNo++,
        new: origin === "-" ? null : newNo++,
        text: line.slice(1),
      });
    } else if (line.startsWith("diff ") || line.startsWith("index ")) {
      hunk = null;
    }
  }
  return files.filter((f) => f.path);
}
