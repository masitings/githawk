use std::time::Instant;

fn main() {
    let path = std::env::args().nth(1).unwrap_or_else(|| ".".into());
    let t = Instant::now();
    let rows = githawk_core::graph(&path).expect("graph");
    let lanes = rows.iter().map(|r| r.col).max().unwrap_or(0) + 1;
    println!("{} commits, {} lanes, {:?}", rows.len(), lanes, t.elapsed());
}
