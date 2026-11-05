use std::collections::HashMap;

use git2::{Oid, Repository, Sort};
use serde::Serialize;

use crate::Error;

#[derive(Debug, Clone, Serialize)]
pub struct RefLabel {
    pub name: String,
    /// "local", "remote" or "tag".
    pub kind: &'static str,
    pub head: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct Edge {
    pub from: u16,
    pub to: u16,
    pub color: u16,
}

#[derive(Debug, Clone, Serialize)]
pub struct Row {
    pub id: String,
    pub parents: Vec<String>,
    pub summary: String,
    pub author: String,
    pub email: String,
    /// Unix seconds, UTC.
    pub time: i64,
    pub refs: Vec<RefLabel>,
    pub head: bool,
    pub col: u16,
    pub color: u16,
    /// Segments from this row's lanes down to the next row.
    pub edges: Vec<Edge>,
}

pub fn graph(path: &str) -> Result<Vec<Row>, Error> {
    graph_filtered(path, &[], None)
}

/// `hidden` and `solo` are branch short names such as "main" or "origin/main".
/// Solo shows only that branch's history; hidden branches are left out.
pub fn graph_filtered(
    path: &str,
    hidden: &[String],
    solo: Option<&str>,
) -> Result<Vec<Row>, Error> {
    let repo = Repository::discover(path)?;
    let head_ref = repo.head().ok();
    let head = head_ref.as_ref().and_then(|h| h.target());
    let head_name = head_ref
        .as_ref()
        .filter(|h| h.is_branch())
        .and_then(|h| h.shorthand().map(str::to_owned));
    let refs = ref_labels(&repo, head_name.as_deref())?;

    let mut walk = repo.revwalk()?;
    // Lane assignment relies on children always coming before parents.
    walk.set_sorting(Sort::TOPOLOGICAL | Sort::TIME)?;
    let mut pushed = false;
    for r in repo.references()? {
        let r = r?;
        if !(r.is_branch() || r.is_remote()) {
            continue;
        }
        let (Some(name), Ok(c)) = (r.shorthand(), r.peel_to_commit()) else {
            continue;
        };
        let wanted = match solo {
            Some(s) => s == name,
            None => !hidden.iter().any(|h| h == name),
        };
        if wanted {
            walk.push(c.id())?;
            pushed = true;
        }
    }
    let head_hidden = head_name.as_ref().is_some_and(|n| hidden.contains(n));
    if let (Some(h), None, false) = (head, solo, head_hidden) {
        walk.push(h)?;
        pushed = true;
    }
    if !pushed {
        return Ok(Vec::new());
    }

    let mut lanes: Vec<Option<Oid>> = Vec::new();
    let mut colors: Vec<u16> = Vec::new();
    let mut next_color = 0u16;
    let mut pending: Vec<(u16, usize)> = Vec::new();
    let mut rows: Vec<Row> = Vec::new();

    for oid in walk {
        let oid = oid?;
        let commit = repo.find_commit(oid)?;

        let col = match lanes.iter().position(|l| *l == Some(oid)) {
            Some(i) => i,
            None => alloc(&mut lanes, &mut colors, &mut next_color),
        };

        if let Some(prev) = rows.last_mut() {
            prev.edges = pending
                .drain(..)
                .map(|(from, lane)| Edge {
                    from,
                    to: if lanes[lane] == Some(oid) { col } else { lane } as u16,
                    color: colors[lane],
                })
                .collect();
        }

        for l in lanes.iter_mut().skip(col + 1) {
            if *l == Some(oid) {
                *l = None;
            }
        }

        let parents: Vec<Oid> = commit.parent_ids().collect();
        lanes[col] = parents.first().copied();
        let mut from_node = vec![col];
        for &p in parents.iter().skip(1) {
            match lanes.iter().position(|l| *l == Some(p)) {
                Some(k) => pending.push((col as u16, k)),
                None => {
                    let k = alloc(&mut lanes, &mut colors, &mut next_color);
                    lanes[k] = Some(p);
                    from_node.push(k);
                }
            }
        }
        for (l, lane) in lanes.iter().enumerate() {
            if lane.is_some() {
                let from = if from_node.contains(&l) { col } else { l };
                pending.push((from as u16, l));
            }
        }
        let color = colors[col];
        while lanes.last() == Some(&None) {
            lanes.pop();
            colors.pop();
        }

        let author = commit.author();
        rows.push(Row {
            id: oid.to_string(),
            parents: parents.iter().map(Oid::to_string).collect(),
            summary: commit.summary().unwrap_or_default().to_owned(),
            author: author.name().unwrap_or_default().to_owned(),
            email: author.email().unwrap_or_default().to_owned(),
            time: commit.time().seconds(),
            refs: refs.get(&oid).cloned().unwrap_or_default(),
            head: Some(oid) == head,
            col: col as u16,
            color,
            edges: Vec::new(),
        });
    }
    Ok(rows)
}

fn alloc(lanes: &mut Vec<Option<Oid>>, colors: &mut Vec<u16>, next: &mut u16) -> usize {
    let i = lanes.iter().position(Option::is_none).unwrap_or_else(|| {
        lanes.push(None);
        colors.push(0);
        lanes.len() - 1
    });
    colors[i] = *next;
    *next = next.wrapping_add(1);
    i
}

fn ref_labels(repo: &Repository, head: Option<&str>) -> Result<HashMap<Oid, Vec<RefLabel>>, Error> {
    let mut map: HashMap<Oid, Vec<RefLabel>> = HashMap::new();
    for r in repo.references()? {
        let r = r?;
        let kind = if r.is_branch() {
            "local"
        } else if r.is_remote() {
            "remote"
        } else if r.is_tag() {
            "tag"
        } else {
            continue;
        };
        let (Some(name), Ok(c)) = (r.shorthand(), r.peel_to_commit()) else {
            continue;
        };
        if kind == "remote" && name.ends_with("/HEAD") {
            continue;
        }
        map.entry(c.id()).or_default().push(RefLabel {
            name: name.to_owned(),
            kind,
            head: kind == "local" && Some(name) == head,
        });
    }
    for labels in map.values_mut() {
        labels.sort_by_key(|l| (!l.head, l.kind != "local", l.kind == "tag"));
    }
    Ok(map)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_opens_and_closes_a_lane() {
        let dir = tempfile::tempdir().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        let tree = repo
            .find_tree(repo.index().unwrap().write_tree().unwrap())
            .unwrap();
        let commit = |msg: &str, t: i64, parents: &[Oid]| {
            let sig = git2::Signature::new("t", "t@t", &git2::Time::new(t, 0)).unwrap();
            let ps: Vec<_> = parents
                .iter()
                .map(|p| repo.find_commit(*p).unwrap())
                .collect();
            let refs: Vec<_> = ps.iter().collect();
            repo.commit(None, &sig, &sig, msg, &tree, &refs).unwrap()
        };
        let c0 = commit("c0", 0, &[]);
        let c1 = commit("c1", 1, &[c0]);
        let c2 = commit("c2", 2, &[c1]);
        let f1 = commit("f1", 3, &[c1]);
        let m = commit("m", 4, &[c2, f1]);
        repo.reference("refs/heads/main", m, true, "").unwrap();
        repo.set_head("refs/heads/main").unwrap();

        let rows = graph(dir.path().to_str().unwrap()).unwrap();
        let names: Vec<_> = rows.iter().map(|r| r.summary.as_str()).collect();
        assert_eq!(names, ["m", "f1", "c2", "c1", "c0"]);
        assert_eq!(
            rows.iter().map(|r| r.col).collect::<Vec<_>>(),
            [0, 1, 0, 0, 0]
        );
        assert!(rows[0].head);
        assert_eq!(rows[0].refs[0].name, "main");
        assert!(rows[0].refs[0].head);

        let e = |r: &Row| r.edges.iter().map(|e| (e.from, e.to)).collect::<Vec<_>>();
        assert_eq!(e(&rows[0]), [(0, 0), (0, 1)]);
        assert_eq!(e(&rows[1]), [(0, 0), (1, 1)]);
        assert_eq!(e(&rows[2]), [(0, 0), (1, 0)]);
        assert_eq!(e(&rows[3]), [(0, 0)]);
        assert!(rows[4].edges.is_empty());
        assert_ne!(rows[0].color, rows[1].color);

        repo.reference("refs/heads/side", f1, true, "").unwrap();
        let solo = graph_filtered(dir.path().to_str().unwrap(), &[], Some("side")).unwrap();
        assert_eq!(
            solo.iter().map(|r| r.summary.as_str()).collect::<Vec<_>>(),
            ["f1", "c1", "c0"]
        );
        let hidden = graph_filtered(dir.path().to_str().unwrap(), &["main".into()], None).unwrap();
        assert_eq!(
            hidden.len(),
            3,
            "HEAD is main, so hiding main hides HEAD too"
        );
    }
}
