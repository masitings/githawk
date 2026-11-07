import { useSyncExternalStore } from "react";
import { api, type AiTask, type MergeMethod, type Server } from "@/lib/api";

export type Profile = {
  id: string;
  name: string;
  gitName: string;
  gitEmail: string;
  signingKey: string;
  azureOrg: string;
};

export type Settings = {
  theme: "system" | "light" | "dark";
  profiles: Profile[];
  active: string;
  shortcuts: Record<string, string>;
  /** Minutes between background fetches; 0 turns it off. */
  autoFetch: number;
  ai: { provider: "anthropic" | "openai"; model: string; baseUrl: string };
  /** Self-hosted GitHub Enterprise, GitLab and Bitbucket Data Center servers. */
  servers: Server[];
  prMerge: MergeMethod;
  showChecks: boolean;
  terminal: TerminalPrefs;
};

export type TerminalPrefs = {
  font: string;
  fontSize: number;
  lineHeight: number;
  cursor: "block" | "bar" | "underline";
  blink: boolean;
  dimUnfocused: boolean;
};

export const ACTIONS: Record<string, string> = {
  palette: "Command palette",
  files: "Find file",
  undo: "Undo",
  redo: "Redo",
  fetch: "Fetch",
  pull: "Pull",
  push: "Push",
  branch: "Create branch",
  stash: "Stash changes",
  pop: "Pop stash",
  terminal: "Toggle terminal",
  reflog: "Reflog and command log",
  agents: "Agent sessions",
  sidebar: "Toggle sidebar",
  search: "Search commits",
  settings: "Settings",
};

export const DEFAULT_SHORTCUTS: Record<string, string> = {
  palette: "mod+k",
  files: "mod+p",
  undo: "mod+z",
  redo: "mod+shift+z",
  fetch: "mod+shift+f",
  pull: "mod+shift+l",
  push: "mod+shift+u",
  branch: "mod+b",
  stash: "mod+shift+s",
  pop: "mod+shift+o",
  terminal: "ctrl+`",
  reflog: "mod+shift+r",
  agents: "mod+shift+a",
  sidebar: "mod+shift+b",
  search: "mod+f",
  settings: "mod+,",
};

const DEFAULT: Settings = {
  theme: "system",
  profiles: [{ id: "default", name: "Default", gitName: "", gitEmail: "", signingKey: "", azureOrg: "" }],
  active: "default",
  shortcuts: DEFAULT_SHORTCUTS,
  autoFetch: 0,
  ai: { provider: "anthropic", model: "claude-opus-5-5", baseUrl: "" },
  servers: [],
  prMerge: "merge",
  showChecks: true,
  terminal: { font: "JetBrains Mono Variable", fontSize: 12, lineHeight: 1, cursor: "block", blink: true, dimUnfocused: false },
};

const KEY = "githawk.settings";

function read(): Settings {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return s ? { ...DEFAULT, ...s, shortcuts: { ...DEFAULT_SHORTCUTS, ...s.shortcuts }, ai: { ...DEFAULT.ai, ...s.ai }, terminal: { ...DEFAULT.terminal, ...s.terminal } } : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

let current = read();
const listeners = new Set<() => void>();

export function getSettings() {
  return current;
}

export function setSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* storage unavailable: settings last for this session only */
  }
  applySettings();
  listeners.forEach((l) => l());
}

export function useSettings() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

export const activeProfile = (s = current) => s.profiles.find((p) => p.id === s.active) ?? s.profiles[0];
/** Keychain account for a provider ("github"), a self-hosted server's host, or "ai-anthropic". */
export const account = (key: string, s = current) => `${activeProfile(s).id}/${key}`;

export const aiRun = (root: string, task: AiTask) =>
  api.ai(root, { ...current.ai, account: account(`ai-${current.ai.provider}`) }, task);

const dark = matchMedia("(prefers-color-scheme: dark)");

export function applySettings() {
  const t = current.theme;
  document.documentElement.classList.toggle("dark", t === "dark" || (t === "system" && dark.matches));
  const p = activeProfile();
  api.setIdentity(p.gitName, p.gitEmail, p.signingKey).catch(() => {});
  api.setServers(current.servers).catch(() => {});
}
dark.addEventListener("change", applySettings);

const isMac = navigator.platform.toLowerCase().includes("mac");

export function comboOf(e: KeyboardEvent): string {
  const parts = [];
  if (isMac ? e.metaKey : e.ctrlKey) parts.push("mod");
  if (isMac && e.ctrlKey) parts.push("ctrl");
  if (e.altKey) parts.push("alt");
  if (e.shiftKey) parts.push("shift");
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
  if (!["meta", "control", "alt", "shift"].includes(k)) parts.push(e.code === "Backquote" ? "`" : k);
  return parts.join("+");
}

export function prettyCombo(combo: string) {
  return combo
    .split("+")
    .map((p) => (p === "mod" ? (isMac ? "⌘" : "Ctrl") : p === "shift" ? (isMac ? "⇧" : "Shift") : p === "alt" ? (isMac ? "⌥" : "Alt") : p === "ctrl" ? "Ctrl" : p.toUpperCase()))
    .join(isMac ? "" : "+");
}

export function actionFor(e: KeyboardEvent): string | null {
  const combo = comboOf(e);
  return Object.entries(current.shortcuts).find(([, c]) => c === combo)?.[0] ?? null;
}
