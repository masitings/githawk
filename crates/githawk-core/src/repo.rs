use git2::{
    Delta, Diff, DiffOptions, Oid, Patch, Repository, RepositoryState, Status as S, StatusOptions,
};
use serde::{Deserialize, Serialize};

use crate::Error;

#[derive(Debug, Serialize)]
pub struct FileStatus {
    pub path: String,
    /// One of A M D R T, or None when the side is unchanged.
    pub staged: Option<char>,
    /// One of ? M D R T, or None when the side is unchanged.
    pub unstaged: Option<char>,
    pub conflicted: bool,
}

#[derive(Debug, Serialize)]
pub struct Status {
    pub files: Vec<FileStatus>,
    /// "clean", "merge", "rebase", "cherry-pick", "revert", ...
    pub state: &'static str,
    pub branch: Option<String>,
}

pub fn status(path: &str) -> Result<Status, Error> {
    let repo = Repository::discover(path)?;
    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .renames_head_to_index(true);
    let files = repo
        .statuses(Some(&mut opts))?
        .iter()
        .filter_map(|e| {
            let s = e.status();
            let staged = [
                (S::INDEX_NEW, 'A'),
                (S::INDEX_MODIFIED, 'M'),
                (S::INDEX_DELETED, 'D'),
                (S::INDEX_RENAMED, 'R'),
                (S::INDEX_TYPECHANGE, 'T'),
            ]
            .into_iter()
            .find(|(f, _)| s.contains(*f))
            .map(|(_, c)| c);
            let unstaged = [
                (S::WT_NEW, '?'),
                (S::WT_MODIFIED, 'M'),
                (S::WT_DELETED, 'D'),
                (S::WT_RENAMED, 'R'),
                (S::WT_TYPECHANGE, 'T'),
            ]
            .into_iter()
            .find(|(f, _)| s.contains(*f))
            .map(|(_, c)| c);
            let conflicted = s.contains(S::CONFLICTED);
            (staged.is_some() || unstaged.is_some() || conflicted).then(|| FileStatus {
                path: e.path().unwrap_or_default().to_owned(),
                staged,
                unstaged,
                conflicted,
            })
        })
        .collect();
    let state = match repo.state() {
        RepositoryState::Clean => "clean",
        RepositoryState::Merge => "merge",
        RepositoryState::Revert | RepositoryState::RevertSequence => "revert",
        RepositoryState::CherryPick | RepositoryState::CherryPickSequence => "cherry-pick",
        RepositoryState::Bisect => "bisect",
        RepositoryState::Rebase
        | RepositoryState::RebaseInteractive
        | RepositoryState::RebaseMerge => "rebase",
        RepositoryState::ApplyMailbox | RepositoryState::ApplyMailboxOrRebase => "am",
    };
    let branch = repo
        .head()
        .ok()
        .filter(|h| h.is_branch())
        .and_then(|h| h.shorthand().map(str::to_owned))
        .or_else(|| {
            // Unborn branch: HEAD points at a ref that does not exist yet.
            repo.find_reference("HEAD").ok().and_then(|r| {
                r.symbolic_target()
                    .map(|t| t.trim_start_matches("refs/heads/").to_owned())
            })
        });
    Ok(Status {
        files,
        state,
        branch,
    })
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Target {
    Commit {
        id: String,
    },
    /// Changes from `from` to `to`; both accept any revision git understands.
    Range {
        from: String,
        to: String,
    },
    Staged,
    Unstaged,
}

#[derive(Debug, Serialize)]
pub struct Line {
    pub origin: char,
    pub old: Option<u32>,
    pub new: Option<u32>,
    pub text: String,
}

#[derive(Debug, Serialize)]
pub struct Hunk {
    pub header: String,
    pub lines: Vec<Line>,
}

#[derive(Debug, Serialize)]
pub struct FileDiff {
    pub path: String,
    pub old_path: Option<String>,
    pub status: char,
    pub binary: bool,
    /// Lines added and removed; only filled for commits when listing files.
    pub added: usize,
    pub deleted: usize,
    pub hunks: Vec<Hunk>,
}

pub(crate) fn make_diff<'r>(
    repo: &'r Repository,
    target: &Target,
    file: Option<&str>,
    ignore_whitespace: bool,
) -> Result<Diff<'r>, Error> {
    let mut opts = DiffOptions::new();
    opts.ignore_whitespace(ignore_whitespace);
    if let Some(f) = file {
        opts.pathspec(f).disable_pathspec_match(true);
    }
    let mut diff = match target {
        Target::Commit { id } => {
            let c = repo.find_commit(Oid::from_str(id)?)?;
            let old = c.parents().next().map(|p| p.tree()).transpose()?;
            repo.diff_tree_to_tree(old.as_ref(), Some(&c.tree()?), Some(&mut opts))?
        }
        Target::Range { from, to } => {
            let tree = |rev: &str| repo.revparse_single(rev).and_then(|o| o.peel_to_tree());
            repo.diff_tree_to_tree(Some(&tree(from)?), Some(&tree(to)?), Some(&mut opts))?
        }
        Target::Staged => {
            let head = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
            repo.diff_tree_to_index(head.as_ref(), None, Some(&mut opts))?
        }
        Target::Unstaged => {
            opts.include_untracked(true)
                .recurse_untracked_dirs(true)
                .show_untracked_content(true);
            repo.diff_index_to_workdir(None, Some(&mut opts))?
        }
    };
    if !matches!(target, Target::Unstaged) {
        diff.find_similar(None)?;
    }
    Ok(diff)
}

/// Lists changed files; hunks are filled only when `file` is given.
pub fn diff(
    path: &str,
    target: &Target,
    file: Option<&str>,
    ignore_whitespace: bool,
) -> Result<Vec<FileDiff>, Error> {
    let repo = Repository::discover(path)?;
    let diff = make_diff(&repo, target, file, ignore_whitespace)?;
    let mut out = Vec::new();
    for (i, d) in diff.deltas().enumerate() {
        let new_path = d.new_file().path().or(d.old_file().path());
        let path = new_path
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default();
        let old_path = d
            .old_file()
            .path()
            .map(|p| p.to_string_lossy().into_owned())
            .filter(|p| *p != path);
        let status = match d.status() {
            Delta::Added | Delta::Untracked => 'A',
            Delta::Deleted => 'D',
            Delta::Renamed => 'R',
            Delta::Copied => 'C',
            Delta::Typechange => 'T',
            Delta::Conflicted => 'U',
            _ => 'M',
        };
        let mut f = FileDiff {
            path,
            old_path,
            status,
            binary: d.flags().is_binary(),
            added: 0,
            deleted: 0,
            hunks: Vec::new(),
        };
        if file.is_none()
            && matches!(target, Target::Commit { .. } | Target::Range { .. })
            && let Some(patch) = Patch::from_diff(&diff, i)?
        {
            let (_, added, deleted) = patch.line_stats()?;
            (f.added, f.deleted) = (added, deleted);
        }
        if file.is_some()
            && let Some(patch) = Patch::from_diff(&diff, i)?
        {
            f.binary |= patch.delta().flags().is_binary();
            for h in 0..patch.num_hunks() {
                let (hunk, n) = patch.hunk(h)?;
                let mut lines = Vec::with_capacity(n);
                for l in 0..n {
                    let line = patch.line_in_hunk(h, l)?;
                    let origin = line.origin();
                    if !matches!(origin, ' ' | '+' | '-') {
                        continue;
                    }
                    lines.push(Line {
                        origin,
                        old: line.old_lineno(),
                        new: line.new_lineno(),
                        text: String::from_utf8_lossy(line.content())
                            .trim_end_matches(['\n', '\r'])
                            .to_owned(),
                    });
                }
                let header = String::from_utf8_lossy(hunk.header()).trim_end().to_owned();
                f.hunks.push(Hunk { header, lines });
            }
        }
        out.push(f);
    }
    Ok(out)
}

#[derive(Debug, Serialize)]
pub struct CommitInfo {
    pub id: String,
    pub parents: Vec<String>,
    pub author: String,
    pub email: String,
    /// Unix seconds, UTC.
    pub time: i64,
    pub committer: String,
    pub message: String,
}

/// `rev` is any revision git understands, such as a SHA or "HEAD".
pub fn commit_info(path: &str, rev: &str) -> Result<CommitInfo, Error> {
    let repo = Repository::discover(path)?;
    let c = repo.revparse_single(rev)?.peel_to_commit()?;
    let a = c.author();
    Ok(CommitInfo {
        id: c.id().to_string(),
        parents: c.parent_ids().map(|p| p.to_string()).collect(),
        author: a.name().unwrap_or_default().to_owned(),
        email: a.email().unwrap_or_default().to_owned(),
        time: a.when().seconds(),
        committer: c.committer().name().unwrap_or_default().to_owned(),
        message: c.message().unwrap_or_default().to_owned(),
    })
}

#[derive(Debug, Serialize)]
pub struct Branch {
    pub name: String,
    pub tip: String,
    pub head: bool,
    pub upstream: Option<String>,
    pub ahead: usize,
    pub behind: usize,
}

#[derive(Debug, Serialize)]
pub struct Named {
    pub name: String,
    pub tip: String,
}

#[derive(Debug, Serialize)]
pub struct Stash {
    pub index: usize,
    pub message: String,
    pub tip: String,
}

#[derive(Debug, Serialize)]
pub struct Refs {
    pub local: Vec<Branch>,
    pub remote: Vec<Named>,
    pub remotes: Vec<String>,
    /// Fetch URL per remote name.
    pub urls: std::collections::BTreeMap<String, String>,
    pub tags: Vec<Named>,
    pub stashes: Vec<Stash>,
}

pub fn refs(path: &str) -> Result<Refs, Error> {
    let mut repo = Repository::discover(path)?;
    let mut local = Vec::new();
    let mut remote = Vec::new();
    for b in repo.branches(None)? {
        let (b, kind) = b?;
        let Some(name) = b.name()?.map(str::to_owned) else {
            continue;
        };
        let Some(tip) = b.get().target() else {
            continue;
        };
        if kind == git2::BranchType::Remote {
            if !name.ends_with("/HEAD") {
                remote.push(Named {
                    name,
                    tip: tip.to_string(),
                });
            }
            continue;
        }
        let up = b.upstream().ok();
        let upstream = up
            .as_ref()
            .and_then(|u| u.name().ok().flatten().map(str::to_owned));
        let (ahead, behind) = up
            .and_then(|u| u.get().target())
            .and_then(|u| repo.graph_ahead_behind(tip, u).ok())
            .unwrap_or((0, 0));
        local.push(Branch {
            name,
            tip: tip.to_string(),
            head: b.is_head(),
            upstream,
            ahead,
            behind,
        });
    }
    let remotes: Vec<String> = repo
        .remotes()?
        .iter()
        .flatten()
        .map(str::to_owned)
        .collect();
    let urls = remotes
        .iter()
        .filter_map(|n: &String| Some((n.clone(), repo.find_remote(n).ok()?.url()?.to_owned())))
        .collect();
    let mut tags = Vec::new();
    repo.tag_foreach(|oid, name| {
        let name = String::from_utf8_lossy(name)
            .trim_start_matches("refs/tags/")
            .to_owned();
        let tip = repo
            .find_object(oid, None)
            .and_then(|o| o.peel_to_commit())
            .map(|c| c.id())
            .unwrap_or(oid);
        tags.push(Named {
            name,
            tip: tip.to_string(),
        });
        true
    })?;
    let mut stashes = Vec::new();
    repo.stash_foreach(|index, message, oid| {
        stashes.push(Stash {
            index,
            message: message.to_owned(),
            tip: oid.to_string(),
        });
        true
    })?;
    Ok(Refs {
        local,
        remote,
        remotes,
        urls,
        tags,
        stashes,
    })
}

/// Reads a file at `rev`: a commit id, "HEAD", "index" or "workdir".
pub fn blob(path: &str, rev: &str, file: &str) -> Result<Vec<u8>, Error> {
    let repo = Repository::discover(path)?;
    match rev {
        "workdir" => {
            let root = repo
                .workdir()
                .ok_or_else(|| Error::from_str("bare repository"))?;
            std::fs::read(root.join(file)).map_err(|e| Error::from_str(&e.to_string()))
        }
        "index" => {
            let entry = repo
                .index()?
                .get_path(std::path::Path::new(file), 0)
                .ok_or_else(|| Error::from_str("not in index"))?;
            Ok(repo.find_blob(entry.id)?.content().to_vec())
        }
        rev => {
            let tree = repo.revparse_single(rev)?.peel_to_tree()?;
            let entry = tree.get_path(std::path::Path::new(file))?;
            Ok(repo.find_blob(entry.id())?.content().to_vec())
        }
    }
}

/// Repository root (work tree, or git dir when bare).
pub fn root(path: &str) -> Result<String, Error> {
    let repo = Repository::discover(path)?;
    let p = repo.workdir().unwrap_or(repo.path());
    Ok(p.to_string_lossy().trim_end_matches('/').to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn range_and_whitespace() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path();
        let git = |args: &[&str]| crate::ops::run(p, args, None).unwrap();
        git(&["init", "-q", "-b", "main"]);
        git(&["config", "user.email", "t@t"]);
        git(&["config", "user.name", "t"]);
        let commit = |text: &str| {
            std::fs::write(p.join("f.txt"), text).unwrap();
            git(&["commit", "-qam", "c"]);
        };
        std::fs::write(p.join("f.txt"), "a\n").unwrap();
        git(&["add", "f.txt"]);
        git(&["commit", "-qm", "c"]);
        commit("a\nb\n");
        commit("a \nb\nc\n");
        let range = Target::Range {
            from: "HEAD~2".into(),
            to: "main".into(),
        };
        let all = diff(p.to_str().unwrap(), &range, None, false).unwrap();
        assert_eq!((all[0].added, all[0].deleted), (3, 1));
        let one = diff(p.to_str().unwrap(), &range, Some("f.txt"), true).unwrap();
        let changed: Vec<_> = one[0].hunks[0]
            .lines
            .iter()
            .filter(|l| l.origin != ' ')
            .collect();
        assert!(
            changed.iter().all(|l| l.origin == '+'),
            "whitespace-only change hidden"
        );
    }
}
