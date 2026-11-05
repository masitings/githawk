use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use git2::Repository;
use serde::{Deserialize, Serialize};

use crate::ops::run;

const KEEP: usize = 100;

/// HEAD plus every branch and tag, enough to put refs back where they were.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Snapshot {
    /// "ref:refs/heads/x" when on a branch, else the detached commit id.
    pub head: String,
    pub refs: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entry {
    pub label: String,
    /// Undo a commit by `reset --soft`, so its changes come back staged.
    pub soft: bool,
    /// Unix seconds, UTC.
    pub time: i64,
    pub before: Snapshot,
    pub after: Snapshot,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct Log {
    pub entries: Vec<Entry>,
    /// `entries[..pos]` are applied; the rest were undone and can be redone.
    pub pos: usize,
}

pub fn snapshot(root: &str) -> Result<Snapshot, String> {
    let repo = Repository::discover(root).map_err(|e| e.message().to_owned())?;
    let head = repo
        .find_reference("HEAD")
        .map_err(|e| e.message().to_owned())?;
    let head = match head.symbolic_target() {
        Some(t) => format!("ref:{t}"),
        None => head.target().map(|o| o.to_string()).unwrap_or_default(),
    };
    let mut refs = BTreeMap::new();
    for r in repo
        .references()
        .map_err(|e| e.message().to_owned())?
        .flatten()
    {
        let (Some(name), Some(target)) = (r.name(), r.target()) else {
            continue;
        };
        if name.starts_with("refs/heads/") || name.starts_with("refs/tags/") {
            refs.insert(name.to_owned(), target.to_string());
        }
    }
    Ok(Snapshot { head, refs })
}

fn log_path(root: &str) -> Result<PathBuf, String> {
    let repo = Repository::discover(root).map_err(|e| e.message().to_owned())?;
    Ok(repo.path().join("githawk").join("oplog.json"))
}

pub fn load(root: &str) -> Log {
    log_path(root)
        .ok()
        .and_then(|p| std::fs::read(p).ok())
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn save(root: &str, log: &Log) -> Result<(), String> {
    let p = log_path(root)?;
    std::fs::create_dir_all(p.parent().unwrap()).map_err(|e| e.to_string())?;
    let tmp = p.with_extension("tmp");
    std::fs::write(&tmp, serde_json::to_vec(log).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    std::fs::rename(tmp, p).map_err(|e| e.to_string())
}

pub fn record(
    root: &str,
    label: String,
    soft: bool,
    before: Snapshot,
    after: Snapshot,
) -> Result<(), String> {
    if before == after {
        return Ok(());
    }
    let mut log = load(root);
    log.entries.truncate(log.pos);
    let time = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or_default();
    log.entries.push(Entry {
        label,
        soft,
        time,
        before,
        after,
    });
    if log.entries.len() > KEEP {
        log.entries.drain(..log.entries.len() - KEEP);
    }
    log.pos = log.entries.len();
    save(root, &log)
}

pub fn undo(root: &str) -> Result<String, String> {
    let mut log = load(root);
    let e = log
        .pos
        .checked_sub(1)
        .map(|i| log.entries[i].clone())
        .ok_or("Nothing to undo")?;
    restore(root, &e.after, &e.before, e.soft)?;
    log.pos -= 1;
    save(root, &log)?;
    Ok(e.label)
}

pub fn redo(root: &str) -> Result<String, String> {
    let mut log = load(root);
    let e = log.entries.get(log.pos).cloned().ok_or("Nothing to redo")?;
    restore(root, &e.before, &e.after, e.soft)?;
    log.pos += 1;
    save(root, &log)?;
    Ok(e.label)
}

fn restore(root: &str, expected: &Snapshot, target: &Snapshot, soft: bool) -> Result<(), String> {
    let now = snapshot(root)?;
    if now != *expected {
        return Err(
            "The repository changed since this operation, so it can't be undone safely.".into(),
        );
    }
    let dir = Path::new(root);
    let git = |args: &[&str]| run(dir, args, None).map(drop);
    let branch = |head: &str| head.strip_prefix("ref:").map(str::to_owned);
    let cur = branch(&now.head);
    let names: BTreeSet<&String> = now.refs.keys().chain(target.refs.keys()).collect();

    for name in &names {
        if Some(name.as_str()) == cur.as_deref() {
            continue;
        }
        if let Some(oid) = target.refs.get(*name)
            && now.refs.get(*name) != Some(oid)
        {
            git(&["update-ref", name, oid])?;
        }
    }

    if now.head != target.head {
        match branch(&target.head) {
            Some(b) => git(&["switch", b.trim_start_matches("refs/heads/")])?,
            None => git(&["switch", "--detach", &target.head])?,
        }
    } else {
        let want = match &cur {
            Some(b) => target.refs.get(b).cloned(),
            None => Some(target.head.clone()),
        };
        let have = match &cur {
            Some(b) => now.refs.get(b).cloned(),
            None => Some(now.head.clone()),
        };
        if let Some(w) = want.filter(|w| Some(w) != have.as_ref()) {
            git(&["reset", if soft { "--soft" } else { "--keep" }, &w])?;
        }
    }

    for name in &names {
        let checked_out = branch(&target.head).as_deref() == Some(name.as_str());
        match target.refs.get(*name) {
            None if now.refs.contains_key(*name) => git(&["update-ref", "-d", name])?,
            Some(oid)
                if Some(name.as_str()) == cur.as_deref()
                    && !checked_out
                    && now.refs.get(*name) != Some(oid) =>
            {
                git(&["update-ref", name, oid])?
            }
            _ => {}
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn undo_and_redo_commit_branch_and_checkout() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path();
        let root = p.to_str().unwrap();
        let git = |args: &[&str]| run(p, args, None).unwrap();
        git(&["init", "-q", "-b", "main"]);
        git(&["config", "user.email", "t@t"]);
        git(&["config", "user.name", "t"]);
        std::fs::write(p.join("a"), "1").unwrap();
        git(&["add", "."]);
        git(&["commit", "-qm", "one"]);

        let tracked = |label: &str, soft: bool, f: &dyn Fn()| {
            let before = snapshot(root).unwrap();
            f();
            record(root, label.into(), soft, before, snapshot(root).unwrap()).unwrap();
        };
        std::fs::write(p.join("a"), "2").unwrap();
        tracked("commit", true, &|| {
            git(&["commit", "-qam", "two"]);
        });
        tracked("branch", false, &|| {
            git(&["switch", "-qc", "feat"]);
        });
        tracked("rename", false, &|| {
            git(&["branch", "-m", "feat", "feature"]);
        });

        assert_eq!(undo(root).unwrap(), "rename");
        assert_eq!(git(&["branch", "--show-current"]), "feat\n");
        assert_eq!(undo(root).unwrap(), "branch");
        assert_eq!(git(&["branch", "--format=%(refname:short)"]), "main\n");
        assert_eq!(undo(root).unwrap(), "commit");
        assert_eq!(git(&["log", "--format=%s"]), "one\n");
        assert_eq!(git(&["status", "--porcelain"]), "M  a\n");
        assert!(undo(root).is_err());

        assert_eq!(redo(root).unwrap(), "commit");
        assert_eq!(git(&["log", "--format=%s"]), "two\none\n");
        assert_eq!(redo(root).unwrap(), "branch");
        assert_eq!(redo(root).unwrap(), "rename");
        assert_eq!(git(&["branch", "--show-current"]), "feature\n");

        git(&["commit", "-q", "--allow-empty", "-m", "outside"]);
        assert!(undo(root).unwrap_err().contains("changed"));
    }
}
