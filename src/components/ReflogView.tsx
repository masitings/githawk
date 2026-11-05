import { useEffect, useState } from "react";
import { Copy, History, SquareTerminal, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, date, short, type Logged, type ReflogEntry } from "@/lib/api";
import { WithMenu, type MenuItem } from "@/components/Menu";

type Props = {
  root: string;
  version: number;
  menu: (id: string) => MenuItem[];
  onSelectCommit: (id: string) => void;
  onClose: () => void;
};

const shellArg = (a: string) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`);
export const commandLine = (e: Logged) => `git ${e.args.map(shellArg).join(" ")}`;
const clock = (t: number) => new Date(t * 1000).toLocaleTimeString(undefined, { hour12: false });
const seconds = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

export function ReflogView({ root, version, menu, onSelectCommit, onClose }: Props) {
  const [entries, setEntries] = useState<ReflogEntry[] | null>(null);
  const [log, setLog] = useState<Logged[]>([]);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    api.reflog(root).then(setEntries).catch((e) => toast.error(String(e)));
  }, [root, version]);

  useEffect(() => {
    const load = () => api.commandLog(root).then(setLog).catch(() => {});
    load();
    const t = setInterval(load, 1500);
    return () => clearInterval(t);
  }, [root]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-auto bg-background p-4">
      <section className="flex max-h-[55%] min-h-48 shrink-0 flex-col overflow-hidden rounded-[9px] border bg-panel" aria-label="Reflog">
        <header className="flex shrink-0 items-center gap-2 border-b px-3.5 py-2.5 text-sm">
          <History className="size-4 text-muted-foreground" aria-hidden />
          <b>Reflog</b>
          <span className="flex-1 truncate text-xs text-dim">Every position HEAD has been at. Right-click to restore one.</span>
          <Button variant="ghost" size="icon-sm" aria-label="Back to graph" onClick={onClose}>
            <X />
          </Button>
        </header>
        <ol className="min-h-0 flex-1 overflow-auto p-1">
          {entries?.map((e, i) => (
            <li key={i}>
              <WithMenu
                items={() => menu(e.id)}
                role="button"
                tabIndex={0}
                onClick={() => onSelectCommit(e.id)}
                onKeyDown={(ev: React.KeyboardEvent) => ev.key === "Enter" && onSelectCommit(e.id)}
                className="flex h-8 items-center gap-3 rounded-md px-2.5 text-sm hover:bg-raised"
              >
                <code className="w-16 shrink-0 text-[11.5px] text-muted-foreground">HEAD@{`{${i}}`}</code>
                <code className="w-16 shrink-0 text-[11.5px] text-[var(--lane-1)]">{short(e.id)}</code>
                <span className="flex-1 truncate">{e.message}</span>
                <time className="shrink-0 text-xs text-dim">{date(e.time)}</time>
              </WithMenu>
            </li>
          ))}
        </ol>
      </section>

      <section className="flex min-h-48 flex-1 flex-col overflow-hidden rounded-[9px] border bg-panel" aria-label="Git command log">
        <header className="flex shrink-0 items-center gap-2 border-b px-3.5 py-2.5 text-sm">
          <SquareTerminal className="size-4 text-muted-foreground" aria-hidden />
          <b>Git command log</b>
          <span className="flex-1 truncate text-xs text-dim">The exact commands GitHawk ran for you in this session</span>
          <Button
            variant="outline"
            size="sm"
            disabled={!log.length}
            onClick={() => navigator.clipboard.writeText(log.map((e) => `$ ${commandLine(e)}`).join("\n")).then(() => toast.success("Copied"))}
          >
            <Copy /> Copy
          </Button>
        </header>
        <ol className="min-h-0 flex-1 overflow-auto px-2 py-1.5 font-mono text-xs">
          {!log.length && <li className="px-1.5 py-2 font-sans text-sm text-dim">No git commands yet. Pull, commit or stage something and it shows up here.</li>}
          {log.map((e, i) => (
            <li key={`${e.time}-${i}`}>
              <button
                aria-expanded={open === i}
                onClick={() => setOpen(open === i ? null : i)}
                className="grid w-full grid-cols-[72px_minmax(0,1fr)_auto] gap-2.5 rounded px-1.5 py-1 text-left hover:bg-raised"
              >
                <span className="text-dim">{clock(e.time)}</span>
                <span className={open === i ? "break-all whitespace-pre-wrap" : "truncate"}>$ {commandLine(e)}</span>
                <span className={`text-right ${e.code === 0 ? "text-dim" : "text-del"}`}>
                  {e.code === null ? "killed" : `exit ${e.code}`} · {seconds(e.ms)}
                </span>
              </button>
              {open === i && e.stderr && <pre className="mx-1.5 mb-1.5 max-h-40 overflow-auto rounded border bg-panel-2 p-2 whitespace-pre-wrap text-muted-foreground">{e.stderr}</pre>}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
