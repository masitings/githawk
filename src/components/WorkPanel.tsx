import { useState } from "react";
import { LoaderCircle, Minus, Plus, Sparkles, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api, type FileStatus, type Op, type Status, type Target } from "@/lib/api";
import { confirm } from "@/lib/prompt";
import { aiRun } from "@/lib/settings";
import { WithMenu, type MenuItem } from "@/components/Menu";

const SUMMARY_MAX = 72;

const letterTone: Record<string, string> = {
  A: "text-[var(--lane-2)]",
  "?": "text-[var(--lane-2)]",
  M: "text-[var(--lane-4)]",
  D: "text-destructive",
  R: "text-[var(--lane-0)]",
  "!": "text-destructive",
};

type Props = {
  root: string;
  status: Status;
  open: { target: Target; path: string } | null;
  onOpen: (target: Target, path: string) => void;
  onConflict: (path: string) => void;
  fileMenu: (path: string) => MenuItem[];
  run: (op: Op, label?: string) => Promise<boolean>;
};

export function WorkPanel({ root, status, open, onOpen, onConflict, fileMenu, run }: Props) {
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [amend, setAmend] = useState(false);
  const [sign, setSign] = useState(false);
  const [generating, setGenerating] = useState(false);
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
    }
  }

  const list = (files: FileStatus[], side: "unstaged" | "staged") =>
    files.map((f) => {
      const letter = f.conflicted ? "!" : (side === "staged" ? f.staged : f.unstaged) ?? "";
      const active = open?.path === f.path && open.target.kind === side;
      return (
        <li key={f.path}>
          <WithMenu items={() => fileMenu(f.path)} className={`group flex items-center gap-2 rounded px-2 py-0.5 ${active ? "bg-accent" : "hover:bg-muted"}`}>
          <span className={`w-3 shrink-0 font-mono text-xs font-bold ${letterTone[letter] ?? ""}`} aria-label={`status ${letter}`}>
            {letter}
          </span>
          <button
            className="min-w-0 flex-1 truncate text-left text-sm"
            title={f.conflicted ? `${f.path} has conflicts: click to resolve` : f.path}
            onClick={() => (f.conflicted ? onConflict(f.path) : onOpen({ kind: side }, f.path))}
          >
            {f.path}
          </button>
          {side === "unstaged" ? (
            <>
              <Button
                size="icon-xs"
                variant="ghost"
                className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                aria-label={`Discard ${f.path}`}
                onClick={() => discard([f])}
              >
                <Undo2 />
              </Button>
              <Button
                size="icon-xs"
                variant="ghost"
                className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                aria-label={`Stage ${f.path}`}
                onClick={() => run({ op: "stage", paths: [f.path] })}
              >
                <Plus />
              </Button>
            </>
          ) : (
            <Button
              size="icon-xs"
              variant="ghost"
              className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              aria-label={`Unstage ${f.path}`}
              onClick={() => run({ op: "unstage", paths: [f.path] })}
            >
              <Minus />
            </Button>
          )}
          </WithMenu>
        </li>
      );
    });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
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
      <form onSubmit={commit} className="grid gap-2 p-3">
        <div className="relative">
          <Input
            aria-label="Commit summary"
            placeholder="Summary"
            value={summary}
            onChange={(e) => setSummary(e.currentTarget.value)}
            className="pr-20"
          />
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            className="absolute top-1/2 right-9 -translate-y-1/2"
            aria-label="Generate commit message with AI"
            title="Generate from staged changes with AI"
            disabled={generating || !staged.length}
            onClick={generate}
          >
            {generating ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
          </Button>
          <span
            className={`absolute top-1/2 right-2 -translate-y-1/2 text-xs ${
              summary.length > SUMMARY_MAX ? "text-destructive" : "text-muted-foreground"
            }`}
            aria-live="polite"
          >
            {SUMMARY_MAX - summary.length}
          </span>
        </div>
        {summary.length > SUMMARY_MAX && (
          <p className="text-xs text-destructive">Keep the summary under {SUMMARY_MAX} characters; put details in the description.</p>
        )}
        <Textarea
          aria-label="Commit description"
          placeholder="Description"
          rows={3}
          className="max-h-40"
          value={description}
          onChange={(e) => setDescription(e.currentTarget.value)}
        />
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={amend} onCheckedChange={(v) => toggleAmend(v === true)} />
          Amend previous commit
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={sign} onCheckedChange={(v) => setSign(v === true)} />
          Sign commit (GPG/SSH)
        </label>
        <Button type="submit" disabled={!summary.trim() || (!staged.length && !amend)}>
          {amend ? "Amend commit" : `Commit ${staged.length} file${staged.length === 1 ? "" : "s"}`}
        </Button>
      </form>
    </div>
  );
}
