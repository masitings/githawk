use std::collections::HashMap;
use std::sync::RwLock;

use reqwest::blocking::{Client, RequestBuilder};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

const KEYRING_SERVICE: &str = "app.githawk.desktop";

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Github,
    Gitlab,
    Bitbucket,
    Azure,
    #[serde(rename = "bitbucket-server")]
    BitbucketServer,
}

/// A self-hosted server: GitHub Enterprise, GitLab self-managed or Bitbucket Data Center.
#[derive(Debug, Clone, Deserialize)]
pub struct Server {
    pub host: String,
    pub kind: Provider,
}

static SERVERS: RwLock<Vec<Server>> = RwLock::new(Vec::new());

#[derive(Debug, Deserialize)]
pub struct LineComment {
    pub path: String,
    pub line: u64,
    /// "+", "-" or " ": which side of the diff the line is on.
    pub origin: String,
    pub body: String,
}

#[derive(Debug, Deserialize)]
pub struct Review {
    /// "approve", "request-changes" or "comment".
    pub event: String,
    pub body: String,
    pub comments: Vec<LineComment>,
}

#[derive(Debug, Serialize)]
pub struct HostRepo {
    pub name: String,
    pub https: String,
    pub ssh: String,
    pub private: bool,
}

#[derive(Debug, Serialize)]
pub struct Pr {
    pub number: u64,
    pub title: String,
    pub author: String,
    pub head: String,
    pub base: String,
    pub url: String,
    pub draft: bool,
}

#[derive(Debug, Deserialize)]
pub struct NewPr {
    pub title: String,
    pub body: String,
    pub head: String,
    pub base: String,
}

/// Where a remote lives: `path` is "owner/repo", or "org/project/repo" on Azure DevOps.
/// `key` names its token: the provider for cloud hosts, the host name for self-hosted servers.
#[derive(Debug, PartialEq)]
pub struct RemoteRef {
    pub provider: Provider,
    pub path: String,
    pub key: String,
    pub api: String,
}

pub trait HostingProvider {
    fn repos(&self) -> Result<Vec<HostRepo>, String>;
    fn prs(&self, remote: &RemoteRef) -> Result<Vec<Pr>, String>;
    fn create_pr(&self, remote: &RemoteRef, pr: &NewPr) -> Result<String, String>;
    /// The pull request as one unified diff.
    fn pr_diff(&self, _remote: &RemoteRef, _number: u64) -> Result<String, String> {
        Err("Reviewing pull requests in GitHawk isn't supported for this provider yet".into())
    }
    fn review(&self, _remote: &RemoteRef, _number: u64, _review: &Review) -> Result<(), String> {
        Err("Reviewing pull requests in GitHawk isn't supported for this provider yet".into())
    }
    /// `method` is "merge", "squash" or "rebase".
    fn merge(&self, _remote: &RemoteRef, _number: u64, _method: &str) -> Result<(), String> {
        Err("Merging pull requests from GitHawk isn't supported for this provider yet".into())
    }
    /// Combined CI status of a commit: "success", "failure" or "pending"; None when it has no checks.
    fn checks(&self, _remote: &RemoteRef, _sha: &str) -> Result<Option<String>, String> {
        Ok(None)
    }
    /// Profile photo URLs keyed by lowercased commit email; `emails` are the repository's recent authors.
    fn avatars(
        &self,
        _remote: &RemoteRef,
        _emails: &[String],
    ) -> Result<HashMap<String, String>, String> {
        Ok(HashMap::new())
    }
    /// Adds a public key to the token owner's account for SSH authentication.
    fn add_ssh_key(&self, _title: &str, _key: &str) -> Result<(), String> {
        Err("This provider has no API for adding SSH keys; add it in its web settings".into())
    }
}

/// API base for a provider; `host` is set for self-hosted servers.
fn api_base(provider: Provider, host: Option<&str>) -> String {
    match (provider, host) {
        (Provider::Github, None) => "https://api.github.com".into(),
        (Provider::Github, Some(h)) => format!("https://{h}/api/v3"),
        (Provider::Gitlab, h) => format!("https://{}/api/v4", h.unwrap_or("gitlab.com")),
        (Provider::Bitbucket, _) => "https://api.bitbucket.org/2.0".into(),
        (Provider::Azure, _) => "https://dev.azure.com".into(),
        (Provider::BitbucketServer, h) => format!("https://{}/rest/api/1.0", h.unwrap_or_default()),
    }
}

/// Resolves a token key ("github", or a self-hosted host) to its provider and API base.
fn resolve(key: &str) -> Option<(Provider, String)> {
    let cloud = match key {
        "github" => Some(Provider::Github),
        "gitlab" => Some(Provider::Gitlab),
        "bitbucket" => Some(Provider::Bitbucket),
        "azure" => Some(Provider::Azure),
        _ => None,
    };
    if let Some(p) = cloud {
        return Some((p, api_base(p, None)));
    }
    let servers = SERVERS.read().unwrap();
    let s = servers.iter().find(|s| s.host.eq_ignore_ascii_case(key))?;
    Some((s.kind, api_base(s.kind, Some(&s.host))))
}

pub fn parse_remote(url: &str) -> Option<RemoteRef> {
    parse_remote_with(url, &SERVERS.read().unwrap())
}

fn parse_remote_with(url: &str, servers: &[Server]) -> Option<RemoteRef> {
    let url = url.trim().trim_end_matches('/').trim_end_matches(".git");
    let rest = url.split_once("://").map(|(_, r)| r).unwrap_or(url);
    let rest = rest.rsplit_once('@').map(|(_, r)| r).unwrap_or(rest);
    let at = rest.find([':', '/'])?;
    let (host, path) = (&rest[..at], &rest[at + 1..]);
    let path = match path.split_once('/') {
        // ssh://host:2222/owner/repo
        Some((port, tail))
            if rest[at..].starts_with(':')
                && !port.is_empty()
                && port.bytes().all(|b| b.is_ascii_digit()) =>
        {
            tail
        }
        _ => path,
    };
    let server = servers.iter().find(|s| s.host.eq_ignore_ascii_case(host));
    let provider = match host {
        _ if server.is_some() => server?.kind,
        h if on(h, "github.com") => Provider::Github,
        h if on(h, "gitlab.com") => Provider::Gitlab,
        h if on(h, "bitbucket.org") => Provider::Bitbucket,
        h if on(h, "dev.azure.com") || on(h, "visualstudio.com") => Provider::Azure,
        _ => return None,
    };
    let (key, api) = match server {
        Some(s) => (s.host.clone(), api_base(provider, Some(&s.host))),
        None => (
            serde_json::to_value(provider).ok()?.as_str()?.to_owned(),
            api_base(provider, None),
        ),
    };
    let path = if provider == Provider::Azure {
        let parts: Vec<&str> = path
            .trim_start_matches("v3/")
            .split('/')
            .filter(|p| *p != "_git")
            .collect();
        match parts.as_slice() {
            [org, project, repo] => format!("{org}/{project}/{repo}"),
            _ if host.ends_with("visualstudio.com") && parts.len() == 2 => {
                format!("{}/{}/{}", host.split('.').next()?, parts[0], parts[1])
            }
            _ => return None,
        }
    } else if provider == Provider::BitbucketServer {
        path.trim_start_matches("scm/").to_owned()
    } else {
        path.to_owned()
    };
    // The path is formatted into API URLs, so `..`, `?` or `#` would redirect token-bearing requests.
    let segments: Vec<&str> = path.split('/').collect();
    let two = matches!(
        provider,
        Provider::Github | Provider::Bitbucket | Provider::BitbucketServer
    );
    if segments.len() < 2
        || (two && segments.len() != 2)
        || !segments
            .iter()
            .all(|s| safe_segment(s, provider == Provider::Azure))
    {
        return None;
    }
    Some(RemoteRef {
        provider,
        path,
        key,
        api,
    })
}

fn on(host: &str, domain: &str) -> bool {
    host.eq_ignore_ascii_case(domain) || host.to_ascii_lowercase().ends_with(&format!(".{domain}"))
}

fn safe_segment(s: &str, azure: bool) -> bool {
    let decoded = s.to_ascii_lowercase().replace("%2e", ".");
    let lower = s.to_ascii_lowercase();
    !s.is_empty()
        && decoded != "."
        && decoded != ".."
        && !(azure && (lower.contains("%2f") || lower.contains("%5c")))
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || "._-~".contains(c) || (azure && c == '%'))
}

fn combine(states: &[&str]) -> Option<String> {
    if states.is_empty() {
        None
    } else if states.contains(&"failure") {
        Some("failure".into())
    } else if states.contains(&"pending") {
        Some("pending".into())
    } else {
        Some("success".into())
    }
}

fn client() -> Client {
    Client::builder()
        .user_agent("GitHawk")
        .build()
        .expect("http client")
}

/// GitHub puts details in `errors[].message`, GitLab sends `message` as a field → reasons map.
fn error_text(body: &Value) -> String {
    let mut parts: Vec<String> = Vec::new();
    match &body["message"] {
        Value::String(m) => parts.push(m.clone()),
        Value::Object(fields) => parts.extend(fields.iter().map(|(k, v)| match v {
            Value::Array(r) => format!("{k} {}", r.iter().map(s).collect::<Vec<_>>().join(", ")),
            v => format!("{k} {}", s(v)),
        })),
        _ => {}
    }
    if let Some(m) = body["error"]["message"].as_str() {
        parts.push(m.into());
    }
    parts.extend(
        body["errors"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|e| e["message"].as_str().map(str::to_owned)),
    );
    parts.join(": ")
}

pub(crate) fn send(req: RequestBuilder) -> Result<Value, String> {
    let res = req.send().map_err(|e| e.to_string())?;
    let status = res.status();
    let body: Value = res.json().unwrap_or(Value::Null);
    if status.is_success() {
        Ok(body)
    } else {
        Err(format!("{status} {}", error_text(&body)).trim().to_owned())
    }
}

fn send_text(req: RequestBuilder) -> Result<String, String> {
    let res = req.send().map_err(|e| e.to_string())?;
    let status = res.status();
    let body = res.text().map_err(|e| e.to_string())?;
    if status.is_success() {
        Ok(body)
    } else {
        Err(
            format!("{status} {}", body.chars().take(200).collect::<String>())
                .trim()
                .to_owned(),
        )
    }
}

fn s(v: &Value) -> String {
    v.as_str().unwrap_or_default().to_owned()
}

fn enc(path: &str) -> String {
    path.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

struct GitHub {
    token: String,
    api: String,
}
struct GitLab {
    token: String,
    api: String,
}
/// Bitbucket Data Center; token is an HTTP access token.
struct BitbucketServer {
    token: String,
    api: String,
}
/// Token is "username:app_password", or a bearer access token.
struct Bitbucket(String);
/// Token is a PAT; `org` is the Azure DevOps organisation used for listing repositories.
struct Azure {
    token: String,
    org: String,
}

impl GitHub {
    fn req(&self, r: RequestBuilder) -> RequestBuilder {
        let r = r.header("Accept", "application/vnd.github+json");
        if self.token.is_empty() {
            r
        } else {
            r.bearer_auth(&self.token)
        }
    }
}

impl HostingProvider for GitHub {
    fn add_ssh_key(&self, title: &str, key: &str) -> Result<(), String> {
        send(
            self.req(client().post(format!("{}/user/keys", self.api)))
                .json(&json!({ "title": title, "key": key })),
        )
        .map(drop)
        .map_err(|e| {
            if e.starts_with("403") || e.starts_with("404") {
                format!("{e}. The token needs the write:public_key scope.")
            } else {
                e
            }
        })
    }
    fn repos(&self) -> Result<Vec<HostRepo>, String> {
        let v = send(
            self.req(client().get(format!("{}/user/repos?per_page=100&sort=updated", self.api))),
        )?;
        Ok(v.as_array()
            .into_iter()
            .flatten()
            .map(|r| HostRepo {
                name: s(&r["full_name"]),
                https: s(&r["clone_url"]),
                ssh: s(&r["ssh_url"]),
                private: r["private"].as_bool().unwrap_or(false),
            })
            .collect())
    }

    fn merge(&self, remote: &RemoteRef, number: u64, method: &str) -> Result<(), String> {
        let url = format!("{}/repos/{}/pulls/{number}/merge", self.api, remote.path);
        send(self.req(client().put(url).json(&json!({"merge_method": method})))).map(drop)
    }

    // ponytail: newest 300 commits; older authors fall back to the placeholder avatar
    fn avatars(
        &self,
        remote: &RemoteRef,
        _emails: &[String],
    ) -> Result<HashMap<String, String>, String> {
        let mut map = HashMap::new();
        for page in 1..=3 {
            let url = format!(
                "{}/repos/{}/commits?per_page=100&page={page}",
                self.api, remote.path
            );
            let v = send(self.req(client().get(url)))?;
            let list = v.as_array().cloned().unwrap_or_default();
            for c in &list {
                for (who, git) in [("author", "author"), ("committer", "committer")] {
                    let (Some(email), Some(avatar)) = (
                        c["commit"][git]["email"].as_str(),
                        c[who]["avatar_url"].as_str(),
                    ) else {
                        continue;
                    };
                    map.entry(email.to_lowercase())
                        .or_insert_with(|| avatar.to_owned());
                }
            }
            if list.len() < 100 {
                break;
            }
        }
        Ok(map)
    }

    fn checks(&self, remote: &RemoteRef, sha: &str) -> Result<Option<String>, String> {
        let base = format!("{}/repos/{}/commits/{sha}", self.api, remote.path);
        let runs = send(self.req(client().get(format!("{base}/check-runs?per_page=100"))))?;
        let status = send(self.req(client().get(format!("{base}/status"))))?;
        let mut states: Vec<&str> = runs["check_runs"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|r| match (r["status"].as_str(), r["conclusion"].as_str()) {
                (Some("completed"), Some("success" | "neutral" | "skipped")) => "success",
                (Some("completed"), _) => "failure",
                _ => "pending",
            })
            .collect();
        if status["total_count"].as_u64().unwrap_or(0) > 0 {
            states.push(match status["state"].as_str() {
                Some("success") => "success",
                Some("pending") => "pending",
                _ => "failure",
            });
        }
        Ok(combine(&states))
    }

    fn prs(&self, remote: &RemoteRef) -> Result<Vec<Pr>, String> {
        let url = format!(
            "{}/repos/{}/pulls?state=open&per_page=100",
            self.api, remote.path
        );
        let v = send(self.req(client().get(url)))?;
        Ok(v.as_array()
            .into_iter()
            .flatten()
            .map(|p| Pr {
                number: p["number"].as_u64().unwrap_or_default(),
                title: s(&p["title"]),
                author: s(&p["user"]["login"]),
                head: s(&p["head"]["ref"]),
                base: s(&p["base"]["ref"]),
                url: s(&p["html_url"]),
                draft: p["draft"].as_bool().unwrap_or(false),
            })
            .collect())
    }

    fn create_pr(&self, remote: &RemoteRef, pr: &NewPr) -> Result<String, String> {
        let url = format!("{}/repos/{}/pulls", self.api, remote.path);
        let body = json!({"title": pr.title, "body": pr.body, "head": pr.head, "base": pr.base});
        Ok(s(
            &send(self.req(client().post(url).json(&body)))?["html_url"],
        ))
    }

    fn pr_diff(&self, remote: &RemoteRef, number: u64) -> Result<String, String> {
        let url = format!("{}/repos/{}/pulls/{number}", self.api, remote.path);
        send_text(
            self.req(client().get(url))
                .header("Accept", "application/vnd.github.diff"),
        )
    }

    fn review(&self, remote: &RemoteRef, number: u64, review: &Review) -> Result<(), String> {
        let event = match review.event.as_str() {
            "approve" => "APPROVE",
            "request-changes" => "REQUEST_CHANGES",
            _ => "COMMENT",
        };
        let comments: Vec<Value> = review
            .comments
            .iter()
            .map(|c| {
                json!({
                    "path": c.path,
                    "line": c.line,
                    "side": if c.origin == "-" { "LEFT" } else { "RIGHT" },
                    "body": c.body,
                })
            })
            .collect();
        let mut body = json!({"event": event, "comments": comments});
        if !review.body.trim().is_empty() {
            body["body"] = json!(review.body);
        }
        let url = format!("{}/repos/{}/pulls/{number}/reviews", self.api, remote.path);
        send(self.req(client().post(url).json(&body))).map(|_| ())
    }
}

impl GitLab {
    fn req(&self, r: RequestBuilder) -> RequestBuilder {
        r.header("PRIVATE-TOKEN", &self.token)
    }
}

impl HostingProvider for GitLab {
    fn add_ssh_key(&self, title: &str, key: &str) -> Result<(), String> {
        send(
            self.req(client().post(format!("{}/user/keys", self.api)))
                .json(&json!({ "title": title, "key": key })),
        )
        .map(drop)
    }
    // ponytail: one request per author, capped at 40; batch if repos with more authors feel slow
    fn avatars(
        &self,
        _remote: &RemoteRef,
        emails: &[String],
    ) -> Result<HashMap<String, String>, String> {
        let mut map = HashMap::new();
        for email in emails.iter().take(40) {
            let url = format!("{}/avatar?size=64&email={}", self.api, enc(email));
            let Ok(v) = send(self.req(client().get(url))) else {
                continue;
            };
            // GitLab falls back to Gravatar identicons, which would leak emails to a third party
            if let Some(a) = v["avatar_url"]
                .as_str()
                .filter(|a| !a.contains("gravatar.com"))
            {
                map.insert(email.to_lowercase(), a.to_owned());
            }
        }
        Ok(map)
    }

    fn repos(&self) -> Result<Vec<HostRepo>, String> {
        let url = format!(
            "{}/projects?membership=true&per_page=100&order_by=last_activity_at",
            self.api
        );
        let v = send(self.req(client().get(url)))?;
        Ok(v.as_array()
            .into_iter()
            .flatten()
            .map(|r| HostRepo {
                name: s(&r["path_with_namespace"]),
                https: s(&r["http_url_to_repo"]),
                ssh: s(&r["ssh_url_to_repo"]),
                private: r["visibility"].as_str() != Some("public"),
            })
            .collect())
    }

    fn merge(&self, remote: &RemoteRef, number: u64, method: &str) -> Result<(), String> {
        if method == "rebase" {
            return Err("GitLab sets rebase merging per project; merge or squash instead".into());
        }
        let url = format!(
            "{}/projects/{}/merge_requests/{number}/merge",
            self.api,
            enc(&remote.path)
        );
        send(
            self.req(
                client()
                    .put(url)
                    .json(&json!({"squash": method == "squash"})),
            ),
        )
        .map(drop)
    }

    fn checks(&self, remote: &RemoteRef, sha: &str) -> Result<Option<String>, String> {
        let url = format!(
            "{}/projects/{}/repository/commits/{sha}",
            self.api,
            enc(&remote.path)
        );
        let v = send(self.req(client().get(url)))?;
        Ok(v["last_pipeline"]["status"].as_str().map(|st| {
            match st {
                "success" | "skipped" | "manual" => "success",
                "failed" | "canceled" => "failure",
                _ => "pending",
            }
            .to_owned()
        }))
    }

    fn prs(&self, remote: &RemoteRef) -> Result<Vec<Pr>, String> {
        let url = format!(
            "{}/projects/{}/merge_requests?state=opened&per_page=100",
            self.api,
            enc(&remote.path)
        );
        let v = send(self.req(client().get(url)))?;
        Ok(v.as_array()
            .into_iter()
            .flatten()
            .map(|p| Pr {
                number: p["iid"].as_u64().unwrap_or_default(),
                title: s(&p["title"]),
                author: s(&p["author"]["username"]),
                head: s(&p["source_branch"]),
                base: s(&p["target_branch"]),
                url: s(&p["web_url"]),
                draft: p["draft"].as_bool().unwrap_or(false),
            })
            .collect())
    }

    fn create_pr(&self, remote: &RemoteRef, pr: &NewPr) -> Result<String, String> {
        let url = format!("{}/projects/{}/merge_requests", self.api, enc(&remote.path));
        let body = json!({"title": pr.title, "description": pr.body, "source_branch": pr.head, "target_branch": pr.base});
        Ok(s(
            &send(self.req(client().post(url).json(&body)))?["web_url"],
        ))
    }

    fn pr_diff(&self, remote: &RemoteRef, number: u64) -> Result<String, String> {
        let url = format!(
            "{}/projects/{}/merge_requests/{number}/diffs?per_page=100",
            self.api,
            enc(&remote.path)
        );
        let v = send(self.req(client().get(url)))?;
        Ok(v.as_array()
            .into_iter()
            .flatten()
            .map(|d| {
                let (old, new) = (s(&d["old_path"]), s(&d["new_path"]));
                let from = if d["new_file"] == true {
                    "/dev/null".into()
                } else {
                    format!("a/{old}")
                };
                let to = if d["deleted_file"] == true {
                    "/dev/null".into()
                } else {
                    format!("b/{new}")
                };
                format!(
                    "diff --git a/{old} b/{new}\n--- {from}\n+++ {to}\n{}",
                    s(&d["diff"])
                )
            })
            .collect())
    }

    fn review(&self, remote: &RemoteRef, number: u64, review: &Review) -> Result<(), String> {
        if review.event == "request-changes" {
            return Err("GitLab has no request-changes API: leave a comment instead".into());
        }
        let mr = format!(
            "{}/projects/{}/merge_requests/{number}",
            self.api,
            enc(&remote.path)
        );
        if !review.comments.is_empty() {
            let refs = send(self.req(client().get(&mr)))?["diff_refs"].clone();
            for c in &review.comments {
                let mut position = json!({
                    "position_type": "text",
                    "base_sha": refs["base_sha"],
                    "start_sha": refs["start_sha"],
                    "head_sha": refs["head_sha"],
                    "old_path": c.path,
                    "new_path": c.path,
                });
                position[if c.origin == "-" {
                    "old_line"
                } else {
                    "new_line"
                }] = json!(c.line);
                send(
                    self.req(
                        client()
                            .post(format!("{mr}/discussions"))
                            .json(&json!({"body": c.body, "position": position})),
                    ),
                )?;
            }
        }
        if !review.body.trim().is_empty() {
            send(
                self.req(
                    client()
                        .post(format!("{mr}/notes"))
                        .json(&json!({"body": review.body})),
                ),
            )?;
        }
        if review.event == "approve" {
            send(self.req(client().post(format!("{mr}/approve"))))?;
        }
        Ok(())
    }
}

impl Bitbucket {
    fn req(&self, r: RequestBuilder) -> RequestBuilder {
        match self.0.split_once(':') {
            Some((user, pass)) => r.basic_auth(user, Some(pass)),
            None => r.bearer_auth(&self.0),
        }
    }
}

impl HostingProvider for Bitbucket {
    fn add_ssh_key(&self, title: &str, key: &str) -> Result<(), String> {
        let me = send(self.req(client().get("https://api.bitbucket.org/2.0/user")))?;
        send(
            self.req(client().post(format!(
                "https://api.bitbucket.org/2.0/users/{}/ssh-keys",
                enc(&s(&me["uuid"]))
            )))
            .json(&json!({ "label": title, "key": key })),
        )
        .map(drop)
    }
    fn repos(&self) -> Result<Vec<HostRepo>, String> {
        let v = send(self.req(
            client().get("https://api.bitbucket.org/2.0/repositories?role=member&pagelen=100"),
        ))?;
        let clone = |r: &Value, kind: &str| {
            r["links"]["clone"]
                .as_array()
                .into_iter()
                .flatten()
                .find(|c| c["name"] == kind)
                .map(|c| s(&c["href"]))
                .unwrap_or_default()
        };
        Ok(v["values"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|r| HostRepo {
                name: s(&r["full_name"]),
                https: clone(r, "https"),
                ssh: clone(r, "ssh"),
                private: r["is_private"].as_bool().unwrap_or(false),
            })
            .collect())
    }

    fn merge(&self, remote: &RemoteRef, number: u64, method: &str) -> Result<(), String> {
        let strategy = match method {
            "squash" => "squash",
            "rebase" => "rebase_merge",
            _ => "merge_commit",
        };
        let url = format!(
            "https://api.bitbucket.org/2.0/repositories/{}/pullrequests/{number}/merge",
            remote.path
        );
        send(
            self.req(
                client()
                    .post(url)
                    .json(&json!({"merge_strategy": strategy})),
            ),
        )
        .map(drop)
    }

    fn checks(&self, remote: &RemoteRef, sha: &str) -> Result<Option<String>, String> {
        let url = format!(
            "https://api.bitbucket.org/2.0/repositories/{}/commit/{sha}/statuses?pagelen=100",
            remote.path
        );
        let v = send(self.req(client().get(url)))?;
        let states: Vec<&str> = v["values"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|x| match x["state"].as_str() {
                Some("SUCCESSFUL") => "success",
                Some("INPROGRESS") => "pending",
                _ => "failure",
            })
            .collect();
        Ok(combine(&states))
    }

    fn prs(&self, remote: &RemoteRef) -> Result<Vec<Pr>, String> {
        let url = format!(
            "https://api.bitbucket.org/2.0/repositories/{}/pullrequests?state=OPEN&pagelen=50",
            remote.path
        );
        let v = send(self.req(client().get(url)))?;
        Ok(v["values"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|p| Pr {
                number: p["id"].as_u64().unwrap_or_default(),
                title: s(&p["title"]),
                author: s(&p["author"]["display_name"]),
                head: s(&p["source"]["branch"]["name"]),
                base: s(&p["destination"]["branch"]["name"]),
                url: s(&p["links"]["html"]["href"]),
                draft: p["draft"].as_bool().unwrap_or(false),
            })
            .collect())
    }

    fn create_pr(&self, remote: &RemoteRef, pr: &NewPr) -> Result<String, String> {
        let url = format!(
            "https://api.bitbucket.org/2.0/repositories/{}/pullrequests",
            remote.path
        );
        let body = json!({
            "title": pr.title,
            "description": pr.body,
            "source": {"branch": {"name": pr.head}},
            "destination": {"branch": {"name": pr.base}},
        });
        Ok(s(
            &send(self.req(client().post(url).json(&body)))?["links"]["html"]["href"]
        ))
    }

    fn pr_diff(&self, remote: &RemoteRef, number: u64) -> Result<String, String> {
        send_text(self.req(client().get(format!(
            "https://api.bitbucket.org/2.0/repositories/{}/pullrequests/{number}/diff",
            remote.path
        ))))
    }

    fn review(&self, remote: &RemoteRef, number: u64, review: &Review) -> Result<(), String> {
        let pr = format!(
            "https://api.bitbucket.org/2.0/repositories/{}/pullrequests/{number}",
            remote.path
        );
        for c in &review.comments {
            let side = if c.origin == "-" { "from" } else { "to" };
            send(
                self.req(client().post(format!("{pr}/comments")).json(&json!({
                    "content": {"raw": c.body},
                    "inline": {"path": c.path, side: c.line},
                }))),
            )?;
        }
        if !review.body.trim().is_empty() {
            send(
                self.req(
                    client()
                        .post(format!("{pr}/comments"))
                        .json(&json!({"content": {"raw": review.body}})),
                ),
            )?;
        }
        match review.event.as_str() {
            "approve" => send(self.req(client().post(format!("{pr}/approve")))).map(|_| ()),
            "request-changes" => {
                send(self.req(client().post(format!("{pr}/request-changes")))).map(|_| ())
            }
            _ => Ok(()),
        }
    }
}

impl BitbucketServer {
    fn req(&self, r: RequestBuilder) -> RequestBuilder {
        r.bearer_auth(&self.token)
    }

    fn repo(&self, path: &str) -> Result<String, String> {
        let (project, repo) = path
            .split_once('/')
            .ok_or("Unrecognised Bitbucket remote")?;
        Ok(format!("{}/projects/{project}/repos/{repo}", self.api))
    }
}

impl HostingProvider for BitbucketServer {
    fn add_ssh_key(&self, _title: &str, key: &str) -> Result<(), String> {
        let api = self.api.replace("/rest/api/1.0", "/rest/ssh/1.0");
        send(
            self.req(client().post(format!("{api}/keys")))
                .json(&json!({ "text": key })),
        )
        .map(drop)
    }
    fn repos(&self) -> Result<Vec<HostRepo>, String> {
        let v = send(self.req(client().get(format!("{}/repos?limit=100", self.api))))?;
        let clone = |r: &Value, kind: &str| {
            r["links"]["clone"]
                .as_array()
                .into_iter()
                .flatten()
                .find(|c| c["name"] == kind)
                .map(|c| s(&c["href"]))
                .unwrap_or_default()
        };
        Ok(v["values"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|r| HostRepo {
                name: format!("{}/{}", s(&r["project"]["key"]), s(&r["slug"])),
                https: clone(r, "http"),
                ssh: clone(r, "ssh"),
                private: r["public"].as_bool() != Some(true),
            })
            .collect())
    }

    fn prs(&self, remote: &RemoteRef) -> Result<Vec<Pr>, String> {
        let url = format!(
            "{}/pull-requests?state=OPEN&limit=100",
            self.repo(&remote.path)?
        );
        let v = send(self.req(client().get(url)))?;
        Ok(v["values"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|p| Pr {
                number: p["id"].as_u64().unwrap_or_default(),
                title: s(&p["title"]),
                author: s(&p["author"]["user"]["displayName"]),
                head: s(&p["fromRef"]["displayId"]),
                base: s(&p["toRef"]["displayId"]),
                url: s(&p["links"]["self"][0]["href"]),
                draft: p["draft"].as_bool().unwrap_or(false),
            })
            .collect())
    }

    fn create_pr(&self, remote: &RemoteRef, pr: &NewPr) -> Result<String, String> {
        let body = json!({
            "title": pr.title,
            "description": pr.body,
            "fromRef": {"id": format!("refs/heads/{}", pr.head)},
            "toRef": {"id": format!("refs/heads/{}", pr.base)},
        });
        let url = format!("{}/pull-requests", self.repo(&remote.path)?);
        Ok(s(
            &send(self.req(client().post(url).json(&body)))?["links"]["self"][0]["href"]
        ))
    }

    fn pr_diff(&self, remote: &RemoteRef, number: u64) -> Result<String, String> {
        send_text(self.req(client().get(format!(
            "{}/pull-requests/{number}.diff",
            self.repo(&remote.path)?
        ))))
    }

    fn review(&self, remote: &RemoteRef, number: u64, review: &Review) -> Result<(), String> {
        let pr = format!("{}/pull-requests/{number}", self.repo(&remote.path)?);
        for c in &review.comments {
            let (line_type, file_type) = match c.origin.as_str() {
                "-" => ("REMOVED", "FROM"),
                "+" => ("ADDED", "TO"),
                _ => ("CONTEXT", "TO"),
            };
            send(self.req(client().post(format!("{pr}/comments")).json(&json!({
                "text": c.body,
                "anchor": {"path": c.path, "line": c.line, "lineType": line_type, "fileType": file_type, "diffType": "EFFECTIVE"},
            }))))?;
        }
        if !review.body.trim().is_empty() {
            send(
                self.req(
                    client()
                        .post(format!("{pr}/comments"))
                        .json(&json!({"text": review.body})),
                ),
            )?;
        }
        let status = match review.event.as_str() {
            "approve" => "APPROVED",
            "request-changes" => "NEEDS_WORK",
            _ => return Ok(()),
        };
        let host = self.api.trim_end_matches("/rest/api/1.0");
        let me =
            send_text(self.req(client().get(format!("{host}/plugins/servlet/applinks/whoami"))))?;
        send(
            self.req(
                client()
                    .put(format!("{pr}/participants/{}", enc(me.trim())))
                    .json(&json!({"status": status})),
            ),
        )
        .map(|_| ())
    }
}

impl Azure {
    fn req(&self, r: RequestBuilder) -> RequestBuilder {
        r.basic_auth("", Some(&self.token))
    }

    fn api(path: &str) -> Result<(String, String), String> {
        let mut it = path.splitn(3, '/');
        let (Some(org), Some(project), Some(repo)) = (it.next(), it.next(), it.next()) else {
            return Err("Unrecognised Azure DevOps remote".into());
        };
        Ok((
            format!(
                "https://dev.azure.com/{org}/{project}/_apis/git/repositories/{repo}/pullrequests"
            ),
            format!("https://dev.azure.com/{org}/{project}/_git/{repo}/pullrequest"),
        ))
    }
}

impl HostingProvider for Azure {
    fn repos(&self) -> Result<Vec<HostRepo>, String> {
        if self.org.is_empty() {
            return Err("Set the Azure DevOps organisation to list repositories".into());
        }
        let url = format!(
            "https://dev.azure.com/{}/_apis/git/repositories?api-version=7.1",
            self.org
        );
        let v = send(self.req(client().get(url)))?;
        Ok(v["value"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|r| HostRepo {
                name: format!("{}/{}", s(&r["project"]["name"]), s(&r["name"])),
                https: s(&r["remoteUrl"]),
                ssh: s(&r["sshUrl"]),
                private: r["project"]["visibility"].as_str() != Some("public"),
            })
            .collect())
    }

    fn prs(&self, remote: &RemoteRef) -> Result<Vec<Pr>, String> {
        let (api, web) = Self::api(&remote.path)?;
        let v = send(self.req(client().get(format!(
            "{api}?searchCriteria.status=active&api-version=7.1"
        ))))?;
        let branch = |v: &Value| s(v).trim_start_matches("refs/heads/").to_owned();
        Ok(v["value"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|p| {
                let id = p["pullRequestId"].as_u64().unwrap_or_default();
                Pr {
                    number: id,
                    title: s(&p["title"]),
                    author: s(&p["createdBy"]["displayName"]),
                    head: branch(&p["sourceRefName"]),
                    base: branch(&p["targetRefName"]),
                    url: format!("{web}/{id}"),
                    draft: p["isDraft"].as_bool().unwrap_or(false),
                }
            })
            .collect())
    }

    fn create_pr(&self, remote: &RemoteRef, pr: &NewPr) -> Result<String, String> {
        let (api, web) = Self::api(&remote.path)?;
        let body = json!({
            "title": pr.title,
            "description": pr.body,
            "sourceRefName": format!("refs/heads/{}", pr.head),
            "targetRefName": format!("refs/heads/{}", pr.base),
        });
        let v = send(self.req(client().post(format!("{api}?api-version=7.1")).json(&body)))?;
        Ok(format!(
            "{web}/{}",
            v["pullRequestId"].as_u64().unwrap_or_default()
        ))
    }
}

pub(crate) fn entry(account: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, account).map_err(|e| e.to_string())
}

fn provider(
    kind: Provider,
    api: String,
    account: &str,
) -> Result<Box<dyn HostingProvider>, String> {
    let token = entry(account)?
        .get_password()
        .map_err(|_| format!("No token saved for {kind:?}. Add one in Settings → Integrations."))?;
    Ok(match kind {
        Provider::Github => Box::new(GitHub { token, api }),
        Provider::Gitlab => Box::new(GitLab { token, api }),
        Provider::BitbucketServer => Box::new(BitbucketServer { token, api }),
        Provider::Bitbucket => Box::new(Bitbucket(token)),
        Provider::Azure => {
            let (org, token) = token.split_once('\n').unwrap_or(("", &token));
            Box::new(Azure {
                token: token.to_owned(),
                org: org.to_owned(),
            })
        }
    })
}

type Res<T> = Result<T, String>;

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Res<T> + Send + 'static) -> Res<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}

/// `account` names one token in the OS keychain, e.g. "default/github".
#[tauri::command]
pub async fn hosting_save_token(account: String, token: String) -> Res<()> {
    blocking(move || {
        entry(&account)?
            .set_password(token.trim())
            .map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn hosting_delete_token(account: String) -> Res<()> {
    blocking(move || match entry(&account)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    })
    .await
}

#[tauri::command]
pub async fn hosting_has_token(account: String) -> Res<bool> {
    blocking(move || Ok(entry(&account)?.get_password().is_ok())).await
}

#[tauri::command]
pub fn hosting_set_servers(servers: Vec<Server>) {
    *SERVERS.write().unwrap() = servers
        .into_iter()
        .map(|s| Server {
            host: s
                .host
                .trim()
                .trim_start_matches("https://")
                .trim_end_matches('/')
                .to_owned(),
            ..s
        })
        .filter(|s| !s.host.is_empty())
        .collect();
}

/// `key` is a cloud provider ("github") or a self-hosted server's host.
#[tauri::command]
pub async fn hosting_repos(key: String, account: String) -> Res<Vec<HostRepo>> {
    blocking(move || {
        let (kind, api) = resolve(&key).ok_or("Unknown hosting provider")?;
        provider(kind, api, &account)?.repos()
    })
    .await
}

/// `key` is a cloud provider ("github") or a self-hosted server's host; `path` is a `.pub` file in ~/.ssh.
#[tauri::command]
pub async fn hosting_add_ssh_key(key: String, account: String, path: String) -> Res<()> {
    blocking(move || {
        let (public, title) = crate::keys::public_key(&path)?;
        let (kind, api) = resolve(&key).ok_or("Unknown hosting provider")?;
        provider(kind, api, &account)?.add_ssh_key(&title, &public)
    })
    .await
}

#[derive(Serialize)]
pub struct Detected {
    provider: Provider,
    path: String,
    key: String,
}

#[tauri::command]
pub fn hosting_detect(url: String) -> Option<Detected> {
    parse_remote(&url).map(|r| Detected {
        provider: r.provider,
        path: r.path,
        key: r.key,
    })
}

fn with_remote<T>(
    url: &str,
    account: &str,
    f: impl FnOnce(&dyn HostingProvider, &RemoteRef) -> Res<T>,
) -> Res<T> {
    let remote = parse_remote(url).ok_or("This remote is not on a supported hosting provider")?;
    let p = provider(remote.provider, remote.api.clone(), account)?;
    f(p.as_ref(), &remote)
}

#[tauri::command]
pub async fn hosting_prs(account: String, url: String) -> Res<Vec<Pr>> {
    blocking(move || with_remote(&url, &account, |p, r| p.prs(r))).await
}

#[tauri::command]
pub async fn hosting_create_pr(account: String, url: String, pr: NewPr) -> Res<String> {
    blocking(move || with_remote(&url, &account, |p, r| p.create_pr(r, &pr))).await
}

#[tauri::command]
pub async fn hosting_pr_diff(account: String, url: String, number: u64) -> Res<String> {
    blocking(move || with_remote(&url, &account, |p, r| p.pr_diff(r, number))).await
}

#[tauri::command]
pub async fn hosting_merge(account: String, url: String, number: u64, method: String) -> Res<()> {
    blocking(move || with_remote(&url, &account, |p, r| p.merge(r, number, &method))).await
}

#[tauri::command]
pub async fn hosting_avatars(
    account: String,
    url: String,
    root: String,
) -> Res<HashMap<String, String>> {
    blocking(move || {
        let emails = githawk_core::inspect::authors(&root, 2000);
        let remote =
            parse_remote(&url).ok_or("This remote is not on a supported hosting provider")?;
        match provider(remote.provider, remote.api.clone(), &account) {
            Ok(p) => p.avatars(&remote, &emails),
            // public GitHub repositories list commits without a token (60 requests an hour)
            Err(_) if remote.provider == Provider::Github => GitHub {
                token: String::new(),
                api: remote.api.clone(),
            }
            .avatars(&remote, &emails),
            Err(e) => Err(e),
        }
    })
    .await
}

/// CI status for each commit; commits without checks are left out.
#[tauri::command]
pub async fn hosting_checks(
    account: String,
    url: String,
    shas: Vec<String>,
) -> Res<HashMap<String, String>> {
    blocking(move || {
        with_remote(&url, &account, |p, r| {
            Ok(shas
                .iter()
                .filter(|s| s.len() >= 7 && s.chars().all(|c| c.is_ascii_hexdigit()))
                .filter_map(|s| p.checks(r, s).ok().flatten().map(|st| (s.clone(), st)))
                .collect())
        })
    })
    .await
}

#[tauri::command]
pub async fn hosting_review(account: String, url: String, number: u64, review: Review) -> Res<()> {
    blocking(move || with_remote(&url, &account, |p, r| p.review(r, number, &review))).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explains_api_errors() {
        let gh = json!({ "message": "Validation Failed", "errors": [{ "message": "key is already in use" }] });
        assert_eq!(error_text(&gh), "Validation Failed: key is already in use");
        let gl = json!({ "message": { "key": ["has already been taken"] } });
        assert_eq!(error_text(&gl), "key has already been taken");
    }

    #[test]
    fn combines_check_states() {
        assert_eq!(combine(&[]), None);
        assert_eq!(combine(&["success", "pending"]).as_deref(), Some("pending"));
        assert_eq!(
            combine(&["success", "failure", "pending"]).as_deref(),
            Some("failure")
        );
        assert_eq!(combine(&["success"]).as_deref(), Some("success"));
    }

    #[test]
    fn parses_remote_urls() {
        let servers = [
            Server {
                host: "git.corp.example".into(),
                kind: Provider::BitbucketServer,
            },
            Server {
                host: "ghe.corp.example".into(),
                kind: Provider::Github,
            },
        ];
        let p = |u: &str| parse_remote_with(u, &servers).map(|r| (r.provider, r.path));
        assert_eq!(
            p("https://github.com/owner/repo.git"),
            Some((Provider::Github, "owner/repo".into()))
        );
        assert_eq!(
            p("git@github.com:owner/repo.git"),
            Some((Provider::Github, "owner/repo".into()))
        );
        assert_eq!(
            p("ssh://git@gitlab.com/group/sub/repo"),
            Some((Provider::Gitlab, "group/sub/repo".into()))
        );
        assert_eq!(
            p("https://user@bitbucket.org/ws/repo.git"),
            Some((Provider::Bitbucket, "ws/repo".into()))
        );
        assert_eq!(
            p("https://org@dev.azure.com/org/proj/_git/repo"),
            Some((Provider::Azure, "org/proj/repo".into()))
        );
        assert_eq!(
            p("git@ssh.dev.azure.com:v3/org/proj/repo"),
            Some((Provider::Azure, "org/proj/repo".into()))
        );
        assert_eq!(
            p("https://org.visualstudio.com/proj/_git/repo"),
            Some((Provider::Azure, "org/proj/repo".into()))
        );
        assert_eq!(
            p("ssh://git@gitlab.com:2222/group/repo.git"),
            Some((Provider::Gitlab, "group/repo".into()))
        );
        assert_eq!(
            p("https://github.com/123org/repo"),
            Some((Provider::Github, "123org/repo".into()))
        );
        assert_eq!(
            p("https://git.corp.example/scm/PROJ/repo.git"),
            Some((Provider::BitbucketServer, "PROJ/repo".into()))
        );
        assert_eq!(
            p("ssh://git@git.corp.example:7999/proj/repo.git"),
            Some((Provider::BitbucketServer, "proj/repo".into()))
        );
        assert_eq!(p("https://github.com/a/b/../../repos/x/y/issues#"), None);
        assert_eq!(p("https://github.com/a/b%2F..%2F..%2Fuser"), None);
        assert_eq!(p("https://github.com/a/.%2e"), None);
        assert_eq!(p("https://github.com/a/b?x=1"), None);
        assert_eq!(p("https://evilgithub.com/a/b"), None);
        assert_eq!(p("https://bitbucket.org/ws/repo/extra"), None);
        assert_eq!(
            p("https://dev.azure.com/org/My%20Project/_git/repo"),
            Some((Provider::Azure, "org/My%20Project/repo".into()))
        );
        let ghe = parse_remote_with("git@ghe.corp.example:team/app.git", &servers).unwrap();
        assert_eq!(
            (ghe.path.as_str(), ghe.key.as_str(), ghe.api.as_str()),
            (
                "team/app",
                "ghe.corp.example",
                "https://ghe.corp.example/api/v3"
            )
        );
        let gh = parse_remote_with("https://github.com/o/r", &servers).unwrap();
        assert_eq!(
            (gh.key.as_str(), gh.api.as_str()),
            ("github", "https://api.github.com")
        );
        assert_eq!(p("https://unknown.example/o/r"), None);
        assert_eq!(p("/local/path/repo.git"), None);
        assert_eq!(enc("group/sub repo"), "group%2Fsub%20repo");
    }
}

#[derive(Serialize)]
pub struct Contributor {
    login: String,
    avatar: String,
    url: String,
    commits: u64,
}

/// GitHawk's own contributors, from the public GitHub API without a token.
#[tauri::command]
pub async fn githawk_contributors() -> Res<Vec<Contributor>> {
    blocking(|| {
        let body = send(
            client()
                .get("https://api.github.com/repos/masitings/githawk/contributors?per_page=100"),
        )?;
        Ok(body
            .as_array()
            .into_iter()
            .flatten()
            .filter(|c| c["type"] == "User")
            .map(|c| Contributor {
                login: s(&c["login"]),
                avatar: s(&c["avatar_url"]),
                url: s(&c["html_url"]),
                commits: c["contributions"].as_u64().unwrap_or(0),
            })
            .collect())
    })
    .await
}

/// People credited in `.all-contributorsrc`, including non-code work like design and bug reports.
#[tauri::command]
pub async fn githawk_thanks() -> Res<Value> {
    blocking(|| {
        let body =
            send(client().get(
                "https://raw.githubusercontent.com/masitings/githawk/main/.all-contributorsrc",
            ))?;
        Ok(body["contributors"].clone())
    })
    .await
}
