import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { api, type PetInfo } from "@/lib/api";
import { ask } from "@/lib/prompt";
import { getSettings, setSettings } from "@/lib/settings";

export type Mood = "busy" | "done" | "failed";

export const petMood = (mood: Mood) => window.dispatchEvent(new CustomEvent<Mood>("githawk-pet", { detail: mood }));

export const PET_SITE = "https://codex-pets.net";

export function usePets() {
  const [pets, setPets] = useState<PetInfo[]>([]);
  useEffect(() => {
    const load = () => api.pets().then(setPets, () => setPets([]));
    load();
    window.addEventListener("githawk-pets", load);
    return () => window.removeEventListener("githawk-pets", load);
  }, []);
  return pets;
}

export const choosePet = (id: string) => setSettings({ pet: { ...getSettings().pet, id, enabled: true } });

export async function addPet() {
  const r = await ask({
    title: "Add a pet",
    description: `Paste a pet link or id from ${PET_SITE.replace("https://", "")}. Pets are saved in ~/.codex/pets, shared with Codex.`,
    fields: [{ name: "source", label: "Link or id", placeholder: `${PET_SITE}/#/pets/debug-duck` }],
    confirm: "Add pet",
  });
  const source = r?.text.source.trim();
  if (!source) return;
  await install(source);
}

export async function install(source: string) {
  try {
    const id = await api.petInstall(source);
    window.dispatchEvent(new Event("githawk-pets"));
    choosePet(id);
    toast.success("Pet added");
  } catch (e) {
    toast.error(String(e));
  }
}

export const browsePets = () => openUrl(PET_SITE);
