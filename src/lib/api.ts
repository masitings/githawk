import { invoke } from "@tauri-apps/api/core";

export type Edge = { from: number; to: number; color: number };
export type RefLabel = { name: string; kind: "local" | "remote" | "tag"; head: boolean };
export type Row = {
  id: string;
  parents: string[];
  summary: string;
  author: string;
  time: number;
  refs: RefLabel[];
  head: boolean;
  col: number;
  color: number;
  edges: Edge[];
};
export type Opened = { root: string; total: number; head: number | null };
export type FileStatus = {
  path: string;
  staged: string | null;
  unstaged: string | null;
  conflicted: boolean;
};
export type Status = { files: FileStatus[]; state: string; branch: string | null };
export type Line = { origin: " " | "+" | "-"; old: number | null; new: number | null; text: string };
export type Hunk = { header: string; lines: Line[] };
export type FileDiff = {
  path: string;
  old_path: string | null;
  status: string;
  binary: boolean;
  hunks: Hunk[];
};
export type CommitInfo = {
  id: string;
  parents: string[];
  author: string;
  email: string;
  time: number;
  committer: string;
  message: string;
};
export type Branch = {
  name: string;
  tip: string;
  head: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
};
export type Named = { name: string; tip: string };
export type Stash = { index: number; message: string; tip: string };
export type Refs = {
  local: Branch[];
  remote: Named[];
  remotes: string[];
  urls: Record<string, string>;
  tags: Named[];
  stashes: Stash[];
};
export type Target = { kind: "commit"; id: string } | { kind: "staged" } | { kind: "unstaged" };
export type Mode = "stage" | "unstage" | "discard";

export type Op =
  | { op: "checkout"; name: string }
  | { op: "checkout-detached"; id: string }
  | { op: "create-branch"; name: string; at: string; checkout: boolean }
  | { op: "rename-branch"; old: string; new: string }
  | { op: "delete-branch"; name: string; force: boolean }
  | { op: "delete-remote-branch"; remote: string; name: string }
  | { op: "set-upstream"; branch: string; upstream: string }
  | { op: "fetch" }
  | { op: "pull"; mode: "merge" | "ff-only" | "rebase" }
  | { op: "push"; remote: string; branch: string; force: boolean; setUpstream: boolean }
  | { op: "merge"; name: string }
  | { op: "rebase"; onto: string }
  | { op: "abort"; state: string }
  | { op: "continue"; state: string }
  | { op: "stash-save"; message: string; untracked: boolean }
  | { op: "stash-apply"; index: number }
  | { op: "stash-pop"; index: number }
  | { op: "stash-drop"; index: number }
  | { op: "tag"; name: string; at: string; message: string }
  | { op: "delete-tag"; name: string }
  | { op: "push-tag"; remote: string; name: string }
  | { op: "stage"; paths: string[] }
  | { op: "unstage"; paths: string[] }
  | { op: "discard"; tracked: string[]; untracked: string[] }
  | { op: "commit"; summary: string; description: string; amend: boolean; sign: boolean }
  | { op: "cherry-pick"; ids: string[] }
  | { op: "revert"; ids: string[] }
  | { op: "lfs-pull" }
  | { op: "submodule-update" }
  | { op: "worktree-add"; path: string; branch: string; create: boolean }
  | { op: "worktree-remove"; path: string; force: boolean }
  | { op: "reset"; id: string; mode: "soft" | "mixed" | "hard" }
  | { op: "flow-init"; main: string; develop: string; createDevelop: boolean }
  | { op: "flow-finish"; branch: string; into: string[]; tag: string | null };

export type Snapshot = { head: string; refs: Record<string, string> };
export type OpEntry = { label: string; soft: boolean; time: number; before: Snapshot; after: Snapshot };
export type OpLog = { entries: OpEntry[]; pos: number };
export type TodoItem = { id: string; summary: string; message: string };
export type Step = { action: string; id: string; message: string };
export type Conflict = { base: string | null; ours: string | null; theirs: string | null; merged: string };
export type FileCommit = { id: string; author: string; time: number; summary: string; path: string };
export type BlameLine = { id: string; author: string; time: number; text: string };
export type ReflogEntry = { id: string; old: string; message: string; time: number };
export type Worktree = { path: string; branch: string | null; head: string; main: boolean };
export type Submodule = { name: string; path: string; url: string | null; expected: string | null; actual: string | null };
export type Flow = { main: string; develop: string; feature: string; release: string; hotfix: string; tag: string };
export type Extras = { worktrees: Worktree[]; submodules: Submodule[]; lfs: boolean; flow: Flow | null };
export type Signature = { status: string; signer: string };
export type Provider = "github" | "gitlab" | "bitbucket" | "azure" | "bitbucket-server";
export type Server = { host: string; kind: "github" | "gitlab" | "bitbucket-server" };
export type LineComment = { path: string; line: number; origin: string; body: string };
export type Review = { event: "approve" | "request-changes" | "comment"; body: string; comments: LineComment[] };
export type HostRepo = { name: string; https: string; ssh: string; private: boolean };
export type Pr = { number: number; title: string; author: string; head: string; base: string; url: string; draft: boolean };

export type AiTask = { kind: "commit-message" } | { kind: "explain"; id: string } | { kind: "changelog"; from: string; to: string };
export type AiConfig = { provider: string; model: string; baseUrl: string; account: string };

export const api = {
  open: (path: string, hidden: string[] = [], solo: string | null = null) =>
    invoke<Opened>("open_repo", { path, hidden, solo }),
  close: (root: string) => invoke<void>("close_repo", { root }),
  page: (root: string, skip: number, limit: number) => invoke<Row[]>("graph_page", { root, skip, limit }),
  findRow: (root: string, id: string) => invoke<number | null>("find_row", { root, id }),
  search: (root: string, query: string) => invoke<number[]>("search", { root, query }),
  status: (root: string) => invoke<Status>("status", { root }),
  refs: (root: string) => invoke<Refs>("refs", { root }),
  diff: (root: string, target: Target, file?: string) =>
    invoke<FileDiff[]>("diff", { root, target, file: file ?? null }),
  commit: (root: string, id: string) => invoke<CommitInfo>("commit_info", { root, id }),
  blob: (root: string, rev: string, file: string) => invoke<ArrayBuffer>("blob", { root, rev, file }),
  applyLines: (root: string, file: string, mode: Mode, selected: [number, number][]) =>
    invoke<void>("apply_lines", { root, file, mode, selected }),
  run: (root: string, op: Op) => invoke<void>("run_op", { root, op }),
  clone: (url: string, parent: string) => invoke<string>("clone_repo", { url, parent }),
  init: (path: string) => invoke<void>("init_repo", { path }),
  cancel: () => invoke<void>("cancel"),
  watch: (root: string) => invoke<void>("watch", { root }),
  undo: (root: string) => invoke<string>("undo", { root }),
  redo: (root: string) => invoke<string>("redo", { root }),
  oplog: (root: string) => invoke<OpLog>("oplog", { root }),
  rebaseTodo: (root: string, base: string | null) => invoke<TodoItem[]>("rebase_todo", { root, base }),
  rebase: (root: string, base: string | null, steps: Step[] | null, raw: string | null) =>
    invoke<void>("interactive_rebase", { root, base, steps, raw }),
  conflict: (root: string, file: string) => invoke<Conflict>("conflict", { root, file }),
  resolve: (root: string, file: string, content: string) => invoke<void>("resolve", { root, file, content }),
  history: (root: string, file: string) => invoke<FileCommit[]>("history", { root, file }),
  blame: (root: string, file: string) => invoke<BlameLine[]>("blame", { root, file }),
  reflog: (root: string) => invoke<ReflogEntry[]>("reflog", { root }),
  files: (root: string) => invoke<string[]>("files", { root }),
  extras: (root: string) => invoke<Extras>("extras", { root }),
  signature: (root: string, id: string) => invoke<Signature>("signature", { root, id }),
  setIdentity: (name: string, email: string, signingKey: string) =>
    invoke<void>("set_identity", { name, email, signingKey }),
  termOpen: (root: string, cols: number, rows: number) => invoke<number>("term_open", { root, cols, rows }),
  termWrite: (id: number, data: string) => invoke<void>("term_write", { id, data }),
  termResize: (id: number, cols: number, rows: number) => invoke<void>("term_resize", { id, cols, rows }),
  termClose: (id: number) => invoke<void>("term_close", { id }),
  saveToken: (account: string, token: string) => invoke<void>("hosting_save_token", { account, token }),
  deleteToken: (account: string) => invoke<void>("hosting_delete_token", { account }),
  hasToken: (account: string) => invoke<boolean>("hosting_has_token", { account }),
  hostRepos: (key: string, account: string) => invoke<HostRepo[]>("hosting_repos", { key, account }),
  detect: (url: string) => invoke<{ provider: Provider; path: string; key: string } | null>("hosting_detect", { url }),
  setServers: (servers: Server[]) => invoke<void>("hosting_set_servers", { servers }),
  prDiff: (account: string, url: string, number: number) => invoke<string>("hosting_pr_diff", { account, url, number }),
  review: (account: string, url: string, number: number, review: Review) => invoke<void>("hosting_review", { account, url, number, review }),
  prs: (account: string, url: string) => invoke<Pr[]>("hosting_prs", { account, url }),
  createPr: (account: string, url: string, pr: { title: string; body: string; head: string; base: string }) =>
    invoke<string>("hosting_create_pr", { account, url, pr }),
  ai: (root: string, config: AiConfig, task: AiTask) => invoke<string>("ai_run", { root, config, task }),
};

export const short = (id: string) => id.slice(0, 7);
export const lane = (i: number) => `var(--lane-${i % 8})`;
export const date = (t: number) =>
  new Date(t * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
