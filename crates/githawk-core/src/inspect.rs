use std::path::Path;

use git2::{BlameOptions, Repository};
use serde::Serialize;

use crate::ops::run;

fn e(err: git2::Error) -> String {
    err.message().to_owned()
}

fn open(root: &str) -> Result<Repository, String> {
    Repository::discover(root).map_err(e)
}

#[derive(Debug, Serialize)]
pub struct Conflict {
    pub base: Option<String>,
    pub ours: Option<String>,
    pub theirs: Option<String>,
    /// The work tree file, conflict markers included.
    pub merged: String,
}

pub fn conflict(root: &str, file: &str) -> Result<Conflict, String> {
    let repo = open(root)?;
    let index = repo.index().map_err(e)?;
    let stage = |n: i32| {
        index
            .get_path(Path::new(file), n)
            .and_then(|entry| repo.find_blob(entry.id).ok())
            .map(|b| String::from_utf8_lossy(b.content()).into_owned())
    };
    let workdir = repo.workdir().ok_or("bare repository")?;
    let merged = std::fs::read(workdir.join(file)).map_err(|e| e.to_string())?;
    Ok(Conflict {
        base: stage(1),
        ours: stage(2),
        theirs: stage(3),
        merged: String::from_utf8_lossy(&merged).into_owned(),
    })
}

pub fn resolve(root: &str, file: &str, content: &str) -> Result<(), String> {
    let repo = open(root)?;
    let workdir = repo.workdir().ok_or("bare repository")?;
    std::fs::write(workdir.join(file), content).map_err(|e| e.to_string())?;
    run(workdir, &["add", "--", file], None).map(drop)
}

#[derive(Debug, Serialize)]
pub struct FileCommit {
    pub id: String,
    pub author: String,
    /// Unix seconds, UTC.
    pub time: i64,
    pub summary: String,
    /// The file's path in this commit; differs from today's after a rename.
    pub path: String,
}

pub fn history(root: &str, file: &str) -> Result<Vec<FileCommit>, String> {
    let out = run(
        Path::new(root),
        &[
            "log",
            "--no-show-signature",
            "--follow",
            "--name-only",
            "--format=%x1e%H%x1f%an%x1f%at%x1f%s",
            "--",
            file,
        ],
        None,
    )?;
    Ok(out
        .split('\x1e')
        .filter_map(|rec| {
            let mut lines = rec.lines().filter(|l| !l.is_empty());
            let mut f = lines.next()?.split('\x1f');
            Some(FileCommit {
                id: f.next()?.to_owned(),
                author: f.next()?.to_owned(),
                time: f.next()?.parse().ok()?,
                summary: f.next().unwrap_or_default().to_owned(),
                path: lines.next().unwrap_or(file).to_owned(),
            })
        })
        .collect())
}

#[derive(Debug, Serialize)]
pub struct BlameLine {
    pub id: String,
    pub author: String,
    /// Unix seconds, UTC.
    pub time: i64,
    pub text: String,
}

/// Blame of the file as committed at HEAD.
pub fn blame(root: &str, file: &str) -> Result<Vec<BlameLine>, String> {
    let repo = open(root)?;
    let head = repo.head().map_err(e)?.peel_to_tree().map_err(e)?;
    let blob = head
        .get_path(Path::new(file))
        .map_err(e)?
        .to_object(&repo)
        .map_err(e)?;
    let text = String::from_utf8_lossy(blob.as_blob().ok_or("not a file")?.content()).into_owned();
    let mut opts = BlameOptions::new();
    opts.track_copies_same_commit_moves(true);
    let blame = repo
        .blame_file(Path::new(file), Some(&mut opts))
        .map_err(e)?;
    Ok(text
        .lines()
        .enumerate()
        .map(|(i, line)| {
            let h = blame.get_line(i + 1);
            let sig = h.as_ref().map(|h| h.final_signature());
            BlameLine {
                id: h
                    .as_ref()
                    .map(|h| h.final_commit_id().to_string())
                    .unwrap_or_default(),
                author: sig
                    .as_ref()
                    .and_then(|s| s.name().map(str::to_owned))
                    .unwrap_or_default(),
                time: sig.as_ref().map(|s| s.when().seconds()).unwrap_or_default(),
                text: line.to_owned(),
            }
        })
        .collect())
}

#[derive(Debug, Serialize)]
pub struct ReflogEntry {
    pub id: String,
    pub old: String,
    pub message: String,
    /// Unix seconds, UTC.
    pub time: i64,
}

pub fn reflog(root: &str) -> Result<Vec<ReflogEntry>, String> {
    let repo = open(root)?;
    let log = repo.reflog("HEAD").map_err(e)?;
    Ok(log
        .iter()
        .map(|r| ReflogEntry {
            id: r.id_new().to_string(),
            old: r.id_old().to_string(),
            message: r.message().unwrap_or_default().to_owned(),
            time: r.committer().when().seconds(),
        })
        .collect())
}

pub fn files(root: &str) -> Result<Vec<String>, String> {
    let repo = open(root)?;
    let index = repo.index().map_err(e)?;
    Ok(index
        .iter()
        .filter(|i| (i.flags >> 12) & 3 == 0)
        .map(|i| String::from_utf8_lossy(&i.path).into_owned())
        .collect())
}

#[derive(Debug, Serialize)]
pub struct Worktree {
    pub path: String,
    pub branch: Option<String>,
    pub head: String,
    pub main: bool,
}

pub fn worktrees(root: &str) -> Result<Vec<Worktree>, String> {
    let out = run(Path::new(root), &["worktree", "list", "--porcelain"], None)?;
    Ok(out
        .split("\n\n")
        .filter(|b| !b.trim().is_empty())
        .enumerate()
        .map(|(i, block)| {
            let field = |k: &str| {
                block
                    .lines()
                    .find_map(|l| l.strip_prefix(k))
                    .map(str::to_owned)
            };
            Worktree {
                path: field("worktree ").unwrap_or_default(),
                branch: field("branch ").map(|b| b.trim_start_matches("refs/heads/").to_owned()),
                head: field("HEAD ").unwrap_or_default(),
                main: i == 0,
            }
        })
        .collect())
}

#[derive(Debug, Serialize)]
pub struct Submodule {
    pub name: String,
    pub path: String,
    pub url: Option<String>,
    /// Commit recorded in the parent repository.
    pub expected: Option<String>,
    /// Commit checked out in the submodule, if initialised.
    pub actual: Option<String>,
}

pub fn submodules(root: &str) -> Result<Vec<Submodule>, String> {
    let repo = open(root)?;
    Ok(repo
        .submodules()
        .map_err(e)?
        .iter()
        .map(|s| Submodule {
            name: s.name().unwrap_or_default().to_owned(),
            path: s.path().to_string_lossy().into_owned(),
            url: s.url().map(str::to_owned),
            expected: s.index_id().map(|o| o.to_string()),
            actual: s.workdir_id().map(|o| o.to_string()),
        })
        .collect())
}

pub fn uses_lfs(root: &str) -> bool {
    open(root)
        .ok()
        .and_then(|r| r.workdir().map(|w| w.join(".gitattributes")))
        .and_then(|p| std::fs::read_to_string(p).ok())
        .is_some_and(|s| s.contains("filter=lfs"))
}

#[derive(Debug, Serialize)]
pub struct Flow {
    pub main: String,
    pub develop: String,
    pub feature: String,
    pub release: String,
    pub hotfix: String,
    pub tag: String,
}

/// git-flow's config, if the repo was initialised for it.
pub fn gitflow(root: &str) -> Option<Flow> {
    let cfg = open(root).ok()?.config().ok()?.snapshot().ok()?;
    let get = |k: &str, d: &str| cfg.get_string(k).unwrap_or_else(|_| d.to_owned());
    Some(Flow {
        main: cfg.get_string("gitflow.branch.master").ok()?,
        develop: cfg.get_string("gitflow.branch.develop").ok()?,
        feature: get("gitflow.prefix.feature", "feature/"),
        release: get("gitflow.prefix.release", "release/"),
        hotfix: get("gitflow.prefix.hotfix", "hotfix/"),
        tag: get("gitflow.prefix.versiontag", ""),
    })
}

#[derive(Debug, Serialize)]
pub struct Signature {
    /// git's %G? code: G good, B bad, U untrusted, X/Y expired, R revoked, E unverifiable, N none.
    pub status: String,
    pub signer: String,
}

// Pins verifier programs to global/system config so a repo's own .git/config can't pick one to run.
// ponytail: read once per process; restart GitHawk after changing gpg.program globally
fn trusted_verifiers() -> &'static [String] {
    static ARGS: std::sync::OnceLock<Vec<String>> = std::sync::OnceLock::new();
    ARGS.get_or_init(|| {
        let outside = std::env::temp_dir();
        let get = |scope: &str, key: &str| {
            run(&outside, &["config", scope, "--get", key], None)
                .ok()
                .map(|v| v.trim().to_owned())
                .filter(|v| !v.is_empty())
        };
        [
            ("gpg.program", "gpg"),
            ("gpg.ssh.program", "ssh-keygen"),
            ("gpg.x509.program", "gpgsm"),
        ]
        .into_iter()
        .flat_map(|(key, default)| {
            let value = get("--global", key)
                .or_else(|| get("--system", key))
                .unwrap_or_else(|| default.to_owned());
            ["-c".to_owned(), format!("{key}={value}")]
        })
        .collect()
    })
}

pub fn signature(root: &str, id: &str) -> Result<Signature, String> {
    if !id.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("Invalid commit id".into());
    }
    let mut args: Vec<&str> = trusted_verifiers().iter().map(String::as_str).collect();
    args.extend(["log", "-1", "--format=%G?%x1f%GS", id]);
    let out = run(Path::new(root), &args, None)?;
    let (status, signer) = out.trim().split_once('\x1f').unwrap_or((out.trim(), ""));
    Ok(Signature {
        status: status.to_owned(),
        signer: signer.to_owned(),
    })
}

/// When the repository was last fetched, from FETCH_HEAD's modification time (Unix seconds).
pub fn last_fetch(root: &str) -> Option<i64> {
    let repo = git2::Repository::open(root).ok()?;
    let modified = std::fs::metadata(repo.path().join("FETCH_HEAD"))
        .ok()?
        .modified()
        .ok()?;
    Some(
        modified
            .duration_since(std::time::UNIX_EPOCH)
            .ok()?
            .as_secs() as i64,
    )
}

/// How many commits `a` has that `b` doesn't (ahead), and the reverse (behind).
pub fn ahead_behind(root: &str, a: &str, b: &str) -> Result<(usize, usize), String> {
    let repo = Repository::open(root).map_err(e)?;
    let oid = |r: &str| {
        repo.revparse_single(r)
            .and_then(|o| o.peel_to_commit())
            .map(|c| c.id())
            .map_err(e)
    };
    repo.graph_ahead_behind(oid(a)?, oid(b)?).map_err(e)
}

/// Distinct author emails of the newest `limit` commits, most recent first, lowercased.
pub fn authors(root: &str, limit: usize) -> Vec<String> {
    let out = run(
        Path::new(root),
        &[
            "log",
            "--no-show-signature",
            "--all",
            "--format=%ae",
            &format!("-n{limit}"),
        ],
        None,
    )
    .unwrap_or_default();
    let mut seen = std::collections::HashSet::new();
    out.lines()
        .map(str::to_lowercase)
        .filter(|e| !e.is_empty() && seen.insert(e.clone()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn repo_config_cannot_pick_a_verifier_program() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path();
        let git = |args: &[&str]| run(p, args, None).unwrap();
        git(&["init", "-q"]);
        git(&[
            "-c",
            "user.name=a",
            "-c",
            "user.email=a@a",
            "commit",
            "-q",
            "--allow-empty",
            "-m",
            "base",
        ]);
        let tree = git(&["rev-parse", "HEAD^{tree}"]);
        let parent = git(&["rev-parse", "HEAD"]);
        let raw = format!(
            "tree {}\nparent {}\nauthor a <a@a> 1700000000 +0000\ncommitter a <a@a> 1700000000 +0000\ngpgsig -----BEGIN PGP SIGNATURE-----\n \n AAAA\n -----END PGP SIGNATURE-----\n\nsigned\n",
            tree.trim(),
            parent.trim()
        );
        std::fs::write(p.join("c.txt"), raw).unwrap();
        let id = git(&["hash-object", "-t", "commit", "-w", "c.txt"])
            .trim()
            .to_owned();
        std::fs::remove_file(p.join("c.txt")).unwrap();
        git(&["update-ref", "refs/heads/signed", &id]);

        let marker = p.join("ran");
        let script = p.join("evil.sh");
        std::fs::write(
            &script,
            format!("#!/bin/sh\ntouch '{}'\nexit 1\n", marker.display()),
        )
        .unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        git(&["config", "gpg.program", script.to_str().unwrap()]);
        git(&["config", "log.showSignature", "true"]);

        let root = p.to_str().unwrap();
        signature(root, &id).unwrap();
        authors(root, 10);
        assert!(
            !marker.exists(),
            "a program from the repository's config ran"
        );
    }

    #[test]
    fn history_follows_renames_and_conflicts_resolve() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path();
        let root = p.to_str().unwrap();
        let git = |args: &[&str]| run(p, args, None).unwrap();
        git(&["init", "-q", "-b", "main"]);
        git(&["config", "user.email", "t@t"]);
        git(&["config", "user.name", "t"]);
        std::fs::write(p.join("old.txt"), "one\ntwo\nthree\nfour\n").unwrap();
        git(&["add", "."]);
        git(&["commit", "-qm", "add"]);
        git(&["mv", "old.txt", "new.txt"]);
        git(&["commit", "-qm", "rename"]);

        let h = history(root, "new.txt").unwrap();
        assert_eq!(
            h.iter()
                .map(|c| (c.summary.as_str(), c.path.as_str()))
                .collect::<Vec<_>>(),
            [("rename", "new.txt"), ("add", "old.txt")]
        );
        assert_eq!(blame(root, "new.txt").unwrap().len(), 4);
        assert!(reflog(root).unwrap().len() >= 2);
        assert_eq!(files(root).unwrap(), ["new.txt"]);

        git(&["switch", "-qc", "other"]);
        std::fs::write(p.join("new.txt"), "one\nTHEIRS\nthree\nfour\n").unwrap();
        git(&["commit", "-qam", "theirs"]);
        git(&["switch", "-q", "main"]);
        std::fs::write(p.join("new.txt"), "one\nOURS\nthree\nfour\n").unwrap();
        git(&["commit", "-qam", "ours"]);
        assert!(run(p, &["merge", "other"], None).is_err());
        let c = conflict(root, "new.txt").unwrap();
        assert!(c.ours.unwrap().contains("OURS") && c.theirs.unwrap().contains("THEIRS"));
        assert!(c.merged.contains("<<<<<<<"));
        resolve(root, "new.txt", "one\nBOTH\nthree\nfour\n").unwrap();
        assert_eq!(git(&["diff", "--name-only", "--diff-filter=U"]), "");
        assert_eq!(worktrees(root).unwrap().len(), 1);
    }
}
