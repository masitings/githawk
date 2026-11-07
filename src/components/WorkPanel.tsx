import { useState } from "react";
import { Archive, ArrowRight, ChevronRight, GitCommitHorizontal, Copy, Folder, FolderOpen, FolderTree, List, LoaderCircle, Minus, Pencil, Plus, Sparkles, TriangleAlert, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { api, type FileStatus, type Op, type Status, type Target } from "@/lib/api";
import { confirm } from "@/lib/prompt";
import { aiRun, getSettings, setSettings, useSettings } from "@/lib/settings";
import { WithMenu, type MenuItem } from "@/components/Menu";

const SUMMARY_MAX = 72;

const STATUS: Record<string, [typeof Plus, string, string]> = {
  A: [Plus, "Added", "var(--lane-3)"],
  "?": [Plus, "Untracked", "var(--lane-3)"],
  M: [Pencil, "Modified", "var(--lane-0)"],
  T: [Pencil, "Type changed", "var(--lane-0)"],
  D: [Minus, "Deleted", "var(--lane-4)"],
  R: [ArrowRight, "Renamed", "var(--lane-2)"],
  C: [Copy, "Copied", "var(--lane-2)"],
  "!": [TriangleAlert, "Conflicted", "var(--lane-4)"],
};

const INDENT = 14;

// One vertical guide per nesting level, like editor file trees.
const guides = (depth: number) =>
  Array.from({ length: depth }, (_, i) => (
    <span key={i} aria-hidden className="pointer-events-none absolute inset-y-0 border-l border-border" style={{ left: 15 + i * INDENT }} />
  ));

type Dir = { name: string; path: string; dirs: Dir[]; files: FileStatus[] };

function buildTree(files: FileStatus[]): Dir {
  const root: Dir = { name: "", path: "", dirs: [], files: [] };
  for (const f of files) {
    let d = root;
    const parts = f.path.split("/");
    for (const part of parts.slice(0, -1)) {
      const path = d.path ? `${d.path}/${part}` : part;
      let next = d.dirs.find((x) => x.path === path);
      if (!next) d.dirs.push((next = { name: part, path, dirs: [], files: [] }));
      d = next;
    }
    d.files.push(f);
  }
  // Folders holding a single folder and nothing else collapse into "a/b/c", like most editors do.
  const squash = (d: Dir): Dir => {
    d.dirs = d.dirs.map(squash);
    if (d.path && d.dirs.length === 1 && !d.files.length) {
      const only = d.dirs[0];
      return { ...only, name: `${d.name}/${only.name}` };
    }
    return d;
  };
  return squash(root);
}

const allFiles = (d: Dir): FileStatus[] => [...d.files, ...d.dirs.flatMap(allFiles)];

type Props = {
  root: string;
  status: Status;
  open: { target: Target; path: string } | null;
  onOpen: (target: Target, path: string) => void;
  onConflict: (path: string) => void;
  fileMenu: (path: string) => MenuItem[];
  run: (op: Op, label?: string) => Promise<boolean>;
  onPush: () => void;
};

export function WorkPanel({ root, status, open, onOpen, onConflict, fileMenu, run, onPush }: Props) {
  const ui = useSettings().ui;
  const spellCheck = ui.spellcheck;
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleDir = (key: string) =>
    setCollapsed((c) => {
      const n = new Set(c);
      if (!n.delete(key)) n.add(key);
      return n;
    });
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [amend, setAmend] = useState(false);
  const [sign, setSign] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [mode, setMode] = useState<"commit" | "stash">("commit");
  const [stashTitle, setStashTitle] = useState("");
  const [stashBody, setStashBody] = useState("");
  const [stashUntracked, setStashUntracked] = useState(true);
  const unstaged = status.files.filter((f) => f.unstaged || f.conflicted);
  const staged = status.files.filter((f) => f.staged && !f.conflicted);

  async function discard(files: FileStatus[]) {
    const n = files.length;
    if (!(await confirm("Discard changes?", `Changes in ${n} file${n === 1 ? "" : "s"} will be lost.`, "Discard"))) return;
    await run({
      op: "discard",
      tracked: files.filter((f) => f.unstaged !== "?").map((f) => f.path),
      untracked: files.filter((f) => f.unstaged === "?").map((f) => f.path),
    });
  }

  async function toggleAmend(on: boolean) {
    setAmend(on);
    if (on && !summary && !description) {
      try {
        const head = await api.commit(root, "HEAD");
        const [s, ...rest] = head.message.split("\n");
        setSummary(s);
        setDescription(rest.join("\n").trim());
      } catch {
        /* no HEAD yet: nothing to prefill */
      }
    }
  }

  async function generate() {
    setGenerating(true);
    try {
      const [s, ...rest] = (await aiRun(root, { kind: "commit-message" })).split("\n");
      setSummary(s.trim());
      setDescription(rest.join("\n").trim());
    } catch (e) {
      toast.error(String(e));
    } finally {
      setGenerating(false);
    }
  }

  async function commit(e: React.FormEvent) {
    e.preventDefault();
    if (await run({ op: "commit", summary, description, amend, sign }, amend ? "Amended" : "Committed")) {
      setSummary("");
      setDescription("");
      setAmend(false);
      if (ui.pushAfterCommit) onPush();
    }
  }

  async function stash(e: React.FormEvent) {
    e.preventDefault();
    const message = stashBody.trim() ? `${stashTitle.trim()}\n\n${stashBody.trim()}` : stashTitle.trim();
    if (await run({ op: "stash-save", message, untracked: stashUntracked }, "Stashed")) {
      setStashTitle("");
      setStashBody("");
    }
  }

  const actions = (files: FileStatus[], side: "unstaged" | "staged", label: string) =>
    side === "unstaged" ? (
      <>
        <Button
          size="icon-xs"
          variant="ghost"
          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          aria-label={`Discard ${label}`}
          onClick={() => discard(files)}
        >
          <Undo2 />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          aria-label={`Stage ${label}`}
          onClick={() => run({ op: "stage", paths: files.map((f) => f.path) })}
        >
          <Plus />
        </Button>
      </>
    ) : (
      <Button
        size="icon-xs"
        variant="ghost"
        className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        aria-label={`Unstage ${label}`}
        onClick={() => run({ op: "unstage", paths: files.map((f) => f.path) })}
      >
        <Minus />
      </Button>
    );

  const fileRow = (f: FileStatus, side: "unstaged" | "staged", depth: number) => {
    const letter = f.conflicted ? "!" : (side === "staged" ? f.staged : f.unstaged) ?? "";
    const active = open?.path === f.path && open.target.kind === side;
    const tree = ui.fileView === "tree";
    const [Icon, label, tone] = STATUS[letter] ?? [Pencil, letter, "var(--muted-foreground)"];
    return (
      <li key={f.path} className="relative">
        {guides(depth)}
        <WithMenu
          items={() => fileMenu(f.path)}
          className={`group flex h-7 items-center gap-2 rounded-md pr-1 ${active ? "bg-accent" : "hover:bg-muted"}`}
          style={{ paddingLeft: 8 + depth * INDENT + (tree && depth ? 4 : 0) }}
        >
          <Icon role="img" aria-label={label} className="size-3 shrink-0" strokeWidth={2.25} style={{ color: tone }}>
            <title>{label}</title>
          </Icon>
          <button
            className="min-w-0 flex-1 truncate text-left text-sm"
            title={f.conflicted ? `${f.path} has conflicts: click to resolve` : f.path}
            onClick={() => (f.conflicted ? onConflict(f.path) : onOpen({ kind: side }, f.path))}
          >
            {tree ? f.path.slice(f.path.lastIndexOf("/") + 1) : f.path}
          </button>
          {actions([f], side, f.path)}
        </WithMenu>
      </li>
    );
  };

  const dirRows = (d: Dir, side: "unstaged" | "staged", depth: number): React.ReactNode[] => {
    const rows: React.ReactNode[] = [];
    for (const sub of d.dirs) {
      const key = `${side}:${sub.path}`;
      const open = !collapsed.has(key);
      const files = allFiles(sub);
      rows.push(
        <li key={key} className="relative">
          {guides(depth)}
          <div className="group flex h-7 items-center gap-1 rounded-md pr-1 hover:bg-muted" style={{ paddingLeft: 2 + depth * INDENT + (depth ? 4 : 0) }}>
            <button
              className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm"
              aria-expanded={open}
              title={sub.path}
              onClick={() => toggleDir(key)}
            >
              <ChevronRight className={`size-3 shrink-0 text-dim transition-transform ${open ? "rotate-90" : ""}`} aria-hidden />
              {open ? (
                <FolderOpen className="size-3.5 shrink-0 text-[var(--lane-0)]" aria-hidden />
              ) : (
                <Folder className="size-3.5 shrink-0 text-[var(--lane-0)]" aria-hidden />
              )}
              <span className="truncate">{sub.name}</span>
              <span className="ml-auto shrink-0 rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground group-hover:hidden">{files.length}</span>
            </button>
            {actions(files, side, `folder ${sub.path}`)}
          </div>
        </li>,
      );
      if (open) rows.push(...dirRows(sub, side, depth + 1));
    }
    rows.push(...d.files.map((f) => fileRow(f, side, depth)));
    return rows;
  };

  const list = (files: FileStatus[], side: "unstaged" | "staged") =>
    ui.fileView === "tree" ? dirRows(buildTree(files), side, 0) : files.map((f) => fileRow(f, side, 0));

  const viewButton = (view: "path" | "tree", Icon: typeof List, label: string) => (
    <Button
      size="xs"
      variant="ghost"
      aria-pressed={ui.fileView === view}
      className={`h-5 ${ui.fileView === view ? "bg-raised text-foreground" : "text-muted-foreground"}`}
      onClick={() => setSettings({ ui: { ...getSettings().ui, fileView: view } })}
    >
      <Icon /> {label}
    </Button>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-7 shrink-0 items-center gap-1 border-b bg-panel px-1.5" role="group" aria-label="File list view">
        {viewButton("path", List, "Path")}
        {viewButton("tree", FolderTree, "Tree")}
      </div>
      <section className="flex min-h-0 flex-1 flex-col border-b">
        <header className="flex items-center gap-2 px-3 py-2 text-sm font-medium">
          Unstaged ({unstaged.length})
          <span className="ml-auto flex gap-1">
            {unstaged.length > 0 && (
              <>
                <Button size="xs" variant="ghost" onClick={() => discard(unstaged)}>
                  Discard all
                </Button>
                <Button size="xs" variant="outline" onClick={() => run({ op: "stage", paths: unstaged.map((f) => f.path) })}>
                  Stage all
                </Button>
              </>
            )}
          </span>
        </header>
        <ul className="min-h-0 flex-1 overflow-auto px-1 pb-2">{list(unstaged, "unstaged")}</ul>
      </section>
      <section className="flex min-h-0 flex-1 flex-col border-b">
        <header className="flex items-center gap-2 px-3 py-2 text-sm font-medium">
          Staged ({staged.length})
          {staged.length > 0 && (
            <Button
              size="xs"
              variant="outline"
              className="ml-auto"
              onClick={() => run({ op: "unstage", paths: staged.map((f) => f.path) })}
            >
              Unstage all
            </Button>
          )}
        </header>
        <ul className="min-h-0 flex-1 overflow-auto px-1 pb-2">{list(staged, "staged")}</ul>
      </section>
      <div className="grid gap-2 p-3">
        <div className="flex gap-1" role="tablist" aria-label="Commit or stash">
          {(["commit", "stash"] as const).map((t) => (
            <Button
              key={t}
              type="button"
              role="tab"
              size="xs"
              variant="ghost"
              aria-selected={mode === t}
              className={mode === t ? "bg-raised text-foreground" : "text-muted-foreground"}
              onClick={() => setMode(t)}
            >
              {t === "commit" ? <GitCommitHorizontal /> : <Archive />}
              {t === "commit" ? "Commit" : "Stash"}
            </Button>
          ))}
        </div>

        {mode === "commit" ? (
          <form onSubmit={commit} className="grid gap-2">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={amend} onCheckedChange={(v) => toggleAmend(v === true)} />
              Amend previous commit
            </label>
            <div className="rounded-md border bg-panel-2 focus-within:ring-3 focus-within:ring-ring/50">
              <div className="flex items-center gap-1 pr-1.5">
                <input
                  aria-label="Commit summary"
                  placeholder="Commit summary"
                  spellCheck={spellCheck}
                  value={summary}
                  onChange={(e) => setSummary(e.currentTarget.value)}
                  className="h-9 min-w-0 flex-1 bg-transparent px-2.5 text-sm outline-none placeholder:text-muted-foreground"
                />
                <span className={`text-xs tabular-nums ${summary.length > SUMMARY_MAX ? "text-destructive" : "text-muted-foreground"}`} aria-live="polite">
                  {SUMMARY_MAX - summary.length}
                </span>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Generate commit message with AI"
                  title="Generate from staged changes with AI"
                  disabled={generating || !staged.length}
                  onClick={generate}
                >
                  {generating ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
                </Button>
              </div>
              <textarea
                aria-label="Commit description"
                placeholder="Description"
                spellCheck={spellCheck}
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.currentTarget.value)}
                className="block max-h-40 min-h-16 w-full resize-y bg-transparent px-2.5 pb-2 text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            {summary.length > SUMMARY_MAX && (
              <p className="text-xs text-destructive">Keep the summary under {SUMMARY_MAX} characters; put details in the description.</p>
            )}
            <details className="group text-sm">
              <summary className="flex cursor-pointer list-none items-center gap-1 text-muted-foreground select-none hover:text-foreground">
                <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" aria-hidden />
                Commit options
              </summary>
              <div className="grid gap-2 pt-2 pl-1">
                <label className="flex items-center gap-2">
                  <Checkbox checked={sign} onCheckedChange={(v) => setSign(v === true)} />
                  Sign commit (GPG/SSH)
                </label>
                <label className="flex items-center gap-2">
                  <Checkbox checked={ui.pushAfterCommit} onCheckedChange={(v) => setSettings({ ui: { ...getSettings().ui, pushAfterCommit: v === true } })} />
                  Push after committing
                </label>
              </div>
            </details>
            <Button type="submit" className="h-9" disabled={!summary.trim() || (!staged.length && !amend)}>
              <GitCommitHorizontal />
              {!summary.trim()
                ? "Type a message to commit"
                : amend
                  ? "Amend commit"
                  : !staged.length
                    ? "Stage changes to commit"
                    : `Commit ${staged.length} file${staged.length === 1 ? "" : "s"}${ui.pushAfterCommit ? " and push" : ""}`}
            </Button>
          </form>
        ) : (
          <form onSubmit={stash} className="grid gap-2">
            <div className="rounded-md border bg-panel-2 focus-within:ring-3 focus-within:ring-ring/50">
              <input
                aria-label="Stash title"
                placeholder="Stash title"
                spellCheck={spellCheck}
                value={stashTitle}
                onChange={(e) => setStashTitle(e.currentTarget.value)}
                className="h-9 w-full bg-transparent px-2.5 text-sm outline-none placeholder:text-muted-foreground"
              />
              <textarea
                aria-label="Stash description"
                placeholder="Description"
                spellCheck={spellCheck}
                rows={3}
                value={stashBody}
                onChange={(e) => setStashBody(e.currentTarget.value)}
                className="block max-h-40 min-h-16 w-full resize-y bg-transparent px-2.5 pb-2 text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={stashUntracked} onCheckedChange={(v) => setStashUntracked(v === true)} />
              Include untracked files
            </label>
            <Button type="submit" className="h-9" disabled={!status.files.length || !stashTitle.trim()}>
              <Archive />
              {!status.files.length ? "No changes to stash" : !stashTitle.trim() ? "Type a message to stash" : `Stash ${status.files.length} file${status.files.length === 1 ? "" : "s"}`}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
