import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { toast } from "sonner";

export const appVersion = () => getVersion();

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
