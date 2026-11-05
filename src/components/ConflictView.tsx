import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { compose, parseConflicts, type Choice, type Seg } from "@/lib/conflicts";

export function ConflictView({ root, path, onClose }: { root: string; path: string; onClose: () => void }) {
  const [segs, setSegs] = useState<Seg[] | null>(null);
  const [choices, setChoices] = useState<Choice[]>([]);
  const [result, setResult] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .conflict(root, path)
      .then((c) => {
        const s = parseConflicts(c.merged);
        setSegs(s);
        setChoices(s.filter((x) => !("text" in x)).map(() => null));
        setResult(c.merged);
      })
      .catch((e) => toast.error(String(e)));
  }, [root, path]);

  const blocks = useMemo(() => (segs ?? []).filter((s): s is Exclude<Seg, { text: string }> => !("text" in s)), [segs]);

  function choose(i: number, c: Choice) {
    const next = choices.map((x, k) => (k === i ? c : x));
    setChoices(next);
    setResult(compose(segs!, next));
  }
  function chooseAll(c: Choice) {
    const next = choices.map(() => c);
    setChoices(next);
    setResult(compose(segs!, next));
  }

  async function save() {
    setSaving(true);
    try {
      await api.resolve(root, path, result);
      toast.success(`${path} resolved and staged`);
      onClose();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSaving(false);
    }
  }

  const unresolved = /^(<<<<<<<|>>>>>>>)/m.test(result);

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label={`Resolve conflicts in ${path}`}>
      <header className="flex h-10 shrink-0 items-center gap-2 border-b px-3 text-sm">
        <span className="truncate font-medium">Resolve {path}</span>
        <span className="text-xs text-muted-foreground">
          {blocks.length} conflict{blocks.length === 1 ? "" : "s"}
        </span>
        <span className="ml-auto flex gap-1">
          <Button size="xs" variant="outline" onClick={() => chooseAll("ours")} disabled={!blocks.length}>
            Take all ours
          </Button>
          <Button size="xs" variant="outline" onClick={() => chooseAll("theirs")} disabled={!blocks.length}>
            Take all theirs
          </Button>
        </span>
        <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
          <X />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        {blocks.map((b, i) => (
          <div key={i} className="border-b p-3">
            <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
              Conflict {i + 1}
              <span className="ml-auto flex gap-1">
                {(["ours", "theirs", "both"] as const).map((c) => (
                  <Button key={c} size="xs" variant={choices[i] === c ? "default" : "outline"} aria-pressed={choices[i] === c} onClick={() => choose(i, c)}>
                    {c === "both" ? "Both" : c === "ours" ? "Ours" : "Theirs"}
                  </Button>
                ))}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 font-mono text-xs">
              {(
                [
                  ["Ours", b.oursLabel, b.ours, "var(--diff-add)"],
                  ["Theirs", b.theirsLabel, b.theirs, "var(--diff-del)"],
                ] as const
              ).map(([title, label, text, bg]) => (
                <figure key={title} className="min-w-0 rounded border">
                  <figcaption className="truncate border-b px-2 py-1 font-sans text-muted-foreground">
                    {title} <span className="opacity-70">{label}</span>
                  </figcaption>
                  <pre className="overflow-auto p-2 whitespace-pre" style={{ background: bg }}>
                    {text || " "}
                  </pre>
                </figure>
              ))}
            </div>
          </div>
        ))}
        {segs && !blocks.length && <p className="p-3 text-sm text-muted-foreground">No conflict markers left in this file.</p>}
      </div>
      <div className="grid shrink-0 gap-2 border-t p-3">
        <label className="text-xs text-muted-foreground" htmlFor="merge-result">
          Result (editable; picking a side again rebuilds it)
        </label>
        <Textarea id="merge-result" className="h-56 font-mono text-xs" value={result} onChange={(e) => setResult(e.currentTarget.value)} />
        <div className="flex items-center gap-2">
          {unresolved && <span className="text-xs text-destructive">Conflict markers remain.</span>}
          <Button className="ml-auto" disabled={saving || unresolved} onClick={save}>
            Save and mark resolved
          </Button>
        </div>
      </div>
    </section>
  );
}
