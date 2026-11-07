use std::io::Read;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::ipc::Response;

type Res<T> = Result<T, String>;

const MAX_BYTES: u64 = 20 << 20;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pet {
    #[serde(default)]
    id: String,
    display_name: String,
    #[serde(default)]
    description: String,
    #[serde(default = "default_sheet")]
    spritesheet_path: String,
}

fn default_sheet() -> String {
    "spritesheet.webp".into()
}

/// Shared with Codex, so pets installed there show up here too.
fn pets_dir() -> Res<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(|h| PathBuf::from(h).join(".codex").join("pets"))
        .ok_or_else(|| "Can't find your home folder".into())
}

fn valid_id(id: &str) -> Res<&str> {
    if !id.is_empty()
        && id.len() <= 100
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        Ok(id)
    } else {
        Err(format!("Invalid pet id: {id:?}"))
    }
}

fn valid_file(name: &str) -> Res<&str> {
    if !name.is_empty()
        && !name.contains(['/', '\\'])
        && !name.starts_with('.')
        && name.chars().all(|c| c.is_ascii_graphic())
    {
        Ok(name)
    } else {
        Err(format!("Invalid file name in pet: {name:?}"))
    }
}

fn read_pet(dir: PathBuf) -> Option<Pet> {
    let mut pet: Pet = serde_json::from_slice(&std::fs::read(dir.join("pet.json")).ok()?).ok()?;
    pet.id = dir.file_name()?.to_str()?.to_owned();
    valid_file(&pet.spritesheet_path).ok()?;
    dir.join(&pet.spritesheet_path).is_file().then_some(pet)
}

#[tauri::command]
pub async fn pets_list() -> Res<Vec<Pet>> {
    tauri::async_runtime::spawn_blocking(|| {
        let Ok(entries) = std::fs::read_dir(pets_dir()?) else {
            return Ok(vec![]);
        };
        let mut pets: Vec<Pet> = entries
            .flatten()
            .filter_map(|e| read_pet(e.path()))
            .collect();
        pets.sort_by_key(|p| p.display_name.to_lowercase());
        Ok(pets)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn pet_sprite(id: String) -> Res<Response> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = pets_dir()?.join(valid_id(&id)?);
        let pet = read_pet(dir.clone()).ok_or("Pet not found")?;
        let bytes = std::fs::read(dir.join(pet.spritesheet_path)).map_err(|e| e.to_string())?;
        Ok(Response::new(bytes))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Unpacks a `.codex-pet.zip` into `~/.codex/pets/<id>`, keeping only top-level files.
fn install_zip(dir: PathBuf, zip: &[u8]) -> Res<()> {
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(zip))
        .map_err(|e| format!("Not a pet package: {e}"))?;
    let mut files = Vec::new();
    for i in 0..archive.len() {
        let mut f = archive.by_index(i).map_err(|e| e.to_string())?;
        if f.is_dir() {
            continue;
        }
        let name = valid_file(f.name())?.to_owned();
        if f.size() > MAX_BYTES {
            return Err(format!("{name} is too large"));
        }
        let mut data = Vec::new();
        f.by_ref()
            .take(MAX_BYTES)
            .read_to_end(&mut data)
            .map_err(|e| e.to_string())?;
        files.push((name, data));
    }
    let manifest = files
        .iter()
        .find(|(n, _)| n == "pet.json")
        .ok_or("The package has no pet.json")?;
    let pet: Pet =
        serde_json::from_slice(&manifest.1).map_err(|e| format!("Invalid pet.json: {e}"))?;
    let sheet = valid_file(&pet.spritesheet_path)?;
    if !files.iter().any(|(n, _)| n == sheet) {
        return Err(format!("The package has no {sheet}"));
    }
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    for (name, data) in files {
        std::fs::write(dir.join(name), data).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// `source` is a local `.zip` path, a codex-pets.net link or a pet id from that site.
#[tauri::command]
pub async fn pet_install(source: String) -> Res<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let source = source.trim();
        if source.to_lowercase().ends_with(".zip") && !source.contains("://") {
            let path = PathBuf::from(source);
            let id = path
                .file_name()
                .and_then(|n| n.to_str())
                .and_then(|n| n.split('.').next())
                .ok_or("Invalid file name")?
                .to_owned();
            let data = std::fs::read(&path).map_err(|e| e.to_string())?;
            install_zip(pets_dir()?.join(valid_id(&id)?), &data)?;
            return Ok(id);
        }
        let id = source
            .split('?')
            .next()
            .unwrap_or_default()
            .trim_end_matches('/')
            .rsplit(['/', '#'])
            .next()
            .unwrap_or_default();
        let id = valid_id(id)?;
        let res = reqwest::blocking::Client::builder()
            .user_agent("GitHawk")
            .build()
            .map_err(|e| e.to_string())?
            .get(format!("https://codex-pets.net/api/pets/{id}/download"))
            .send()
            .map_err(|e| e.to_string())?;
        if !res.status().is_success() {
            return Err(format!("Couldn't download {id}: {}", res.status()));
        }
        let mut data = Vec::new();
        res.take(MAX_BYTES)
            .read_to_end(&mut data)
            .map_err(|e| e.to_string())?;
        install_zip(pets_dir()?.join(id), &data)?;
        Ok(id.to_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn zip(files: &[(&str, &[u8])]) -> Vec<u8> {
        let mut w = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        for (name, data) in files {
            w.start_file(*name, zip::write::SimpleFileOptions::default())
                .unwrap();
            w.write_all(data).unwrap();
        }
        w.finish().unwrap().into_inner()
    }

    #[test]
    fn installs_packages() {
        let dir = std::env::temp_dir().join(format!("githawk-pet-{}", std::process::id()));
        let manifest =
            br#"{"id":"duck","displayName":"Duck","spritesheetPath":"spritesheet.webp"}"#;
        install_zip(
            dir.join("duck"),
            &zip(&[("pet.json", manifest), ("spritesheet.webp", b"img")]),
        )
        .unwrap();
        let pet = read_pet(dir.join("duck")).unwrap();
        assert_eq!(
            (pet.id.as_str(), pet.display_name.as_str()),
            ("duck", "Duck")
        );

        assert!(install_zip(dir.join("x"), &zip(&[("pet.json", manifest)])).is_err());
        assert!(
            install_zip(
                dir.join("x"),
                &zip(&[("../pet.json", manifest), ("spritesheet.webp", b"")])
            )
            .is_err()
        );
        assert!(install_zip(dir.join("x"), b"not a zip").is_err());
        assert!(!dir.join("x").exists());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn rejects_unsafe_names() {
        assert!(valid_id("debug-duck_2").is_ok());
        for bad in ["", "..", "a/b", "a\\b", "duck.zip"] {
            assert!(valid_id(bad).is_err(), "{bad}");
        }
        assert!(valid_file("spritesheet.webp").is_ok());
        for bad in ["../x", "a/b", ".hidden", "a b", ""] {
            assert!(valid_file(bad).is_err(), "{bad}");
        }
    }
}
