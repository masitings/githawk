import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// pnpm is a .cmd shim on Windows, which execFile can only start through a shell.
const run = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 1 << 28, shell: process.platform === "win32" });
const texts = (dir) => {
  try {
    return readdirSync(dir)
      .filter((f) => /^(licen[cs]e|copying|notice)/i.test(f))
      .sort()
      .map((f) => readFileSync(join(dir, f), "utf8").trim());
  } catch {
    return [];
  }
};

const entries = [];

const host = run("rustc", ["-vV"]).match(/host: (\S+)/)[1];
const meta = JSON.parse(run("cargo", ["metadata", "--format-version", "1", "--filter-platform", host, "--manifest-path", "src-tauri/Cargo.toml"]));
const pkgs = new Map(meta.packages.map((p) => [p.id, p]));
const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
const app = meta.packages.find((p) => p.name === "githawk").id;
const seen = new Set([app]);
for (const queue = [app]; queue.length; ) {
  for (const d of nodes.get(queue.pop()).deps) {
    // Only normal deps end up in the binary; build and dev deps don't ship.
    if (d.dep_kinds.some((k) => k.kind === null) && !seen.has(d.pkg)) {
      seen.add(d.pkg);
      queue.push(d.pkg);
    }
  }
}
for (const id of seen) {
  const p = pkgs.get(id);
  if (p.source) entries.push({ name: `${p.name} ${p.version}`, license: p.license ?? "", texts: texts(dirname(p.manifest_path)) });
}

// ponytail: every production npm dependency, not only what Vite bundles; over-inclusive is safe for notices.
const npm = JSON.parse(run("pnpm", ["licenses", "list", "--prod", "--json"]));
for (const list of Object.values(npm)) {
  for (const p of list) entries.push({ name: `${p.name} ${p.versions.join(", ")}`, license: p.license, texts: texts(p.paths[0]) });
}

const groups = new Map();
for (const e of entries) {
  const key = e.texts.join("\n\n") || `License: ${e.license || "unknown"} (no license file in the package)`;
  (groups.get(key) ?? groups.set(key, []).get(key)).push(e.name);
}
const out = [`GitHawk includes the following third-party software (${entries.length} packages).`];
for (const [text, names] of [...groups].sort((a, b) => a[1][0].localeCompare(b[1][0]))) {
  out.push(`${"=".repeat(72)}\n${names.sort().join("\n")}\n${"-".repeat(72)}\n${text}`);
}
mkdirSync("public", { recursive: true });
writeFileSync("public/third-party-licenses.txt", out.join("\n\n") + "\n");
console.log(`third-party-licenses.txt: ${entries.length} packages, ${groups.size} license texts`);
