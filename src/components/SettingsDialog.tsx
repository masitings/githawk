import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, type Provider, type Server } from "@/lib/api";
import { ACTIONS, account, activeProfile, comboOf, getSettings, prettyCombo, setSettings, useSettings, type Profile } from "@/lib/settings";
import { confirm } from "@/lib/prompt";

type Keyed = { id: string; name: string; url: string; hint: string };

const PROVIDERS: (Keyed & { id: Provider })[] = [
  {
    id: "github",
    name: "GitHub",
    url: "https://github.com/settings/tokens/new?scopes=repo&description=GitHawk",
    hint: "Personal access token with the repo scope",
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
    hint: "Personal access token with Code (read & write); set the organisation in your profile",
  },
];

const AI_KEYS: Record<"anthropic" | "openai", Keyed> = {
  anthropic: { id: "ai-anthropic", name: "Anthropic API key", url: "https://platform.claude.com/settings/keys", hint: "sk-ant-…" },
  openai: { id: "ai-openai", name: "API key", url: "https://platform.openai.com/api-keys", hint: "Leave empty for local servers such as Ollama" },
};

const field = "h-8 rounded-md border bg-transparent px-2 text-sm";

export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const s = useSettings();
  const profile = activeProfile(s);

  const updateProfile = (patch: Partial<Profile>) =>
    setSettings({ profiles: s.profiles.map((p) => (p.id === profile.id ? { ...p, ...patch } : p)) });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="general" className="max-h-[70vh] overflow-auto">
          <TabsList>
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="profiles">Profiles</TabsTrigger>
            <TabsTrigger value="integrations">Integrations</TabsTrigger>
            <TabsTrigger value="ai">AI</TabsTrigger>
            <TabsTrigger value="shortcuts">Shortcuts</TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="grid gap-4 pt-3 text-sm">
            <label className="grid gap-1.5">
              Theme
              <select className={field} value={s.theme} onChange={(e) => setSettings({ theme: e.currentTarget.value as never })}>
                <option value="system">Match system</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
            <label className="grid gap-1.5">
              Fetch in the background
              <select className={field} value={s.autoFetch} onChange={(e) => setSettings({ autoFetch: Number(e.currentTarget.value) })}>
                <option value={0}>Off</option>
                <option value={5}>Every 5 minutes</option>
                <option value={15}>Every 15 minutes</option>
                <option value={60}>Every hour</option>
              </select>
            </label>
          </TabsContent>

          <TabsContent value="profiles" className="grid gap-4 pt-3 text-sm">
            <div className="flex items-center gap-2">
              <select className={`${field} flex-1`} aria-label="Active profile" value={s.active} onChange={(e) => setSettings({ active: e.currentTarget.value })}>
                {s.profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const id = crypto.randomUUID();
                  setSettings({
                    profiles: [...s.profiles, { id, name: "New profile", gitName: "", gitEmail: "", signingKey: "", azureOrg: "" }],
                    active: id,
                  });
                }}
              >
                Add
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={s.profiles.length < 2}
                onClick={async () => {
                  if (!(await confirm(`Delete profile ${profile.name}?`, "Its saved integration tokens are removed from the keychain.", "Delete"))) return;
                  await Promise.all([...PROVIDERS, ...Object.values(AI_KEYS), ...s.servers.map((x) => ({ id: x.host }))].map((p) => api.deleteToken(account(p.id, s))));
                  const rest = s.profiles.filter((p) => p.id !== profile.id);
                  setSettings({ profiles: rest, active: rest[0].id });
                }}
              >
                Delete
              </Button>
            </div>
            {(
              [
                ["name", "Profile name", "Work"],
                ["gitName", "Author name", "Leave empty to use git config"],
                ["gitEmail", "Author email", "Leave empty to use git config"],
                ["signingKey", "Signing key", "GPG key id or SSH public key path"],
                ["azureOrg", "Azure DevOps organisation", "my-org"],
              ] as const
            ).map(([k, label, placeholder]) => (
              <label key={k} className="grid gap-1.5">
                {label}
                <Input value={profile[k]} placeholder={placeholder} onChange={(e) => updateProfile({ [k]: e.currentTarget.value })} />
              </label>
            ))}
          </TabsContent>

          <TabsContent value="integrations" className="grid gap-3 pt-3 text-sm">
            <p className="text-muted-foreground">
              Tokens are stored in your OS keychain for the <strong>{profile.name}</strong> profile and only sent to the provider.
            </p>
            {PROVIDERS.map((p) => (
              <TokenRow key={`${profile.id}/${p.id}`} provider={p} azureOrg={profile.azureOrg} />
            ))}
            <h3 className="mt-2 font-medium">Self-hosted servers</h3>
            <p className="text-muted-foreground">GitHub Enterprise Server, GitLab self-managed and Bitbucket Data Center. Remotes on these hosts get pull requests too.</p>
            {s.servers.map((srv, i) => (
              <div key={i} className="grid gap-2 rounded-md border p-3">
                <div className="flex gap-2">
                  <Input
                    aria-label="Server host"
                    placeholder="git.example.com"
                    value={srv.host}
                    onChange={(e) => setSettings({ servers: s.servers.map((x, j) => (j === i ? { ...x, host: e.currentTarget.value } : x)) })}
                  />
                  <select
                    className={field}
                    aria-label="Server type"
                    value={srv.kind}
                    onChange={(e) => setSettings({ servers: s.servers.map((x, j) => (j === i ? { ...x, kind: e.currentTarget.value as Server["kind"] } : x)) })}
                  >
                    <option value="github">GitHub Enterprise</option>
                    <option value="gitlab">GitLab</option>
                    <option value="bitbucket-server">Bitbucket Data Center</option>
                  </select>
                  <Button variant="ghost" size="sm" onClick={() => setSettings({ servers: s.servers.filter((_, j) => j !== i) })}>
                    Remove
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
            <Button variant="outline" size="sm" className="justify-self-start" onClick={() => setSettings({ servers: [...s.servers, { host: "", kind: "github" }] })}>
              Add server
            </Button>
          </TabsContent>

          <TabsContent value="ai" className="grid gap-4 pt-3 text-sm">
            <p className="text-muted-foreground">
              Writes commit messages, explains commits and drafts changelogs. Diffs and commit messages are sent only to the server you choose here.
            </p>
            <label className="grid gap-1.5">
              Provider
              <select
                className={field}
                value={s.ai.provider}
                onChange={(e) => {
                  const provider = e.currentTarget.value as "anthropic" | "openai";
                  setSettings({ ai: provider === "anthropic" ? { provider, model: "claude-opus-5-5", baseUrl: "" } : { provider, model: "llama3.2", baseUrl: "http://localhost:11434/v1" } });
                }}
              >
                <option value="anthropic">Anthropic (Claude)</option>
                <option value="openai">OpenAI-compatible (OpenAI, Ollama, LM Studio…)</option>
              </select>
            </label>
            <label className="grid gap-1.5">
              Model
              <Input value={s.ai.model} onChange={(e) => setSettings({ ai: { ...s.ai, model: e.currentTarget.value } })} />
            </label>
            <label className="grid gap-1.5">
              Server URL
              <Input
                value={s.ai.baseUrl}
                placeholder={s.ai.provider === "anthropic" ? "https://api.anthropic.com" : "http://localhost:11434/v1"}
                onChange={(e) => setSettings({ ai: { ...s.ai, baseUrl: e.currentTarget.value } })}
              />
            </label>
            <TokenRow key={`${profile.id}/${s.ai.provider}`} provider={AI_KEYS[s.ai.provider]} azureOrg="" />
          </TabsContent>

          <TabsContent value="shortcuts" className="grid max-h-96 gap-1 overflow-auto pt-3 text-sm">
            {Object.entries(ACTIONS).map(([id, label]) => (
              <ShortcutRow key={id} id={id} label={label} combo={s.shortcuts[id] ?? ""} />
            ))}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function TokenRow({ provider, azureOrg }: { provider: Keyed; azureOrg: string }) {
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
      toast.success(`${provider.name} connected`);
    } catch (e) {
      toast.error(String(e));
    }
  }

  return (
    <div className="grid gap-1.5 rounded-md border p-3">
      <div className="flex items-center gap-2">
        <span className="font-medium">{provider.name}</span>
        <span className={`text-xs ${has ? "text-[var(--lane-2)]" : "text-muted-foreground"}`}>{has ? "Connected" : "Not connected"}</span>
        <Button variant="link" size="xs" className="ml-auto" onClick={() => openUrl(provider.url)}>
          Create token
        </Button>
        {has && (
          <Button
            variant="ghost"
            size="xs"
            onClick={async () => {
              await api.deleteToken(acct);
              setHas(false);
            }}
          >
            Disconnect
          </Button>
        )}
      </div>
      <div className="flex gap-2">
        <Input
          type="password"
          autoComplete="off"
          aria-label={`${provider.name} token`}
          placeholder={provider.hint}
          value={token}
          onChange={(e) => setToken(e.currentTarget.value)}
        />
        <Button size="sm" disabled={!token.trim()} onClick={save}>
          Save
        </Button>
      </div>
    </div>
  );
}

function ShortcutRow({ id, label, combo }: { id: string; label: string; combo: string }) {
  const [recording, setRecording] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded px-2 py-1 hover:bg-muted">
      <span className="flex-1">{label}</span>
      <button
        className={`min-w-28 rounded border px-2 py-0.5 font-mono text-xs ${recording ? "border-primary" : ""}`}
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
        {recording ? "Press keys…" : combo ? prettyCombo(combo) : "—"}
      </button>
    </div>
  );
}

