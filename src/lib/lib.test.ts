import assert from "node:assert/strict";
import { compose, parseConflicts } from "./conflicts.ts";
import { avatarUrl } from "./avatars.ts";

const text = "a\n<<<<<<< HEAD\nours\n||||||| base\norig\n=======\ntheirs\n>>>>>>> feat\nz\n";
const segs = parseConflicts(text);
assert.equal(segs.length, 3);
assert.deepEqual(segs[1], { ours: "ours\n", base: "orig\n", theirs: "theirs\n", oursLabel: "HEAD", theirsLabel: "feat" });
assert.equal(compose(segs, ["theirs"]), "a\ntheirs\nz\n");
assert.equal(compose(segs, ["both"]), "a\nours\ntheirs\nz\n");
assert.match(compose(segs, [null]), /^a\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> feat\nz\n$/);
assert.equal(parseConflicts("x\n<<<<<<< broken\n").length, 1, "unterminated block stays plain text");
console.log("conflicts ok");

import { fuzzy } from "./fuzzy.ts";
assert.equal(fuzzy("xyz", "main"), null);
assert.ok(fuzzy("fl", "feature/login")! > fuzzy("fl", "fooball")!, "word boundaries rank higher");
assert.ok(fuzzy("main", "main")! > fuzzy("main", "remains")!);
console.log("fuzzy ok");

import { parseUnified } from "./unified.ts";
const diff = [
  "diff --git a/src/a.ts b/src/a.ts",
  "index 1..2 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -10,3 +10,3 @@ fn",
  " keep",
  "-old",
  "+new",
  "\\ No newline at end of file",
  "diff --git a/gone.txt b/gone.txt",
  "--- a/gone.txt",
  "+++ /dev/null",
  "@@ -1 +0,0 @@",
  "-bye",
].join("\n");
const files = parseUnified(diff);
assert.deepEqual(files.map((f) => f.path), ["src/a.ts", "gone.txt"]);
assert.deepEqual(files[0].hunks[0].lines, [
  { origin: " ", old: 10, new: 10, text: "keep" },
  { origin: "-", old: 11, new: null, text: "old" },
  { origin: "+", old: null, new: 11, text: "new" },
]);
assert.equal(files[1].hunks[0].lines[0].old, 1);
console.log("unified ok");

assert.equal(avatarUrl("12345+octo@users.noreply.github.com", {}), "https://avatars.githubusercontent.com/u/12345?s=64");
assert.equal(avatarUrl("octo@users.noreply.github.com", {}), "https://github.com/octo.png?size=64");
assert.equal(avatarUrl("Maya@Example.com", { "maya@example.com": "https://a/u/1?v=4" }), "https://a/u/1?v=4&s=64");
assert.equal(avatarUrl("nobody@example.com", {}), undefined);
console.log("avatars ok");
