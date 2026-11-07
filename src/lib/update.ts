import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { api } from "@/lib/api";

export const appVersion = () => getVersion();

const osName = () => (/Windows/.test(navigator.userAgent) ? "Windows" : /Mac/.test(navigator.userAgent) ? "macOS" : "Linux");

// Opens a prefilled issue in the browser; the user reviews it and submits with their own GitHub account.
export async function reportProblem() {
  const [app, git] = await Promise.all([getVersion().catch(() => "?"), api.gitVersion().catch(() => "not found")]);
  const body = `**What happened?**


**What did you expect?**


**Steps to reproduce**
1.

**Failing command** (from the command log, ⌘⇧R, if a git operation failed)


---
GitHawk ${app} · ${osName()} · git ${git}
`;
  const q = new URLSearchParams({ body });
  await openUrl(`https://github.com/masitings/githawk/issues/new?${q}`);
}

/** `manual` reports "up to date" and errors; the startup check stays quiet. */
export async function checkForUpdate(manual = false) {
  try {
    const update = await check();
    if (!update) {
      if (manual) toast.success("GitHawk is up to date");
      return;
    }
    toast(`GitHawk ${update.version} is available`, {
      duration: Infinity,
      action: {
        label: "Update",
        onClick: async () => {
          const id = toast.loading(`Downloading GitHawk ${update.version}…`);
          try {
            await update.downloadAndInstall();
            toast.success("Update installed", { id, duration: Infinity, action: { label: "Restart", onClick: () => relaunch() } });
          } catch (e) {
            toast.error(String(e), { id });
          }
        },
      },
    });
  } catch (e) {
    if (manual) toast.error(String(e));
  }
}
