import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Cloud, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";

let version: Promise<string> | undefined;

export const ago = (t: number) => {
  const s = Math.max(0, Date.now() / 1000 - t);
  if (s < 60) return "just now";
  const n = (v: number, unit: string) => `${v} ${unit}${v === 1 ? "" : "s"} ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return n(Math.floor(s / 3600), "hour");
  if (s < 86400 * 60) return n(Math.floor(s / 86400), "day");
  if (s < 86400 * 730) return n(Math.floor(s / (86400 * 30)), "month");
  return n(Math.floor(s / (86400 * 365)), "year");
};

export const prettyRemote = (url: string) =>
  url
    .replace(/^[a-z+]+:\/\//, "")
    .replace(/^[^@/]+@/, "")
    .replace(/^([^/:]+):(?!\d)/, "$1/")
    .replace(/\.git$/, "");

export function StatusBar({ root, fetched, urls }: { root: string; fetched: number | null | undefined; urls: Record<string, string> | undefined }) {
  const [watching, setWatching] = useState(true);
  const [git, setGit] = useState("");
  const [, tick] = useState(0);

  useEffect(() => {
    (version ??= api.gitVersion().catch(() => "")).then(setGit);
    const t = setInterval(() => tick((x) => x + 1), 30_000);
    const un = listen<string>("watcher-error", (e) => e.payload.startsWith(`${root}:`) && setWatching(false));
    return () => {
      clearInterval(t);
      un.then((f) => f()).catch(() => {});
    };
  }, [root]);

  const remote = urls && (urls.origin ? "origin" : Object.keys(urls)[0]);

  return (
    <footer className="flex h-[26px] shrink-0 items-center gap-[18px] overflow-hidden border-t bg-background px-3 text-[11.5px] whitespace-nowrap text-muted-foreground">
      <span className="flex items-center gap-1.5" role="status">
        <span aria-hidden className={`size-[7px] rounded-full ${watching ? "bg-[var(--lane-3)]" : "bg-del"}`} />
        {watching ? "Watching for changes" : "File watcher stopped"}
      </span>
      <span title={fetched ? new Date(fetched * 1000).toLocaleString() : undefined}>{fetched ? `Last fetched ${ago(fetched)}` : "Never fetched"}</span>
      {remote && (
        <span className="flex min-w-0 items-center gap-1.5">
          <Cloud className="size-3 shrink-0" aria-hidden />
          <span className="truncate">
            {remote} · {prettyRemote(urls![remote])}
          </span>
        </span>
      )}
      <span className="flex-1" />
      <span className="flex items-center gap-1.5">
        <ShieldCheck className="size-3" aria-hidden />
        Local only · no telemetry
      </span>
      {git && <span className="font-mono">git {git}</span>}
    </footer>
  );
}
