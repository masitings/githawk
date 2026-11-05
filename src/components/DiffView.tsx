import { useEffect, useMemo, useState } from "react";
import hljs from "highlight.js/lib/common";
import { X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, type FileDiff, type Line, type Mode, type Target } from "@/lib/api";
import { confirm } from "@/lib/prompt";

const IMAGE = /\.(png|jpe?g|gif|webp|bmp|ico|svg|avif)$/i;
const ALIAS: Record<string, string> = { tsx: "typescript", jsx: "javascript", mjs: "javascript", cjs: "javascript", yml: "yaml" };
const LIMIT = 3000;

function language(path: string) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const name = ALIAS[ext] ?? ext;
  return hljs.getLanguage(name) ? name : null;
}

function highlight(text: string, lang: string | null) {
  if (!lang || text.length > 2000) return null;
  try {
    return hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
  } catch {
    return null;
  }
}

type Props = {
  root: string;
  target: Target;
  path: string;
  version: number;
  onClose: () => void;
};

export function DiffView({ root, target, path, version, onClose }: Props) {
  const [file, setFile] = useState<FileDiff | null>(null);
  const [error, setError] = useState("");
  const [split, setSplit] = useState(() => {
    try {
      return localStorage.getItem("githawk.diff.split") === "1";
    } catch {
      return false;
    }
  });
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<[number, number] | null>(null);
  const [all, setAll] = useState(false);
  const lang = language(path);
  const editable = target.kind !== "commit";

  useEffect(() => {
    api
      .diff(root, target, path)
      .then((d) => {
        setFile(d[0] ?? null);
        setError("");
      })
      .catch((e) => setError(String(e)));
    setSel(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, path, target.kind, target.kind === "commit" ? target.id : "", version]);

  useEffect(() => {
    try {
      localStorage.setItem("githawk.diff.split", split ? "1" : "0");
    } catch {
      /* preference just won't persist */
    }
  }, [split]);

  async function apply(mode: Mode, hunk: number) {
    if (!file) return;
    const picked = [...sel].map((k) => k.split(":").map(Number) as [number, number]).filter(([h]) => h === hunk);
    const lines: [number, number][] = picked.length
      ? picked
      : file.hunks[hunk].lines.map((_, l) => [hunk, l] as [number, number]);
    if (mode === "discard" && !(await confirm("Discard changes?", `${lines.length} line(s) in ${path} will be lost.`, "Discard")))
      return;
    try {
      await api.applyLines(root, path, mode, lines);
      setSel(new Set());
    } catch (e) {
      toast.error(String(e));
    }
  }

  function toggle(h: number, l: number, shift: boolean) {
    if (!editable) return;
    const next = new Set(sel);
    if (shift && anchor && anchor[0] === h) {
      const [a, b] = [Math.min(anchor[1], l), Math.max(anchor[1], l)];
      for (let i = a; i <= b; i++) if (file!.hunks[h].lines[i].origin !== " ") next.add(`${h}:${i}`);
    } else {
      const k = `${h}:${l}`;
      if (next.has(k)) next.delete(k);
      else next.add(k);
      setAnchor([h, l]);
    }
    setSel(next);
  }

  const lineCount = useMemo(() => file?.hunks.reduce((n, h) => n + h.lines.length, 0) ?? 0, [file]);
  const revs = (() => {
    if (target.kind === "commit") return [`${target.id}^`, target.id];
    if (target.kind === "staged") return ["HEAD", "index"];
    return ["index", "workdir"];
  })();

  let budget = all ? Infinity : LIMIT;

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label={`Diff of ${path}`}>
      <header className="flex h-10 shrink-0 items-center gap-2 border-b px-3 text-sm">
        <span className="truncate font-medium">{file?.old_path ? `${file.old_path} → ${path}` : path}</span>
        <span className="ml-auto" />
        <div className="flex rounded-md border p-0.5 text-xs" role="group" aria-label="Diff layout">
          <button className={`rounded px-2 py-0.5 ${!split ? "bg-muted" : ""}`} aria-pressed={!split} onClick={() => setSplit(false)}>
            Unified
          </button>
          <button className={`rounded px-2 py-0.5 ${split ? "bg-muted" : ""}`} aria-pressed={split} onClick={() => setSplit(true)}>
            Split
          </button>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Close diff" onClick={onClose}>
          <X />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto font-mono text-xs leading-5">
        {error && <p className="p-3 text-destructive">{error}</p>}
        {!file && !error && <p className="p-3 font-sans text-muted-foreground">No changes in this file.</p>}
        {file && IMAGE.test(path) && <ImageDiff root={root} revs={revs} path={path} oldPath={file.old_path ?? path} version={version} />}
        {file?.binary && !IMAGE.test(path) && <p className="p-3 text-muted-foreground">Binary file changed.</p>}
        {file && !file.binary && !file.hunks.length && <p className="p-3 text-muted-foreground">No content changes.</p>}
        {file?.hunks.map((h, hi) => {
          if (budget <= 0) return null;
          const shown = h.lines.slice(0, budget);
          budget -= h.lines.length;
          const nSel = [...sel].filter((k) => k.startsWith(`${hi}:`)).length;
          const what = nSel ? `${nSel} line${nSel === 1 ? "" : "s"}` : "hunk";
          return (
            <div key={hi} className="border-b">
              <div className="sticky top-0 z-10 flex items-center gap-2 bg-muted px-3 py-1 text-muted-foreground">
                <span className="truncate">{h.header}</span>
                {editable && (
                  <span className="ml-auto flex shrink-0 gap-1 font-sans">
                    {target.kind === "unstaged" ? (
                      <>
                        <Button size="xs" variant="outline" onClick={() => apply("discard", hi)}>
                          Discard {what}
                        </Button>
                        <Button size="xs" onClick={() => apply("stage", hi)}>
                          Stage {what}
                        </Button>
                      </>
                    ) : (
                      <Button size="xs" onClick={() => apply("unstage", hi)}>
                        Unstage {what}
                      </Button>
                    )}
                  </span>
                )}
              </div>
              {split ? (
                <SplitHunk lines={shown} hunk={hi} sel={sel} lang={lang} toggle={toggle} />
              ) : (
                shown.map((l, li) => (
                  <LineRow key={li} line={l} k={`${hi}:${li}`} sel={sel} lang={lang} onClick={(s) => toggle(hi, li, s)} />
                ))
              )}
            </div>
          );
        })}
        {!all && lineCount > LIMIT && (
          <div className="p-3 font-sans">
            <Button variant="outline" size="sm" onClick={() => setAll(true)}>
              Show all {lineCount.toLocaleString()} lines
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}

const tone = (o: string) =>
  o === "+" ? "bg-[var(--diff-add)]" : o === "-" ? "bg-[var(--diff-del)]" : "";

function LineRow({
  line,
  k,
  sel,
  lang,
  onClick,
  side,
}: {
  line: Line;
  k: string;
  sel: Set<string>;
  lang: string | null;
  onClick: (shift: boolean) => void;
  side?: "old" | "new";
}) {
  const html = highlight(line.text, lang);
  const picked = sel.has(k);
  const changed = line.origin !== " ";
  return (
    <div
      className={`flex min-w-max ${tone(line.origin)} ${picked ? "outline outline-1 -outline-offset-1 outline-primary" : ""} ${
        changed ? "cursor-pointer" : ""
      }`}
      onClick={(e) => changed && onClick(e.shiftKey)}
      aria-selected={changed ? picked : undefined}
    >
      {side !== "new" && <span className="w-10 shrink-0 pr-2 text-right text-muted-foreground select-none">{line.old ?? ""}</span>}
      {side !== "old" && <span className="w-10 shrink-0 pr-2 text-right text-muted-foreground select-none">{line.new ?? ""}</span>}
      <span className="w-4 shrink-0 text-center text-muted-foreground select-none">{line.origin}</span>
      {html ? (
        <span className="pr-4 whitespace-pre" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <span className="pr-4 whitespace-pre">{line.text}</span>
      )}
    </div>
  );
}

function SplitHunk({
  lines,
  hunk,
  sel,
  lang,
  toggle,
}: {
  lines: Line[];
  hunk: number;
  sel: Set<string>;
  lang: string | null;
  toggle: (h: number, l: number, shift: boolean) => void;
}) {
  type Cell = { line: Line; i: number } | null;
  const rows: [Cell, Cell][] = [];
  for (let i = 0; i < lines.length; ) {
    if (lines[i].origin === " ") {
      rows.push([{ line: lines[i], i }, { line: lines[i], i }]);
      i++;
      continue;
    }
    const del: Cell[] = [];
    const add: Cell[] = [];
    while (i < lines.length && lines[i].origin !== " ") {
      (lines[i].origin === "-" ? del : add).push({ line: lines[i], i });
      i++;
    }
    for (let j = 0; j < Math.max(del.length, add.length); j++) rows.push([del[j] ?? null, add[j] ?? null]);
  }
  const cell = (c: Cell, side: "old" | "new") =>
    c ? (
      <LineRow line={c.line} k={`${hunk}:${c.i}`} sel={sel} lang={lang} side={side} onClick={(s) => toggle(hunk, c.i, s)} />
    ) : (
      <div className="h-5 bg-muted/40" />
    );
  return (
    <div className="grid grid-cols-2">
      {rows.map(([a, b], r) => (
        <div key={r} className="contents">
          <div className="overflow-hidden border-r">{cell(a, "old")}</div>
          <div className="overflow-hidden">{cell(b, "new")}</div>
        </div>
      ))}
    </div>
  );
}

function ImageDiff({
  root,
  revs,
  path,
  oldPath,
  version,
}: {
  root: string;
  revs: string[];
  path: string;
  oldPath: string;
  version: number;
}) {
  const [urls, setUrls] = useState<(string | null)[]>([null, null]);
  useEffect(() => {
    let made: string[] = [];
    const type = path.toLowerCase().endsWith(".svg") ? "image/svg+xml" : "";
    Promise.all(
      [
        [revs[0], oldPath],
        [revs[1], path],
      ].map(([rev, p]) =>
        api
          .blob(root, rev, p)
          .then((b) => URL.createObjectURL(new Blob([b], type ? { type } : {})))
          .catch(() => null),
      ),
    ).then((u) => {
      made = u.filter((x): x is string => !!x);
      setUrls(u);
    });
    return () => made.forEach(URL.revokeObjectURL);
  }, [root, revs[0], revs[1], path, oldPath, version]);
  return (
    <div className="grid grid-cols-2 gap-4 p-4 font-sans">
      {["Before", "After"].map((label, i) => (
        <figure key={label} className="grid gap-2">
          <figcaption className="text-xs text-muted-foreground">{label}</figcaption>
          {urls[i] ? (
            <img src={urls[i]!} alt={`${label}: ${path}`} className="max-h-96 max-w-full rounded border bg-[repeating-conic-gradient(#8882_0_25%,transparent_0_50%)] bg-[length:16px_16px] object-contain" />
          ) : (
            <p className="text-sm text-muted-foreground">None</p>
          )}
        </figure>
      ))}
    </div>
  );
}
