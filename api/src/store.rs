//! Puerto de almacenamiento y su implementación en memoria. El orden replica Redis:
//! puntaje descendente y, en empate, miembro descendente (como `ZREVRANGE`).

use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard, PoisonError};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    pub member: String,
    pub score: u32,
    pub at: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StoreError {
    Unavailable,
}

pub trait Store: Send + Sync {
    /// Agrega `member` con `score` solo si no existe, y guarda `at` la primera vez.
    /// Devuelve `true` si el miembro es nuevo.
    fn zadd_nx(&self, board: &str, member: &str, score: u32, at: u64) -> Result<bool, StoreError>;
    /// Posición 1-based en el orden descendente del tablero.
    fn rank(&self, board: &str, member: &str) -> Result<Option<u64>, StoreError>;
    fn total(&self, board: &str) -> Result<u64, StoreError>;
    /// Los `limit` mejores, en orden de ranking.
    fn top(&self, board: &str, limit: usize) -> Result<Vec<Entry>, StoreError>;
    /// Cuenta un golpe en `bucket` y devuelve el total de la ventana, incluido este.
    fn rate_limit_hit(&self, bucket: &str) -> Result<u64, StoreError>;
}

type Scores = HashMap<String, (u32, u64)>;

#[derive(Default)]
pub struct MemoryStore {
    boards: Mutex<HashMap<String, Scores>>,
    buckets: Mutex<HashMap<String, u64>>,
}

impl MemoryStore {
    fn boards(&self) -> MutexGuard<'_, HashMap<String, Scores>> {
        self.boards.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn buckets(&self) -> MutexGuard<'_, HashMap<String, u64>> {
        self.buckets.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// Orden de ranking de Redis: score descendente, luego miembro descendente en bytes.
fn ranked(scores: &Scores) -> Vec<(&String, u32, u64)> {
    let mut rows: Vec<_> = scores
        .iter()
        .map(|(member, &(score, at))| (member, score, at))
        .collect();
    rows.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| b.0.cmp(a.0)));
    rows
}

impl Store for MemoryStore {
    fn zadd_nx(&self, board: &str, member: &str, score: u32, at: u64) -> Result<bool, StoreError> {
        let mut boards = self.boards();
        let scores = boards.entry(board.to_string()).or_default();
        if scores.contains_key(member) {
            return Ok(false);
        }
        scores.insert(member.to_string(), (score, at));
        Ok(true)
    }

    fn rank(&self, board: &str, member: &str) -> Result<Option<u64>, StoreError> {
        let boards = self.boards();
        let Some(scores) = boards.get(board) else {
            return Ok(None);
        };
        Ok(ranked(scores)
            .iter()
            .position(|(candidate, _, _)| candidate.as_str() == member)
            .map(|index| index as u64 + 1))
    }

    fn total(&self, board: &str) -> Result<u64, StoreError> {
        Ok(self
            .boards()
            .get(board)
            .map_or(0, |scores| scores.len() as u64))
    }

    fn top(&self, board: &str, limit: usize) -> Result<Vec<Entry>, StoreError> {
        let boards = self.boards();
        let Some(scores) = boards.get(board) else {
            return Ok(Vec::new());
        };
        Ok(ranked(scores)
            .into_iter()
            .take(limit)
            .map(|(member, score, at)| Entry {
                member: member.clone(),
                score,
                at,
            })
            .collect())
    }

    fn rate_limit_hit(&self, bucket: &str) -> Result<u64, StoreError> {
        let mut buckets = self.buckets();
        let hits = buckets.entry(bucket.to_string()).or_insert(0);
        *hits += 1;
        Ok(*hits)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ranks_by_score_descending() {
        let store = MemoryStore::default();
        store.zadd_nx("b", "low|1", 10, 1).unwrap();
        store.zadd_nx("b", "high|2", 90, 2).unwrap();
        store.zadd_nx("b", "mid|3", 50, 3).unwrap();
        assert_eq!(store.rank("b", "high|2").unwrap(), Some(1));
        assert_eq!(store.rank("b", "mid|3").unwrap(), Some(2));
        assert_eq!(store.rank("b", "low|1").unwrap(), Some(3));
    }

    #[test]
    fn breaks_score_ties_by_member_descending_like_zrevrange() {
        let store = MemoryStore::default();
        store.zadd_nx("b", "aaa|1", 7, 1).unwrap();
        store.zadd_nx("b", "zzz|2", 7, 1).unwrap();
        let top = store.top("b", 10).unwrap();
        assert_eq!(top[0].member, "zzz|2");
        assert_eq!(top[1].member, "aaa|1");
        assert_eq!(store.rank("b", "zzz|2").unwrap(), Some(1));
    }

    #[test]
    fn zadd_nx_never_overwrites_an_existing_member() {
        let store = MemoryStore::default();
        assert!(store.zadd_nx("b", "m|1", 5, 100).unwrap());
        assert!(!store.zadd_nx("b", "m|1", 999, 200).unwrap());
        let top = store.top("b", 1).unwrap();
        assert_eq!((top[0].score, top[0].at), (5, 100));
    }

    #[test]
    fn boards_are_independent() {
        let store = MemoryStore::default();
        store.zadd_nx("overflow", "m|1", 5, 1).unwrap();
        assert_eq!(store.total("overflow").unwrap(), 1);
        assert_eq!(store.total("mission:s01").unwrap(), 0);
        assert_eq!(store.rank("mission:s01", "m|1").unwrap(), None);
    }

    #[test]
    fn top_respects_the_limit() {
        let store = MemoryStore::default();
        for n in 0..5 {
            store.zadd_nx("b", &format!("p{n}|x"), n, 1).unwrap();
        }
        assert_eq!(store.top("b", 2).unwrap().len(), 2);
        assert_eq!(store.top("missing", 2).unwrap(), Vec::new());
    }

    #[test]
    fn rate_limit_counts_hits_within_a_bucket() {
        let store = MemoryStore::default();
        assert_eq!(store.rate_limit_hit("rl:a:1").unwrap(), 1);
        assert_eq!(store.rate_limit_hit("rl:a:1").unwrap(), 2);
        assert_eq!(store.rate_limit_hit("rl:a:2").unwrap(), 1);
    }
}
