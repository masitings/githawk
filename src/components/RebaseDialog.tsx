import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { api, short, type TodoItem } from "@/lib/api";

const ACTIONS = ["pick", "reword", "edit", "squash", "fixup", "drop"] as const;
type Item = TodoItem & { action: (typeof ACTIONS)[number] };

type Props = {
  root: string;
  /** Rebase commits after this one; null rebases from the root commit. */
  base: string | null;
  onClose: () => void;
  onDone: () => void;
};

export function RebaseDialog({ root, base, onClose, onDone }: Props) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [raw, setRaw] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    api
      .rebaseTodo(root, base)
      .then((t) => setItems(t.map((i) => ({ ...i, action: "pick" }))))
      .catch((e) => {
        toast.error(String(e));
        close.current();
      });
  }, [root, base]);

  const move = (i: number, d: number) => {
    if (!items) return;
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    setItems(next);
  };
  const update = (i: number, patch: Partial<Item>) => setItems(items!.map((it, k) => (k === i ? { ...it, ...patch } : it)));
  const firstKept = items?.find((i) => i.action !== "drop");
  const invalid = firstKept && (firstKept.action === "squash" || firstKept.action === "fixup");

  async function start() {
    setBusy(true);
    try {
      if (raw !== null) await api.rebase(root, base, null, raw);
      else await api.rebase(root, base, items!.map((i) => ({ action: i.action, id: i.id, message: i.message })), null);
      toast.success("Rebase finished");
      onDone();
    } catch (e) {
      const msg = String(e);
      toast.error(/conflict|stopped|could not apply/i.test(msg) ? "Rebase stopped: resolve the conflicts or edits, then Continue." : msg);
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Interactive rebase</DialogTitle>
          <DialogDescription>
            {base ? `Rewriting commits after ${short(base)}, oldest at the top.` : "Rewriting the whole history, oldest at the top."}
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="xs"
            onClick={() =>
              setRaw(raw === null ? (items ?? []).map((i) => `${i.action} ${short(i.id)} ${i.summary}`).join("\n") + "\n" : null)
            }
          >
            {raw === null ? "Edit as text" : "Back to list"}
          </Button>
        </div>
        {raw !== null ? (
          <div className="grid gap-1">
            <Textarea
              aria-label="Rebase todo"
              className="h-72 font-mono text-xs"
              value={raw}
              onChange={(e) => setRaw(e.currentTarget.value)}
            />
            <p className="text-xs text-muted-foreground">
              Same syntax as git's todo file, exec lines included. In text mode, reword keeps the existing message: use the list to change messages.
            </p>
          </div>
        ) : (
          <ol className="grid max-h-96 gap-1 overflow-auto">
            {items === null && <li className="text-sm text-muted-foreground">Loading…</li>}
            {items?.length === 0 && <li className="text-sm text-muted-foreground">No commits to rebase.</li>}
            {items?.map((it, i) => (
              <li key={it.id} className={`grid gap-1 rounded-md border p-2 ${it.action === "drop" ? "opacity-50" : ""}`}>
                <div className="flex items-center gap-2 text-sm">
                  <select
                    aria-label={`Action for ${short(it.id)}`}
                    className="h-7 rounded border bg-transparent px-1 text-xs"
                    value={it.action}
                    onChange={(e) => update(i, { action: e.currentTarget.value as Item["action"] })}
                  >
                    {ACTIONS.map((a) => (
                      <option key={a}>{a}</option>
                    ))}
                  </select>
                  <code className="text-xs text-muted-foreground">{short(it.id)}</code>
                  <span className={`flex-1 truncate ${it.action === "drop" ? "line-through" : ""}`}>{it.summary}</span>
                  <Button size="icon-xs" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowUp />
                  </Button>
                  <Button size="icon-xs" variant="ghost" aria-label="Move down" disabled={i === items.length - 1} onClick={() => move(i, 1)}>
                    <ArrowDown />
                  </Button>
                </div>
                {it.action === "reword" && (
                  <Textarea
                    aria-label={`New message for ${short(it.id)}`}
                    rows={3}
                    value={it.message}
                    onChange={(e) => update(i, { message: e.currentTarget.value })}
                  />
                )}
              </li>
            ))}
          </ol>
        )}
        {invalid && raw === null && <p className="text-sm text-destructive">The first commit can't be squashed or fixed up.</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy || !!invalid || (raw === null && !items?.length)} onClick={start}>
            {busy ? "Rebasing…" : "Start rebase"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
