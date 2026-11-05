import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ChevronDown, GitMerge, MessageSquarePlus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { confirm } from "@/lib/prompt";
import { useSettings } from "@/lib/settings";
import { api, type LineComment, type Line, type MergeMethod, type Pr, type Review } from "@/lib/api";
import { parseUnified, type PatchFile } from "@/lib/unified";

type Props = { account: string; url: string; pr: Pr; onCheckout: () => void; onMerged: () => void; onClose: () => void };

const tone = { "+": "bg-[var(--diff-add)]", "-": "bg-[var(--diff-del)]", " ": "" };
const lineOf = (l: Line) => (l.origin === "-" ? l.old : l.new) ?? 0;
const keyOf = (path: string, l: Line) => `${path}:${l.origin}:${lineOf(l)}`;

const MERGE_LABEL: Record<MergeMethod, string> = { merge: "Create a merge commit", squash: "Squash and merge", rebase: "Rebase and merge" };

export function PrView({ account, url, pr, onCheckout, onMerged, onClose }: Props) {
  const { prMerge } = useSettings();
  const [files, setFiles] = useState<PatchFile[] | null>(null);
  const [error, setError] = useState("");
  const [comments, setComments] = useState<Record<string, LineComment>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setFiles(null);
    setError("");
    setComments({});
    api
      .prDiff(account, url, pr.number)
      .then((d) => setFiles(parseUnified(d)))
      .catch((e) => setError(String(e)));
  }, [account, url, pr.number]);

  async function merge(method: MergeMethod) {
    if (!(await confirm(`${MERGE_LABEL[method]} #${pr.number}?`, `${pr.head} goes into ${pr.base} on the server.`, "Merge"))) return;
    setBusy(true);
    try {
      await api.mergePr(account, url, pr.number, method);
      toast.success(`Merged #${pr.number}`);
      onMerged();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: Review["event"]) {
    setBusy(true);
    try {
      await api.review(account, url, pr.number, { event, body, comments: Object.values(comments) });
      toast.success(event === "approve" ? "Approved" : event === "request-changes" ? "Requested changes" : "Review posted");
      setComments({});
      setBody("");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  }

  const pending = Object.keys(comments).length;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b px-3 py-2 text-sm">
        <span className="text-muted-foreground">#{pr.number}</span>
        <span className="min-w-0 flex-1 truncate font-medium">{pr.title}</span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {pr.head} → {pr.base} · {pr.author}
        </span>
        <Button size="xs" variant="ghost" onClick={onCheckout}>
          Checkout
        </Button>
        <Button size="xs" variant="ghost" onClick={() => openUrl(pr.url)}>
          Open in browser
        </Button>
        <span className="flex">
          <Button size="xs" className="rounded-r-none" disabled={busy || pr.draft} title={pr.draft ? "Draft pull requests can't be merged" : undefined} onClick={() => merge(prMerge)}>
            <GitMerge /> {MERGE_LABEL[prMerge]}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button size="icon-xs" className="rounded-l-none border-l border-primary-foreground/20" aria-label="Merge options" disabled={busy || pr.draft} />}>
              <ChevronDown />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {(Object.keys(MERGE_LABEL) as MergeMethod[]).map((m) => (
                <DropdownMenuItem key={m} onClick={() => merge(m)}>
                  {MERGE_LABEL[m]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
        <Button size="icon-xs" variant="ghost" aria-label="Close pull request" onClick={onClose}>
          <X />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto font-mono text-xs">
        {error && <p className="p-3 font-sans text-sm text-destructive">{error}</p>}
        {!files && !error && <p className="p-3 font-sans text-sm text-muted-foreground">Loading changes…</p>}
        {files?.map((f) => (
          <section key={f.path} className="border-b">
            <h3 className="sticky top-0 z-10 border-b bg-background px-3 py-1.5 font-sans text-sm font-medium">{f.path}</h3>
            {f.hunks.map((h, hi) => (
              <div key={hi}>
                <div className="bg-muted/50 px-3 py-0.5 text-muted-foreground">{h.header}</div>
                {h.lines.map((l, li) => {
                  const k = keyOf(f.path, l);
                  const c = comments[k];
                  return (
                    <div key={li}>
                      <div className={`group flex ${tone[l.origin]}`}>
                        <button
                          className="w-6 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                          aria-label={`Comment on line ${lineOf(l)} of ${f.path}`}
                          onClick={() => {
                            setEditing(k);
                            setDraft(c?.body ?? "");
                          }}
                        >
                          <MessageSquarePlus className="mx-auto size-3.5" />
                        </button>
                        <span className="w-10 shrink-0 pr-1 text-right text-muted-foreground select-none">{l.old ?? ""}</span>
                        <span className="w-10 shrink-0 pr-2 text-right text-muted-foreground select-none">{l.new ?? ""}</span>
                        <span className="w-3 shrink-0 select-none">{l.origin}</span>
                        <span className="whitespace-pre">{l.text}</span>
                      </div>
                      {editing === k ? (
                        <div className="grid gap-1 border-y bg-background p-2 font-sans">
                          <Textarea autoFocus rows={3} aria-label="Line comment" value={draft} onChange={(e) => setDraft(e.currentTarget.value)} />
                          <div className="flex justify-end gap-1">
                            {c && (
                              <Button
                                size="xs"
                                variant="ghost"
                                onClick={() => {
                                  const { [k]: _, ...rest } = comments;
                                  setComments(rest);
                                  setEditing(null);
                                }}
                              >
                                Delete
                              </Button>
                            )}
                            <Button size="xs" variant="outline" onClick={() => setEditing(null)}>
                              Cancel
                            </Button>
                            <Button
                              size="xs"
                              disabled={!draft.trim()}
                              onClick={() => {
                                setComments({ ...comments, [k]: { path: f.path, line: lineOf(l), origin: l.origin, body: draft.trim() } });
                                setEditing(null);
                              }}
                            >
                              Add to review
                            </Button>
                          </div>
                        </div>
                      ) : (
                        c && (
                          <button
                            className="block w-full border-y bg-accent/50 px-3 py-1.5 text-left font-sans text-sm whitespace-pre-wrap"
                            onClick={() => {
                              setEditing(k);
                              setDraft(c.body);
                            }}
                          >
                            {c.body}
                          </button>
                        )
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </section>
        ))}
      </div>
      <footer className="grid gap-2 border-t p-3">
        <Textarea rows={2} aria-label="Review summary" placeholder="Review summary (optional)" value={body} onChange={(e) => setBody(e.currentTarget.value)} />
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {pending} pending comment{pending === 1 ? "" : "s"}
          </span>
          <span className="ml-auto flex gap-2">
            <Button size="sm" variant="outline" disabled={busy || (!pending && !body.trim())} onClick={() => submit("comment")}>
              Comment
            </Button>
            <Button size="sm" variant="outline" disabled={busy || (!pending && !body.trim())} onClick={() => submit("request-changes")}>
              Request changes
            </Button>
            <Button size="sm" disabled={busy} onClick={() => submit("approve")}>
              Approve
            </Button>
          </span>
        </div>
      </footer>
    </div>
  );
}
