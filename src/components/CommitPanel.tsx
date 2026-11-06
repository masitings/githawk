import { useEffect, useState } from "react";
import { ArrowLeftRight, Copy, LoaderCircle, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, date, short, type CommitInfo, type FileDiff, type Signature, type Target } from "@/lib/api";
import { WithMenu, type MenuItem } from "@/components/Menu";
import { ago } from "@/components/StatusBar";
import { avatarUrl } from "@/lib/avatars";
import { aiRun } from "@/lib/settings";

type Props = {
  root: string;
  id: string;
  open: { target: Target; path: string } | null;
  onOpen: (target: Target, path: string) => void;
  onSelect: (id: string) => void;
  fileMenu: (path: string) => MenuItem[];
  avatars: Record<string, string> | null;
};

const SIGNED: Record<string, [string, string]> = {
  G: ["signed", "text-[var(--lane-3)]"],
  U: ["signed with an untrusted key", "text-[var(--lane-0)]"],
  X: ["signature expired", "text-[var(--lane-0)]"],
  Y: ["signing key expired", "text-[var(--lane-0)]"],
  R: ["signing key revoked", "text-del"],
  B: ["bad signature", "text-del"],
  E: ["signed, can't verify", "text-muted-foreground"],
};

const STATUS: Record<string, [string, string]> = {
  A: ["Added", "var(--lane-3)"],
  M: ["Modified", "var(--lane-1)"],
  D: ["Deleted", "var(--lane-4)"],
  R: ["Renamed", "var(--lane-2)"],
  C: ["Copied", "var(--lane-2)"],
  T: ["Type changed", "var(--lane-0)"],
  U: ["Conflicted", "var(--lane-4)"],
};

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");

export function CommitPanel({ root, id, open, onOpen, onSelect, fileMenu, avatars }: Props) {
  const [info, setInfo] = useState<CommitInfo | null>(null);
  const [files, setFiles] = useState<FileDiff[]>([]);
  const [sig, setSig] = useState<Signature | null>(null);
  const [explain, setExplain] = useState<string | null>(null);
  const [photoFailed, setPhotoFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setInfo(null);
    setFiles([]);
    setSig(null);
    setExplain(null);
    setPhotoFailed(false);
    api.signature(root, id).then((s) => live && setSig(s)).catch(() => {});
    api.commit(root, id).then((c) => live && setInfo(c)).catch((e) => toast.error(String(e)));
    api.diff(root, { kind: "commit", id }).then((f) => live && setFiles(f)).catch((e) => toast.error(String(e)));
    return () => {
      live = false;
    };
  }, [root, id]);

  if (!info) return <p className="p-3 text-sm text-muted-foreground">Loading…</p>;
  const [summary, ...rest] = info.message.trim().split("\n");
  const body = rest.join("\n").trim();
  const photo = avatars && !photoFailed ? avatarUrl(info.email, avatars) : undefined;
  const signed = sig && SIGNED[sig.status];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-7 shrink-0 items-center gap-1 border-b bg-panel pr-1.5 pl-3.5">
        <div
          className="min-w-0 flex-1 truncate text-[12.5px] font-semibold"
          title={`${info.id}\n${info.parents.length > 1 ? `Merge of ${info.parents.length} parents` : info.parents.length ? "Commit" : "Root commit"} · ${date(info.time)}`}
        >
          {info.parents.length > 1 ? "Merge" : "Commit"} <span className="font-mono font-medium text-muted-foreground">{short(info.id)}</span>
        </div>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Copy commit SHA"
          title="Copy SHA"
          onClick={() => navigator.clipboard.writeText(info.id).then(() => toast.success("SHA copied"))}
        >
          <Copy />
        </Button>
        <Button
          size="xs"
          variant="ghost"
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
      </header>

      <div className="flex shrink-0 flex-col gap-3 border-b p-3.5">
        <h2 className="text-[15px] leading-[21px] font-semibold">{summary}</h2>
        {body && (
          <p
            tabIndex={0}
            aria-label="Commit message body"
            className="max-h-40 overflow-auto rounded-md border bg-panel-2 px-2.5 py-2 text-[12.5px] leading-[19px] whitespace-pre-wrap text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            {body}
          </p>
        )}
        {explain && (
          <div className="max-h-64 overflow-auto rounded-md border bg-panel-2 p-2.5 text-[12.5px] leading-[19px] whitespace-pre-wrap" aria-label="AI explanation">
            {explain}
          </div>
        )}
        <div className="flex items-center gap-2.5">
          <span className="inline-flex size-[30px] shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-primary bg-raised text-[11px] font-semibold">
            {photo ? <img src={photo} alt="" className="size-full object-cover" onError={() => setPhotoFailed(true)} /> : initials(info.author)}
          </span>
          <div className="min-w-0 text-[12.5px]">
            <div className="truncate font-semibold" title={info.email}>
              {info.author}
            </div>
            <div className="truncate text-dim">
              authored {ago(info.time)}
              {signed && (
                <>
                  {" · "}
                  <span className={signed[1]} title={sig?.signer || undefined}>
                    {signed[0]}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
        <dl className="grid grid-cols-[70px_minmax(0,1fr)] gap-y-1.5 text-xs">
          <dt className="text-dim">{info.parents.length > 1 ? "Parents" : "Parent"}</dt>
          <dd className="flex flex-wrap gap-2 font-mono">
            {info.parents.length ? (
              info.parents.map((p) => (
                <button key={p} className="text-[var(--lane-1)] underline-offset-2 hover:underline" onClick={() => onSelect(p)}>
                  {short(p)}
                </button>
              ))
            ) : (
              <span className="text-dim">none</span>
            )}
          </dd>
          <dt className="text-dim">Email</dt>
          <dd className="truncate">{info.email}</dd>
          {info.committer !== info.author && (
            <>
              <dt className="text-dim">Committer</dt>
              <dd className="truncate">{info.committer}</dd>
            </>
          )}
        </dl>
      </div>

      <FileList files={files} target={{ kind: "commit", id: info.id }} open={open} onOpen={onOpen} fileMenu={fileMenu} />
    </div>
  );
}

function FileList({
  files,
  target,
  open,
  onOpen,
  fileMenu,
}: {
  files: FileDiff[];
  target: Target;
  open: { target: Target; path: string } | null;
  onOpen: (target: Target, path: string) => void;
  fileMenu: (path: string) => MenuItem[];
}) {
  const added = files.reduce((n, f) => n + f.added, 0);
  const deleted = files.reduce((n, f) => n + f.deleted, 0);
  return (
    <>
      <div className="flex items-center gap-2 px-3.5 pt-2.5 pb-1.5">
        <span className="flex-1 text-[11px] font-semibold tracking-[0.7px] text-muted-foreground uppercase">
          {files.length} file{files.length === 1 ? "" : "s"} changed
        </span>
        <span className="font-mono text-[11.5px] text-add">+{added}</span>
        <span className="font-mono text-[11.5px] text-del">−{deleted}</span>
      </div>
      <ul className="min-h-0 flex-1 overflow-auto px-1 pb-2">
        {files.map((f) => {
          const active = open?.path === f.path && JSON.stringify(open.target) === JSON.stringify(target);
          const [label, tone] = STATUS[f.status] ?? STATUS.M;
          const slash = f.path.lastIndexOf("/") + 1;
          return (
            <li key={f.path}>
              <WithMenu items={() => fileMenu(f.path)}>
                <button
                  className={`flex h-[30px] w-full items-center gap-2 rounded-md px-3 text-left text-[12.5px] ${active ? "bg-raised" : "hover:bg-panel-2"}`}
                  title={f.old_path ? `${f.old_path} → ${f.path}` : f.path}
                  onClick={() => onOpen(target, f.path)}
                >
                  <span
                    aria-label={label}
                    className="inline-flex size-[18px] shrink-0 items-center justify-center rounded font-mono text-[11px] font-semibold"
                    style={{ color: tone, background: `color-mix(in oklab, ${tone} 18%, transparent)` }}
                  >
                    {f.status}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    <span className="text-dim">{f.path.slice(0, slash)}</span>
                    {f.path.slice(slash)}
                  </span>
                  {f.binary ? (
                    <span className="font-mono text-[11px] text-dim">bin</span>
                  ) : (
                    <>
                      {f.added > 0 && <span className="font-mono text-[11px] text-add">+{f.added}</span>}
                      {f.deleted > 0 && <span className="font-mono text-[11px] text-del">−{f.deleted}</span>}
                  </>
                )}
              </button>
            </WithMenu>
          </li>
        );
      })}
    </ul>
    </>
  );
}

export function ComparePanel({
  root,
  from,
  to,
  open,
  onOpen,
  onSwap,
  onClose,
  fileMenu,
}: {
  root: string;
  from: string;
  to: string;
  open: { target: Target; path: string } | null;
  onOpen: (target: Target, path: string) => void;
  onSwap: () => void;
  onClose: () => void;
  fileMenu: (path: string) => MenuItem[];
}) {
  const [files, setFiles] = useState<FileDiff[] | null>(null);
  useEffect(() => {
    let live = true;
    setFiles(null);
    api
      .diff(root, { kind: "range", from, to })
      .then((f) => live && setFiles(f))
      .catch((e) => toast.error(String(e)));
    return () => {
      live = false;
    };
  }, [root, from, to]);
  const label = (rev: string) => (/^[0-9a-f]{40}$/.test(rev) ? short(rev) : rev);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-7 shrink-0 items-center gap-1 border-b bg-panel pr-1.5 pl-3.5">
        <div className="min-w-0 flex-1 truncate text-[12.5px] font-semibold" title={`Changes from ${from} to ${to}`}>
          Compare <span className="font-mono font-medium text-muted-foreground">{label(from)}</span> → <span className="font-mono font-medium text-muted-foreground">{label(to)}</span>
        </div>
        <Button size="icon-xs" variant="ghost" aria-label="Swap sides" title="Swap sides" onClick={onSwap}>
          <ArrowLeftRight />
        </Button>
        <Button size="icon-xs" variant="ghost" aria-label="Close comparison" onClick={onClose}>
          <X />
        </Button>
      </header>
      {files ? (
        <FileList files={files} target={{ kind: "range", from, to }} open={open} onOpen={onOpen} fileMenu={fileMenu} />
      ) : (
        <p className="p-3 text-sm text-muted-foreground">Loading…</p>
      )}
    </div>
  );
}
