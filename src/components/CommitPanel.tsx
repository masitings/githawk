import { useEffect, useState } from "react";
import { Copy, LoaderCircle, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, date, short, type CommitInfo, type FileDiff, type Signature, type Target } from "@/lib/api";
import { WithMenu, type MenuItem } from "@/components/Menu";
import { aiRun } from "@/lib/settings";

type Props = {
  root: string;
  id: string;
  open: { target: Target; path: string } | null;
  onOpen: (target: Target, path: string) => void;
  onSelect: (id: string) => void;
  fileMenu: (path: string) => MenuItem[];
};

const SIGNED: Record<string, [string, string]> = {
  G: ["Signed", "text-[var(--lane-2)]"],
  U: ["Signed, untrusted key", "text-[var(--lane-4)]"],
  X: ["Signed, expired signature", "text-[var(--lane-4)]"],
  Y: ["Signed, expired key", "text-[var(--lane-4)]"],
  R: ["Signed, revoked key", "text-destructive"],
  B: ["Bad signature", "text-destructive"],
  E: ["Signed, can't verify", "text-muted-foreground"],
};

export function CommitPanel({ root, id, open, onOpen, onSelect, fileMenu }: Props) {
  const [info, setInfo] = useState<CommitInfo | null>(null);
  const [files, setFiles] = useState<FileDiff[]>([]);
  const [sig, setSig] = useState<Signature | null>(null);
  const [explain, setExplain] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setInfo(null);
    setFiles([]);
    setSig(null);
    setExplain(null);
    api.signature(root, id).then((s) => live && setSig(s)).catch(() => {});
    api.commit(root, id).then((c) => live && setInfo(c)).catch((e) => toast.error(String(e)));
    api.diff(root, { kind: "commit", id }).then((f) => live && setFiles(f)).catch((e) => toast.error(String(e)));
    return () => {
      live = false;
    };
  }, [root, id]);

  if (!info) return <p className="p-3 text-sm text-muted-foreground">Loading…</p>;
  const [summary, ...body] = info.message.trim().split("\n");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid gap-2 border-b p-3 text-sm">
        <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
          commit {short(info.id)}
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Copy commit SHA"
            onClick={() => navigator.clipboard.writeText(info.id).then(() => toast.success("SHA copied"))}
          >
            <Copy />
          </Button>
          <Button
            size="xs"
            variant="ghost"
            className="ml-auto font-sans"
            disabled={explain === ""}
            onClick={() => {
              setExplain("");
              aiRun(root, { kind: "explain", id: info.id })
                .then(setExplain)
                .catch((e) => {
                  setExplain(null);
                  toast.error(String(e));
                });
            }}
          >
            {explain === "" ? <LoaderCircle className="animate-spin" /> : <Sparkles />} Explain
          </Button>
        </div>
        <h2 className="font-medium">{summary}</h2>
        {body.join("\n").trim() && <p className="whitespace-pre-wrap text-muted-foreground">{body.join("\n").trim()}</p>}
        {explain && (
          <div className="max-h-64 overflow-auto rounded-md border bg-muted/40 p-2 whitespace-pre-wrap" aria-label="AI explanation">
            {explain}
          </div>
        )}
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Author</dt>
          <dd className="truncate" title={info.email}>
            {info.author} &lt;{info.email}&gt;
          </dd>
          <dt className="text-muted-foreground">Date</dt>
          <dd>{date(info.time)}</dd>
          {info.committer !== info.author && (
            <>
              <dt className="text-muted-foreground">Committer</dt>
              <dd>{info.committer}</dd>
            </>
          )}
          {sig && SIGNED[sig.status] && (
            <>
              <dt className="text-muted-foreground">Signature</dt>
              <dd className={SIGNED[sig.status][1]}>
                {SIGNED[sig.status][0]}
                {sig.signer && ` by ${sig.signer}`}
              </dd>
            </>
          )}
          <dt className="text-muted-foreground">Parents</dt>
          <dd className="flex gap-2 font-mono">
            {info.parents.length ? (
              info.parents.map((p) => (
                <button key={p} className="underline-offset-2 hover:underline" onClick={() => onSelect(p)}>
                  {short(p)}
                </button>
              ))
            ) : (
              <span className="text-muted-foreground">none</span>
            )}
          </dd>
        </dl>
      </div>
      <header className="px-3 py-2 text-sm font-medium">
        {files.length} changed file{files.length === 1 ? "" : "s"}
      </header>
      <ul className="min-h-0 flex-1 overflow-auto px-1 pb-2">
        {files.map((f) => {
          const active = open?.path === f.path && open.target.kind === "commit";
          return (
            <li key={f.path}>
              <WithMenu items={() => fileMenu(f.path)}>
              <button
                className={`flex w-full items-center gap-2 rounded px-2 py-0.5 text-left text-sm ${active ? "bg-accent" : "hover:bg-muted"}`}
                title={f.old_path ? `${f.old_path} → ${f.path}` : f.path}
                onClick={() => onOpen({ kind: "commit", id: info.id }, f.path)}
              >
                <span className="w-3 shrink-0 font-mono text-xs font-bold text-muted-foreground">{f.status}</span>
                <span className="truncate">{f.path}</span>
              </button>
              </WithMenu>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
