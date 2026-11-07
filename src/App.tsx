import { useEffect, useRef, useState } from "react";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { open as pickFolder } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Toaster, toast } from "sonner";
import { Bug, Check, ChevronDown, FolderGit2, FolderOpen, GitBranchPlus, Plus, Settings, UserRound, X, DownloadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { api, type Opened } from "@/lib/api";
import { ask, PromptHost } from "@/lib/prompt";
import { RepoView } from "@/components/RepoView";
import { PROVIDERS, ProfilePhoto, SettingsView, type SettingsSection } from "@/components/SettingsView";
import { CloneDialog } from "@/components/CloneDialog";
import { checkForUpdate, reportProblem } from "@/lib/update";
import { account, actionFor, activeProfile, setSettings, useSettings } from "@/lib/settings";

type Tab = { root: string; alias: string };

const load = (key: string): Tab[] => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "[]");
  } catch {
    return [];
  }
};
const save = (key: string, value: Tab[]) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: tabs just won't persist */
  }
};
const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

export default function App() {
  const [tabs, setTabs] = useState<Tab[]>(() => load("githawk.tabs"));
  const [recents, setRecents] = useState<Tab[]>(() => load("githawk.recents"));
  const [active, setActive] = useState<string | null>(() => load("githawk.tabs")[0]?.root ?? null);
  const [opened, setOpened] = useState<Record<string, Opened>>({});
  const [progress, setProgress] = useState("");
  const [settingsPage, setSettingsPage] = useState<SettingsSection | null>(null);
  const settingsOpen = settingsPage !== null;
  const setSettingsOpen = (open: boolean, page: SettingsSection = "general") => setSettingsPage(open ? page : null);
  const prefs = useSettings();
  const profile = activeProfile(prefs);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [goto, setGoto] = useState<{ root: string; ref: string; n: number } | null>(null);
  const [gitOk, setGitOk] = useState<boolean | null>(null);
  const checkGit = () => api.gitVersion().then((v) => setGitOk(!!v), () => setGitOk(false));

  useEffect(() => {
    checkGit();
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV) checkForUpdate();
  }, []);
  useEffect(() => save("githawk.tabs", tabs), [tabs]);
  useEffect(() => save("githawk.recents", recents), [recents]);
  useEffect(() => {
    const a = listen<string>("git-progress", (e) => setProgress(e.payload));
    const b = listen<string>("watcher-error", (e) => toast.error(`File watcher stopped: ${e.payload}`));
    const onKey = (e: KeyboardEvent) => {
      if (actionFor(e) === "settings") {
        e.preventDefault();
        setSettingsOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      a.then((f) => f());
      b.then((f) => f());
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  async function openLinks(urls: string[] | null) {
    for (const raw of urls ?? []) {
      let url: URL;
      try {
        url = new URL(raw);
      } catch {
        continue;
      }
      const path = url.searchParams.get("path");
      if (url.protocol !== "githawk:" || url.hostname !== "open" || !path) {
        toast.error(`Unsupported link: ${raw}`);
        continue;
      }
      const root = await openPathRef.current(path);
      const ref = url.searchParams.get("ref");
      if (root && ref) setGoto({ root, ref, n: Date.now() });
    }
  }

  const openPathRef = useRef(openPath);
  openPathRef.current = openPath;
  useEffect(() => {
    getCurrent().then(openLinks).catch(() => {});
    const un = onOpenUrl(openLinks);
    return () => {
      un.then((f) => f()).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openPath(path: string): Promise<string | null> {
    try {
      const o = await api.open(path);
      setOpened((m) => ({ ...m, [o.root]: o }));
      const existing = tabs.find((t) => t.root === o.root);
      const tab = existing ?? recents.find((t) => t.root === o.root) ?? { root: o.root, alias: baseName(o.root) };
      if (!existing) setTabs((t) => [...t, tab]);
      setRecents((r) => [tab, ...r.filter((x) => x.root !== tab.root)].slice(0, 15));
      setActive(o.root);
      return o.root;
    } catch (e) {
      toast.error(String(e));
      return null;
    }
  }

  async function openDialog() {
    const dir = await pickFolder({ directory: true, title: "Open repository" });
    if (dir) await openPath(dir);
  }

  async function cloneFrom(url: string) {
    const parent = await pickFolder({ directory: true, title: "Clone into folder" });
    if (!parent) return;
    setCloneOpen(false);
    const t = toast.loading("Cloning…");
    try {
      const dest = await api.clone(url, parent);
      toast.success("Cloned", { id: t });
      await openPath(dest);
    } catch (e) {
      toast.error(String(e), { id: t });
    }
  }

  async function initDialog() {
    const dir = await pickFolder({ directory: true, title: "Create repository in folder" });
    if (!dir) return;
    try {
      await api.init(dir);
      await openPath(dir);
    } catch (e) {
      toast.error(String(e));
    }
  }

  function closeTab(root: string) {
    const rest = tabs.filter((t) => t.root !== root);
    setTabs(rest);
    if (active === root) setActive(rest[0]?.root ?? null);
    api.close(root);
  }

  async function renameTab(tab: Tab) {
    const r = await ask({ title: "Rename tab", fields: [{ name: "alias", label: "Alias", value: tab.alias }] });
    if (!r) return;
    const alias = r.text.alias.trim();
    const upd = (list: Tab[]) => list.map((t) => (t.root === tab.root ? { ...t, alias } : t));
    setTabs(upd);
    setRecents(upd);
  }

  if (gitOk === false) return <MissingGit onRetry={checkGit} />;

  return (
    <TooltipProvider>
      <div className="flex h-screen flex-col bg-background text-foreground">
        <nav className="flex h-10 shrink-0 items-end gap-1 overflow-x-auto bg-background px-3" aria-label="Repositories">
          <span className="flex h-10 shrink-0 items-center pr-3 text-sm font-bold tracking-[0.2px]">GitHawk</span>
          {tabs.map((t) => (
            <div
              key={t.root}
              className={`group flex h-8 max-w-56 items-center gap-1 rounded-t-lg px-3 text-[12.5px] ${
                active === t.root && !settingsOpen ? "bg-panel" : "text-muted-foreground hover:bg-panel/60"
              }`}
            >
              <button
                className="truncate"
                title={t.root}
                onClick={() => {
                  setActive(t.root);
                  setSettingsOpen(false);
                }}
                onDoubleClick={() => renameTab(t)}
              >
                {t.alias}
              </button>
              <button
                aria-label={`Close ${t.alias}`}
                className="rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-raised focus-visible:opacity-100"
                onClick={() => closeTab(t.root)}
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="New tab"
            className="mb-1 text-muted-foreground"
            onClick={() => {
              setActive(null);
              setSettingsOpen(false);
            }}
          >
            <Plus />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button className="mb-[7px] ml-auto flex h-[26px] shrink-0 items-center gap-1.5 rounded-full border bg-panel-2 px-2.5 text-xs hover:bg-raised focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none" />
              }
            >
              <ProfilePhoto email={profile.gitEmail} className="-ml-1.5 size-[18px]">
                <UserRound className="size-3.5 text-muted-foreground" />
              </ProfilePhoto>
              Profile: {profile.name}
              <ChevronDown className="size-3 text-muted-foreground" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-48">
              {prefs.profiles.map((p) => (
                <DropdownMenuItem key={p.id} onClick={() => setSettings({ active: p.id })}>
                  <Check className={p.id === prefs.active ? "" : "invisible"} aria-hidden />
                  {p.name}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setSettingsOpen(true, "profiles")}>Manage profiles…</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="ghost" size="icon-sm" aria-label="Report a problem" title="Report a problem" className="mb-1.5 text-muted-foreground" onClick={() => reportProblem()}>
            <Bug />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Settings" aria-pressed={settingsOpen} className="mb-1.5 text-muted-foreground" onClick={() => setSettingsOpen(!settingsOpen)}>
            <Settings />
          </Button>
        </nav>

        {tabs.map((t) => (
          <div key={t.root} className={active === t.root && !settingsOpen ? "flex min-h-0 flex-1" : "hidden"}>
            <RepoView
              root={t.root}
              initial={opened[t.root]}
              progress={progress}
              active={active === t.root}
              goto={goto?.root === t.root ? goto : undefined}
              onOpenRepo={openPath}
              onOpenSettings={() => setSettingsOpen(true)}
            />
          </div>
        ))}

        {settingsPage && <SettingsView key={settingsPage} initial={settingsPage} onClose={() => setSettingsOpen(false)} />}

        {active === null && !settingsOpen && (
          <main className="flex flex-1 justify-center overflow-auto px-6 py-12">
            <div className="flex w-full max-w-[1080px] flex-col gap-7">
              <div>
                <h1 className="text-[28px] leading-[34px] font-bold tracking-[-0.3px]">Welcome to GitHawk</h1>
                <p className="mt-0.5 text-[14px] text-muted-foreground">Open a repository to get started. Everything stays on this machine.</p>
              </div>
              <div className="flex flex-wrap gap-3.5">
                {[
                  { icon: FolderOpen, title: "Open repository", text: "Pick a folder that already has a .git directory.", run: openDialog },
                  { icon: DownloadCloud, title: "Clone", text: "From a URL, or browse repositories on a connected provider.", run: () => setCloneOpen(true) },
                  { icon: GitBranchPlus, title: "Init new repository", text: "Create an empty repository in a folder.", run: initDialog },
                ].map((c) => (
                  <button
                    key={c.title}
                    onClick={c.run}
                    className="flex flex-[1_1_200px] flex-col items-start gap-2 rounded-xl border bg-panel p-[18px] text-left hover:bg-panel-2 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                  >
                    <span className="inline-flex size-9 items-center justify-center rounded-[9px] bg-raised text-primary">
                      <c.icon className="size-[18px]" aria-hidden />
                    </span>
                    <span className="text-[14px] font-semibold">{c.title}</span>
                    <span className="text-[12.5px] leading-[18px] text-muted-foreground">{c.text}</span>
                  </button>
                ))}
              </div>
              {progress && <p className="truncate text-xs text-muted-foreground">{progress}</p>}
              <div className="flex flex-wrap items-start gap-5">
                <section className="min-w-0 flex-[999_1_540px] rounded-xl border bg-panel p-2">
                  <h2 className="px-3 pt-2 pb-2.5 text-[14px] font-bold">Recent repositories</h2>
                  {recents.map((r) => (
                    <div key={r.root} className="group flex items-center rounded-lg hover:bg-raised">
                      <button className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left" onClick={() => openPath(r.root)}>
                        <FolderGit2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="min-w-0">
                          <span className="block truncate font-semibold">{r.alias}</span>
                          <span className="block truncate text-xs text-dim">{r.root}</span>
                        </span>
                      </button>
                      <button
                        aria-label={`Remove ${r.alias} from recent`}
                        className="mr-2 rounded p-1 opacity-0 group-hover:opacity-100 hover:bg-panel-2 focus-visible:opacity-100"
                        onClick={() => setRecents(recents.filter((x) => x.root !== r.root))}
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  ))}
                  {!recents.length && <p className="px-3 pb-3 text-sm text-dim">Repositories you open show up here.</p>}
                </section>
                <WelcomeSide onSettings={(page) => setSettingsOpen(true, page)} />
              </div>
            </div>
          </main>
        )}
      </div>
      <CloneDialog open={cloneOpen} onOpenChange={setCloneOpen} onClone={cloneFrom} />
      <PromptHost />
      <Toaster richColors theme="system" position="bottom-right" />
    </TooltipProvider>
  );
}

function WelcomeSide({ onSettings }: { onSettings: (page: SettingsSection) => void }) {
  const prefs = useSettings();
  const profile = activeProfile(prefs);
  const [connected, setConnected] = useState<Record<string, boolean>>({});
  useEffect(() => {
    Promise.all(PROVIDERS.map((p) => api.hasToken(account(p.id)).catch(() => false))).then((r) =>
      setConnected(Object.fromEntries(PROVIDERS.map((p, i) => [p.id, r[i]]))),
    );
  }, [prefs.active]);

  return (
    <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-4">
      <section className="rounded-xl border bg-panel px-4 pt-3.5 pb-1.5">
        <h2 className="text-[14px] font-bold">Hosting providers</h2>
        <p className="pt-0.5 pb-1.5 text-xs text-dim">Used for clone, pull requests and checks</p>
        {PROVIDERS.map((p) => (
          <div key={p.id} className="flex items-center gap-2.5 border-b py-2 last:border-b-0">
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">{p.name}</span>
              <span className="flex items-center gap-1.5 text-xs text-dim">
                <span aria-hidden className={`size-[7px] rounded-full ${connected[p.id] ? "bg-[var(--lane-3)]" : "bg-dim/50"}`} />
                {connected[p.id] ? "Connected" : "Not connected"}
              </span>
            </span>
            {!connected[p.id] && (
              <Button variant="outline" size="sm" onClick={() => onSettings("integrations")}>
                Connect
              </Button>
            )}
          </div>
        ))}
      </section>
      <section className="flex flex-col gap-2 rounded-xl border bg-panel px-4 py-3.5">
        <h2 className="text-[14px] font-bold">Profile</h2>
        <div className="flex items-center gap-2.5">
          <span aria-hidden className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border-2 border-[var(--lane-0)] bg-raised text-xs font-semibold">
            {(profile.name.trim()[0] ?? "?").toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold">{profile.name}</div>
            <div className="truncate text-xs text-dim">
              {profile.gitEmail || "Uses git config identity"}
              {profile.signingKey && " · signing on"}
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => onSettings("profiles")}>
            Manage
          </Button>
        </div>
      </section>
    </div>
  );
}

function MissingGit({ onRetry }: { onRetry: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const ua = navigator.userAgent;
  const how = /Windows/.test(ua)
    ? ["Install Git for Windows, or run this in a terminal:", "winget install --id Git.Git -e"]
    : /Mac/.test(ua)
      ? ["Install the Xcode Command Line Tools, or Git from Homebrew:", "xcode-select --install"]
      : ["Install Git with your package manager, for example:", "sudo apt install git"];
  return (
    <main className="flex h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center text-foreground">
      <FolderGit2 className="size-10 text-muted-foreground" aria-hidden />
      <h1 className="text-lg font-semibold">Git is not installed</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        GitHawk runs the git on your computer, so hooks, signing and credentials work the same as in your terminal. {how[0]}
      </p>
      <code className="rounded-md border bg-panel-2 px-3 py-1.5 font-mono text-[12.5px] select-all">{how[1]}</code>
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => openUrl("https://git-scm.com/downloads")}>
          Download Git
        </Button>
        <Button
          disabled={busy}
          onClick={() => {
            setBusy(true);
            onRetry().finally(() => setBusy(false));
          }}
        >
          Check again
        </Button>
      </div>
      <p className="max-w-md text-xs text-dim">Already installed? Make sure git is on your PATH, then check again.</p>
    </main>
  );
}
