import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api, type HostRepo } from "@/lib/api";
import { account, getSettings } from "@/lib/settings";

const NAMES: Record<string, string> = { github: "GitHub", gitlab: "GitLab", bitbucket: "Bitbucket", azure: "Azure DevOps" };

type Props = { open: boolean; onOpenChange: (o: boolean) => void; onClone: (url: string) => void };

export function CloneDialog({ open, onOpenChange, onClone }: Props) {
  const [url, setUrl] = useState("");
  const [connected, setConnected] = useState<string[]>([]);
  const [provider, setProvider] = useState("");
  const [repos, setRepos] = useState<HostRepo[] | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [ssh, setSsh] = useState(false);

  useEffect(() => {
    if (!open) return;
    setUrl("");
    setRepos(null);
    setError("");
    const keys = [...Object.keys(NAMES), ...getSettings().servers.map((s) => s.host)];
    Promise.all(keys.map(async (p) => ((await api.hasToken(account(p)).catch(() => false)) ? p : null))).then((ps) => {
      const list = ps.filter((p): p is string => !!p);
      setConnected(list);
      setProvider(list[0] ?? "");
    });
  }, [open]);

  useEffect(() => {
    if (!open || !provider) return;
    setRepos(null);
    setError("");
    api.hostRepos(provider, account(provider)).then(setRepos).catch((e) => setError(String(e)));
  }, [open, provider]);

  const shown = (repos ?? []).filter((r) => r.name.toLowerCase().includes(filter.toLowerCase()));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Clone repository</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (url.trim()) onClone(url.trim());
          }}
        >
          <label className="grid gap-1.5 text-sm">
            Repository URL
            <Input autoFocus value={url} placeholder="https://github.com/owner/repo.git" onChange={(e) => setUrl(e.currentTarget.value)} />
          </label>
          {connected.length > 0 && (
            <div className="grid gap-2 rounded-md border p-2">
              <div className="flex items-center gap-2 text-sm">
                <select
                  aria-label="Provider"
                  className="h-7 rounded border bg-transparent px-1 text-xs"
                  value={provider}
                  onChange={(e) => setProvider(e.currentTarget.value)}
                >
                  {connected.map((p) => (
                    <option key={p} value={p}>
                      {NAMES[p] ?? p}
                    </option>
                  ))}
                </select>
                <Input className="h-7" placeholder="Filter" aria-label="Filter repositories" value={filter} onChange={(e) => setFilter(e.currentTarget.value)} />
                <label className="flex shrink-0 items-center gap-1 text-xs">
                  <input type="checkbox" checked={ssh} onChange={(e) => setSsh(e.currentTarget.checked)} /> SSH
                </label>
              </div>
              <ul className="max-h-60 overflow-auto">
                {error && <li className="p-2 text-xs text-destructive">{error}</li>}
                {repos === null && !error && <li className="p-2 text-xs text-muted-foreground">Loading…</li>}
                {shown.map((r) => {
                  const u = ssh ? r.ssh : r.https;
                  return (
                    <li key={r.name}>
                      <button
                        type="button"
                        className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm ${url === u ? "bg-accent" : "hover:bg-muted"}`}
                        onClick={() => setUrl(u)}
                      >
                        <span className="truncate">{r.name}</span>
                        {r.private && <Lock className="size-3 shrink-0 text-muted-foreground" aria-label="private" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!url.trim()}>
              Choose folder…
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
