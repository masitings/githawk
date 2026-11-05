import { useState, type ReactNode } from "react";
import { Archive, Check, ChevronRight, Cloud, Eye, EyeOff, Folder, FolderTree, GitPullRequest, Laptop, Package, Plus, Search, Tag, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Extras, Pr, RefLabel, Refs, Stash, Submodule, Worktree } from "@/lib/api";
import { WithMenu, type MenuItem } from "@/components/Menu";

type Props = {
  refs: Refs | null;
  extras: Extras | null;
  prs: { list: Pr[] | null; error: string } | null;
  hidden: Set<string>;
  solo: string | null;
  onToggleHidden: (name: string) => void;
  onClearSolo: () => void;
  onJump: (tip: string) => void;
  onCheckout: (name: string) => void;
  onCreatePr: () => void;
  refMenu: (ref: RefLabel) => MenuItem[];
  stashMenu: (s: Stash) => MenuItem[];
  worktreeMenu: (w: Worktree) => MenuItem[];
  submoduleMenu: (s: Submodule) => MenuItem[];
  prMenu: (p: Pr) => MenuItem[];
};

export function Sidebar(p: Props) {
  const [filter, setFilter] = useState("");
  const q = filter.toLowerCase();
  const match = (name: string) => name.toLowerCase().includes(q);
  const { refs } = p;
  if (!refs) return <aside className="w-60 shrink-0 border-r" />;

  const byRemote = new Map<string, typeof refs.remote>();
  for (const r of refs.remote.filter((r) => match(r.name))) {
    const remote = refs.remotes.find((x) => r.name.startsWith(`${x}/`)) ?? r.name.split("/")[0];
    byRemote.set(remote, [...(byRemote.get(remote) ?? []), r]);
  }

  const eye = (name: string) => {
    const off = p.hidden.has(name);
    return (
      <button
        className={`shrink-0 rounded p-0.5 hover:bg-panel-2 ${off ? "" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"}`}
        aria-label={off ? `Show ${name} in graph` : `Hide ${name} in graph`}
        aria-pressed={off}
        onClick={(e) => {
          e.stopPropagation();
          p.onToggleHidden(name);
        }}
      >
        {off ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
      </button>
    );
  };

  const item = (o: {
    key: string;
    label: ReactNode;
    icon: ReactNode;
    menu: () => MenuItem[];
    onClick: () => void;
    extra?: ReactNode;
    onDouble?: () => void;
    dim?: boolean;
  }) => (
    <li key={o.key}>
      <WithMenu
        items={o.menu}
        role="button"
        tabIndex={0}
        onClick={o.onClick}
        onDoubleClick={o.onDouble}
        onKeyDown={(e: React.KeyboardEvent) => e.key === "Enter" && o.onClick()}
        className={`group flex h-7 items-center gap-2 rounded-md px-2 text-sm hover:bg-raised ${o.dim ? "opacity-50" : ""}`}
      >
        {o.icon}
        <span className="min-w-0 flex-1 truncate">{o.label}</span>
        {o.extra}
      </WithMenu>
    </li>
  );

  const folders = <T,>(list: T[], name: (x: T) => string, render: (x: T, label: string) => ReactNode, key: string) => {
    const groups = new Map<string, T[]>();
    const nodes: [boolean, string, ReactNode][] = [];
    for (const x of list) {
      const n = name(x);
      const i = n.indexOf("/");
      if (i < 0) nodes.push([false, n, render(x, n)]);
      else groups.set(n.slice(0, i), [...(groups.get(n.slice(0, i)) ?? []), x]);
    }
    for (const [g, items] of groups) {
      nodes.push([
        items.length > 1,
        g,
        items.length === 1 ? (
          render(items[0], name(items[0]))
        ) : (
          <li key={`${key}/${g}/`}>
            <details open={!!q} className="group/folder">
              <summary className="flex h-7 cursor-pointer list-none items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground hover:bg-raised">
                <ChevronRight className="size-3 shrink-0 transition-transform group-open/folder:rotate-90" aria-hidden />
                <Folder className="size-3.5 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{g}</span>
                <span className="text-xs">{items.length}</span>
              </summary>
              <ul className="pl-4">{items.map((x) => render(x, name(x).slice(g.length + 1)))}</ul>
            </details>
          </li>
        ),
      ]);
    }
    return nodes.sort(([fa, a], [fb, b]) => Number(fb) - Number(fa) || a.localeCompare(b)).map(([, , n]) => n);
  };

  const icon = (I: typeof Laptop, label?: string) => <I className="size-3.5 shrink-0 text-muted-foreground" aria-label={label} />;

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r" aria-label="References">
      <div className="grid gap-2 px-2 pt-2.5 pb-2">
        <label className="flex h-[30px] items-center gap-2 rounded-lg border bg-panel px-2.5 text-dim focus-within:ring-2 focus-within:ring-ring/50">
          <Search className="size-3.5 shrink-0" aria-hidden />
          <input
            placeholder="Filter branches, tags…"
            aria-label="Filter references"
            value={filter}
            onChange={(e) => setFilter(e.currentTarget.value)}
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-dim"
          />
        </label>
        {p.solo && (
          <div className="flex items-center gap-1 rounded-md bg-raised px-2 py-1 text-xs">
            <span className="flex-1 truncate">Solo: {p.solo}</span>
            <button aria-label="Show all branches" onClick={p.onClearSolo} className="rounded p-0.5 hover:bg-panel-2">
              <X className="size-3" />
            </button>
          </div>
        )}
        {p.extras?.lfs && <span className="w-fit rounded border px-1.5 text-xs text-muted-foreground">Git LFS</span>}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto px-2 pb-3">
        <Section title="Local" count={refs.local.length}>
          {folders(
            refs.local.filter((b) => match(b.name)),
            (b) => b.name,
            (b, label) =>
              item({
                key: b.name,
                label,
                icon: b.head ? <Check className="size-3.5 shrink-0" aria-label="current" /> : icon(Laptop),
                menu: () => p.refMenu({ name: b.name, kind: "local", head: b.head }),
                onClick: () => p.onJump(b.tip),
                onDouble: () => !b.head && p.onCheckout(b.name),
                dim: p.hidden.has(b.name),
                extra: (
                  <>
                    {(b.ahead > 0 || b.behind > 0) && (
                      <span className="shrink-0 text-xs text-muted-foreground" title={`${b.ahead} ahead, ${b.behind} behind ${b.upstream}`}>
                        {b.ahead > 0 && `↑${b.ahead}`} {b.behind > 0 && `↓${b.behind}`}
                      </span>
                    )}
                    {eye(b.name)}
                  </>
                ),
              }),
            "local",
          )}
        </Section>
        <Section title="Remote" count={refs.remote.length}>
          {[...byRemote].map(([remote, list]) => (
            <li key={remote}>
              <details open>
                <summary className="flex h-7 cursor-pointer items-center px-2 text-sm text-muted-foreground">{remote}</summary>
                <ul className="pl-3">
                  {folders(
                    list,
                    (r) => r.name.slice(remote.length + 1),
                    (r, label) =>
                      item({
                        key: r.name,
                        label,
                        icon: icon(Cloud),
                        menu: () => p.refMenu({ name: r.name, kind: "remote", head: false }),
                        onClick: () => p.onJump(r.tip),
                        onDouble: () => p.onCheckout(r.name.slice(remote.length + 1)),
                        dim: p.hidden.has(r.name),
                        extra: eye(r.name),
                      }),
                    remote,
                  )}
                </ul>
              </details>
            </li>
          ))}
        </Section>
        {p.prs && (
          <Section
            title="Pull requests"
            count={p.prs.list?.length ?? 0}
            action={
              <Button size="icon-xs" variant="ghost" aria-label="Create pull request" onClick={p.onCreatePr}>
                <Plus />
              </Button>
            }
          >
            {p.prs.error && <li className="px-2 text-xs text-muted-foreground">{p.prs.error}</li>}
            {p.prs.list?.filter((pr) => match(pr.title) || match(pr.head)).map((pr) =>
              item({
                key: `pr${pr.number}`,
                label: (
                  <span title={`${pr.head} → ${pr.base} by ${pr.author}`}>
                    <span className="text-muted-foreground">#{pr.number}</span> {pr.title}
                  </span>
                ),
                icon: icon(GitPullRequest),
                menu: () => p.prMenu(pr),
                onClick: () => p.prMenu(pr).find((m) => m !== "-")?.onSelect(),
                dim: pr.draft,
              }),
            )}
          </Section>
        )}
        <Section title="Tags" count={refs.tags.length}>
          {refs.tags
            .filter((t) => match(t.name))
            .map((t) =>
              item({
                key: t.name,
                label: t.name,
                icon: icon(Tag),
                menu: () => p.refMenu({ name: t.name, kind: "tag", head: false }),
                onClick: () => p.onJump(t.tip),
              }),
            )}
        </Section>
        <Section title="Stashes" count={refs.stashes.length}>
          {refs.stashes
            .filter((s) => match(s.message))
            .map((s) =>
              item({ key: `stash${s.index}`, label: s.message, icon: icon(Archive), menu: () => p.stashMenu(s), onClick: () => p.onJump(s.tip) }),
            )}
        </Section>
        {p.extras && p.extras.worktrees.length > 1 && (
          <Section title="Worktrees" count={p.extras.worktrees.length}>
            {p.extras.worktrees.map((w) =>
              item({
                key: w.path,
                label: <span title={w.path}>{w.branch ?? `detached ${w.head.slice(0, 7)}`}</span>,
                icon: icon(FolderTree),
                menu: () => p.worktreeMenu(w),
                onClick: () => p.worktreeMenu(w).find((m) => m !== "-")?.onSelect(),
                extra: w.main ? <span className="text-xs text-muted-foreground">main</span> : undefined,
              }),
            )}
          </Section>
        )}
        {p.extras && p.extras.submodules.length > 0 && (
          <Section title="Submodules" count={p.extras.submodules.length}>
            {p.extras.submodules.map((s) =>
              item({
                key: s.path,
                label: <span title={s.url ?? ""}>{s.path}</span>,
                icon: icon(Package),
                menu: () => p.submoduleMenu(s),
                onClick: () => p.submoduleMenu(s).find((m) => m !== "-")?.onSelect(),
                extra:
                  !s.actual ? (
                    <span className="text-xs text-muted-foreground">not initialised</span>
                  ) : s.actual !== s.expected ? (
                    <span className="text-xs text-[var(--lane-4)]">modified</span>
                  ) : undefined,
              }),
            )}
          </Section>
        )}
      </div>
    </aside>
  );
}

function Section({ title, count, children, action }: { title: string; count: number; children: ReactNode; action?: ReactNode }) {
  return (
    <details open className="shrink-0 rounded-[10px] border bg-panel p-1">
      <summary className="flex h-7 cursor-pointer items-center gap-1.5 px-2 text-[11px] font-semibold tracking-[0.7px] text-muted-foreground uppercase">
        <span className="flex-1">{title}</span>
        <span className="font-medium">{count}</span>
        {action}
      </summary>
      <ul className="max-h-37 overflow-y-auto">{children}</ul>
    </details>
  );
}
