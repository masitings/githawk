import { useEffect, useReducer, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Check, CircleCheck, CircleDot, CircleX, Cloud, Laptop, Tag } from "lucide-react";
import { api, date, lane, type CheckState, type Opened, type RefLabel, type Row } from "@/lib/api";
import { WithMenu, type MenuItem } from "@/components/Menu";
import { avatarImage, avatarUrl } from "@/lib/avatars";

const ROW = 28;
const LANE = 18;
const PAGE = 500;
const REFS_W = 210;
const GRAPH_MIN = 100;
// ponytail: fixed cap until the graph column is resizable
const MAX_LANES = 24;
const DRAG_TYPE = "application/x-githawk-ref";

const AVATAR_FILLS = ["#8A6A48", "#8C4A66", "#4A7A8C", "#4A8A68", "#6A5E92"];
const avatarFill = (name: string) => {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) | 0;
  return AVATAR_FILLS[Math.abs(h) % AVATAR_FILLS.length];
};

type Props = {
  root: string;
  opened: Opened;
  version: number;
  wip: number;
  selected: string | null;
  marked: Set<string>;
  onSelect: (id: string, index: number, mods: { range: boolean; toggle: boolean }) => void;
  jump: { index: number; n: number } | null;
  rowMenu: (row: Row) => MenuItem[];
  refMenu: (ref: RefLabel) => MenuItem[];
  wipMenu: () => MenuItem[];
  onDropRef: (source: RefLabel, target: RefLabel, at: { x: number; y: number }) => void;
  onOpenRef: (ref: RefLabel) => void;
  /** CI status by branch name, for branches with an open pull request. */
  checks: Record<string, CheckState>;
  /** Photo URLs by lowercased commit email; null when the remote isn't on GitHub. */
  avatars: Record<string, string> | null;
};

const CHECK_ICON = { success: CircleCheck, failure: CircleX, pending: CircleDot };
const CHECK_TEXT = { success: "Checks passed", failure: "Checks failed", pending: "Checks running" };
export function CheckBadge({ state }: { state: CheckState | undefined }) {
  if (!state) return null;
  const I = CHECK_ICON[state];
  return (
    <I
      role="img"
      aria-label={CHECK_TEXT[state]}
      className={`size-3.5 shrink-0 ${state === "success" ? "text-[var(--lane-3)]" : state === "failure" ? "text-del" : "text-[var(--lane-0)]"}`}
    >
      <title>{CHECK_TEXT[state]}</title>
    </I>
  );
}

export function Graph(p: Props) {
  const pages = useRef(new Map<number, Row[] | null>());
  const [lanes, setLanes] = useState(1);
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const versionRef = useRef(p.version);
  versionRef.current = p.version;
  const off = p.wip ? 1 : 0;
  const total = p.opened.total + off;

  useEffect(() => {
    pages.current.clear();
    setLanes(1);
    rerender();
  }, [p.version, p.root]);

  const v = useVirtualizer({
    count: total,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW,
    overscan: 30,
  });
  const items = v.getVirtualItems();
  const first = items[0]?.index ?? 0;
  const last = items[items.length - 1]?.index ?? 0;
  const graphW = Math.max(GRAPH_MIN, Math.min(lanes, MAX_LANES) * LANE + 10);
  const row = (data: number) => (data < 0 ? undefined : pages.current.get(Math.floor(data / PAGE))?.[data % PAGE]);

  useEffect(() => {
    const o = new MutationObserver(rerender);
    o.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => o.disconnect();
  }, []);

  useEffect(() => {
    if (p.jump) v.scrollToIndex(p.jump.index + off, { align: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.jump]);

  useEffect(() => {
    if (!p.opened.total) return;
    const version = p.version;
    const need = new Set([Math.floor(Math.max(0, first - off) / PAGE), Math.floor(Math.max(0, last - off) / PAGE)]);
    if (p.opened.head !== null) need.add(Math.floor(p.opened.head / PAGE));
    for (const pg of need) {
      if (pages.current.has(pg)) continue;
      pages.current.set(pg, null);
      api.page(p.root, pg * PAGE, PAGE).then((rows) => {
        if (version !== versionRef.current) return;
        pages.current.set(pg, rows);
        let max = 0;
        for (const r of rows) {
          max = Math.max(max, r.col);
          for (const e of r.edges) max = Math.max(max, e.from, e.to);
        }
        setLanes((l) => Math.max(l, max + 1));
        rerender();
      });
    }
  });

  const draw = () => {
    const canvas = canvasRef.current;
    const el = scrollRef.current;
    if (!canvas || !el) return;
    const dpr = devicePixelRatio;
    // Canvas scrolls with the rows and covers a screen above and below, so async/momentum scrolling never outruns a redraw.
    const view = el.clientHeight;
    const top = Math.max(0, Math.floor((el.scrollTop - view) / ROW) * ROW);
    const h = Math.max(1, Math.min(view * 3, total * ROW - top));
    canvas.style.top = `${top}px`;
    if (canvas.width !== graphW * dpr || canvas.height !== h * dpr) {
      canvas.width = graphW * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${graphW}px`;
      canvas.style.height = `${h}px`;
    }
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, graphW, h);
    if (!total) return;

    const css = getComputedStyle(document.documentElement);
    const colors = Array.from({ length: 8 }, (_, i) => css.getPropertyValue(`--lane-${i}`));
    const bg = css.getPropertyValue("--background");
    const color = (i: number) => colors[i % 8];
    const x = (col: number) => col * LANE + 14;
    const y = (visual: number) => visual * ROW + ROW / 2 - top;
    const start = Math.max(0, Math.floor(top / ROW) - 1);
    const end = Math.min(total - 1, Math.ceil((top + h) / ROW));
    const R = 8;

    if (off && start === 0) {
      const head = p.opened.head === null ? undefined : row(p.opened.head);
      const cx = x(head?.col ?? 0);
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = color(head?.color ?? 0);
      ctx.lineWidth = 2;
      if (head && p.opened.head !== null) {
        ctx.beginPath();
        ctx.moveTo(cx, y(0));
        ctx.lineTo(cx, y(p.opened.head + off));
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.setLineDash([3, 2]);
      ctx.arc(cx, y(0), 8, 0, Math.PI * 2);
      ctx.fillStyle = bg;
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.lineWidth = 2;
    for (let i = Math.max(start, off); i <= end; i++) {
      const r = row(i - off);
      if (!r) continue;
      const next = row(i - off + 1);
      for (const e of r.edges) {
        const [x1, y1, x2, y2] = [x(e.from), y(i), x(e.to), y(i + 1)];
        const s = Math.sign(x2 - x1);
        ctx.strokeStyle = color(e.color);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        if (s === 0) {
          ctx.lineTo(x2, y2);
        } else if (next?.col === e.to) {
          ctx.lineTo(x1, y2 - R);
          ctx.quadraticCurveTo(x1, y2, x1 + s * R, y2);
          ctx.lineTo(x2, y2);
        } else {
          ctx.lineTo(x2 - s * R, y1);
          ctx.quadraticCurveTo(x2, y1, x2, y1 + R);
          ctx.lineTo(x2, y2);
        }
        ctx.stroke();
      }
    }

    for (let i = Math.max(start, off); i <= end; i++) {
      const r = row(i - off);
      if (!r) continue;
      const [cx, cy] = [x(r.col), y(i)];
      const merge = r.parents.length > 1;
      if (r.refs.length) {
        ctx.strokeStyle = color(r.color);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, cy);
        ctx.lineTo(cx - (merge ? 4.5 : 10), cy);
        ctx.stroke();
      }
      ctx.beginPath();
      if (merge) {
        ctx.fillStyle = color(r.color);
        ctx.arc(cx, cy, 4.5, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      ctx.arc(cx, cy, 9.5, 0, Math.PI * 2);
      ctx.fillStyle = avatarFill(r.author);
      ctx.fill();
      ctx.strokeStyle = color(r.color);
      ctx.lineWidth = 2;
      ctx.stroke();
      const url = p.avatars && avatarUrl(r.email, p.avatars);
      const photo = url && avatarImage(url, rerender);
      if (photo) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, 8.5, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(photo, cx - 8.5, cy - 8.5, 17, 17);
        ctx.restore();
        continue;
      }
      ctx.fillStyle = "rgba(255, 255, 255, 0.78)";
      ctx.beginPath();
      ctx.arc(cx, cy - 1.6, 2.9, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx - 5.4, cy + 6.6);
      ctx.quadraticCurveTo(cx, cy + 0.6, cx + 5.4, cy + 6.6);
      ctx.arc(cx, cy, 8.5, Math.asin(6.6 / 8.5), Math.PI - Math.asin(6.6 / 8.5));
      ctx.fill();
    }
  };
  const drawRef = useRef(draw);
  drawRef.current = draw;
  useEffect(draw);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => drawRef.current());
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  function onKey(e: React.KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const cur = p.selected === "wip" ? 0 : -1;
    let idx = cur;
    if (p.selected && p.selected !== "wip") {
      for (const [pg, rows] of pages.current) {
        const k = rows?.findIndex((r) => r.id === p.selected) ?? -1;
        if (k >= 0) idx = pg * PAGE + k + off;
      }
    }
    const nextIdx = Math.min(total - 1, Math.max(0, idx + (e.key === "ArrowDown" ? 1 : -1)));
    if (off && nextIdx === 0) return p.onSelect("wip", -1, { range: false, toggle: false });
    const r = row(nextIdx - off);
    if (r) {
      p.onSelect(r.id, nextIdx - off, { range: e.shiftKey, toggle: false });
      v.scrollToIndex(nextIdx);
    }
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div aria-hidden className="flex h-7 shrink-0 items-center overflow-hidden border-b bg-panel text-[11px] font-semibold tracking-[0.6px] whitespace-nowrap text-dim uppercase">
        <span className="shrink-0 pl-3" style={{ width: REFS_W }}>Branch / tag</span>
        <span className="shrink-0" style={{ width: graphW }}>Graph</span>
        <span className="min-w-40 flex-1 truncate pr-3">Commit message</span>
        <span className="w-30 min-w-0 truncate pr-2">Author</span>
        <span className="w-32 min-w-0 truncate pr-2">Date</span>
      </div>
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          tabIndex={0}
          onKeyDown={onKey}
          role="listbox"
          aria-label="Commit graph"
          aria-multiselectable
          className="h-full overflow-auto outline-none"
        >
          <div className="relative" style={{ height: v.getTotalSize() }}>
            <canvas ref={canvasRef} aria-hidden className="pointer-events-none absolute z-10" style={{ left: REFS_W }} />
            {items.map((it) => {
              const style = { top: it.start, height: ROW };
              if (off && it.index === 0) {
                const sel = p.selected === "wip";
                return (
                  <WithMenu
                    key="wip"
                    items={p.wipMenu}
                    role="option"
                    aria-selected={sel}
                    onClick={() => p.onSelect("wip", -1, { range: false, toggle: false })}
                    className={`absolute inset-x-1 flex items-center overflow-hidden rounded-md border-y-2 border-transparent bg-clip-padding text-sm ${sel ? "bg-raised" : "hover:bg-panel-2"}`}
                    style={style}
                  >
                    <div style={{ width: REFS_W - 4 + graphW }} className="shrink-0" />
                    <span className="min-w-40 flex-1 truncate pr-3 italic text-muted-foreground">
                      {"// WIP"} · {p.wip} changed file{p.wip === 1 ? "" : "s"}
                    </span>
                  </WithMenu>
                );
              }
              const r = row(it.index - off);
              if (!r) return <div key={it.key} className="absolute inset-x-0" style={style} />;
              const sel = p.selected === r.id || p.marked.has(r.id);
              const index = it.index - off;
              return (
                <WithMenu
                  key={it.key}
                  items={() => p.rowMenu(r)}
                  role="option"
                  aria-selected={sel}
                  onClick={(e: React.MouseEvent) => p.onSelect(r.id, index, { range: e.shiftKey, toggle: e.metaKey || e.ctrlKey })}
                  className={`absolute inset-x-1 flex items-center overflow-hidden rounded-md border-y-2 border-transparent bg-clip-padding text-sm ${sel ? "" : "hover:bg-panel-2"} ${r.head ? "font-medium" : ""}`}
                  style={{
                    ...style,
                    background: sel ? `color-mix(in oklab, ${lane(r.color)} 26%, transparent)` : undefined,
                  }}
                >
                  <div className="relative flex shrink-0 items-center gap-1 overflow-hidden pr-3 pl-1.5" style={{ width: REFS_W - 4 }}>
                    {r.refs.length > 0 && (
                      <span aria-hidden className="absolute top-1/2 right-0 left-3 h-0.5 -translate-y-1/2" style={{ background: lane(r.color) }} />
                    )}
                    <Pills row={r} refMenu={p.refMenu} onDropRef={p.onDropRef} onOpenRef={p.onOpenRef} checks={p.checks} />
                  </div>
                  <div className="shrink-0" style={{ width: graphW }} />
                  <span className="min-w-40 flex-1 truncate pr-3">{r.summary}</span>
                  <span className="w-30 min-w-0 truncate pr-2 text-xs text-muted-foreground">{r.author}</span>
                  <time className="w-32 min-w-0 truncate pr-2 text-xs text-dim">{date(r.time)}</time>
                </WithMenu>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function Pills({
  row,
  refMenu,
  onDropRef,
  onOpenRef,
  checks,
}: {
  row: Row;
  refMenu: (ref: RefLabel) => MenuItem[];
  onDropRef: (source: RefLabel, target: RefLabel, at: { x: number; y: number }) => void;
  onOpenRef: (ref: RefLabel) => void;
  checks: Record<string, CheckState>;
}) {
  if (!row.refs.length) return null;
  const main = row.refs[0];
  const tracked = row.refs.some((r) => r.kind === "remote" && main.kind === "local" && r.name.endsWith(`/${main.name}`));
  const rest = row.refs.filter(
    (r) => r !== main && !(tracked && r.kind === "remote" && r.name.endsWith(`/${main.name}`)),
  );
  const Icon = main.kind === "tag" ? Tag : main.kind === "remote" ? Cloud : main.head ? Check : Laptop;
  return (
    <>
      <span className="relative min-w-0" onContextMenu={(e) => e.stopPropagation()}>
        <WithMenu
          items={() => refMenu(main)}
          draggable={main.kind !== "tag"}
          onDoubleClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            onOpenRef(main);
          }}
          onDragStart={(e: React.DragEvent) => e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(main))}
          onDragOver={(e: React.DragEvent) => e.dataTransfer.types.includes(DRAG_TYPE) && e.preventDefault()}
          onDrop={(e: React.DragEvent) => {
            e.preventDefault();
            const src = JSON.parse(e.dataTransfer.getData(DRAG_TYPE)) as RefLabel;
            if (src.name !== main.name) onDropRef(src, main, { x: e.clientX, y: e.clientY });
          }}
          title={row.refs.map((r) => r.name).join("\n")}
          className="flex h-5 max-w-full cursor-grab items-center gap-1 rounded-full border px-2 text-xs font-semibold"
          style={{ background: `color-mix(in oklab, ${lane(row.color)} 18%, var(--background))`, borderColor: lane(row.color) }}
        >
          <Icon className="size-3 shrink-0" aria-hidden />
          {tracked && <Cloud className="size-3 shrink-0" aria-label="tracked on remote" />}
          <span className="truncate">{main.name}</span>
          <CheckBadge state={checks[main.name]} />
        </WithMenu>
      </span>
      {rest.length > 0 && (
        <span className="relative shrink-0 rounded-full border bg-background px-1.5 text-xs text-muted-foreground" title={rest.map((r) => r.name).join("\n")}>
          +{rest.length}
        </span>
      )}
    </>
  );
}

