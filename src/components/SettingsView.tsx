import { useEffect, useState, type ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { Copy, ExternalLink, KeyRound, Upload, Pencil, Plus, Search, Settings as Gear, ShieldCheck, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { api, type GpgKey, type Provider, type Server, type SshKey } from "@/lib/api";
import { ACTIONS, DEFAULT_SHORTCUTS, account, activeProfile, comboOf, getSettings, prettyCombo, setSettings, useSettings, type Profile } from "@/lib/settings";
import { ask, confirm } from "@/lib/prompt";

type Keyed = { id: string; name: string; url: string; hint: string };

export const PROVIDERS: (Keyed & { id: Provider })[] = [
  {
    id: "github",
    name: "GitHub",
    url: "https://github.com/settings/tokens/new?scopes=repo,write:public_key&description=GitHawk",
    hint: "Token with the repo and write:public_key scopes",
  },
  {
    id: "gitlab",
    name: "GitLab",
    url: "https://gitlab.com/-/user_settings/personal_access_tokens?name=GitHawk&scopes=api",
    hint: "Personal access token with the api scope",
  },
  {
    id: "bitbucket",
    name: "Bitbucket",
    url: "https://bitbucket.org/account/settings/app-passwords/new",
    hint: "username:app_password, or an access token",
  },
  {
    id: "azure",
    name: "Azure DevOps",
    url: "https://dev.azure.com/",
    hint: "Personal access token with Code (read & write)",
  },
];

const AI_KEYS: Record<"anthropic" | "openai", Keyed> = {
  anthropic: { id: "ai-anthropic", name: "API key", url: "https://platform.claude.com/settings/keys", hint: "Paste your API key" },
  openai: { id: "ai-openai", name: "API key", url: "https://platform.openai.com/api-keys", hint: "Leave empty for local servers" },
};

const SECTIONS = [
  ["general", "General", "theme appearance dark light fetch background"],
  ["profiles", "Profiles", "author name email signing key identity azure organisation"],
  ["integrations", "Integrations", "github gitlab bitbucket azure token server enterprise self-hosted pull request merge checks ci"],
  ["keys", "SSH, GPG and HTTPS", "ssh key generate gpg signing credential helper https password"],
  ["git", "Git", "default branch pull rebase prune upstream line endings autocrlf sign version"],
  ["ai", "AI assistant", "anthropic openai ollama model key commit message explain changelog"],
  ["shortcuts", "Keyboard shortcuts", "keys hotkeys keyboard"],
] as const;
export type SettingsSection = (typeof SECTIONS)[number][0];

const control = "h-8 rounded-[7px] border bg-panel-2 px-2.5 text-[12.5px] text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50";
const kbd = "rounded-[4px] border bg-panel-2 px-1.5 py-px font-mono text-[11px] text-muted-foreground";

export function SettingsView({ initial = "general", onClose }: { initial?: SettingsSection; onClose: () => void }) {
  const s = useSettings();
  const profile = activeProfile(s);
  const [section, setSection] = useState<SettingsSection>(initial);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !e.defaultPrevented && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const q = query.trim().toLowerCase();
  const nav = SECTIONS.filter(([, label, words]) => !q || `${label} ${words}`.toLowerCase().includes(q));
  const updateProfile = (patch: Partial<Profile>) =>
    setSettings({ profiles: s.profiles.map((p) => (p.id === profile.id ? { ...p, ...patch } : p)) });

  return (
    <div className="flex min-h-0 flex-1 bg-panel">
      <aside aria-label="Settings sections" className="flex w-60 shrink-0 flex-col border-r px-2.5 py-[18px]">
        <div className="flex items-center gap-2 px-1.5 pb-3.5">
          <Gear className="size-4 text-muted-foreground" aria-hidden />
          <b className="text-[14px]">Settings</b>
        </div>
        <label className="mx-0.5 mb-3 flex h-[30px] items-center gap-2 rounded-[7px] border bg-panel-2 px-2.5 text-dim focus-within:ring-3 focus-within:ring-ring/50">
          <Search className="size-3.5 shrink-0" aria-hidden />
          <input
            placeholder="Search settings"
            aria-label="Search settings"
            value={query}
            onChange={(e) => {
              setQuery(e.currentTarget.value);
              const v = e.currentTarget.value.trim().toLowerCase();
              const hit = SECTIONS.find(([, label, words]) => `${label} ${words}`.toLowerCase().includes(v));
              if (v && hit) setSection(hit[0]);
            }}
            className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-dim"
          />
        </label>
        <nav className="flex flex-col gap-0.5">
          {nav.map(([id, label]) => (
            <button
              key={id}
              aria-current={section === id ? "page" : undefined}
              onClick={() => setSection(id)}
              className={`flex h-[34px] items-center rounded-[7px] px-3 text-left text-sm ${
                section === id ? "bg-raised font-semibold text-foreground" : "text-muted-foreground hover:bg-panel-2"
              }`}
            >
              {label}
            </button>
          ))}
          {!nav.length && <p className="px-3 py-2 text-xs text-dim">No matching settings</p>}
        </nav>
        <div className="mx-1.5 mt-[18px] border-t pt-3.5 text-[11.5px] leading-[17px] text-dim">
          Profile: <b className="text-muted-foreground">{profile.name}</b>
          <br />
          Settings are stored on this device.
        </div>
      </aside>

      <main className="relative min-w-0 flex-1 overflow-y-auto bg-background">
        <Button variant="ghost" size="icon-sm" aria-label="Close settings" title="Close (Esc)" className="absolute top-4 right-4 text-muted-foreground" onClick={onClose}>
          <X />
        </Button>
        <div className="max-w-[760px] px-8 pt-7 pb-12">
          {section === "general" && (
            <>
              <Title title="General" text="Appearance and background activity." />
              <H3>Appearance</H3>
              <div role="radiogroup" aria-label="Theme" className="flex flex-wrap gap-3">
                {(
                  [
                    ["dark", "Dark", "#0F1113", "#15181C", "#2B313A"],
                    ["light", "Light", "#F4F5F7", "#FFFFFF", "#D8DDE3"],
                    ["system", "Match system", "linear-gradient(90deg, #0F1113 50%, #F4F5F7 50%)", "#15181C", "#8A929C"],
                  ] as const
                ).map(([id, label, bg, side, line]) => (
                  <button
                    key={id}
                    role="radio"
                    aria-checked={s.theme === id}
                    onClick={() => setSettings({ theme: id })}
                    className={`flex w-42 flex-col gap-2 rounded-[10px] border-2 bg-panel p-2 text-left focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none ${
                      s.theme === id ? "border-primary" : "border-border"
                    }`}
                  >
                    <span aria-hidden className="flex h-21 overflow-hidden rounded-md border" style={{ background: bg, borderColor: line }}>
                      <span className="w-[34px] border-r" style={{ background: side, borderColor: line }} />
                      <span className="flex flex-1 flex-col gap-[7px] p-2.5">
                        <span className="h-1.5 w-[70%] rounded-full bg-[#F4A62A]" />
                        <span className="h-1.5 w-[85%] rounded-full" style={{ background: line }} />
                        <span className="h-1.5 w-[55%] rounded-full" style={{ background: line }} />
                      </span>
                    </span>
                    <span className="px-0.5 text-[12.5px] font-medium">{label}</span>
                  </button>
                ))}
              </div>
              <H3>Repositories</H3>
              <Card>
                <Row label="Fetch in the background" text="Keeps remote branches and pull requests current">
                  <select aria-label="Fetch in the background" className={`${control} w-50`} value={s.autoFetch} onChange={(e) => setSettings({ autoFetch: Number(e.currentTarget.value) })}>
                    <option value={0}>Off</option>
                    <option value={5}>Every 5 minutes</option>
                    <option value={15}>Every 15 minutes</option>
                    <option value={60}>Every hour</option>
                  </select>
                </Row>
              </Card>
            </>
          )}

          {section === "profiles" && (
            <>
              <Title title="Profiles" text="Each profile keeps its own Git identity, signing key and connected providers." />
              <div className="mt-5 flex flex-col gap-2">
                {s.profiles.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 rounded-[10px] border bg-panel px-4 py-3">
                    <span aria-hidden className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border-2 border-[var(--lane-0)] bg-raised text-xs font-semibold">
                      {(p.name.trim()[0] ?? "?").toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">{p.name || "Untitled profile"}</div>
                      <div className="truncate text-xs text-dim">{p.gitEmail || "Uses git config identity"}</div>
                    </div>
                    {p.id === s.active ? (
                      <span className="rounded-full border border-primary/60 bg-primary/15 px-2 py-0.5 text-xs font-medium">Active</span>
                    ) : (
                      <Button variant="outline" size="sm" onClick={() => setSettings({ active: p.id })}>
                        Switch
                      </Button>
                    )}
                  </div>
                ))}
                <Button
                  variant="ghost"
                  size="sm"
                  className="self-start"
                  onClick={() => {
                    const id = crypto.randomUUID();
                    setSettings({
                      profiles: [...s.profiles, { id, name: "New profile", gitName: "", gitEmail: "", signingKey: "", azureOrg: "" }],
                      active: id,
                    });
                  }}
                >
                  <Plus /> New profile
                </Button>
              </div>
              <H3>{profile.name} · Git identity</H3>
              <Card>
                {(
                  [
                    ["name", "Profile name", "", "Work"],
                    ["gitName", "Author name", "Used for commits in repositories opened with this profile", "Leave empty to use git config"],
                    ["gitEmail", "Author email", "", "Leave empty to use git config"],
                    ["signingKey", "Signing key", "GPG key id or SSH public key path, used when commit signing is on", "~/.ssh/id_ed25519.pub"],
                    ["azureOrg", "Azure DevOps organisation", "Needed for Azure DevOps pull requests", "my-org"],
                  ] as const
                ).map(([k, label, text, placeholder]) => (
                  <Row key={k} label={label} text={text}>
                    <Input aria-label={label} value={profile[k]} placeholder={placeholder} onChange={(e) => updateProfile({ [k]: e.currentTarget.value })} className={`${control} w-64`} />
                  </Row>
                ))}
              </Card>
              <div className="mt-4">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  disabled={s.profiles.length < 2}
                  onClick={async () => {
                    if (!(await confirm(`Delete profile ${profile.name}?`, "Its saved integration tokens are removed from the keychain.", "Delete"))) return;
                    await Promise.all([...PROVIDERS, ...Object.values(AI_KEYS), ...s.servers.map((x) => ({ id: x.host }))].map((p) => api.deleteToken(account(p.id, s))));
                    const rest = s.profiles.filter((p) => p.id !== profile.id);
                    setSettings({ profiles: rest, active: rest[0].id });
                  }}
                >
                  <Trash2 /> Delete profile
                </Button>
              </div>
            </>
          )}

          {section === "integrations" && (
            <>
              <Title title="Integrations" text="Connect hosting providers to clone from your repository list and work with pull requests." />
              <H3>Providers · {profile.name}</H3>
              <Card>
                {PROVIDERS.map((p) => (
                  <TokenRow key={`${profile.id}/${p.id}`} provider={p} azureOrg={profile.azureOrg} />
                ))}
              </Card>
              <H3>Self-hosted servers</H3>
              <Card>
                {s.servers.map((srv, i) => (
                  <div key={i} className="border-b last:border-b-0">
                    <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                      <Input
                        aria-label="Server host"
                        placeholder="git.example.com"
                        value={srv.host}
                        onChange={(e) => setSettings({ servers: s.servers.map((x, j) => (j === i ? { ...x, host: e.currentTarget.value } : x)) })}
                        className={`${control} min-w-48 flex-1`}
                      />
                      <select
                        className={control}
                        aria-label="Server type"
                        value={srv.kind}
                        onChange={(e) => setSettings({ servers: s.servers.map((x, j) => (j === i ? { ...x, kind: e.currentTarget.value as Server["kind"] } : x)) })}
                      >
                        <option value="github">GitHub Enterprise</option>
                        <option value="gitlab">GitLab self-managed</option>
                        <option value="bitbucket-server">Bitbucket Data Center</option>
                      </select>
                      <Button variant="ghost" size="icon-sm" aria-label={`Remove ${srv.host || "server"}`} onClick={() => setSettings({ servers: s.servers.filter((_, j) => j !== i) })}>
                        <Trash2 />
                      </Button>
                    </div>
                    {srv.host.trim() && (
                      <TokenRow
                        key={`${profile.id}/${srv.host}`}
                        provider={{ id: srv.host.trim(), name: srv.host.trim(), url: `https://${srv.host.trim()}`, hint: "Personal or HTTP access token" }}
                        azureOrg=""
                      />
                    )}
                  </div>
                ))}
                <div className="px-4 py-2.5">
                  <Button variant="ghost" size="sm" onClick={() => setSettings({ servers: [...s.servers, { host: "", kind: "github" }] })}>
                    <Plus /> Add server
                  </Button>
                </div>
              </Card>
              <H3>Pull requests</H3>
              <Card>
                <Row label="Default merge method" text="Used by the Merge button on a pull request">
                  <div role="group" aria-label="Default merge method" className="inline-flex overflow-hidden rounded-[7px] border">
                    {(["merge", "squash", "rebase"] as const).map((m) => (
                      <button
                        key={m}
                        aria-pressed={s.prMerge === m}
                        onClick={() => setSettings({ prMerge: m })}
                        className={`h-8 px-3 text-[12.5px] capitalize ${s.prMerge === m ? "bg-raised font-medium text-foreground" : "bg-panel-2 text-muted-foreground hover:text-foreground"}`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </Row>
                <Row label="Show checks in the graph" text="CI status next to branches that have an open pull request">
                  <Switch label="Show checks in the graph" checked={s.showChecks} onChange={(v) => setSettings({ showChecks: v })} />
                </Row>
              </Card>
              <Note>Tokens are kept in the OS keychain (Keychain, Credential Manager or Secret Service), never in files or logs, and are only sent to their provider.</Note>
            </>
          )}

          {section === "ai" && (
            <>
              <Title title="AI assistant" text="Bring your own key or run a local model." />
              <H3>Provider</H3>
              <Card>
                <Row label="Provider">
                  <div role="group" aria-label="AI provider" className="inline-flex overflow-hidden rounded-[7px] border">
                    {(
                      [
                        ["anthropic", "Anthropic"],
                        ["openai", "OpenAI-compatible"],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        aria-pressed={s.ai.provider === id}
                        onClick={() =>
                          setSettings({
                            ai: id === "anthropic" ? { provider: id, model: "claude-opus-5-5", baseUrl: "" } : { provider: id, model: "llama3.2", baseUrl: "http://localhost:11434/v1" },
                          })
                        }
                        className={`h-8 px-3 text-[12.5px] ${s.ai.provider === id ? "bg-raised font-medium text-foreground" : "bg-panel-2 text-muted-foreground hover:text-foreground"}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </Row>
                <TokenRow key={`${profile.id}/${s.ai.provider}`} provider={AI_KEYS[s.ai.provider]} azureOrg="" text="Stored in the OS keychain" />
                <Row label="Model">
                  <Input aria-label="Model" value={s.ai.model} onChange={(e) => setSettings({ ai: { ...s.ai, model: e.currentTarget.value } })} className={`${control} w-64`} />
                </Row>
                <Row label="Server URL" text={s.ai.provider === "anthropic" ? "Leave empty for the Anthropic API" : "OpenAI, Ollama, LM Studio or any compatible server"}>
                  <Input
                    aria-label="Server URL"
                    value={s.ai.baseUrl}
                    placeholder={s.ai.provider === "anthropic" ? "https://api.anthropic.com" : "http://localhost:11434/v1"}
                    onChange={(e) => setSettings({ ai: { ...s.ai, baseUrl: e.currentTarget.value } })}
                    className={`${control} w-64`}
                  />
                </Row>
              </Card>
              <Note>A diff is sent to your provider only when you press a Generate or Explain button. Nothing is sent in the background.</Note>
            </>
          )}

          {section === "keys" && <KeysSection profile={profile} onUse={(signingKey) => updateProfile({ signingKey })} onConnect={() => setSection("integrations")} />}
          {section === "git" && <GitSection />}
          {section === "shortcuts" && <Shortcuts shortcuts={s.shortcuts} />}
        </div>
      </main>
    </div>
  );
}

function Title({ title, text }: { title: string; text: string }) {
  return (
    <>
      <h2 className="text-xl leading-7 font-semibold">{title}</h2>
      <p className="mt-1 text-sm leading-[19px] text-muted-foreground">{text}</p>
    </>
  );
}

function H3({ children }: { children: ReactNode }) {
  return <h3 className="mt-[26px] mb-2 text-[11px] font-semibold tracking-[0.7px] text-dim uppercase">{children}</h3>;
}

function Card({ children }: { children: ReactNode }) {
  return <div className="overflow-hidden rounded-[10px] border bg-panel">{children}</div>;
}

function Row({ label, text, children }: { label: string; text?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-14 flex-wrap items-center gap-4 border-b px-4 py-2.5 last:border-b-0">
      <div className="min-w-0 flex-[1_1_260px]">
        <div className="text-sm font-medium">{label}</div>
        {text && <div className="mt-0.5 text-xs leading-[17px] text-dim">{text}</div>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <div className="mt-4 flex gap-2.5 rounded-[10px] border bg-panel-2 px-3.5 py-3 text-xs leading-[18px] text-muted-foreground">
      <ShieldCheck className="mt-px size-4 shrink-0 text-[var(--lane-3)]" aria-hidden />
      <span>{children}</span>
    </div>
  );
}

function TokenRow({ provider, azureOrg, text }: { provider: Keyed; azureOrg: string; text?: string }) {
  const [has, setHas] = useState(false);
  const [token, setToken] = useState("");
  const acct = account(provider.id);

  useEffect(() => {
    api.hasToken(acct).then(setHas).catch(() => setHas(false));
  }, [acct]);

  async function save() {
    const value = provider.id === "azure" ? `${azureOrg.trim()}\n${token.trim()}` : token.trim();
    try {
      await api.saveToken(acct, value);
      setToken("");
      setHas(true);
      toast.success(`${provider.name} saved`);
    } catch (e) {
      toast.error(String(e));
    }
  }

  return (
    <div className="flex min-h-14 flex-wrap items-center gap-4 border-b px-4 py-2.5 last:border-b-0">
      <div className="min-w-0 flex-[1_1_220px]">
        <div className="text-sm font-medium">{provider.name}</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-dim">
          <span aria-hidden className={`size-[7px] rounded-full ${has ? "bg-[var(--lane-3)]" : "bg-dim/50"}`} />
          {has ? "Connected" : (text ?? "Not connected")}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {has ? (
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              await api.deleteToken(acct);
              setHas(false);
            }}
          >
            Disconnect
          </Button>
        ) : (
          <>
            <Input
              type="password"
              autoComplete="off"
              aria-label={`${provider.name} token`}
              placeholder={provider.hint}
              value={token}
              onChange={(e) => setToken(e.currentTarget.value)}
              onKeyDown={(e) => e.key === "Enter" && token.trim() && save()}
              className={`${control} w-56`}
            />
            <Button size="sm" disabled={!token.trim()} onClick={save}>
              Save
            </Button>
          </>
        )}
        <Button variant="ghost" size="icon-sm" aria-label={`Create a ${provider.name} token in the browser`} title="Create token" onClick={() => openUrl(provider.url).catch((e) => toast.error(String(e)))}>
          <ExternalLink />
        </Button>
      </div>
    </div>
  );
}

function Shortcuts({ shortcuts }: { shortcuts: Record<string, string> }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const rows = Object.entries(ACTIONS).filter(([id, label]) => !q || label.toLowerCase().includes(q) || prettyCombo(shortcuts[id] ?? "").toLowerCase().includes(q));
  return (
    <>
      <Title title="Keyboard shortcuts" text="Every action can be reached from the keyboard. Click a shortcut to change it." />
      <div className="mt-5 mb-3 flex flex-wrap items-center gap-2">
        <label className="flex h-8 w-72 max-w-full items-center gap-2 rounded-[7px] border bg-panel-2 px-2.5 text-dim focus-within:ring-3 focus-within:ring-ring/50">
          <Search className="size-3.5 shrink-0" aria-hidden />
          <input
            placeholder="Search actions or keys"
            aria-label="Search shortcuts"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-dim"
          />
        </label>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          onClick={async () => (await confirm("Reset all shortcuts?", "Every shortcut goes back to GitHawk's default.", "Reset")) && setSettings({ shortcuts: DEFAULT_SHORTCUTS })}
        >
          Reset to defaults
        </Button>
      </div>
      <Card>
        {rows.map(([id, label]) => (
          <ShortcutRow key={id} id={id} label={label} combo={shortcuts[id] ?? ""} />
        ))}
        {!rows.length && <p className="px-4 py-3 text-sm text-dim">No matching actions</p>}
      </Card>
    </>
  );
}

function ShortcutRow({ id, label, combo }: { id: string; label: string; combo: string }) {
  const [recording, setRecording] = useState(false);
  return (
    <div className="flex min-h-11 items-center gap-4 border-b px-4 py-1.5 last:border-b-0">
      <span className="min-w-0 flex-1 text-sm">{label}</span>
      <button
        className="flex items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-raised focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        onClick={() => setRecording(true)}
        onBlur={() => setRecording(false)}
        onKeyDown={(e) => {
          if (!recording) return;
          e.preventDefault();
          e.stopPropagation();
          if (e.key === "Escape") return setRecording(false);
          if (["Meta", "Control", "Alt", "Shift"].includes(e.key)) return;
          const s = getSettings();
          setSettings({ shortcuts: { ...s.shortcuts, [id]: comboOf(e.nativeEvent) } });
          setRecording(false);
        }}
        aria-label={`Shortcut for ${label}: ${combo ? prettyCombo(combo) : "none"}. Press to change.`}
      >
        {recording ? (
          <span className="text-xs text-primary">Press new shortcut…</span>
        ) : combo ? (
          combo.split("+").map((k, i) => (
            <kbd key={i} className={kbd}>
              {prettyCombo(k)}
            </kbd>
          ))
        ) : (
          <span className="text-xs text-dim">Not set</span>
        )}
        <Pencil className="ml-1 size-3 text-dim" aria-hidden />
      </button>
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-[18px] w-8 shrink-0 rounded-full border transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none ${
        checked ? "border-primary bg-primary" : "bg-raised"
      }`}
    >
      <span className={`absolute top-1/2 size-3 -translate-y-1/2 rounded-full transition-all ${checked ? "left-[15px] bg-primary-foreground" : "left-0.5 bg-muted-foreground"}`} />
    </button>
  );
}

function KeysSection({ profile, onUse, onConnect }: { profile: Profile; onUse: (key: string) => void; onConnect: () => void }) {
  const { servers } = useSettings();
  const [targets, setTargets] = useState<{ key: string; name: string }[]>([]);
  const [ssh, setSsh] = useState<SshKey[] | null>(null);
  const [gpg, setGpg] = useState<GpgKey[] | null>(null);
  const [config, setConfig] = useState<Record<string, string>>({});

  const load = () => {
    api.sshKeys().then(setSsh).catch((e) => toast.error(String(e)));
    api.gpgKeys().then(setGpg).catch(() => setGpg([]));
    api.gitConfig().then(setConfig).catch(() => {});
  };
  useEffect(load, []);

  useEffect(() => {
    const all = [
      ...PROVIDERS.filter((p) => p.id !== "azure").map((p) => ({ key: p.id, name: p.name })),
      ...servers.filter((x) => x.host.trim()).map((x) => ({ key: x.host.trim(), name: x.host.trim() })),
    ];
    Promise.all(all.map((t) => api.hasToken(account(t.key)).catch(() => false))).then((has) => setTargets(all.filter((_, i) => has[i])));
  }, [servers, profile.id]);

  async function upload(key: SshKey, to: { key: string; name: string }) {
    const id = toast.loading(`Adding the key to ${to.name}…`);
    try {
      await api.addSshKey(to.key, account(to.key), key.path);
      toast.success(`SSH key added to ${to.name}`, { id });
    } catch (e) {
      toast.error(String(e), { id });
    }
  }

  const copy = (key: SshKey) => navigator.clipboard.writeText(key.public).then(() => toast.success("Public key copied"));

  async function generate() {
    const r = await ask({
      title: "Generate SSH key",
      description: "Creates an ed25519 key pair in ~/.ssh without a passphrase. Use Add to… afterwards to put the public key on your hosting provider.",
      fields: [
        { name: "name", label: "File name", value: "id_ed25519_githawk" },
        { name: "email", label: "Comment (usually your email)", value: profile.gitEmail },
      ],
      confirm: "Generate",
    });
    if (!r) return;
    try {
      const key = await api.sshGenerate(r.text.name.trim(), r.text.email.trim());
      await navigator.clipboard.writeText(key.public).catch(() => {});
      toast.success("Key created and public key copied");
      load();
    } catch (e) {
      toast.error(String(e));
    }
  }

  const helper = config["credential.helper"] ?? "";
  const using = (key: string) => profile.signingKey.trim() === key;

  return (
    <>
      <Title title="SSH, GPG and HTTPS" text="Keys for authenticating with remotes and signing commits. Private keys never leave your machine." />
      <H3>SSH keys</H3>
      <Card>
        {ssh?.map((k) => (
          <Row key={k.path} label={k.path.split(/[\\/]/).pop()!.replace(/\.pub$/, "")} text={`${k.kind}${k.comment ? ` · ${k.comment}` : ""}`}>
            {using(k.path) ? (
              <span className="rounded-full border border-primary/60 bg-primary/15 px-2 py-0.5 text-xs font-medium">Signing key · {profile.name}</span>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => onUse(k.path)}>
                Use for signing
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => copy(k)}>
              <Copy /> Copy public key
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
                <Upload /> Add to…
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-48">
                {targets.map((t) => (
                  <DropdownMenuItem key={t.key} onClick={() => upload(k, t)}>
                    {t.name}
                  </DropdownMenuItem>
                ))}
                {!targets.length && <DropdownMenuItem onClick={onConnect}>Connect a provider first…</DropdownMenuItem>}
              </DropdownMenuContent>
            </DropdownMenu>
          </Row>
        ))}
        {ssh && !ssh.length && <p className="border-b px-4 py-3 text-sm text-dim">No SSH keys in ~/.ssh yet.</p>}
        <div className="px-4 py-2.5">
          <Button variant="ghost" size="sm" onClick={generate}>
            <KeyRound /> Generate new key
          </Button>
        </div>
      </Card>
      <H3>GPG keys</H3>
      <Card>
        {gpg?.map((k) => (
          <Row key={k.id} label={k.uid || k.id} text={k.id}>
            {using(k.id) ? (
              <span className="rounded-full border border-primary/60 bg-primary/15 px-2 py-0.5 text-xs font-medium">Signing key · {profile.name}</span>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => onUse(k.id)}>
                Use for signing
              </Button>
            )}
          </Row>
        ))}
        {gpg && !gpg.length && <p className="px-4 py-3 text-sm text-dim">No GPG secret keys found, or gpg isn't installed.</p>}
      </Card>
      <H3>HTTPS</H3>
      <Card>
        <Row label="Credential helper" text="Remembers HTTPS passwords and tokens for git push and pull. Global git setting.">
          <select
            aria-label="Credential helper"
            className={`${control} w-50`}
            value={helper}
            onChange={async (e) => {
              const v = e.currentTarget.value;
              try {
                await api.setGitConfig("credential.helper", v);
                setConfig({ ...config, "credential.helper": v });
              } catch (err) {
                toast.error(String(err));
              }
            }}
          >
            <option value="">None</option>
            <option value="osxkeychain">macOS Keychain</option>
            <option value="manager">Git Credential Manager</option>
            <option value="libsecret">libsecret (Linux)</option>
            <option value="cache">Cache in memory</option>
            <option value="store">Plain-text file</option>
            {helper && !["osxkeychain", "manager", "libsecret", "cache", "store"].includes(helper) && <option value={helper}>{helper}</option>}
          </select>
        </Row>
      </Card>
      <Note>The signing key you pick is used for commits made with the {profile.name} profile. SSH keys sign with gpg.format=ssh automatically.</Note>
    </>
  );
}

function GitSection() {
  const [config, setConfig] = useState<Record<string, string> | null>(null);
  const [version, setVersion] = useState("");
  useEffect(() => {
    api.gitConfig().then(setConfig).catch((e) => toast.error(String(e)));
    api.gitVersion().then(setVersion).catch(() => {});
  }, []);

  async function set(key: string, value: string) {
    try {
      await api.setGitConfig(key, value);
      setConfig((c) => ({ ...c, [key]: value }));
    } catch (e) {
      toast.error(String(e));
    }
  }

  if (!config) return <Title title="Git" text="Loading global git settings…" />;
  const on = (k: string) => config[k] === "true";

  return (
    <>
      <Title title="Git" text="Global git settings from ~/.gitconfig. They apply on the command line too." />
      <H3>Branches and syncing</H3>
      <Card>
        <Row label="Default branch name" text="Used by git init and new repositories">
          <Input
            aria-label="Default branch name"
            defaultValue={config["init.defaultBranch"]}
            placeholder="master"
            onBlur={(e) => e.currentTarget.value.trim() !== config["init.defaultBranch"] && set("init.defaultBranch", e.currentTarget.value.trim())}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            className={`${control} w-50`}
          />
        </Row>
        <Row label="When pulling" text="What git pull does when your branch and the remote have both moved">
          <select aria-label="When pulling" className={`${control} w-50`} value={config["pull.rebase"]} onChange={(e) => set("pull.rebase", e.currentTarget.value)}>
            <option value="">Git default (merge)</option>
            <option value="false">Merge</option>
            <option value="true">Rebase</option>
            <option value="merges">Rebase, keep merges</option>
          </select>
        </Row>
        <Row label="Prune on fetch" text="Remove remote branches that were deleted on the server">
          <Switch label="Prune on fetch" checked={on("fetch.prune")} onChange={(v) => set("fetch.prune", v ? "true" : "")} />
        </Row>
        <Row label="Set upstream automatically" text="Push new branches without --set-upstream">
          <Switch label="Set upstream automatically" checked={on("push.autoSetupRemote")} onChange={(v) => set("push.autoSetupRemote", v ? "true" : "")} />
        </Row>
      </Card>
      <H3>Commits</H3>
      <Card>
        <Row label="Sign commits by default" text="Uses the signing key from your profile">
          <Switch label="Sign commits by default" checked={on("commit.gpgSign")} onChange={(v) => set("commit.gpgSign", v ? "true" : "")} />
        </Row>
        <Row label="Line endings" text="core.autocrlf: convert CRLF and LF when checking files in and out">
          <select aria-label="Line endings" className={`${control} w-50`} value={config["core.autocrlf"]} onChange={(e) => set("core.autocrlf", e.currentTarget.value)}>
            <option value="">Leave as is</option>
            <option value="input">LF in repo (input)</option>
            <option value="true">CRLF on checkout (Windows)</option>
            <option value="false">Never convert</option>
          </select>
        </Row>
      </Card>
      <H3>About</H3>
      <Card>
        <Row label="Git version" text="GitHawk runs the git found on your PATH">
          <span className="font-mono text-xs text-muted-foreground">{version || "not found"}</span>
        </Row>
      </Card>
    </>
  );
}
