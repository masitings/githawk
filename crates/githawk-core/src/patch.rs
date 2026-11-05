use git2::{Patch, Repository};
use serde::Deserialize;

use crate::repo::{Target, make_diff};
use crate::{Error, ops};

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Stage,
    Unstage,
    Discard,
}

/// Applies only the selected `(hunk, line)` pairs of one file's diff.
/// Line indices count the ' ', '+' and '-' lines of a hunk, as `repo::diff` returns them.
pub fn apply_lines(
    path: &str,
    file: &str,
    mode: Mode,
    selected: &[(usize, usize)],
) -> Result<(), Error> {
    let repo = Repository::discover(path)?;
    let target = match mode {
        Mode::Stage | Mode::Discard => Target::Unstaged,
        Mode::Unstage => Target::Staged,
    };
    let diff = make_diff(&repo, &target, Some(file))?;
    let mut patch = Patch::from_diff(&diff, 0)?.ok_or_else(|| Error::from_str("no changes"))?;
    let text = String::from_utf8_lossy(&patch.to_buf()?).into_owned();
    let reverse = !matches!(mode, Mode::Stage);
    let Some(partial) = select(&text, selected, reverse) else {
        return Ok(());
    };
    let mut args = vec!["apply", "--recount", "--whitespace=nowarn"];
    if !matches!(mode, Mode::Discard) {
        args.push("--cached");
    }
    if reverse {
        args.push("--reverse");
    }
    args.push("-");
    let root = repo
        .workdir()
        .ok_or_else(|| Error::from_str("bare repository"))?;
    ops::run(root, &args, Some(&partial))
        .map(drop)
        .map_err(|e| Error::from_str(&e))
}

/// Keeps selected lines. An unselected line on the side being changed is dropped;
/// one on the other side becomes context, so the untouched side stays valid.
fn select(text: &str, selected: &[(usize, usize)], reverse: bool) -> Option<String> {
    let (drop_c, ctx_c) = if reverse { ('-', '+') } else { ('+', '-') };
    let mut out = String::new();
    let mut hunk: Option<usize> = None;
    let mut body = String::new();
    let mut any = false;
    let mut line = 0;
    let mut dropped = false;
    let flush = |out: &mut String, body: &mut String, any: &mut bool| {
        if *any {
            out.push_str(body);
        }
        body.clear();
        *any = false;
    };
    for l in text.split_inclusive('\n') {
        if l.starts_with("@@") {
            flush(&mut out, &mut body, &mut any);
            hunk = Some(hunk.map_or(0, |h| h + 1));
            line = 0;
            body.push_str(l);
            continue;
        }
        let Some(h) = hunk else {
            out.push_str(l);
            continue;
        };
        let c = l.chars().next().unwrap_or(' ');
        if c == '\\' {
            if !dropped {
                body.push_str(l);
            }
            continue;
        }
        let picked = selected.contains(&(h, line));
        line += 1;
        dropped = false;
        if picked && c != ' ' {
            any = true;
            body.push_str(l);
        } else if c == drop_c {
            dropped = true;
        } else if c == ctx_c {
            body.push(' ');
            body.push_str(&l[1..]);
        } else {
            body.push_str(l);
        }
    }
    flush(&mut out, &mut body, &mut any);
    out.contains("\n@@").then_some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    const P: &str = "diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n@@ -10,2 +10,3 @@\n x\n+y\n z\n";

    #[test]
    fn stage_one_line() {
        let out = select(P, &[(0, 2)], false).unwrap();
        assert_eq!(
            out,
            "diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,3 +1,3 @@\n a\n b\n+B\n c\n"
        );
    }

    #[test]
    fn unstage_one_line() {
        let out = select(P, &[(0, 1)], true).unwrap();
        assert!(out.ends_with("@@ -1,3 +1,3 @@\n a\n-b\n B\n c\n"), "{out}");
    }

    #[test]
    fn nothing_selected() {
        assert!(select(P, &[], false).is_none());
    }

    #[test]
    fn stage_and_unstage_single_lines_in_real_repo() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path();
        let git = |args: &[&str]| ops::run(p, args, None).unwrap();
        git(&["init", "-q"]);
        git(&["config", "user.email", "t@t"]);
        git(&["config", "user.name", "t"]);
        let body: String = (1..=20).map(|i| format!("line{i}\n")).collect();
        std::fs::write(p.join("f.txt"), &body).unwrap();
        git(&["add", "."]);
        git(&["commit", "-qm", "init"]);
        std::fs::write(
            p.join("f.txt"),
            body.replace("line2\n", "two\n")
                .replace("line19\n", "nineteen\n"),
        )
        .unwrap();

        let path = p.to_str().unwrap();
        let unstaged = crate::repo::diff(path, &Target::Unstaged, Some("f.txt")).unwrap();
        assert_eq!(unstaged[0].hunks.len(), 2);
        let plus = unstaged[0].hunks[1]
            .lines
            .iter()
            .position(|l| l.origin == '+')
            .unwrap();
        let minus = plus - 1;
        apply_lines(path, "f.txt", Mode::Stage, &[(1, minus), (1, plus)]).unwrap();
        let staged = git(&["diff", "--cached"]);
        assert!(
            staged.contains("+nineteen") && !staged.contains("+two"),
            "{staged}"
        );

        apply_lines(path, "f.txt", Mode::Unstage, &[(0, minus), (0, plus)]).unwrap();
        assert_eq!(git(&["diff", "--cached"]), "");

        let unstaged = crate::repo::diff(path, &Target::Unstaged, Some("f.txt")).unwrap();
        let all: Vec<_> = (0..unstaged[0].hunks[0].lines.len())
            .map(|l| (0, l))
            .collect();
        apply_lines(path, "f.txt", Mode::Discard, &all).unwrap();
        let left = git(&["diff"]);
        assert!(
            left.contains("+nineteen") && !left.contains("+two"),
            "{left}"
        );
    }
}
