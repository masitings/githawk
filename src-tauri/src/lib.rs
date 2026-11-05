mod ai;
mod hosting;
mod keys;
mod term;

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};
use std::sync::Mutex;
use std::sync::mpsc;
use std::time::Duration;

use githawk_core::Row;
use githawk_core::ops::{self, Op};
use githawk_core::patch::{self, Mode};
use githawk_core::repo::{self, CommitInfo, FileDiff, Refs, Status, Target};
use githawk_core::{inspect, oplog, rebase};
use notify::{RecursiveMode, Watcher};
use serde::Serialize;
use tauri::ipc::Response;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
struct Graphs(Mutex<HashMap<String, Vec<Row>>>);

#[derive(Default)]
struct Watchers(Mutex<HashMap<String, notify::RecommendedWatcher>>);

// ponytail: one network op at a time across all tabs; per-repo slots if that bites
#[derive(Default)]
struct Running(Mutex<Option<Child>>);

type Res<T> = Result<T, String>;

fn err(e: githawk_core::Error) -> String {
    e.message().to_owned()
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Res<T> + Send + 'static) -> Res<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
struct Opened {
    root: String,
    total: usize,
    head: Option<usize>,
}

#[tauri::command]
async fn open_repo(
    path: String,
    hidden: Option<Vec<String>>,
    solo: Option<String>,
    graphs: State<'_, Graphs>,
) -> Res<Opened> {
    let (root, rows) = blocking(move || {
        let root = repo::root(&path).map_err(err)?;
        let rows =
            githawk_core::graph_filtered(&root, &hidden.unwrap_or_default(), solo.as_deref())
                .map_err(err)?;
        Ok((root, rows))
    })
    .await?;
    let opened = Opened {
        total: rows.len(),
        head: rows.iter().position(|r| r.head),
        root: root.clone(),
    };
    graphs.0.lock().unwrap().insert(root, rows);
    Ok(opened)
}

#[tauri::command]
fn close_repo(root: String, graphs: State<'_, Graphs>, watchers: State<'_, Watchers>) {
    graphs.0.lock().unwrap().remove(&root);
    watchers.0.lock().unwrap().remove(&root);
}

#[tauri::command]
fn graph_page(root: String, skip: usize, limit: usize, graphs: State<'_, Graphs>) -> Vec<Row> {
    let graphs = graphs.0.lock().unwrap();
    let rows = graphs.get(&root).map(Vec::as_slice).unwrap_or_default();
    rows.iter().skip(skip).take(limit).cloned().collect()
}

#[tauri::command]
fn find_row(root: String, id: String, graphs: State<'_, Graphs>) -> Option<usize> {
    graphs
        .0
        .lock()
        .unwrap()
        .get(&root)?
        .iter()
        .position(|r| r.id == id)
}

#[tauri::command]
fn search(root: String, query: String, graphs: State<'_, Graphs>) -> Vec<usize> {
    let q = query.to_lowercase();
    let graphs = graphs.0.lock().unwrap();
    let Some(rows) = graphs.get(&root) else {
        return Vec::new();
    };
    rows.iter()
        .enumerate()
        .filter(|(_, r)| {
            r.id.starts_with(&q)
                || r.summary.to_lowercase().contains(&q)
                || r.author.to_lowercase().contains(&q)
        })
        .map(|(i, _)| i)
        .take(1000)
        .collect()
}

#[tauri::command]
async fn status(root: String) -> Res<Status> {
    blocking(move || repo::status(&root).map_err(err)).await
}

#[tauri::command]
async fn refs(root: String) -> Res<Refs> {
    blocking(move || repo::refs(&root).map_err(err)).await
}

#[tauri::command]
async fn diff(root: String, target: Target, file: Option<String>) -> Res<Vec<FileDiff>> {
    blocking(move || repo::diff(&root, &target, file.as_deref()).map_err(err)).await
}

#[tauri::command]
async fn commit_info(root: String, id: String) -> Res<CommitInfo> {
    blocking(move || repo::commit_info(&root, &id).map_err(err)).await
}

#[tauri::command]
async fn blob(root: String, rev: String, file: String) -> Res<Response> {
    blocking(move || {
        repo::blob(&root, &rev, &file)
            .map(Response::new)
            .map_err(err)
    })
    .await
}

#[tauri::command]
async fn apply_lines(
    root: String,
    file: String,
    mode: Mode,
    selected: Vec<(usize, usize)>,
) -> Res<()> {
    blocking(move || patch::apply_lines(&root, &file, mode, &selected).map_err(err)).await
}

#[tauri::command]
async fn run_op(app: AppHandle, root: String, op: Op, running: State<'_, Running>) -> Res<()> {
    let cmds = op.commands()?;
    let dir = PathBuf::from(&root);
    let before = oplog::snapshot(&root).ok();
    let result = if op.is_long() {
        let mut r = Ok(());
        for c in cmds {
            r = stream(&app, &running, &dir, &c).await;
            if r.is_err() {
                break;
            }
        }
        r
    } else {
        let dir = dir.clone();
        blocking(move || {
            for c in cmds {
                let args: Vec<&str> = c.iter().map(String::as_str).collect();
                ops::run(&dir, &args, None)?;
            }
            Ok(())
        })
        .await
    };
    if let Some(before) = before {
        let soft = matches!(op, Op::Commit { .. });
        let label = op.label();
        blocking(move || {
            let after = oplog::snapshot(&root)?;
            oplog::record(&root, label, soft, before, after)
        })
        .await?;
    }
    result
}

/// Runs `f`, recording the ref changes it makes so they can be undone.
async fn tracked(
    root: String,
    label: &str,
    f: impl FnOnce() -> Res<()> + Send + 'static,
) -> Res<()> {
    let label = label.to_owned();
    blocking(move || {
        let before = oplog::snapshot(&root)?;
        let result = f();
        oplog::record(&root, label, false, before, oplog::snapshot(&root)?)?;
        result
    })
    .await
}

#[tauri::command]
async fn undo(root: String) -> Res<String> {
    blocking(move || oplog::undo(&root)).await
}

#[tauri::command]
async fn redo(root: String) -> Res<String> {
    blocking(move || oplog::redo(&root)).await
}

#[tauri::command]
async fn oplog(root: String) -> Res<oplog::Log> {
    blocking(move || Ok(oplog::load(&root))).await
}

#[tauri::command]
async fn rebase_todo(root: String, base: Option<String>) -> Res<Vec<rebase::TodoItem>> {
    blocking(move || rebase::todo(&root, base.as_deref())).await
}

#[tauri::command]
async fn interactive_rebase(
    root: String,
    base: Option<String>,
    steps: Option<Vec<rebase::Step>>,
    raw: Option<String>,
) -> Res<()> {
    let r = root.clone();
    tracked(root, "Interactive rebase", move || {
        let todo = match (steps, raw) {
            (_, Some(raw)) => raw,
            (Some(steps), None) => rebase::build(&r, &steps)?,
            (None, None) => return Err("Nothing to rebase".into()),
        };
        rebase::run(&r, base.as_deref(), &todo)
    })
    .await
}

#[tauri::command]
async fn conflict(root: String, file: String) -> Res<inspect::Conflict> {
    blocking(move || inspect::conflict(&root, &file)).await
}

#[tauri::command]
async fn resolve(root: String, file: String, content: String) -> Res<()> {
    blocking(move || inspect::resolve(&root, &file, &content)).await
}

#[tauri::command]
async fn history(root: String, file: String) -> Res<Vec<inspect::FileCommit>> {
    blocking(move || inspect::history(&root, &file)).await
}

#[tauri::command]
async fn blame(root: String, file: String) -> Res<Vec<inspect::BlameLine>> {
    blocking(move || inspect::blame(&root, &file)).await
}

#[tauri::command]
async fn reflog(root: String) -> Res<Vec<inspect::ReflogEntry>> {
    blocking(move || inspect::reflog(&root)).await
}

#[tauri::command]
async fn files(root: String) -> Res<Vec<String>> {
    blocking(move || inspect::files(&root)).await
}

#[derive(Serialize)]
struct Extras {
    worktrees: Vec<inspect::Worktree>,
    submodules: Vec<inspect::Submodule>,
    lfs: bool,
    flow: Option<inspect::Flow>,
    /// Unix seconds of the last fetch, from FETCH_HEAD.
    fetched: Option<i64>,
}

#[tauri::command]
async fn extras(root: String) -> Res<Extras> {
    blocking(move || {
        Ok(Extras {
            worktrees: inspect::worktrees(&root).unwrap_or_default(),
            submodules: inspect::submodules(&root).unwrap_or_default(),
            lfs: inspect::uses_lfs(&root),
            flow: inspect::gitflow(&root),
            fetched: inspect::last_fetch(&root),
        })
    })
    .await
}

#[tauri::command]
fn command_log(root: String) -> Vec<ops::Logged> {
    ops::command_log(Path::new(&root))
}

#[tauri::command]
async fn git_version() -> Res<String> {
    blocking(|| {
        let out = ops::git(&std::env::temp_dir())
            .arg("--version")
            .output()
            .map_err(|e| format!("git not found: {e}"))?;
        Ok(String::from_utf8_lossy(&out.stdout)
            .trim()
            .trim_start_matches("git version ")
            .to_owned())
    })
    .await
}

#[tauri::command]
async fn signature(root: String, id: String) -> Res<inspect::Signature> {
    blocking(move || inspect::signature(&root, &id)).await
}

#[tauri::command]
fn set_identity(name: String, email: String, signing_key: String) {
    ops::set_identity(&name, &email, &signing_key);
}

#[tauri::command]
async fn clone_repo(
    app: AppHandle,
    url: String,
    parent: String,
    running: State<'_, Running>,
) -> Res<String> {
    if url.starts_with('-') {
        return Err("Invalid URL".into());
    }
    let name = url
        .trim_end_matches('/')
        .rsplit(['/', ':'])
        .next()
        .unwrap_or("repo")
        .trim_end_matches(".git")
        .to_owned();
    let dest = Path::new(&parent).join(&name);
    if dest.exists() {
        return Err(format!("{} already exists", dest.display()));
    }
    let args = [
        "clone".into(),
        "--progress".into(),
        "--".into(),
        url,
        dest.to_string_lossy().into_owned(),
    ];
    stream(&app, &running, Path::new(&parent), &args).await?;
    Ok(dest.to_string_lossy().into_owned())
}

#[tauri::command]
async fn init_repo(path: String) -> Res<()> {
    blocking(move || ops::init(Path::new(&path))).await
}

#[tauri::command]
fn cancel(running: State<'_, Running>) {
    if let Some(child) = running.0.lock().unwrap().as_mut() {
        let _ = child.kill();
    }
}

async fn stream(app: &AppHandle, running: &Running, dir: &Path, args: &[String]) -> Res<()> {
    let started = std::time::Instant::now();
    let mut stderr = {
        let mut slot = running.0.lock().unwrap();
        if slot.is_some() {
            return Err("Another network operation is running".into());
        }
        let mut child = ops::git(dir)
            .args(args)
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to run git: {e}"))?;
        let stderr = child.stderr.take().unwrap();
        *slot = Some(child);
        stderr
    };
    let app2 = app.clone();
    let log = blocking(move || {
        let mut log = String::new();
        let mut buf = [0u8; 4096];
        loop {
            let n = stderr.read(&mut buf).map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            let chunk = String::from_utf8_lossy(&buf[..n]);
            log.push_str(&chunk);
            // git rewrites progress lines with '\r'
            if let Some(line) = chunk.split(['\r', '\n']).rfind(|l| !l.trim().is_empty()) {
                let _ = app2.emit("git-progress", line.trim());
            }
        }
        Ok(log)
    })
    .await;
    let child = running.0.lock().unwrap().take();
    let status = blocking(move || child.unwrap().wait().map_err(|e| e.to_string())).await?;
    let _ = app.emit("git-progress", "");
    let log = log?;
    let clean: Vec<_> = log.lines().filter(|l| !l.contains('\r')).collect();
    ops::log_command(dir, args, status.code(), started, &clean.join("\n"));
    if status.success() {
        Ok(())
    } else if status.code().is_none() {
        Err("Cancelled".into())
    } else {
        let tail: Vec<_> = log.lines().filter(|l| !l.contains('\r')).collect();
        Err(tail.join("\n").trim().to_owned())
    }
}

#[derive(Clone, Serialize)]
struct Changed {
    root: String,
    refs: bool,
}

#[tauri::command]
fn watch(app: AppHandle, root: String, watchers: State<'_, Watchers>) -> Res<()> {
    let (tx, rx) = mpsc::channel();
    let mut w = notify::recommended_watcher(tx).map_err(|e| e.to_string())?;
    w.watch(Path::new(&root), RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;
    watchers.0.lock().unwrap().insert(root.clone(), w);
    std::thread::spawn(move || {
        let repo = git2::Repository::open(&root).ok();
        let git_dir = repo.as_ref().map(|r| r.path().to_path_buf());
        let base = PathBuf::from(&root);
        let classify = |p: &Path| -> Option<bool> {
            if let Some(g) = git_dir.as_ref().and_then(|g| p.strip_prefix(g).ok()) {
                let s = g.to_string_lossy();
                if s.starts_with("objects") || s.starts_with("logs") || s.ends_with(".lock") {
                    return None;
                }
                return Some(s != "index");
            }
            let rel = p.strip_prefix(&base).ok()?;
            let ignored = repo
                .as_ref()
                .and_then(|r| r.is_path_ignored(rel).ok())
                .unwrap_or(false);
            (!ignored).then_some(false)
        };
        loop {
            let Ok(first) = rx.recv() else { return };
            let mut events = vec![first];
            // Debounce bursts such as checkouts and builds.
            while let Ok(e) = rx.recv_timeout(Duration::from_millis(150)) {
                events.push(e);
            }
            let mut hit = None::<bool>;
            for e in events {
                match e {
                    Ok(e) => {
                        for p in &e.paths {
                            if let Some(r) = classify(p) {
                                hit = Some(hit.unwrap_or(false) | r);
                            }
                        }
                    }
                    Err(e) => {
                        let _ = app.emit("watcher-error", format!("{root}: {e}"));
                    }
                }
            }
            if let Some(refs) = hit {
                let _ = app.emit(
                    "repo-changed",
                    Changed {
                        root: root.clone(),
                        refs,
                    },
                );
            }
        }
    });
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must come first: a second launch (e.g. from a githawk:// link) hands its URL to this instance.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .setup(|_app| {
            // macOS registers the scheme from the bundle; Windows and Linux need it at runtime.
            #[cfg(any(windows, target_os = "linux"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                _app.deep_link().register_all()?;
            }
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Graphs::default())
        .manage(Watchers::default())
        .manage(Running::default())
        .manage(term::Terms::default())
        .invoke_handler(tauri::generate_handler![
            open_repo,
            close_repo,
            graph_page,
            find_row,
            search,
            status,
            refs,
            diff,
            commit_info,
            blob,
            apply_lines,
            run_op,
            clone_repo,
            init_repo,
            cancel,
            watch,
            undo,
            redo,
            oplog,
            rebase_todo,
            interactive_rebase,
            conflict,
            resolve,
            history,
            blame,
            reflog,
            files,
            extras,
            command_log,
            git_version,
            signature,
            set_identity,
            term::term_open,
            term::term_write,
            term::term_resize,
            term::term_close,
            hosting::hosting_save_token,
            hosting::hosting_delete_token,
            hosting::hosting_has_token,
            hosting::hosting_repos,
            hosting::hosting_detect,
            hosting::hosting_prs,
            hosting::hosting_create_pr,
            hosting::hosting_set_servers,
            hosting::hosting_pr_diff,
            hosting::hosting_review,
            hosting::hosting_merge,
            hosting::hosting_checks,
            ai::ai_run,
            keys::ssh_keys,
            keys::ssh_generate,
            keys::gpg_keys,
            keys::git_config_get,
            keys::git_config_set,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
