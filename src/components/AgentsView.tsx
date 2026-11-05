import { useEffect, useRef, useState } from "react";
import { Bot, FolderOpen, Play, Plus, Square, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, type Op } from "@/lib/api";
import { ask, confirm } from "@/lib/prompt";
import { TerminalPanel } from "@/components/TerminalPanel";

type Session = { id: string; branch: string; path: string; setup: string; agent: string; task: string };
type Live = { started: number; lastOutput: number; exited: boolean; changes: number | null };

type Props = {
  root: string;
  run: (op: Op, label?: string) => Promise<boolean>;
  onOpenRepo: (path: string) => void;
  onClose: () => void;
};

const KEY = (root: string) => `githawk.agents.${root}`;
const load = (root: string): Session[] => {
  try {
    return JSON.parse(localStorage.getItem(KEY(root)) ?? "[]");
  } catch {
    return [];
  }
};
const save = (root: string, list: Session[]) => {
  try {
    localStorage.setItem(KEY(root), JSON.stringify(list));
  } catch {
    /* sessions just won't persist */
  }
};
// ponytail: POSIX quoting; PowerShell/cmd users type their own command line
const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "task";
const IDLE_MS = 4000;

export function AgentsView({ root, run, onOpenRepo, onClose }: Props) {
  const [sessions, setSessions] = useState<Session[]>(() => load(root));
  const [live, setLive] = useState<Record<string, Live>>({});
  const [selected, setSelected] = useState<string | null>(sessions[0]?.id ?? null);
  const [, tick] = useState(0);
  const lastOutput = useRef<Record<string, number>>({});

  useEffect(() => save(root, sessions), [root, sessions]);

  useEffect(() => {
    const t = setInterval(async () => {
      const ids = Object.keys(live).filter((id) => !live[id].exited);
      const changes = await Promise.all(
        ids.map((id) =>
          api
            .status(sessions.find((s) => s.id === id)!.path)
            .then((s) => s.files.length)
            .catch(() => null),
        ),
      );
      setLive((l) => {
        const next = { ...l };
        ids.forEach((id, i) => next[id] && (next[id] = { ...next[id], changes: changes[i], lastOutput: lastOutput.current[id] ?? next[id].lastOutput }));
        return next;
      });
      tick((x) => x + 1);
    }, 2000);
    return () => clearInterval(t);
  }, [live, sessions]);

  const start = (id: string) => {
    lastOutput.current[id] = Date.now();
    setLive((l) => ({ ...l, [id]: { started: Date.now(), lastOutput: Date.now(), exited: false, changes: null } }));
    setSelected(id);
  };

  const stop = (id: string) =>
    setLive((l) => {
      const { [id]: _, ...rest } = l;
      return rest;
    });

  async function create() {
    const last = sessions[sessions.length - 1];
    const parent = root.replace(/[\\/][^\\/]*$/, "");
    const name = root.split(/[\\/]/).pop();
    const r = await ask({
      title: "New agent session",
      description: "Creates a branch in its own worktree, runs the setup command there, then starts the coding agent with your task.",
      fields: [
        { name: "task", label: "Task for the agent", placeholder: "Add input validation to the signup form" },
        { name: "branch", label: "Branch (leave empty to name it after the task)", optional: true },
        { name: "setup", label: "Setup command", value: last?.setup ?? "", placeholder: "pnpm install", optional: true },
        { name: "agent", label: "Agent command", value: last?.agent ?? "claude", placeholder: "claude, codex, aider…" },
      ],
      confirm: "Start",
    });
    if (!r) return;
    const task = r.text.task.trim();
    const branch = r.text.branch.trim() || `agent/${slug(task)}`;
    const path = `${parent}/${name}-${branch.replace(/[\\/]/g, "-")}`;
    if (!(await run({ op: "worktree-add", path, branch, create: true }, `Worktree for ${branch} ready`))) return;
    const s: Session = { id: crypto.randomUUID(), branch, path, setup: r.text.setup.trim(), agent: r.text.agent.trim(), task };
    setSessions((list) => [...list, s]);
    start(s.id);
  }

  async function remove(s: Session) {
    if (!(await confirm(`Remove ${s.branch}?`, `Stops the agent and deletes the worktree at ${s.path}. The branch stays.`, "Remove"))) return;
    stop(s.id);
    if (!(await run({ op: "worktree-remove", path: s.path, force: false }))) {
      if (!(await confirm("The worktree has changes", "Remove it anyway? Its uncommitted changes will be lost.", "Remove"))) return;
      if (!(await run({ op: "worktree-remove", path: s.path, force: true }))) return;
    }
    setSessions((list) => list.filter((x) => x.id !== s.id));
    if (selected === s.id) setSelected(null);
  }

  const state = (s: Session) => {
    const l = live[s.id];
    if (!l) return { label: "Stopped", dot: "bg-muted-foreground/40" };
    if (l.exited) return { label: "Exited", dot: "bg-muted-foreground" };
    if (Date.now() - l.lastOutput < IDLE_MS) return { label: "Working", dot: "bg-[var(--lane-2)] animate-pulse" };
    return { label: "Waiting for you", dot: "bg-[var(--lane-4)]" };
  };

  const command = (s: Session) => [s.setup, s.task ? `${s.agent} ${quote(s.task)}` : s.agent].filter(Boolean).join(" && ");
  const current = sessions.find((s) => s.id === selected);

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <aside className="flex w-64 shrink-0 flex-col border-r" aria-label="Agent sessions">
        <header className="flex items-center gap-2 px-3 py-2 text-sm font-medium">
          <Bot className="size-4" /> Agents
          <Button size="xs" variant="outline" className="ml-auto" onClick={create}>
            <Plus /> New
          </Button>
        </header>
        <ul className="min-h-0 flex-1 overflow-auto px-1 pb-2">
          {!sessions.length && (
            <li className="px-2 py-4 text-sm text-muted-foreground">Run several coding agents side by side, each on its own branch and worktree.</li>
          )}
          {sessions.map((s) => {
            const st = state(s);
            const changes = live[s.id]?.changes;
            return (
              <li key={s.id}>
                <button
                  className={`grid w-full gap-0.5 rounded px-2 py-1.5 text-left ${selected === s.id ? "bg-accent" : "hover:bg-muted"}`}
                  onClick={() => setSelected(s.id)}
                >
                  <span className="flex items-center gap-2 text-sm">
                    <span className={`size-2 shrink-0 rounded-full ${st.dot}`} aria-hidden />
                    <span className="truncate">{s.branch}</span>
                  </span>
                  <span className="truncate pl-4 text-xs text-muted-foreground">
                    {st.label}
                    {changes != null && ` · ${changes} changed file${changes === 1 ? "" : "s"}`}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-1 border-b px-3 py-1.5 text-sm">
          {current ? (
            <>
            <span className="min-w-0 flex-1 truncate" title={current.task}>
              {current.task || current.branch}
            </span>
            {live[current.id] && !live[current.id].exited ? (
              <Button size="xs" variant="ghost" onClick={() => stop(current.id)}>
                <Square /> Stop
              </Button>
            ) : (
              <Button size="xs" variant="ghost" onClick={() => start(current.id)}>
                <Play /> {live[current.id] ? "Restart" : "Start"}
              </Button>
            )}
            <Button size="xs" variant="ghost" onClick={() => onOpenRepo(current.path)}>
              <FolderOpen /> Open worktree
            </Button>
            <Button size="xs" variant="ghost" onClick={() => remove(current)}>
              <Trash2 /> Remove
            </Button>
            </>
          ) : (
            <span className="flex-1 text-muted-foreground">Select or start an agent session.</span>
          )}
          <Button size="icon-xs" variant="ghost" aria-label="Back to graph" onClick={onClose}>
            <X />
          </Button>
        </header>
        <div className="relative min-h-0 flex-1">
          {sessions.map(
            (s) =>
              live[s.id] && (
                <div key={`${s.id}:${live[s.id].started}`} className={s.id === selected ? "absolute inset-0" : "hidden"}>
                  <TerminalPanel
                    root={s.path}
                    command={command(s)}
                    onOutput={() => (lastOutput.current[s.id] = Date.now())}
                    onExit={() => setLive((l) => (l[s.id] ? { ...l, [s.id]: { ...l[s.id], exited: true } } : l))}
                  />
                </div>
              ),
          )}
          {current && !live[current.id] && (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              <Button variant="outline" onClick={() => start(current.id)}>
                <Play /> Start {current.agent}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
