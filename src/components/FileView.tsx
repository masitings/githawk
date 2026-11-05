import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, date, short, type BlameLine, type FileCommit } from "@/lib/api";
import { DiffView } from "@/components/DiffView";

type Props = {
  root: string;
  path: string;
  tab: "history" | "blame";
  onTab: (t: "history" | "blame") => void;
  onSelectCommit: (id: string) => void;
  onClose: () => void;
};

export function FileView({ root, path, tab, onTab, onSelectCommit, onClose }: Props) {
  const [history, setHistory] = useState<FileCommit[] | null>(null);
  const [blame, setBlame] = useState<BlameLine[] | null>(null);
  const [picked, setPicked] = useState<FileCommit | null>(null);

  useEffect(() => {
    setHistory(null);
    setBlame(null);
    setPicked(null);
    api.history(root, path).then((h) => {
      setHistory(h);
      setPicked(h[0] ?? null);
    }).catch((e) => toast.error(String(e)));
  }, [root, path]);

  useEffect(() => {
    if (tab === "blame" && blame === null) api.blame(root, path).then(setBlame).catch((e) => toast.error(String(e)));
  }, [tab, blame, root, path]);

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label={`${path} ${tab}`}>
      <header className="flex h-10 shrink-0 items-center gap-2 border-b px-3 text-sm">
        <span className="truncate font-medium">{path}</span>
        <div className="ml-auto flex rounded-md border p-0.5 text-xs" role="tablist">
          {(["history", "blame"] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={`rounded px-2 py-0.5 capitalize ${tab === t ? "bg-muted" : ""}`} onClick={() => onTab(t)}>
              {t}
            </button>
          ))}
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
          <X />
        </Button>
      </header>
      {tab === "history" ? (
        <div className="flex min-h-0 flex-1">
          <ul className="w-72 shrink-0 overflow-auto border-r py-1" aria-label="Commits that changed this file">
            {history?.length === 0 && <li className="p-3 text-sm text-muted-foreground">No committed history.</li>}
            {history?.map((c) => (
              <li key={c.id}>
                <button
                  className={`grid w-full gap-0.5 px-3 py-1.5 text-left text-sm ${picked?.id === c.id ? "bg-accent" : "hover:bg-muted"}`}
                  onClick={() => setPicked(c)}
                  onDoubleClick={() => onSelectCommit(c.id)}
                >
                  <span className="truncate">{c.summary}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {short(c.id)} · {c.author} · {date(c.time)}
                    {c.path !== path && ` · was ${c.path}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {picked && <DiffView root={root} target={{ kind: "commit", id: picked.id }} path={picked.path} version={0} onClose={() => setPicked(null)} />}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto font-mono text-xs leading-5">
          {blame === null && <p className="p-3 font-sans text-muted-foreground">Loading…</p>}
          <table className="w-full border-collapse">
            <tbody>
              {blame?.map((l, i) => {
                const first = i === 0 || blame[i - 1].id !== l.id;
                return (
                  <tr key={i} className={first ? "border-t" : ""}>
                    <td className="w-64 max-w-64 truncate px-2 align-top font-sans text-muted-foreground">
                      {first && (
                        <button className="truncate hover:underline" title={`${l.author}, ${date(l.time)}`} onClick={() => onSelectCommit(l.id)}>
                          {short(l.id)} {l.author}
                        </button>
                      )}
                    </td>
                    <td className="w-10 pr-2 text-right text-muted-foreground select-none">{i + 1}</td>
                    <td className="pr-4 whitespace-pre">{l.text}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
