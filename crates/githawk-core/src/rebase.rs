use std::path::Path;
use std::process::Stdio;

use git2::{Oid, Repository, Sort};
use serde::{Deserialize, Serialize};

use crate::ops;

#[derive(Debug, Serialize)]
pub struct TodoItem {
    pub id: String,
    pub summary: String,
    pub message: String,
}

#[derive(Debug, Deserialize)]
pub struct Step {
    /// pick, reword, edit, squash, fixup or drop.
    pub action: String,
    pub id: String,
    #[serde(default)]
    pub message: String,
}

fn e(err: git2::Error) -> String {
    err.message().to_owned()
}

/// Commits that `git rebase -i <base>` would list, oldest first. No base means from the root.
pub fn todo(root: &str, base: Option<&str>) -> Result<Vec<TodoItem>, String> {
    let repo = Repository::discover(root).map_err(e)?;
    let mut walk = repo.revwalk().map_err(e)?;
    walk.set_sorting(Sort::TOPOLOGICAL | Sort::REVERSE)
        .map_err(e)?;
    walk.push_head().map_err(e)?;
    if let Some(b) = base {
        walk.hide(Oid::from_str(b).map_err(e)?).map_err(e)?;
    }
    let mut out = Vec::new();
    for oid in walk {
        let c = repo.find_commit(oid.map_err(e)?).map_err(e)?;
        if c.parent_count() > 1 {
            continue;
        }
        out.push(TodoItem {
            id: c.id().to_string(),
            summary: c.summary().unwrap_or_default().to_owned(),
            message: c.message().unwrap_or_default().to_owned(),
        });
    }
    Ok(out)
}

fn quote(p: &Path) -> String {
    format!("'{}'", p.to_string_lossy().replace('\'', r"'\''"))
}

pub fn build(root: &str, steps: &[Step]) -> Result<String, String> {
    let dir = Repository::discover(root)
        .map_err(e)?
        .path()
        .join("githawk");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut todo = String::new();
    for (i, s) in steps.iter().enumerate() {
        if !s.id.chars().all(|c| c.is_ascii_hexdigit()) || s.id.len() < 7 {
            return Err(format!("Invalid commit id {:?}", s.id));
        }
        match s.action.as_str() {
            "drop" => continue,
            "pick" | "edit" | "squash" | "fixup" => {
                todo.push_str(&format!("{} {}\n", s.action, s.id))
            }
            "reword" => {
                let msg = dir.join(format!("reword-{i}.txt"));
                std::fs::write(&msg, &s.message).map_err(|e| e.to_string())?;
                todo.push_str(&format!(
                    "pick {}\nexec git commit --amend --only --allow-empty -F {}\n",
                    s.id,
                    quote(&msg)
                ));
            }
            other => return Err(format!("Unknown rebase action {other:?}")),
        }
    }
    if steps
        .first()
        .is_some_and(|s| matches!(s.action.as_str(), "squash" | "fixup"))
    {
        return Err(
            "The first commit can't be squashed: there is nothing before it to squash into.".into(),
        );
    }
    Ok(todo)
}

/// Runs `git rebase -i` with `todo` as the instruction list.
pub fn run(root: &str, base: Option<&str>, todo: &str) -> Result<(), String> {
    let repo = Repository::discover(root).map_err(e)?;
    let file = repo.path().join("githawk").join("rebase-todo");
    std::fs::create_dir_all(file.parent().unwrap()).map_err(|e| e.to_string())?;
    let todo = if todo.trim().is_empty() {
        "noop\n"
    } else {
        todo
    };
    std::fs::write(&file, todo).map_err(|e| e.to_string())?;
    let mut c = ops::git(Path::new(root));
    c.env("GIT_SEQUENCE_EDITOR", format!("cp {}", quote(&file)))
        .args(["rebase", "-i", "--autostash"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    match base {
        Some(b) if b.chars().all(|c| c.is_ascii_hexdigit()) => c.arg(b),
        Some(b) => return Err(format!("Invalid base {b:?}")),
        None => c.arg("--root"),
    };
    let started = std::time::Instant::now();
    let out = c.output().map_err(|e| format!("Failed to run git: {e}"))?;
    let args = ["rebase", "-i", "--autostash", base.unwrap_or("--root")];
    ops::log_command(
        Path::new(root),
        &args,
        out.status.code(),
        started,
        &String::from_utf8_lossy(&out.stderr),
    );
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reorder_squash_reword_and_drop() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path();
        let root = p.to_str().unwrap();
        let git = |args: &[&str]| ops::run(p, args, None).unwrap();
        git(&["init", "-q", "-b", "main"]);
        git(&["config", "user.email", "t@t"]);
        git(&["config", "user.name", "t"]);
        for n in ["base", "a", "b", "c", "d"] {
            std::fs::write(p.join(n), n).unwrap();
            git(&["add", "."]);
            git(&["commit", "-qm", n]);
        }
        let base = git(&["rev-parse", "HEAD~4"]).trim().to_owned();
        let items = todo(root, Some(&base)).unwrap();
        assert_eq!(
            items.iter().map(|i| i.summary.as_str()).collect::<Vec<_>>(),
            ["a", "b", "c", "d"]
        );
        let step = |action: &str, i: usize, message: &str| Step {
            action: action.into(),
            id: items[i].id.clone(),
            message: message.into(),
        };
        let steps = [
            step("pick", 2, ""),
            step("reword", 0, "A it's renamed\n"),
            step("fixup", 1, ""),
            step("drop", 3, ""),
        ];
        run(root, Some(&base), &build(root, &steps).unwrap()).unwrap();
        assert_eq!(git(&["log", "--format=%s"]), "A it's renamed\nc\nbase\n");
        assert!(!p.join("d").exists() && p.join("b").exists());
    }
}
