import { useEffect, useRef, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export type DropItem = { icon: LucideIcon; label: ReactNode; run: () => void };

type Props = {
  at: { x: number; y: number };
  title: ReactNode;
  items: DropItem[];
  undoKey: string;
  onClose: () => void;
};

const W = 340;

export function DropMenu({ at, title, items, undoKey, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.querySelector("button")?.focus();
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose();
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const buttons = [...(ref.current?.querySelectorAll("button") ?? [])];
      const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[(i + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    };
    window.addEventListener("mousedown", down);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key);
    };
  }, [onClose]);

  const left = Math.max(8, Math.min(at.x + 8, innerWidth - W - 8));
  const top = Math.max(8, Math.min(at.y + 8, innerHeight - (items.length * 34 + 90)));

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Drop actions"
      className="fixed z-50 rounded-[10px] border bg-panel p-1.5 text-sm shadow-overlay"
      style={{ left, top, width: W }}
    >
      <div className="px-2.5 pt-1.5 pb-2 text-[11px] text-dim">{title}</div>
      {items.map((it, i) => (
        <button
          key={i}
          role="menuitem"
          onClick={() => {
            onClose();
            it.run();
          }}
          className="flex h-[34px] w-full items-center gap-2.5 rounded-md px-3 text-left outline-none hover:bg-raised focus-visible:bg-raised"
        >
          <it.icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 truncate">{it.label}</span>
        </button>
      ))}
      <div className="mx-0 mt-1.5 border-t px-2.5 pt-1.5 pb-0.5 text-[11px] text-dim">
        Every operation can be undone with <kbd className="rounded border bg-panel-2 px-1.5 font-mono">{undoKey}</kbd>
      </div>
    </div>
  );
}
