const NOREPLY = /^(?:(\d+)\+)?([^@]+)@users\.noreply\.github\.com$/;

/** Photo URL for a commit email, using the map from the GitHub remote; undefined when unknown. */
export function avatarUrl(email: string, known: Record<string, string>): string | undefined {
  const e = email.toLowerCase();
  if (known[e]) return `${known[e]}${known[e].includes("?") ? "&" : "?"}s=64`;
  const m = NOREPLY.exec(e);
  if (!m) return undefined;
  return m[1] ? `https://avatars.githubusercontent.com/u/${m[1]}?s=64` : `https://github.com/${m[2]}.png?size=64`;
}

const images = new Map<string, HTMLImageElement | null>();

/** The loaded image, or null while it loads or after it failed; `onLoad` fires once it is ready. */
export function avatarImage(url: string, onLoad: () => void): HTMLImageElement | null {
  const cached = images.get(url);
  if (cached !== undefined) return cached?.complete ? cached : null;
  const img = new Image();
  img.decoding = "async";
  img.onload = onLoad;
  img.onerror = () => images.set(url, null);
  img.src = url;
  images.set(url, img);
  return null;
}

/** Gravatar photo for an email; `d=404` makes a missing photo fail so callers can fall back. */
export async function gravatarUrl(email: string, size = 64): Promise<string | undefined> {
  const e = email.trim().toLowerCase();
  if (!e.includes("@")) return undefined;
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(e));
  const hex = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `https://gravatar.com/avatar/${hex}?s=${size}&d=404`;
}
