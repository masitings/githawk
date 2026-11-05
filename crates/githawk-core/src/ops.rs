use std::collections::VecDeque;
use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::{Mutex, RwLock};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PullMode {
    Merge,
    FfOnly,
    Rebase,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ResetMode {
    Soft,
    Mixed,
    Hard,
    /// Like hard, but refuses to overwrite uncommitted changes.
    Keep,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "op", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum Op {
    Checkout {
        name: String,
    },
    CheckoutDetached {
        id: String,
    },
    CreateBranch {
        name: String,
        at: String,
        checkout: bool,
    },
    RenameBranch {
        old: String,
        new: String,
    },
    DeleteBranch {
        name: String,
        force: bool,
    },
    DeleteRemoteBranch {
        remote: String,
        name: String,
    },
    SetUpstream {
        branch: String,
        upstream: String,
    },
    UnsetUpstream {
        branch: String,
    },
    Fetch,
    Pull {
        mode: PullMode,
    },
    Push {
        remote: String,
        branch: String,
        force: bool,
        set_upstream: bool,
    },
    Merge {
        name: String,
    },
    Rebase {
        onto: String,
    },
    Abort {
        state: String,
    },
    Continue {
        state: String,
    },
    StashSave {
        message: String,
        untracked: bool,
    },
    StashApply {
        index: usize,
    },
    StashPop {
        index: usize,
    },
    StashDrop {
        index: usize,
    },
    Tag {
        name: String,
        at: String,
        message: String,
    },
    DeleteTag {
        name: String,
    },
    PushTag {
        remote: String,
        name: String,
    },
    Stage {
        paths: Vec<String>,
    },
    Unstage {
        paths: Vec<String>,
    },
    Discard {
        tracked: Vec<String>,
        untracked: Vec<String>,
    },
    Commit {
        summary: String,
        description: String,
        amend: bool,
        #[serde(default)]
        sign: bool,
    },
    /// Oldest first.
    CherryPick {
        ids: Vec<String>,
    },
    /// Newest first.
    Revert {
        ids: Vec<String>,
    },
    LfsPull,
    SubmoduleUpdate,
    WorktreeAdd {
        path: String,
        branch: String,
        create: bool,
    },
    WorktreeRemove {
        path: String,
        force: bool,
    },
    Reset {
        id: String,
        mode: ResetMode,
    },
    /// Writes git-flow's config keys so other git-flow tools agree with GitHawk.
    FlowInit {
        main: String,
        develop: String,
        create_develop: bool,
    },
    /// Merges `branch` with --no-ff into each of `into` in order, tags the first, then deletes it.
    FlowFinish {
        branch: String,
        into: Vec<String>,
        tag: Option<String>,
    },
}

impl Op {
    pub fn label(&self) -> String {
        match self {
            Op::Checkout { name } => format!("Checkout {name}"),
            Op::CheckoutDetached { id } => format!("Checkout {}", short(id)),
            Op::CreateBranch { name, .. } => format!("Create branch {name}"),
            Op::RenameBranch { old, new } => format!("Rename {old} to {new}"),
            Op::DeleteBranch { name, .. } => format!("Delete branch {name}"),
            Op::DeleteRemoteBranch { remote, name } => format!("Delete {remote}/{name}"),
            Op::SetUpstream { branch, .. } => format!("Set upstream of {branch}"),
            Op::UnsetUpstream { branch } => format!("Unset upstream of {branch}"),
            Op::Fetch => "Fetch".into(),
            Op::Pull { .. } => "Pull".into(),
            Op::Push { branch, .. } => format!("Push {branch}"),
            Op::Merge { name } => format!("Merge {name}"),
            Op::Rebase { onto } => format!("Rebase onto {onto}"),
            Op::Abort { state } => format!("Abort {state}"),
            Op::Continue { state } => format!("Continue {state}"),
            Op::StashSave { .. } => "Stash".into(),
            Op::StashApply { .. } => "Apply stash".into(),
            Op::StashPop { .. } => "Pop stash".into(),
            Op::StashDrop { .. } => "Drop stash".into(),
            Op::Tag { name, .. } => format!("Create tag {name}"),
            Op::DeleteTag { name } => format!("Delete tag {name}"),
            Op::PushTag { name, .. } => format!("Push tag {name}"),
            Op::Stage { .. } => "Stage".into(),
            Op::Unstage { .. } => "Unstage".into(),
            Op::Discard { .. } => "Discard".into(),
            Op::Commit {
                summary,
                amend: true,
                ..
            } => format!("Amend: {summary}"),
            Op::Commit { summary, .. } => format!("Commit: {summary}"),
            Op::CherryPick { ids } => format!("Cherry-pick {} commit(s)", ids.len()),
            Op::Revert { ids } => format!("Revert {} commit(s)", ids.len()),
            Op::Reset { id, .. } => format!("Reset to {}", short(id)),
            Op::LfsPull => "LFS pull".into(),
            Op::SubmoduleUpdate => "Update submodules".into(),
            Op::WorktreeAdd { path, .. } => format!("Add worktree {path}"),
            Op::WorktreeRemove { path, .. } => format!("Remove worktree {path}"),
            Op::FlowInit { .. } => "Initialise Gitflow".into(),
            Op::FlowFinish { branch, .. } => format!("Finish {branch}"),
        }
    }

    /// Network operations: run with progress and can be cancelled.
    pub fn is_long(&self) -> bool {
        matches!(
            self,
            Op::Fetch
                | Op::Pull { .. }
                | Op::Push { .. }
                | Op::DeleteRemoteBranch { .. }
                | Op::PushTag { .. }
        )
    }

    /// The git invocations for this op, run in order.
    pub fn commands(&self) -> Result<Vec<Vec<String>>, String> {
        let a = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        let cmd = match self {
            Op::Checkout { name } => a(&["switch", arg(name)?]),
            Op::CheckoutDetached { id } => a(&["switch", "--detach", arg(id)?]),
            Op::CreateBranch {
                name,
                at,
                checkout: true,
            } => a(&["switch", "-c", arg(name)?, arg(at)?]),
            Op::CreateBranch {
                name,
                at,
                checkout: false,
            } => a(&["branch", arg(name)?, arg(at)?]),
            Op::RenameBranch { old, new } => a(&["branch", "-m", arg(old)?, arg(new)?]),
            Op::DeleteBranch { name, force } => {
                a(&["branch", if *force { "-D" } else { "-d" }, arg(name)?])
            }
            Op::DeleteRemoteBranch { remote, name } => {
                a(&["push", "--progress", arg(remote)?, "--delete", arg(name)?])
            }
            Op::SetUpstream { branch, upstream } => {
                a(&["branch", "--set-upstream-to", arg(upstream)?, arg(branch)?])
            }
            Op::UnsetUpstream { branch } => a(&["branch", "--unset-upstream", arg(branch)?]),
            Op::Fetch => a(&["fetch", "--all", "--prune", "--progress"]),
            Op::Pull { mode } => a(&[
                "pull",
                "--progress",
                match mode {
                    PullMode::Merge => "--no-rebase",
                    PullMode::FfOnly => "--ff-only",
                    PullMode::Rebase => "--rebase",
                },
            ]),
            Op::Push {
                remote,
                branch,
                force,
                set_upstream,
            } => {
                let mut v = a(&["push", "--progress"]);
                if *force {
                    v.push("--force-with-lease".into());
                }
                if *set_upstream {
                    v.push("-u".into());
                }
                v.extend(a(&[arg(remote)?, arg(branch)?]));
                v
            }
            Op::Merge { name } => a(&["merge", "--no-edit", arg(name)?]),
            Op::Rebase { onto } => a(&["rebase", arg(onto)?]),
            Op::Abort { state } => a(&[sequencer(state)?, "--abort"]),
            Op::Continue { state } if state == "merge" => a(&["commit", "--no-edit"]),
            Op::Continue { state } => a(&[sequencer(state)?, "--continue"]),
            Op::StashSave { message, untracked } => {
                let mut v = a(&["stash", "push"]);
                if *untracked {
                    v.push("--include-untracked".into());
                }
                if !message.trim().is_empty() {
                    v.extend(a(&["-m", message]));
                }
                v
            }
            Op::StashApply { index } => {
                vec!["stash".into(), "apply".into(), format!("stash@{{{index}}}")]
            }
            Op::StashPop { index } => {
                vec!["stash".into(), "pop".into(), format!("stash@{{{index}}}")]
            }
            Op::StashDrop { index } => {
                vec!["stash".into(), "drop".into(), format!("stash@{{{index}}}")]
            }
            Op::Tag { name, at, message } if message.trim().is_empty() => {
                a(&["tag", arg(name)?, arg(at)?])
            }
            Op::Tag { name, at, message } => a(&["tag", "-a", arg(name)?, "-m", message, arg(at)?]),
            Op::DeleteTag { name } => a(&["tag", "-d", arg(name)?]),
            Op::PushTag { remote, name } => {
                vec![
                    "push".into(),
                    "--progress".into(),
                    arg(remote)?.into(),
                    format!("refs/tags/{}", arg(name)?),
                ]
            }
            Op::Stage { paths } => with_paths(a(&["add", "-A"]), paths),
            // `reset` also works on an unborn branch, unlike `restore --staged`.
            Op::Unstage { paths } => with_paths(a(&["reset", "-q"]), paths),
            Op::Discard { tracked, untracked } => {
                let mut cmds = Vec::new();
                if !tracked.is_empty() {
                    cmds.push(with_paths(a(&["checkout"]), tracked));
                }
                if !untracked.is_empty() {
                    cmds.push(with_paths(a(&["clean", "-fdq"]), untracked));
                }
                return Ok(cmds);
            }
            Op::Commit {
                summary,
                description,
                amend,
                sign,
            } => {
                if summary.trim().is_empty() {
                    return Err("Commit summary is empty".into());
                }
                let mut v = a(&["commit"]);
                if *amend {
                    v.push("--amend".into());
                }
                if *sign {
                    v.push("-S".into());
                }
                v.extend(a(&["-m", summary]));
                if !description.trim().is_empty() {
                    v.extend(a(&["-m", description]));
                }
                v
            }
            Op::CherryPick { ids } => with_args(a(&["cherry-pick"]), ids)?,
            Op::Revert { ids } => with_args(a(&["revert", "--no-edit"]), ids)?,
            Op::LfsPull => a(&["lfs", "pull"]),
            Op::SubmoduleUpdate => {
                a(&["submodule", "update", "--init", "--recursive", "--progress"])
            }
            Op::WorktreeAdd {
                path,
                branch,
                create: true,
            } => a(&["worktree", "add", "-b", arg(branch)?, "--", path]),
            Op::WorktreeAdd {
                path,
                branch,
                create: false,
            } => a(&["worktree", "add", "--", path, arg(branch)?]),
            Op::WorktreeRemove { path, force } => {
                let mut v = a(&["worktree", "remove"]);
                if *force {
                    v.push("--force".into());
                }
                with_paths(v, std::slice::from_ref(path))
            }
            Op::Reset { id, mode } => a(&[
                "reset",
                match mode {
                    ResetMode::Soft => "--soft",
                    ResetMode::Mixed => "--mixed",
                    ResetMode::Hard => "--hard",
                    ResetMode::Keep => "--keep",
                },
                arg(id)?,
            ]),
            Op::FlowInit {
                main,
                develop,
                create_develop,
            } => {
                let mut cmds: Vec<Vec<String>> = [
                    ("gitflow.branch.master", arg(main)?),
                    ("gitflow.branch.develop", arg(develop)?),
                    ("gitflow.prefix.feature", "feature/"),
                    ("gitflow.prefix.release", "release/"),
                    ("gitflow.prefix.hotfix", "hotfix/"),
                    ("gitflow.prefix.support", "support/"),
                    ("gitflow.prefix.versiontag", ""),
                ]
                .iter()
                .map(|(k, v)| a(&["config", k, v]))
                .collect();
                if *create_develop {
                    cmds.push(a(&["branch", develop, main]));
                }
                return Ok(cmds);
            }
            Op::FlowFinish { branch, into, tag } => {
                let branch = arg(branch)?;
                let mut cmds = Vec::new();
                for (i, target) in into.iter().enumerate() {
                    cmds.push(a(&["switch", arg(target)?]));
                    cmds.push(a(&["merge", "--no-ff", "--no-edit", branch]));
                    if let (0, Some(tag)) = (i, tag) {
                        cmds.push(a(&[
                            "tag",
                            "-a",
                            arg(tag)?,
                            "-m",
                            &format!("Release {tag}"),
                        ]));
                    }
                }
                cmds.push(a(&["branch", "-d", branch]));
                return Ok(cmds);
            }
        };
        Ok(vec![cmd])
    }
}

fn short(id: &str) -> &str {
    id.get(..7).unwrap_or(id)
}

/// Rejects values git would parse as options.
fn arg(s: &str) -> Result<&str, String> {
    if s.is_empty() || s.starts_with('-') || s.contains(['\0', '\n']) {
        Err(format!("Invalid name: {s:?}"))
    } else {
        Ok(s)
    }
}

fn sequencer(state: &str) -> Result<&'static str, String> {
    match state {
        "merge" => Ok("merge"),
        "rebase" => Ok("rebase"),
        "cherry-pick" => Ok("cherry-pick"),
        "revert" => Ok("revert"),
        _ => Err(format!("Nothing to continue or abort in state {state:?}")),
    }
}

fn with_args(mut v: Vec<String>, args: &[String]) -> Result<Vec<String>, String> {
    if args.is_empty() {
        return Err("No commits selected".into());
    }
    for x in args {
        v.push(arg(x)?.to_owned());
    }
    Ok(v)
}

fn with_paths(mut v: Vec<String>, paths: &[String]) -> Vec<String> {
    v.push("--".into());
    v.extend(paths.iter().cloned());
    v
}

static PROFILE_ENV: RwLock<Vec<(String, String)>> = RwLock::new(Vec::new());

/// Applies a profile's identity to every git command GitHawk runs, without touching git config.
pub fn set_identity(name: &str, email: &str, signing_key: &str) {
    let mut env = Vec::new();
    for (k, v) in [("NAME", name), ("EMAIL", email)] {
        if !v.trim().is_empty() {
            env.push((format!("GIT_AUTHOR_{k}"), v.trim().to_owned()));
            env.push((format!("GIT_COMMITTER_{k}"), v.trim().to_owned()));
        }
    }
    let key = signing_key.trim();
    if !key.is_empty() {
        let ssh = key.ends_with(".pub") || key.starts_with("ssh-") || key.starts_with("key::");
        env.push((
            "GIT_CONFIG_COUNT".into(),
            if ssh { "2" } else { "1" }.into(),
        ));
        env.push(("GIT_CONFIG_KEY_0".into(), "user.signingkey".into()));
        env.push(("GIT_CONFIG_VALUE_0".into(), key.to_owned()));
        if ssh {
            env.push(("GIT_CONFIG_KEY_1".into(), "gpg.format".into()));
            env.push(("GIT_CONFIG_VALUE_1".into(), "ssh".into()));
        }
    }
    *PROFILE_ENV.write().unwrap() = env;
}

/// A git command with non-interactive defaults: no prompts, no editor.
pub fn git(cwd: &Path) -> Command {
    let mut c = Command::new("git");
    c.envs(PROFILE_ENV.read().unwrap().iter().cloned());
    c.current_dir(cwd)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_EDITOR", "true")
        .env("GIT_SEQUENCE_EDITOR", "true")
        .env("GIT_LITERAL_PATHSPECS", "1")
        .stdin(Stdio::null());
    c
}

/// One git invocation, as shown in the command log.
#[derive(Debug, Clone, Serialize)]
pub struct Logged {
    pub cwd: String,
    pub args: Vec<String>,
    /// None when the process was killed or failed to start.
    pub code: Option<i32>,
    pub ms: u64,
    /// Unix seconds.
    pub time: i64,
    pub stderr: String,
}

// ponytail: in-memory ring buffer, lost on restart; persist per repo if people ask for history across sessions
const LOG_CAP: usize = 500;
static LOG: Mutex<VecDeque<Logged>> = Mutex::new(VecDeque::new());

pub fn log_command<S: AsRef<str>>(
    cwd: &Path,
    args: &[S],
    code: Option<i32>,
    started: Instant,
    stderr: &str,
) {
    let tail: String = stderr
        .trim()
        .chars()
        .rev()
        .take(2000)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    let entry = Logged {
        cwd: cwd.to_string_lossy().into_owned(),
        args: args.iter().map(|a| a.as_ref().to_owned()).collect(),
        code,
        ms: started.elapsed().as_millis() as u64,
        time: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| d.as_secs() as i64),
        stderr: tail,
    };
    let mut log = LOG.lock().unwrap();
    if log.len() == LOG_CAP {
        log.pop_front();
    }
    log.push_back(entry);
}

/// Commands run in `root`, newest first.
pub fn command_log(root: &Path) -> Vec<Logged> {
    let root = root.to_string_lossy();
    LOG.lock()
        .unwrap()
        .iter()
        .rev()
        .filter(|e| e.cwd == root)
        .cloned()
        .collect()
}

pub fn run(cwd: &Path, args: &[&str], stdin: Option<&str>) -> Result<String, String> {
    let started = Instant::now();
    let r = run_inner(cwd, args, stdin);
    let code = match &r {
        Ok(_) => Some(0),
        Err((code, _)) => *code,
    };
    log_command(
        cwd,
        args,
        code,
        started,
        r.as_ref().err().map_or("", |e| e.1.as_str()),
    );
    r.map_err(|e| e.1)
}

fn run_inner(
    cwd: &Path,
    args: &[&str],
    stdin: Option<&str>,
) -> Result<String, (Option<i32>, String)> {
    let mut c = git(cwd);
    c.args(args).stdout(Stdio::piped()).stderr(Stdio::piped());
    if stdin.is_some() {
        c.stdin(Stdio::piped());
    }
    let mut child = c
        .spawn()
        .map_err(|e| (None, format!("Failed to run git: {e}")))?;
    if let Some(input) = stdin {
        child
            .stdin
            .take()
            .unwrap()
            .write_all(input.as_bytes())
            .map_err(|e| (None, e.to_string()))?;
    }
    let out = child
        .wait_with_output()
        .map_err(|e| (None, e.to_string()))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        let code = out.status.code();
        let err = String::from_utf8_lossy(&out.stderr);
        let out = String::from_utf8_lossy(&out.stdout);
        Err((
            code,
            format!(
                "{}{}",
                err.trim(),
                if err.trim().is_empty() {
                    out.trim()
                } else {
                    ""
                }
            ),
        ))
    }
}

pub fn init(dir: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    run(dir, &["init"], None).map(drop)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn logs_commands_per_repo() {
        let dir = tempfile::tempdir().unwrap();
        run(dir.path(), &["init", "-q"], None).unwrap();
        assert!(run(dir.path(), &["rev-parse", "--verify", "nope"], None).is_err());
        let log = command_log(dir.path());
        assert_eq!(log.len(), 2);
        assert_eq!(log[0].args, ["rev-parse", "--verify", "nope"]);
        assert_ne!(log[0].code, Some(0));
        assert_eq!(log[1].code, Some(0));
    }

    #[test]
    fn refuses_option_injection() {
        let op = Op::Checkout {
            name: "--orphan=x".into(),
        };
        assert!(op.commands().is_err());
        let op = Op::Stage {
            paths: vec!["-rf".into()],
        };
        assert_eq!(op.commands().unwrap()[0], ["add", "-A", "--", "-rf"]);
    }

    #[test]
    fn gitflow_feature_and_release() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path();
        let git = |args: &[&str]| run(p, args, None).unwrap();
        let op = |json: &str| {
            let op: Op = serde_json::from_str(json).unwrap();
            for c in op.commands().unwrap() {
                let args: Vec<&str> = c.iter().map(String::as_str).collect();
                run(p, &args, None).unwrap_or_else(|e| panic!("{json}: {e}"));
            }
        };
        git(&["init", "-q", "-b", "main"]);
        git(&["config", "user.email", "t@t"]);
        git(&["config", "user.name", "t"]);
        git(&["commit", "-q", "--allow-empty", "-m", "root"]);
        op(r#"{"op":"flow-init","main":"main","develop":"develop","createDevelop":true}"#);
        assert_eq!(git(&["config", "gitflow.branch.develop"]), "develop\n");
        op(r#"{"op":"create-branch","name":"feature/x","at":"develop","checkout":true}"#);
        git(&["commit", "-q", "--allow-empty", "-m", "x"]);
        op(r#"{"op":"flow-finish","branch":"feature/x","into":["develop"],"tag":null}"#);
        op(r#"{"op":"create-branch","name":"release/1.0","at":"develop","checkout":true}"#);
        op(r#"{"op":"flow-finish","branch":"release/1.0","into":["main","develop"],"tag":"1.0"}"#);
        assert_eq!(
            git(&["branch", "--format=%(refname:short)"]),
            "develop\nmain\n"
        );
        assert_eq!(git(&["tag"]), "1.0\n");
        assert!(git(&["log", "--format=%s", "main"]).contains("Merge branch 'feature/x'"));
    }

    #[test]
    fn ui_payloads_run_against_a_real_repo() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path();
        let git = |args: &[&str]| run(p, args, None).unwrap();
        git(&["init", "-q", "-b", "main"]);
        git(&["config", "user.email", "t@t"]);
        git(&["config", "user.name", "t"]);
        let op = |json: &str| {
            let op: Op = serde_json::from_str(json).unwrap();
            for c in op.commands().unwrap() {
                let args: Vec<&str> = c.iter().map(String::as_str).collect();
                run(p, &args, None).unwrap_or_else(|e| panic!("{json}: {e}"));
            }
        };
        std::fs::write(p.join("a.txt"), "a\n").unwrap();
        op(r#"{"op":"stage","paths":["a.txt"]}"#);
        op(r#"{"op":"commit","summary":"first","description":"body","amend":false}"#);
        op(r#"{"op":"create-branch","name":"feat","at":"HEAD","checkout":true}"#);
        std::fs::write(p.join("b.txt"), "b\n").unwrap();
        op(r#"{"op":"stage","paths":["b.txt"]}"#);
        op(r#"{"op":"commit","summary":"second","description":"","amend":false}"#);
        op(r#"{"op":"checkout","name":"main"}"#);
        op(r#"{"op":"merge","name":"feat"}"#);
        op(r#"{"op":"tag","name":"v1","at":"HEAD","message":"release"}"#);
        std::fs::write(p.join("a.txt"), "changed\n").unwrap();
        op(r#"{"op":"stash-save","message":"wip","untracked":true}"#);
        op(r#"{"op":"stash-pop","index":0}"#);
        op(r#"{"op":"discard","tracked":["a.txt"],"untracked":[]}"#);
        op(r#"{"op":"reset","id":"HEAD~1","mode":"hard"}"#);
        std::fs::write(p.join("a.txt"), "kept\n").unwrap();
        op(r#"{"op":"reset","id":"HEAD","mode":"keep"}"#);
        assert_eq!(std::fs::read_to_string(p.join("a.txt")).unwrap(), "kept\n");
        op(r#"{"op":"discard","tracked":["a.txt"],"untracked":[]}"#);
        op(r#"{"op":"set-upstream","branch":"feat","upstream":"main"}"#);
        assert_eq!(git(&["config", "branch.feat.merge"]), "refs/heads/main\n");
        op(r#"{"op":"unset-upstream","branch":"feat"}"#);
        assert!(run(p, &["config", "branch.feat.merge"], None).is_err());
        op(r#"{"op":"rename-branch","old":"feat","new":"feature"}"#);
        op(r#"{"op":"delete-branch","name":"feature","force":true}"#);
        op(r#"{"op":"delete-tag","name":"v1"}"#);

        assert_eq!(git(&["log", "--format=%s"]), "first\n");
        assert_eq!(git(&["branch", "--format=%(refname:short)"]), "main\n");
        assert_eq!(git(&["status", "--porcelain"]), "");
        let push: Op = serde_json::from_str(
            r#"{"op":"push","remote":"origin","branch":"main","force":true,"setUpstream":true}"#,
        )
        .unwrap();
        assert_eq!(
            push.commands().unwrap()[0],
            [
                "push",
                "--progress",
                "--force-with-lease",
                "-u",
                "origin",
                "main"
            ]
        );
    }
}
