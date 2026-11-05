import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { prettyCombo, useSettings } from "@/lib/settings";
import { fuzzy } from "@/lib/fuzzy";

export type PaletteItem = { id: string; label: string; group: string; hint?: string; shortcut?: string; run: () => void };

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial: string;
  items: () => PaletteItem[];
};

const LIMIT = 80;

export function Palette({ open, onOpenChange, initial, items }: Props) {
  const [q, setQ] = useState(initial);
  const [cursor, setCursor] = useState(0);
  const [all, setAll] = useState<PaletteItem[]>([]);
  const list = useRef<HTMLUListElement>(null);
  const s = useSettings();

  useEffect(() => {
    if (open) {
      setQ(initial);
      setCursor(0);
      setAll(items());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial]);

  const shown = useMemo(() => {
    const scored: [number, PaletteItem][] = [];
    for (const it of all) {
      const score = fuzzy(q, `${it.group} ${it.label}`);
      if (score !== null) scored.push([score, it]);
    }
    return scored.sort((a, b) => b[0] - a[0]).slice(0, LIMIT).map(([, it]) => it);
  }, [q, all]);

  useEffect(() => {
    list.current?.children[cursor]?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  function pick(it: PaletteItem | undefined) {
    if (!it) return;
    onOpenChange(false);
    it.run();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="top-24 translate-y-0 gap-0 p-0 sm:max-w-xl">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <input
          autoFocus
          role="combobox"
          aria-expanded
          aria-controls="palette-list"
          aria-activedescendant={shown[cursor] ? `palette-${cursor}` : undefined}
          placeholder="Type a command, branch, file or commit…"
          className="h-11 border-b bg-transparent px-4 text-sm outline-none"
          value={q}
          onChange={(e) => {
            setQ(e.currentTarget.value);
            setCursor(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setCursor((c) => Math.min(shown.length - 1, c + 1));
            else if (e.key === "ArrowUp") setCursor((c) => Math.max(0, c - 1));
            else if (e.key === "Enter") pick(shown[cursor]);
            else return;
            e.preventDefault();
          }}
        />
        <ul id="palette-list" ref={list} role="listbox" className="max-h-96 overflow-auto p-1">
          {shown.map((it, i) => (
            <li
              key={it.id}
              id={`palette-${i}`}
              role="option"
              aria-selected={i === cursor}
              className={`flex cursor-default items-center gap-2 rounded px-3 py-1.5 text-sm ${i === cursor ? "bg-accent" : ""}`}
              onMouseMove={() => setCursor(i)}
              onClick={() => pick(it)}
            >
              <span className="w-16 shrink-0 text-xs text-muted-foreground">{it.group}</span>
              <span className="min-w-0 flex-1 truncate">{it.label}</span>
              {it.hint && <span className="truncate text-xs text-muted-foreground">{it.hint}</span>}
              {it.shortcut && s.shortcuts[it.shortcut] && (
                <kbd className="rounded border px-1.5 font-mono text-xs text-muted-foreground">{prettyCombo(s.shortcuts[it.shortcut])}</kbd>
              )}
            </li>
          ))}
          {!shown.length && <li className="px-3 py-6 text-center text-sm text-muted-foreground">No matches</li>}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
