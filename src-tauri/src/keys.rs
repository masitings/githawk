use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Command;

use githawk_core::ops;
use serde::Serialize;

type Res<T> = Result<T, String>;

#[derive(Serialize)]
pub struct SshKey {
    path: String,
    kind: String,
    comment: String,
    public: String,
}

#[derive(Serialize)]
pub struct GpgKey {
    id: String,
    uid: String,
}

fn ssh_dir() -> Res<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(|h| PathBuf::from(h).join(".ssh"))
        .ok_or_else(|| "Can't find your home folder".into())
}

fn read_key(path: PathBuf) -> Option<SshKey> {
    let public = std::fs::read_to_string(&path).ok()?.trim().to_owned();
    let mut parts = public.splitn(3, ' ');
    let kind = parts.next()?.to_owned();
    parts.next()?;
    Some(SshKey {
        path: path.to_string_lossy().into_owned(),
        kind,
        comment: parts.next().unwrap_or_default().to_owned(),
        public,
    })
}

#[tauri::command]
pub async fn ssh_keys() -> Res<Vec<SshKey>> {
    tauri::async_runtime::spawn_blocking(|| {
        let Ok(dir) = std::fs::read_dir(ssh_dir()?) else {
            return Ok(Vec::new());
        };
        let mut keys: Vec<SshKey> = dir
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.extension().is_some_and(|x| x == "pub"))
            .filter_map(read_key)
            .collect();
        keys.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(keys)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn ssh_generate(name: String, email: String) -> Res<SshKey> {
    tauri::async_runtime::spawn_blocking(move || {
        if name.is_empty()
            || name.starts_with(['.', '-'])
            || !name
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || "._-".contains(c))
        {
            return Err(
                "Use letters, digits, dots, dashes and underscores for the key name".into(),
            );
        }
        let dir = ssh_dir()?;
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700));
        }
        let path = dir.join(&name);
        if path.exists() {
            return Err(format!("{} already exists", path.display()));
        }
        // ponytail: no passphrase; add one later with ssh-keygen -p if the key leaves this machine
        let out = Command::new("ssh-keygen")
            .args(["-q", "-t", "ed25519", "-N", "", "-C"])
            .arg(email.trim())
            .arg("-f")
            .arg(&path)
            .output()
            .map_err(|e| format!("ssh-keygen not found: {e}"))?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).trim().to_owned());
        }
        read_key(path.with_extension("pub"))
            .ok_or_else(|| "The key was created but its public half can't be read".into())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn gpg_keys() -> Res<Vec<GpgKey>> {
    tauri::async_runtime::spawn_blocking(|| {
        let Ok(out) = Command::new("gpg")
            .args([
                "--list-secret-keys",
                "--keyid-format",
                "long",
                "--with-colons",
            ])
            .output()
        else {
            return Ok(Vec::new());
        };
        let mut keys: Vec<GpgKey> = Vec::new();
        for line in String::from_utf8_lossy(&out.stdout).lines() {
            let f: Vec<&str> = line.split(':').collect();
            match f.first() {
                Some(&"sec") if f.len() > 4 => keys.push(GpgKey {
                    id: f[4].to_owned(),
                    uid: String::new(),
                }),
                Some(&"uid") if f.len() > 9 => {
                    if let Some(k) = keys.last_mut().filter(|k| k.uid.is_empty()) {
                        k.uid = f[9].to_owned();
                    }
                }
                _ => {}
            }
        }
        Ok(keys)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Global git settings GitHawk may change; anything that can name a program (core.sshCommand,
/// arbitrary credential helpers) is left out on purpose.
const CONFIG_KEYS: &[&str] = &[
    "init.defaultBranch",
    "pull.rebase",
    "fetch.prune",
    "push.autoSetupRemote",
    "core.autocrlf",
    "commit.gpgSign",
    "credential.helper",
];
const HELPERS: &[&str] = &["osxkeychain", "manager", "libsecret", "cache", "store"];

fn valid(key: &str, value: &str) -> bool {
    if key == "credential.helper" {
        value.is_empty() || HELPERS.contains(&value)
    } else {
        value.len() < 100
            && !value.starts_with('-')
            && value
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || "._/-".contains(c))
    }
}

fn global(args: &[&str]) -> Res<String> {
    ops::run(
        &std::env::temp_dir(),
        &[&["config", "--global"], args].concat(),
        None,
    )
}

#[tauri::command]
pub async fn git_config_get() -> Res<HashMap<String, String>> {
    tauri::async_runtime::spawn_blocking(|| {
        Ok(CONFIG_KEYS
            .iter()
            .map(|k| {
                (
                    k.to_string(),
                    global(&["--get", k]).unwrap_or_default().trim().to_owned(),
                )
            })
            .collect())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_config_set(key: String, value: String) -> Res<()> {
    tauri::async_runtime::spawn_blocking(move || {
        let value = value.trim();
        if !CONFIG_KEYS.contains(&key.as_str()) || !valid(&key, value) {
            return Err(format!("Invalid value for {key}"));
        }
        if value.is_empty() {
            // exit code 5 just means the key wasn't set
            let _ = global(&["--unset-all", &key]);
            Ok(())
        } else {
            global(&["--replace-all", &key, value]).map(drop)
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::valid;

    #[test]
    fn config_values() {
        assert!(valid("credential.helper", "osxkeychain"));
        assert!(valid("credential.helper", ""));
        assert!(!valid("credential.helper", "!sh -c evil"));
        assert!(!valid("credential.helper", "/tmp/helper"));
        assert!(valid("init.defaultBranch", "main"));
        assert!(!valid("init.defaultBranch", "--global"));
        assert!(!valid("pull.rebase", "true; rm"));
    }
}
