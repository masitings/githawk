import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Archive,
  Bot,
  ArchiveRestore,
  ChevronDown,
  GitBranch,
  GitMerge,
  GitPullRequestArrow,
  ListOrdered,
  GitBranchPlus,
  GitPullRequestCreate,
  History,
  Redo2,
  RefreshCw,
  Search,
  SquareTerminal,
  Undo2,
  Workflow,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  api,
  date,
  short,
  type Extras,
  type Op,
  type OpLog,
  type Opened,
  type CheckState,
  type Pr,
  type RefLabel,
  type Refs,
  type Row,
  type Stash,
  type Status,
  type Submodule,
  type Target,
  type Worktree,
} from "@/lib/api";
import { ask, confirm } from "@/lib/prompt";
import { account, actionFor, aiRun, getSettings, prettyCombo, useSettings, ACTIONS } from "@/lib/settings";
import type { MenuItem } from "@/components/Menu";
import { Graph } from "@/components/Graph";
import { Sidebar } from "@/components/Sidebar";
import { DiffView } from "@/components/DiffView";
import { WorkPanel } from "@/components/WorkPanel";
import { CommitPanel } from "@/components/CommitPanel";
import { ConflictView } from "@/components/ConflictView";
import { FileView } from "@/components/FileView";
import { StatusBar } from "@/components/StatusBar";
import { DropMenu, type DropItem } from "@/components/DropMenu";
import { ReflogView } from "@/components/ReflogView";
import { RebaseDialog } from "@/components/RebaseDialog";
import { PrView } from "@/components/PrView";
import { AgentsView } from "@/components/AgentsView";
import { TerminalPanel } from "@/components/TerminalPanel";
import { Palette, type PaletteItem } from "@/components/Palette";

const LONG = new Set(["fetch", "pull", "push", "delete-remote-branch", "push-tag", "lfs-pull", "submodule-update"]);
const KEEPS_REFS = new Set(["stage", "unstage", "discard"]);
const PROVIDER_NAME = { github: "GitHub", gitlab: "GitLab", bitbucket: "Bitbucket", azure: "Azure DevOps", "bitbucket-server": "Bitbucket" } as const;

type Center =
  | { kind: "graph" }
  | { kind: "diff"; target: Target; path: string }
  | { kind: "conflict"; path: string }
  | { kind: "file"; path: string; tab: "history" | "blame" }
  | { kind: "reflog" }
  | { kind: "pr"; pr: Pr }
  | { kind: "agents" };

type View = { hidden: string[]; solo: string | null };

const loadView = (root: string): View => {
  try {
    return { hidden: [], solo: null, ...JSON.parse(localStorage.getItem(`githawk.view.${root}`) ?? "{}") };
  } catch {
    return { hidden: [], solo: null };
  }
};

type Props = {
  root: string;
  initial?: Opened;
  progress: string;
  active: boolean;
  onOpenRepo: (path: string) => void;
  onOpenSettings: () => void;
  /** A branch, tag or commit to select, e.g. from a githawk:// link. */
  goto?: { ref: string; n: number };
};

export const linkTo = (root: string, ref: string) => `githawk://open?path=${encodeURIComponent(root)}&ref=${encodeURIComponent(ref)}`;

export function RepoView({ root, initial, progress, active, onOpenRepo, onOpenSettings, goto }: Props) {
  const settings = useSettings();
  const [view, setView] = useState<View>(() => loadView(root));
  const viewRef = useRef(view);
  viewRef.current = view;
  const [opened, setOpened] = useState<Opened | null>(view.hidden.length || view.solo ? null : (initial ?? null));
  const [version, setVersion] = useState(0);
  const [statusVersion, setStatusVersion] = useState(0);
  const [status, setStatus] = useState<Status | null>(null);
  const [refs, setRefs] = useState<Refs | null>(null);
  const [extras, setExtras] = useState<Extras | null>(null);
  const [prs, setPrs] = useState<{ list: Pr[] | null; error: string } | null>(null);
  const [hostAccount, setHostAccount] = useState("");
  const [checks, setChecks] = useState<Record<string, CheckState>>({});
  const [avatars, setAvatars] = useState<Record<string, string> | null>(null);
  const [drop, setDrop] = useState<{ src: RefLabel; target: RefLabel; at: { x: number; y: number }; counts: [number, number] | null } | null>(null);
  const [sidebar, setSidebar] = useState(() => {
    try {
      return localStorage.getItem("githawk.sidebar") !== "hidden";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("githawk.sidebar", sidebar ? "shown" : "hidden");
    } catch {
      /* preference just won't persist */
    }
  }, [sidebar]);
  const [oplog, setOplog] = useState<OpLog | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [marked, setMarked] = useState<Map<string, number>>(new Map());
  const anchor = useRef<number | null>(null);
  const [center, setCenter] = useState<Center>({ kind: "graph" });
  const [jump, setJump] = useState<{ index: number; n: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [rebaseBase, setRebaseBase] = useState<{ base: string | null } | null>(null);
  const [terminal, setTerminal] = useState(false);
  const [agentsOpened, setAgentsOpened] = useState(false);
  const [palette, setPalette] = useState<string | null>(null);
  const files = useRef<string[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const search = useRef<{ q: string; hits: number[]; pos: number }>({ q: "", hits: [], pos: -1 });
  const graphJob = useRef<"idle" | "running" | "again">("idle");

  const refreshGraph = useCallback(async () => {
    if (graphJob.current !== "idle") {
      graphJob.current = "again";
      return;
    }
    do {
      graphJob.current = "running";
      try {
        const v = viewRef.current;
        setOpened(await api.open(root, v.hidden, v.solo));
        setVersion((x) => x + 1);
      } catch (e) {
        toast.error(String(e));
      }
    } while ((graphJob.current as string) === "again");
    graphJob.current = "idle";
  }, [root]);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await api.status(root));
      setStatusVersion((v) => v + 1);
    } catch (e) {
      toast.error(String(e));
    }
  }, [root]);

  const refreshRefs = useCallback(() => {
    api.refs(root).then(setRefs).catch((e) => toast.error(String(e)));
    api.extras(root).then(setExtras).catch(() => {});
    api.oplog(root).then(setOplog).catch(() => {});
    api.files(root).then((f) => (files.current = f)).catch(() => {});
  }, [root]);

  useEffect(() => {
    if (!opened) refreshGraph();
    refreshRefs();
    refreshStatus();
    api.watch(root).catch((e) => toast.error(`File watcher failed: ${e}`));
    const un = listen<{ root: string; refs: boolean }>("repo-changed", (e) => {
      if (e.payload.root !== root) return;
      refreshStatus();
      if (e.payload.refs) {
        refreshRefs();
        refreshGraph();
      }
    });
    return () => {
      un.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root]);

  useEffect(() => {
    try {
      localStorage.setItem(`githawk.view.${root}`, JSON.stringify(view));
    } catch {
      /* view filter just won't persist */
    }
  }, [root, view]);

  const firstStatus = useRef(true);
  useEffect(() => {
    if (status && firstStatus.current) {
      firstStatus.current = false;
      if (status.files.length) setSelected((s) => s ?? "wip");
    }
  }, [status]);

  const originUrl = refs ? (refs.urls.origin ?? Object.values(refs.urls)[0]) : undefined;
  const loadPrs = useCallback(async () => {
    if (!originUrl) return setPrs(null);
    const d = await api.detect(originUrl).catch(() => null);
    if (!d) return setPrs(null);
    const acct = account(d.key);
    setHostAccount(acct);
    if (!(await api.hasToken(acct).catch(() => false))) {
      return setPrs({ list: null, error: `Connect ${PROVIDER_NAME[d.provider]} in Settings to see pull requests.` });
    }
    api
      .prs(acct, originUrl)
      .then((list) => setPrs({ list, error: list.length ? "" : "No open pull requests." }))
      .catch((e) => setPrs({ list: null, error: String(e) }));
  }, [originUrl]);
  useEffect(() => {
    loadPrs();
  }, [loadPrs, settings.active]);

  useEffect(() => {
    setAvatars(null);
    if (!originUrl || !hostAccount) return;
    let live = true;
    api
      .detect(originUrl)
      .then((d) => (d?.provider === "github" ? api.avatars(hostAccount, originUrl) : null))
      .then((map) => live && map && setAvatars(map))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [hostAccount, originUrl]);

  const remoteName = refs && (refs.urls.origin ? "origin" : Object.keys(refs.urls)[0]);
  const heads = (prs?.list ?? [])
    .map((pr) => [pr.head, (refs?.remote.find((r) => r.name === `${remoteName}/${pr.head}`) ?? refs?.local.find((b) => b.name === pr.head))?.tip] as const)
    .filter((h): h is readonly [string, string] => !!h[1]);
  const headsKey = heads.map((h) => h.join("@")).join(",");
  useEffect(() => {
    if (!settings.showChecks || !originUrl || !hostAccount || !heads.length) return setChecks({});
    const load = () =>
      api
        .checks(hostAccount, originUrl, heads.map((h) => h[1]))
        .then((bySha) => {
          const next: Record<string, CheckState> = {};
          for (const [name, sha] of heads) {
            if (!bySha[sha]) continue;
            next[name] = bySha[sha];
            next[`${remoteName}/${name}`] = bySha[sha];
          }
          setChecks(next);
        })
        .catch(() => setChecks({}));
    load();
    // ponytail: 2-minute poll; webhooks would need a server, which GitHawk doesn't have
    const t = setInterval(load, 120_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headsKey, settings.showChecks, hostAccount, originUrl]);

  const run = useCallback(
    async (op: Op, label?: string): Promise<boolean> => {
      const long = LONG.has(op.op);
      if (long) setBusy(label ?? op.op);
      try {
        await api.run(root, op);
        if (label) toast.success(label);
        return true;
      } catch (e) {
        const msg = String(e);
        if (op.op === "push" && !op.force && /rejected|non-fast-forward|fetch first/i.test(msg)) {
          setBusy(null);
          const ok = await confirm(
            "Push rejected",
            "The remote has commits you don't have. Force push with lease? It refuses to overwrite commits pushed since your last fetch.",
            "Force push",
          );
          return ok ? run({ ...op, force: true }, label) : false;
        }
        if (op.op === "delete-branch" && !op.force && /not fully merged/i.test(msg)) {
          if (await confirm(`${op.name} is not fully merged`, "Delete it anyway? You can undo this, and its commits stay in the reflog.", "Delete"))
            return run({ ...op, force: true }, label);
          return false;
        }
        toast.error(msg);
        return false;
      } finally {
        if (long) setBusy(null);
        refreshStatus();
        if (!KEEPS_REFS.has(op.op)) {
          refreshRefs();
          refreshGraph();
        }
      }
    },
    [root, refreshGraph, refreshRefs, refreshStatus],
  );

  const refreshAll = () => {
    refreshStatus();
    refreshRefs();
    refreshGraph();
  };

  async function undo(redo = false) {
    try {
      const label = await (redo ? api.redo(root) : api.undo(root));
      toast.success(`${redo ? "Redid" : "Undid"}: ${label}`);
    } catch (e) {
      toast.error(String(e));
    } finally {
      refreshAll();
    }
  }

  const current = status?.branch ?? null;
  const remoteOf = (name: string) => refs?.remotes.find((r) => name.startsWith(`${r}/`)) ?? name.split("/")[0];

  async function select(id: string) {
    setSelected(id);
    setMarked(new Map());
    setCenter({ kind: "graph" });
    if (id === "wip") return;
    const index = await api.findRow(root, id);
    if (index !== null) setJump({ index, n: Date.now() });
  }

  useEffect(() => {
    if (!goto) return;
    api
      .commit(root, goto.ref)
      .then((c) => select(c.id))
      .catch(() => toast.error(`${goto.ref} isn't in this repository`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goto?.n]);

  async function onGraphSelect(id: string, index: number, mods: { range: boolean; toggle: boolean }) {
    setCenter({ kind: "graph" });
    if (id === "wip" || index < 0) {
      setSelected(id);
      setMarked(new Map());
      return;
    }
    if (mods.toggle) {
      const next = new Map(marked);
      if (selected && selected !== "wip" && !next.size && anchor.current !== null) next.set(selected, anchor.current);
      if (next.has(id)) next.delete(id);
      else next.set(id, index);
      setMarked(next);
      setSelected(id);
      anchor.current = index;
      return;
    }
    if (mods.range && anchor.current !== null) {
      const [a, b] = [Math.min(anchor.current, index), Math.max(anchor.current, index)];
      const rows = await api.page(root, a, Math.min(b - a + 1, 500));
      setMarked(new Map(rows.map((r, i) => [r.id, a + i])));
      setSelected(id);
      return;
    }
    anchor.current = index;
    setSelected(id);
    setMarked(new Map());
  }

  async function push(branch = current) {
    if (!branch || !refs) return toast.error("Not on a branch");
    const b = refs.local.find((x) => x.name === branch);
    if (b?.upstream) {
      const remote = remoteOf(b.upstream);
      const rb = b.upstream.slice(remote.length + 1);
      return run({ op: "push", remote, branch: rb === branch ? branch : `${branch}:${rb}`, force: false, setUpstream: false }, `Pushed ${branch}`);
    }
    if (!refs.remotes.length) return toast.error("This repository has no remote");
    const r = await ask({
      title: `Push ${branch}`,
      description: "This branch has no upstream yet. It will be set to the remote branch of the same name.",
      fields: [{ name: "remote", label: "Remote", value: refs.remotes.includes("origin") ? "origin" : refs.remotes[0] }],
      confirm: "Push",
    });
    if (r) run({ op: "push", remote: r.text.remote.trim(), branch, force: false, setUpstream: true }, `Pushed ${branch}`);
  }

  async function createBranch(at: string) {
    const r = await ask({
      title: "Create branch",
      description: at === "HEAD" ? undefined : `At ${short(at)}`,
      fields: [{ name: "name", label: "Branch name" }],
      checks: [{ name: "checkout", label: "Check out after creating", value: true }],
      confirm: "Create",
    });
    if (r) run({ op: "create-branch", name: r.text.name.trim(), at, checkout: r.checked.checkout });
  }

  async function stash() {
    const r = await ask({
      title: "Stash changes",
      fields: [{ name: "message", label: "Message", optional: true }],
      checks: [{ name: "untracked", label: "Include untracked files", value: true }],
      confirm: "Stash",
    });
    if (r) run({ op: "stash-save", message: r.text.message, untracked: r.checked.untracked }, "Stashed");
  }

  async function reset(id: string, mode: "soft" | "mixed" | "hard") {
    if (mode === "hard" && !(await confirm(`Hard reset ${current ?? "HEAD"} to ${short(id)}?`, "Uncommitted changes will be lost; the commits can be restored with Undo.", "Reset")))
      return;
    run({ op: "reset", id, mode });
  }

  async function addWorktree(branch?: string) {
    const parent = root.replace(/[\\/][^\\/]*$/, "");
    const name = root.split(/[\\/]/).pop();
    const r = await ask({
      title: "Add worktree",
      description: "Check out a branch in a separate folder, so you can work on it alongside this one.",
      fields: [
        { name: "branch", label: "Branch", value: branch ?? "" },
        { name: "path", label: "Folder", value: `${parent}/${name}-${(branch ?? "worktree").replace(/[\\/]/g, "-")}` },
      ],
      checks: [{ name: "create", label: "Create this branch", value: !branch }],
      confirm: "Add",
    });
    if (!r) return;
    if (await run({ op: "worktree-add", path: r.text.path.trim(), branch: r.text.branch.trim(), create: r.checked.create }, "Worktree added")) {
      if (await confirm("Open the new worktree in a tab?", r.text.path.trim(), "Open")) onOpenRepo(r.text.path.trim());
    }
  }

  async function createPr(from?: string, into?: string) {
    const branch = from ?? current;
    if (!originUrl || !branch) return toast.error("Check out a branch with a remote first");
    const d = await api.detect(originUrl);
    if (!d) return toast.error("The remote isn't on GitHub, GitLab, Bitbucket, Azure DevOps or a server added in Settings");
    const b = refs?.local.find((x) => x.name === branch);
    if (!b?.upstream) {
      if (!(await confirm(`${branch} isn't on the remote yet`, "Push it first, then create the pull request?", "Push"))) return;
      await push(branch);
    }
    const base = into ?? ["main", "master", "develop"].find((n) => refs?.remote.some((r) => r.name === `${remoteOf(b?.upstream ?? "origin/")}/${n}`)) ?? "main";
    const head = await api.commit(root, branch).catch(() => null);
    const r = await ask({
      title: `Create pull request on ${PROVIDER_NAME[d.provider]}`,
      description: `${branch} → base branch`,
      fields: [
        { name: "title", label: "Title", value: head?.message.split("\n")[0] ?? branch },
        { name: "body", label: "Description", optional: true },
        { name: "base", label: "Base branch", value: base },
      ],
      confirm: "Create",
    });
    if (!r) return;
    try {
      const url = await api.createPr(account(d.key), originUrl, {
        title: r.text.title.trim(),
        body: r.text.body,
        head: branch,
        base: r.text.base.trim(),
      });
      toast.success("Pull request created", { action: { label: "Open", onClick: () => openUrl(url) } });
      loadPrs();
    } catch (e) {
      toast.error(String(e));
    }
  }

  const flow = extras?.flow ?? null;
  const flowKind = flow && current ? (["feature", "release", "hotfix"] as const).find((k) => current.startsWith(flow[k])) : undefined;

  async function flowInit() {
    const main = ["main", "master"].find((n) => refs?.local.some((b) => b.name === n)) ?? current ?? "main";
    const r = await ask({
      title: "Initialise Gitflow",
      description: "Uses feature/, release/ and hotfix/ branch prefixes. Stored in this repo's git config, compatible with the git-flow tools.",
      fields: [
        { name: "main", label: "Production branch", value: main },
        { name: "develop", label: "Development branch", value: "develop" },
      ],
      confirm: "Initialise",
    });
    if (!r) return;
    const develop = r.text.develop.trim();
    run({ op: "flow-init", main: r.text.main.trim(), develop, createDevelop: !refs?.local.some((b) => b.name === develop) }, "Gitflow initialised");
  }

  async function flowStart(kind: "feature" | "release" | "hotfix") {
    if (!flow) return;
    const r = await ask({
      title: `Start ${kind}`,
      description: `Branches from ${kind === "hotfix" ? flow.main : flow.develop}.`,
      fields: [{ name: "name", label: kind === "feature" ? "Feature name" : "Version", placeholder: kind === "feature" ? "login-form" : "1.2.0" }],
      confirm: "Start",
    });
    if (r) run({ op: "create-branch", name: flow[kind] + r.text.name.trim(), at: kind === "hotfix" ? flow.main : flow.develop, checkout: true });
  }

  async function flowFinish() {
    if (!flow || !flowKind || !current) return;
    const name = current.slice(flow[flowKind].length);
    if (flowKind === "feature") {
      if (await confirm(`Finish ${current}?`, `Merges it into ${flow.develop} and deletes the branch.`, "Finish"))
        run({ op: "flow-finish", branch: current, into: [flow.develop], tag: null }, `Finished ${current}`);
      return;
    }
    const r = await ask({
      title: `Finish ${current}`,
      description: `Merges it into ${flow.main} and ${flow.develop}, tags ${flow.main}, and deletes the branch.`,
      fields: [{ name: "tag", label: "Tag", value: flow.tag + name, optional: true }],
      confirm: "Finish",
    });
    if (r) run({ op: "flow-finish", branch: current, into: [flow.main, flow.develop], tag: r.text.tag.trim() || null }, `Finished ${current}`);
  }

  async function changelog(from: string) {
    const t = toast.loading("Writing changelog…");
    try {
      const text = await aiRun(root, { kind: "changelog", from, to: "HEAD" });
      toast.dismiss(t);
      if (await ask({ title: `Changelog since ${refs?.tags.find((x) => x.tip === from)?.name ?? short(from)}`, body: text, confirm: "Copy" }))
        navigator.clipboard.writeText(text);
    } catch (e) {
      toast.error(String(e), { id: t });
    }
  }

  const setFilter = (v: View) => {
    setView(v);
    viewRef.current = v;
    refreshGraph();
  };

  const multi = (row: Row) => marked.size > 1 && marked.has(row.id);
  // Graph index grows with age, so a higher index is an older commit.
  const byIndex = (newestFirst: boolean) => [...marked].sort((a, b) => (newestFirst ? a[1] - b[1] : b[1] - a[1])).map(([id]) => id);

  const rowMenu = (row: Row): MenuItem[] =>
    multi(row)
      ? [
          { label: `Cherry-pick ${marked.size} commits`, onSelect: () => run({ op: "cherry-pick", ids: byIndex(false) }, "Cherry-picked") },
          { label: `Revert ${marked.size} commits`, onSelect: () => run({ op: "revert", ids: byIndex(true) }, "Reverted") },
          "-",
          { label: "Copy commit SHAs", onSelect: () => navigator.clipboard.writeText(byIndex(false).join("\n")) },
        ]
      : [
          { label: "Checkout this commit", onSelect: () => run({ op: "checkout-detached", id: row.id }) },
          { label: "Create branch here…", onSelect: () => createBranch(row.id) },
          {
            label: "Create tag here…",
            onSelect: async () => {
              const r = await ask({
                title: "Create tag",
                description: `At ${short(row.id)}`,
                fields: [
                  { name: "name", label: "Tag name" },
                  { name: "message", label: "Message (makes an annotated tag)", optional: true },
                ],
                confirm: "Create",
              });
              if (r) run({ op: "tag", name: r.text.name.trim(), at: row.id, message: r.text.message });
            },
          },
          "-",
          { label: "Cherry-pick commit", onSelect: () => run({ op: "cherry-pick", ids: [row.id] }, "Cherry-picked") },
          { label: "Revert commit", onSelect: () => run({ op: "revert", ids: [row.id] }, "Reverted") },
          { label: "Interactive rebase from here…", onSelect: () => setRebaseBase({ base: row.parents[0] ?? null }) },
          { label: `AI changelog from here to ${current ?? "HEAD"}…`, onSelect: () => changelog(row.id) },
          "-",
          { label: `Reset ${current ?? "HEAD"} here: soft`, onSelect: () => reset(row.id, "soft") },
          { label: `Reset ${current ?? "HEAD"} here: mixed`, onSelect: () => reset(row.id, "mixed") },
          { label: `Reset ${current ?? "HEAD"} here: hard`, onSelect: () => reset(row.id, "hard"), destructive: true },
          "-",
          { label: "Copy commit SHA", onSelect: () => navigator.clipboard.writeText(row.id) },
          { label: "Copy GitHawk link", onSelect: () => navigator.clipboard.writeText(linkTo(root, row.id)) },
        ];

  const mergeRebase = (name: string): MenuItem[] =>
    current && name !== current
      ? [
          { label: `Merge ${name} into ${current}`, onSelect: () => run({ op: "merge", name }) },
          { label: `Rebase ${current} onto ${name}`, onSelect: () => run({ op: "rebase", onto: name }) },
        ]
      : [];

  const viewItems = (name: string): MenuItem[] => [
    view.hidden.includes(name)
      ? { label: `Show ${name} in graph`, onSelect: () => setFilter({ ...view, hidden: view.hidden.filter((h) => h !== name) }) }
      : { label: `Hide ${name} in graph`, onSelect: () => setFilter({ ...view, hidden: [...view.hidden, name] }) },
    view.solo === name
      ? { label: "Show all branches", onSelect: () => setFilter({ ...view, solo: null }) }
      : { label: `Solo ${name}`, onSelect: () => setFilter({ ...view, solo: name }) },
  ];

  const refMenu = (ref: RefLabel): MenuItem[] => {
    if (ref.kind === "tag") {
      return [
        {
          label: `Push tag ${ref.name}`,
          onSelect: () => {
            const remote = refs?.remotes.includes("origin") ? "origin" : refs?.remotes[0];
            if (!remote) return toast.error("This repository has no remote");
            run({ op: "push-tag", remote, name: ref.name }, `Pushed tag ${ref.name}`);
          },
        },
        { label: `AI changelog since ${ref.name}…`, onSelect: () => changelog(ref.name) },
        {
          label: `Delete tag ${ref.name}`,
          destructive: true,
          onSelect: async () => (await confirm(`Delete tag ${ref.name}?`)) && run({ op: "delete-tag", name: ref.name }),
        },
      ];
    }
    if (ref.kind === "remote") {
      const remote = remoteOf(ref.name);
      const name = ref.name.slice(remote.length + 1);
      return [
        { label: `Checkout ${name}`, onSelect: () => run({ op: "checkout", name }) },
        ...mergeRebase(ref.name),
        "-",
        ...viewItems(ref.name),
        "-",
        {
          label: `Delete ${ref.name} from remote`,
          destructive: true,
          onSelect: async () =>
            (await confirm(`Delete ${name} on ${remote}?`, "The branch is removed for everyone using this remote. This can't be undone from here.", "Delete")) &&
            run({ op: "delete-remote-branch", remote, name }, `Deleted ${ref.name}`),
        },
      ];
    }
    return [
      ...(ref.head ? [] : [{ label: `Checkout ${ref.name}`, onSelect: () => run({ op: "checkout", name: ref.name }) }]),
      ...mergeRebase(ref.name),
      { label: `Push ${ref.name}`, onSelect: () => push(ref.name) },
      ...(ref.head ? [] : [{ label: `Check out ${ref.name} in a new worktree…`, onSelect: () => addWorktree(ref.name) }]),
      {
        label: "Set upstream…",
        onSelect: async () => {
          const r = await ask({
            title: `Set upstream of ${ref.name}`,
            fields: [{ name: "up", label: "Upstream", value: `${refs?.remotes[0] ?? "origin"}/${ref.name}` }],
          });
          if (r) run({ op: "set-upstream", branch: ref.name, upstream: r.text.up.trim() });
        },
      },
      {
        label: `Rename ${ref.name}…`,
        onSelect: async () => {
          const r = await ask({ title: "Rename branch", fields: [{ name: "name", label: "New name", value: ref.name }], confirm: "Rename" });
          if (r) run({ op: "rename-branch", old: ref.name, new: r.text.name.trim() });
        },
      },
      { label: "Copy GitHawk link", onSelect: () => navigator.clipboard.writeText(linkTo(root, ref.name)) },
      "-",
      ...viewItems(ref.name),
      "-",
      {
        label: `Delete ${ref.name}`,
        destructive: true,
        onSelect: async () =>
          !ref.head && (await confirm(`Delete branch ${ref.name}?`, "You can bring it back with Undo.", "Delete")) && run({ op: "delete-branch", name: ref.name, force: false }),
      },
    ];
  };

  const stashMenu = (s: Stash): MenuItem[] => [
    { label: "Apply stash", onSelect: () => run({ op: "stash-apply", index: s.index }) },
    { label: "Pop stash", onSelect: () => run({ op: "stash-pop", index: s.index }) },
    "-",
    {
      label: "Drop stash",
      destructive: true,
      onSelect: async () => (await confirm("Drop stash?", s.message, "Drop")) && run({ op: "stash-drop", index: s.index }),
    },
  ];

  const worktreeMenu = (w: Worktree): MenuItem[] => [
    { label: "Open in new tab", onSelect: () => onOpenRepo(w.path) },
    ...(w.main
      ? []
      : [
          "-" as const,
          {
            label: "Remove worktree",
            destructive: true,
            onSelect: async () => {
              if (!(await confirm(`Remove worktree ${w.path}?`, "The folder is deleted; its branch stays.", "Remove"))) return;
              if (!(await run({ op: "worktree-remove", path: w.path, force: false })) && (await confirm("The worktree has changes", "Remove it anyway? Its uncommitted changes will be lost.", "Remove")))
                run({ op: "worktree-remove", path: w.path, force: true });
            },
          },
        ]),
  ];

  const submoduleMenu = (s: Submodule): MenuItem[] => [
    { label: "Open in new tab", onSelect: () => (s.actual ? onOpenRepo(`${root}/${s.path}`) : toast.error("Initialise submodules first")) },
    { label: "Update all submodules", onSelect: () => run({ op: "submodule-update" }, "Submodules updated") },
  ];

  const prMenu = (pr: Pr): MenuItem[] => [
    { label: "Review in GitHawk", onSelect: () => setCenter({ kind: "pr", pr }) },
    { label: "Open in browser", onSelect: () => openUrl(pr.url) },
    { label: `Checkout ${pr.head}`, onSelect: () => run({ op: "checkout", name: pr.head }) },
    { label: "Copy link", onSelect: () => navigator.clipboard.writeText(pr.url) },
  ];

  const reflogMenu = (id: string): MenuItem[] => [
    { label: "Create branch here…", onSelect: () => createBranch(id) },
    { label: "Checkout this commit", onSelect: () => run({ op: "checkout-detached", id }) },
    { label: `Reset ${current ?? "HEAD"} here: mixed`, onSelect: () => reset(id, "mixed") },
    { label: `Reset ${current ?? "HEAD"} here: hard`, onSelect: () => reset(id, "hard"), destructive: true },
    "-",
    { label: "Copy commit SHA", onSelect: () => navigator.clipboard.writeText(id) },
  ];

  const fileMenu = (path: string): MenuItem[] => [
    { label: "File history", onSelect: () => setCenter({ kind: "file", path, tab: "history" }) },
    { label: "Blame", onSelect: () => setCenter({ kind: "file", path, tab: "blame" }) },
  ];

  const wipMenu = (): MenuItem[] => [
    { label: "Stash changes…", onSelect: stash },
    {
      label: "Discard all changes",
      destructive: true,
      onSelect: async () => {
        if (!status || !(await confirm("Discard all changes?", "Every uncommitted change will be lost.", "Discard"))) return;
        if (await run({ op: "reset", id: "HEAD", mode: "hard" })) run({ op: "discard", tracked: [], untracked: ["."] });
      },
    },
  ];

  const closeDrop = useCallback(() => setDrop(null), []);

  async function onOpenRef(r: RefLabel) {
    if (r.kind === "tag") return;
    if (r.kind === "local") return r.head || run({ op: "checkout", name: r.name });
    const name = r.name.slice(remoteOf(r.name).length + 1);
    const local = refs?.local.find((b) => b.name === name);
    if (!local) return run({ op: "checkout", name }, `Checked out ${name}`);
    const [ahead, behind] = await api.aheadBehind(root, name, r.name).catch(() => [0, 0]);
    const checkout = async () => local.head || run({ op: "checkout", name });
    if (!ahead && !behind) return checkout();
    if (!ahead) return (await checkout()) && run({ op: "merge", name: r.name }, `Fast-forwarded ${name}`);
    const lost = `${ahead} local commit${ahead === 1 ? "" : "s"}`;
    if (
      !(await confirm(
        `Reset ${name} to ${r.name}?`,
        `Drops ${lost} on ${name} that ${ahead === 1 ? "isn't" : "aren't"} on the remote${behind ? `, and brings in ${behind} from it` : ""}. Uncommitted changes are kept, and you can undo this.`,
        "Reset",
      ))
    )
      return;
    if (await checkout()) run({ op: "reset", id: r.name, mode: "keep" }, `${name} now matches ${r.name}`);
  }

  function onDropRef(src: RefLabel, target: RefLabel, at: { x: number; y: number }) {
    setDrop({ src, target, at, counts: null });
    api
      .aheadBehind(root, src.name, target.name)
      .then((counts) => setDrop((d) => (d && d.src === src ? { ...d, counts } : d)))
      .catch(() => {});
  }

  const dropItems = (src: RefLabel, target: RefLabel): DropItem[] => {
    const b = (name: string) => <b className="font-semibold">{name}</b>;
    const branchOf = (r: RefLabel) => (r.kind === "remote" ? r.name.slice(remoteOf(r.name).length + 1) : r.name);
    const checkout = async (name: string) => current === name || run({ op: "checkout", name });
    const tip = (name: string) => [...(refs?.local ?? []), ...(refs?.remote ?? [])].find((x) => x.name === name)?.tip;
    const items: DropItem[] = [];
    if (target.kind === "local") {
      items.push({
        icon: GitMerge,
        label: <>Merge {b(src.name)} into {b(target.name)}</>,
        run: async () => (await checkout(target.name)) && run({ op: "merge", name: src.name }, `Merged ${src.name} into ${target.name}`),
      });
    }
    if (src.kind === "local") {
      items.push(
        {
          icon: GitPullRequestArrow,
          label: <>Rebase {b(src.name)} onto {b(target.name)}</>,
          run: async () => (await checkout(src.name)) && run({ op: "rebase", onto: target.name }, `Rebased ${src.name} onto ${target.name}`),
        },
        {
          icon: ListOrdered,
          label: <>Interactive rebase onto {b(target.name)}…</>,
          run: async () => {
            const base = tip(target.name);
            if (base && (await checkout(src.name))) setRebaseBase({ base });
          },
        },
      );
      const remote = target.kind === "remote" ? remoteOf(target.name) : remoteName;
      if (remote) {
        const dest = target.kind === "remote" ? branchOf(target) : src.name;
        items.push({
          icon: ArrowUpFromLine,
          label: target.kind === "remote" ? <>Push {b(src.name)} to {b(target.name)}</> : <>Push {b(src.name)} to {b(remote)}</>,
          run: () => run({ op: "push", remote, branch: dest === src.name ? src.name : `${src.name}:${dest}`, force: false, setUpstream: false }, "Pushed"),
        });
      }
    }
    if (prs && branchOf(src) !== branchOf(target)) {
      items.push({ icon: GitPullRequestCreate, label: <>Open pull request into {b(branchOf(target))}…</>, run: () => createPr(branchOf(src), branchOf(target)) });
    }
    return items;
  };

  async function onSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    const s = search.current;
    if (s.q !== q) {
      s.q = q;
      s.hits = await api.search(root, q);
      s.pos = -1;
    }
    if (!s.hits.length) return toast("No matching commits");
    s.pos = (s.pos + 1) % s.hits.length;
    const index = s.hits[s.pos];
    const [r] = await api.page(root, index, 1);
    if (r) {
      setSelected(r.id);
      setMarked(new Map());
      anchor.current = index;
      setCenter({ kind: "graph" });
      setJump({ index, n: Date.now() });
    }
  }

  const actions: Record<string, () => void> = {
    palette: () => setPalette(""),
    files: () => setPalette("file "),
    undo: () => undo(false),
    redo: () => undo(true),
    fetch: () => run({ op: "fetch" }, "Fetched"),
    pull: () => run({ op: "pull", mode: "merge" }, "Pulled"),
    push: () => push(),
    branch: () => createBranch("HEAD"),
    stash,
    pop: () => run({ op: "stash-pop", index: 0 }, "Popped stash"),
    terminal: () => setTerminal((t) => !t),
    reflog: () => setCenter({ kind: "reflog" }),
    agents: () => {
      setAgentsOpened(true);
      setCenter((c) => (c.kind === "agents" ? { kind: "graph" } : { kind: "agents" }));
    },
    search: () => searchRef.current?.focus(),
    settings: onOpenSettings,
    sidebar: () => setSidebar((x) => !x),
  };
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const a = actionFor(e);
      if (!a) return;
      const t = e.target as HTMLElement;
      const inTerminal = !!t.closest?.(".xterm");
      const typing = t.matches?.("input, textarea, select, [contenteditable=true]");
      if ((inTerminal && a !== "terminal") || (typing && (a === "undo" || a === "redo" || !/mod|ctrl/.test(getSettings().shortcuts[a])))) return;
      e.preventDefault();
      actionsRef.current[a]?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  useEffect(() => {
    if (!active || !settings.autoFetch) return;
    const t = setInterval(() => {
      api
        .run(root, { op: "fetch" })
        .then(() => {
          refreshRefs();
          refreshGraph();
        })
        .catch(() => {});
    }, settings.autoFetch * 60_000);
    return () => clearInterval(t);
  }, [active, settings.autoFetch, root, refreshRefs, refreshGraph]);

  const paletteItems = (): PaletteItem[] => {
    const items: PaletteItem[] = Object.entries(ACTIONS)
      .filter(([id]) => id !== "palette")
      .map(([id, label]) => ({ id: `a:${id}`, label, group: "Action", shortcut: id, run: () => actions[id]() }));
    items.push(
      { id: "a:pr", label: "Create pull request…", group: "Action", run: () => createPr() },
      { id: "a:worktree", label: "Add worktree…", group: "Action", run: () => addWorktree() },
      ...(flow
        ? (["feature", "release", "hotfix"] as const).map((k) => ({ id: `a:flow-${k}`, label: `Gitflow: start ${k}…`, group: "Action", run: () => flowStart(k) }))
        : [{ id: "a:flow-init", label: "Gitflow: initialise…", group: "Action", run: flowInit }]),
      ...(flowKind ? [{ id: "a:flow-finish", label: `Gitflow: finish ${current}…`, group: "Action", run: flowFinish }] : []),
      { id: "a:rebase", label: `Interactive rebase ${current ?? "HEAD"}…`, group: "Action", hint: "pick the base commit in the graph", run: () => toast("Right-click the commit to rebase from, then choose Interactive rebase.") },
    );
    if (extras?.submodules.length) items.push({ id: "a:sub", label: "Update submodules", group: "Action", run: () => run({ op: "submodule-update" }, "Submodules updated") });
    if (extras?.lfs) items.push({ id: "a:lfs", label: "Git LFS pull", group: "Action", run: () => run({ op: "lfs-pull" }, "LFS files pulled") });
    for (const b of refs?.local ?? []) items.push({ id: `b:${b.name}`, label: b.name, group: "Branch", hint: b.head ? "current" : "checkout", run: () => (b.head ? select(b.tip) : run({ op: "checkout", name: b.name })) });
    for (const b of refs?.remote ?? []) items.push({ id: `r:${b.name}`, label: b.name, group: "Remote", hint: "checkout", run: () => run({ op: "checkout", name: b.name.slice(remoteOf(b.name).length + 1) }) });
    for (const t of refs?.tags ?? []) items.push({ id: `t:${t.name}`, label: t.name, group: "Tag", run: () => select(t.tip) });
    for (const f of files.current) items.push({ id: `f:${f}`, label: f, group: "File", hint: "history", run: () => setCenter({ kind: "file", path: f, tab: "history" }) });
    return items;
  };

  const inProgress = status && ["merge", "rebase", "cherry-pick", "revert"].includes(status.state);
  const conflicts = status?.files.filter((f) => f.conflicted).length ?? 0;
  const wip = status?.files.length ?? 0;
  const canUndo = !!oplog && oplog.pos > 0;
  const canRedo = !!oplog && oplog.pos < oplog.entries.length;
  const kbd = (id: string) => (settings.shortcuts[id] ? ` (${prettyCombo(settings.shortcuts[id])})` : "");

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex min-h-[54px] shrink-0 items-center gap-0.5 overflow-x-auto border-b bg-panel px-3 py-1">
        <div className="flex h-11 max-w-56 min-w-24 shrink-0 flex-col justify-center overflow-hidden px-2.5">
          <span className="text-[10.5px] tracking-[0.6px] text-dim uppercase">Branch</span>
          <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold" title="Current branch">
            <GitBranch className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{current ?? "detached HEAD"}</span>
          </span>
        </div>
        <span className="min-w-3 flex-1" />
        <Button variant="ghost" size="tool" aria-label={`Undo${canUndo ? `: ${oplog!.entries[oplog!.pos - 1].label}` : ""}`} title={`Undo${canUndo ? `: ${oplog!.entries[oplog!.pos - 1].label}` : ""}${kbd("undo")}`} disabled={!canUndo} onClick={() => undo(false)}>
          <Undo2 /> Undo
        </Button>
        <Button variant="ghost" size="tool" aria-label={`Redo${canRedo ? `: ${oplog!.entries[oplog!.pos].label}` : ""}`} title={`Redo${canRedo ? `: ${oplog!.entries[oplog!.pos].label}` : ""}${kbd("redo")}`} disabled={!canRedo} onClick={() => undo(true)}>
          <Redo2 /> Redo
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="tool" aria-label="Operation history" disabled={!oplog?.entries.length} />}>
            <History /> History
          </DropdownMenuTrigger>
          <DropdownMenuContent className="max-h-96 w-80 overflow-auto">
            {oplog?.entries
              .map((e, i) => ({ e, i }))
              .reverse()
              .map(({ e, i }) => (
                <DropdownMenuItem key={i} disabled className={`flex justify-between gap-2 opacity-100! ${i >= oplog.pos ? "text-muted-foreground line-through" : ""}`}>
                  <span className="truncate">{e.label}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{date(e.time)}</span>
                </DropdownMenuItem>
              ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="mx-1.5 h-7 w-px shrink-0 bg-border" />
        <div className="flex">
          <Button variant="ghost" size="tool" disabled={!!busy} onClick={actions.pull} title={`Pull${kbd("pull")}`}>
            <ArrowDownToLine /> Pull
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" className="self-center" aria-label="Pull options" disabled={!!busy} />}>
              <ChevronDown />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => run({ op: "pull", mode: "merge" }, "Pulled")}>Pull (fast-forward if possible)</DropdownMenuItem>
              <DropdownMenuItem onClick={() => run({ op: "pull", mode: "ff-only" }, "Pulled")}>Pull (fast-forward only)</DropdownMenuItem>
              <DropdownMenuItem onClick={() => run({ op: "pull", mode: "rebase" }, "Pulled")}>Pull (rebase)</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <Button variant="ghost" size="tool" disabled={!!busy} onClick={() => push()} title={`Push${kbd("push")}`}>
          <ArrowUpFromLine /> Push
        </Button>
        <Button variant="ghost" size="tool" disabled={!!busy} onClick={actions.fetch} title={`Fetch${kbd("fetch")}`}>
          <RefreshCw className={busy === "Fetched" ? "animate-spin" : ""} /> Fetch
        </Button>
        <span className="mx-1.5 h-7 w-px shrink-0 bg-border" />
        <Button variant="ghost" size="tool" onClick={actions.branch} title={`Create branch${kbd("branch")}`}>
          <GitBranchPlus /> Branch
        </Button>
        <Button variant="ghost" size="tool" disabled={!wip} onClick={stash} title={`Stash${kbd("stash")}`}>
          <Archive /> Stash
        </Button>
        <Button variant="ghost" size="tool" disabled={!refs?.stashes.length} onClick={actions.pop} title={`Pop stash${kbd("pop")}`}>
          <ArchiveRestore /> Pop
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="tool" />}>
            <Workflow /> Gitflow
          </DropdownMenuTrigger>
          <DropdownMenuContent className="min-w-64">
            {flow ? (
              <>
                <DropdownMenuItem onClick={() => flowStart("feature")}>Start feature…</DropdownMenuItem>
                <DropdownMenuItem onClick={() => flowStart("release")}>Start release…</DropdownMenuItem>
                <DropdownMenuItem onClick={() => flowStart("hotfix")}>Start hotfix…</DropdownMenuItem>
                <DropdownMenuItem disabled={!flowKind} onClick={flowFinish}>
                  {flowKind ? `Finish ${current}…` : "Finish (check out a Gitflow branch first)"}
                </DropdownMenuItem>
              </>
            ) : (
              <DropdownMenuItem onClick={flowInit}>Initialise Gitflow…</DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        {prs && (
          <Button variant="ghost" size="tool" onClick={() => createPr()}>
            <GitPullRequestCreate /> PR
          </Button>
        )}
        <Button variant="ghost" size="tool" onClick={actions.reflog} title={`Reflog${kbd("reflog")}`}>
          <History /> Reflog
        </Button>
        <Button variant="ghost" size="tool" onClick={actions.agents} title={`Agents${kbd("agents")}`}>
          <Bot /> Agents
        </Button>
        <Button variant="ghost" size="tool" aria-pressed={terminal} title={`Terminal${kbd("terminal")}`} onClick={actions.terminal}>
          <SquareTerminal /> Terminal
        </Button>
        {busy && (
          <span className="ml-2 flex min-w-0 items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
            <span className="truncate">{progress || "Working…"}</span>
            <Button size="xs" variant="outline" onClick={() => api.cancel()}>
              Cancel
            </Button>
          </span>
        )}
        <span className="min-w-3 flex-1" />
        <form onSubmit={onSearch} className="relative shrink-0">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            aria-label="Search commits by message, author or SHA"
            placeholder="Search commits"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            className="h-8 w-64 rounded-lg bg-panel-2 pl-8"
          />
        </form>
      </div>

      {inProgress && (
        <div role="status" className="flex items-center gap-3 border-b bg-[var(--diff-del)] px-3 py-1.5 text-sm">
          <span className="font-medium">{status!.state[0].toUpperCase() + status!.state.slice(1)} in progress</span>
          <span className="text-muted-foreground">
            {conflicts ? `${conflicts} conflicted file${conflicts === 1 ? "" : "s"}: open each to resolve it` : "No conflicts left"}
          </span>
          <span className="ml-auto flex gap-1">
            <Button size="xs" variant="outline" onClick={() => run({ op: "abort", state: status!.state })}>
              Abort
            </Button>
            <Button size="xs" disabled={conflicts > 0} onClick={() => run({ op: "continue", state: status!.state })}>
              Continue
            </Button>
          </span>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {sidebar && (
          <Sidebar
            refs={refs}
            extras={extras}
            prs={prs}
            hidden={new Set(view.hidden)}
            solo={view.solo}
            onToggleHidden={(name) =>
              setFilter({ ...view, hidden: view.hidden.includes(name) ? view.hidden.filter((h) => h !== name) : [...view.hidden, name] })
            }
            onClearSolo={() => setFilter({ ...view, solo: null })}
            onJump={select}
            onCheckout={(name) => run({ op: "checkout", name })}
            onCreatePr={() => createPr()}
            refMenu={refMenu}
            stashMenu={stashMenu}
            worktreeMenu={worktreeMenu}
            submoduleMenu={submoduleMenu}
            prMenu={prMenu}
            checks={checks}
          />
        )}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1">
            {center.kind === "diff" && (
              <DiffView
                root={root}
                target={center.target}
                path={center.path}
                version={center.target.kind === "commit" ? 0 : statusVersion}
                onClose={() => setCenter({ kind: "graph" })}
              />
            )}
            {center.kind === "conflict" && <ConflictView root={root} path={center.path} onClose={() => setCenter({ kind: "graph" })} />}
            {center.kind === "file" && (
              <FileView
                root={root}
                path={center.path}
                tab={center.tab}
                onTab={(tab) => setCenter({ ...center, tab })}
                onSelectCommit={select}
                onClose={() => setCenter({ kind: "graph" })}
              />
            )}
            {center.kind === "pr" && originUrl && (
              <PrView
                account={hostAccount}
                url={originUrl}
                pr={center.pr}
                onCheckout={() => run({ op: "checkout", name: center.pr.head })}
                onMerged={() => {
                  setCenter({ kind: "graph" });
                  loadPrs();
                  actions.fetch();
                }}
                onClose={() => setCenter({ kind: "graph" })}
              />
            )}
            {center.kind === "reflog" && (
              <ReflogView root={root} version={version} menu={reflogMenu} onSelectCommit={(id) => { setSelected(id); setMarked(new Map()); }} onClose={() => setCenter({ kind: "graph" })} />
            )}
            {agentsOpened && (
              <div className={center.kind === "agents" ? "flex min-h-0 min-w-0 flex-1" : "hidden"}>
                <AgentsView root={root} run={run} onOpenRepo={onOpenRepo} onClose={() => setCenter({ kind: "graph" })} />
              </div>
            )}
            <div className={center.kind === "graph" ? "flex min-h-0 min-w-0 flex-1" : "hidden"}>
              {opened ? (
                opened.total === 0 && (view.solo || view.hidden.length) ? (
                  <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                    Every branch is hidden.
                    <Button size="sm" variant="outline" onClick={() => setFilter({ hidden: [], solo: null })}>
                      Show all branches
                    </Button>
                  </div>
                ) : (
                  <Graph
                    root={root}
                    opened={opened}
                    version={version}
                    wip={wip}
                    selected={selected}
                    marked={new Set(marked.keys())}
                    onSelect={onGraphSelect}
                    jump={jump}
                    rowMenu={rowMenu}
                    refMenu={refMenu}
                    wipMenu={wipMenu}
                    onDropRef={onDropRef}
                    onOpenRef={onOpenRef}
                    checks={checks}
                    avatars={avatars}
                  />
                )
              ) : (
                <p className="p-4 text-sm text-muted-foreground">Loading history…</p>
              )}
            </div>
          </div>
          {terminal && (
            <div className="h-64 shrink-0 border-t">
              <TerminalPanel root={root} />
            </div>
          )}
        </div>
        <aside className={center.kind === "agents" || center.kind === "pr" ? "hidden" : "flex w-96 shrink-0 flex-col border-l bg-panel"} aria-label="Details">
          {marked.size > 1 ? (
            <div className="grid gap-2 p-3 text-sm">
              <p className="font-medium">{marked.size} commits selected</p>
              <Button size="sm" onClick={() => run({ op: "cherry-pick", ids: byIndex(false) }, "Cherry-picked")}>
                Cherry-pick onto {current ?? "HEAD"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => run({ op: "revert", ids: byIndex(true) }, "Reverted")}>
                Revert all
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setMarked(new Map())}>
                Clear selection
              </Button>
            </div>
          ) : selected === "wip" && status ? (
            <WorkPanel
              root={root}
              status={status}
              open={center.kind === "diff" ? center : null}
              onOpen={(target, path) => setCenter({ kind: "diff", target, path })}
              onConflict={(path) => setCenter({ kind: "conflict", path })}
              fileMenu={fileMenu}
              run={run}
            />
          ) : selected ? (
            <CommitPanel
              root={root}
              id={selected}
              open={center.kind === "diff" ? center : null}
              onOpen={(target, path) => setCenter({ kind: "diff", target, path })}
              onSelect={select}
              fileMenu={fileMenu}
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
              Select a commit to see its details.
              {wip > 0 && (
                <Button size="sm" variant="outline" onClick={() => setSelected("wip")}>
                  Review {wip} changed file{wip === 1 ? "" : "s"}
                </Button>
              )}
            </div>
          )}
          {center.kind !== "graph" && (
            <Button variant="ghost" size="sm" className="m-2 self-start" onClick={() => setCenter({ kind: "graph" })}>
              <X /> Back to graph
            </Button>
          )}
        </aside>
      </div>
      <StatusBar root={root} fetched={extras?.fetched} urls={refs?.urls} />
      {drop && (
        <DropMenu
          at={drop.at}
          title={
            <>
              Dropped on {drop.target.name}
              {drop.counts && ` · ${drop.counts[0]} commit${drop.counts[0] === 1 ? "" : "s"} ahead, ${drop.counts[1]} behind`}
            </>
          }
          items={dropItems(drop.src, drop.target)}
          undoKey={prettyCombo(settings.shortcuts.undo ?? "mod+z")}
          onClose={closeDrop}
        />
      )}
      {rebaseBase && (
        <RebaseDialog
          root={root}
          base={rebaseBase.base}
          onClose={() => setRebaseBase(null)}
          onDone={() => {
            setRebaseBase(null);
            refreshAll();
          }}
        />
      )}
      <Palette open={palette !== null} initial={palette ?? ""} onOpenChange={(o) => !o && setPalette(null)} items={paletteItems} />
    </div>
  );
}
