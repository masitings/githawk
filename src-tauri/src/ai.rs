use std::path::Path;
use std::time::Duration;

use githawk_core::ops;
use reqwest::blocking::Client;
use serde::Deserialize;
use serde_json::{Value, json};

use crate::hosting;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConfig {
    /// "anthropic", or "openai" for any OpenAI-compatible server (OpenAI, Ollama, LM Studio).
    provider: String,
    model: String,
    base_url: String,
    /// Keychain account holding the API key; local servers may have none.
    account: String,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Task {
    CommitMessage,
    Explain { id: String },
    Changelog { from: String, to: String },
}

// ponytail: hard cap instead of chunking; raise it or chunk if real diffs hit it
const MAX_INPUT: usize = 200_000;

fn git(root: &str, args: &[&str]) -> Result<String, String> {
    ops::run(Path::new(root), args, None)
}

fn arg(s: &str) -> Result<&str, String> {
    if s.is_empty() || s.starts_with('-') || s.contains(['\0', '\n']) {
        Err(format!("Invalid revision: {s:?}"))
    } else {
        Ok(s)
    }
}

fn cap(mut s: String) -> String {
    if s.len() > MAX_INPUT {
        let mut end = MAX_INPUT;
        while !s.is_char_boundary(end) {
            end -= 1;
        }
        s.truncate(end);
        s.push_str("\n[diff truncated]");
    }
    s
}

fn prompt(root: &str, task: &Task) -> Result<(&'static str, String), String> {
    Ok(match task {
        Task::CommitMessage => {
            let diff = git(
                root,
                &[
                    "diff",
                    "--cached",
                    "--no-color",
                    "--no-ext-diff",
                    "--no-textconv",
                ],
            )?;
            if diff.trim().is_empty() {
                return Err("Stage some changes first".into());
            }
            (
                "Write a git commit message for the staged diff. First line: an imperative summary of at most 72 characters. \
                 Add a blank line and a short body only when the change needs explaining. \
                 Reply with the message only, without code fences or commentary.",
                cap(diff),
            )
        }
        Task::Explain { id } => (
            "Explain what this commit changes and why, for a developer reading the history. \
             Start with one short paragraph, then list notable changes as bullets. Be concise.",
            cap(git(
                root,
                &[
                    "show",
                    "--no-color",
                    "--no-ext-diff",
                    "--no-textconv",
                    "--no-show-signature",
                    "--format=fuller",
                    "--stat",
                    "--patch",
                    arg(id)?,
                ],
            )?),
        ),
        Task::Changelog { from, to } => {
            let range = format!("{}..{}", arg(from)?, arg(to)?);
            let log = git(
                root,
                &[
                    "log",
                    "--no-show-signature",
                    "--no-merges",
                    "--format=- %s (%h)%n%b",
                    &range,
                ],
            )?;
            if log.trim().is_empty() {
                return Err("No commits in that range".into());
            }
            (
                "Write a release changelog in Markdown from these commits, grouped under Added, Changed, Fixed and Other. \
                 Omit empty groups, merge duplicates, and keep each entry to one line. Reply with the changelog only.",
                cap(log),
            )
        }
    })
}

fn complete(cfg: &AiConfig, system: &str, input: &str) -> Result<String, String> {
    let key = hosting::entry(&cfg.account)?.get_password().ok();
    let client = Client::builder()
        .user_agent("GitHawk")
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|e| e.to_string())?;
    let base = cfg.base_url.trim().trim_end_matches('/');
    if cfg.provider == "anthropic" {
        let key = key.ok_or("Add an Anthropic API key in Settings → AI")?;
        let base = if base.is_empty() {
            "https://api.anthropic.com"
        } else {
            base
        };
        let v = hosting::send(
            client
                .post(format!("{base}/v1/messages"))
                .header("x-api-key", key)
                .header("anthropic-version", "2026-10-21")
                .header("anthropic-beta", "server-side-fallback-2026-07-01")
                .json(&json!({
                    "model": cfg.model,
                    "max_tokens": 16000,
                    "system": system,
                    "messages": [{"role": "user", "content": input}],
                    "fallbacks": "default",
                })),
        )?;
        if v["stop_reason"] == "refusal" {
            return Err("The model declined this request".into());
        }
        let text: String = v["content"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|b| b["type"] == "text")
            .filter_map(|b| b["text"].as_str())
            .collect();
        Ok(text.trim().to_owned())
    } else {
        if base.is_empty() {
            return Err("Set the server URL in Settings → AI".into());
        }
        let mut req = client.post(format!("{base}/chat/completions"));
        if let Some(key) = key.filter(|k| !k.is_empty()) {
            req = req.bearer_auth(key);
        }
        let v: Value = hosting::send(req.json(&json!({
            "model": cfg.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": input},
            ],
        })))?;
        Ok(v["choices"][0]["message"]["content"]
            .as_str()
            .unwrap_or_default()
            .trim()
            .to_owned())
    }
}

#[tauri::command]
pub async fn ai_run(root: String, config: AiConfig, task: Task) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (system, input) = prompt(&root, &task)?;
        complete(&config, system, &input)
    })
    .await
    .map_err(|e| e.to_string())?
}
