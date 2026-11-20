//! Puerto de almacenamiento y su implementación en memoria. El orden replica Redis:
//! puntaje descendente y, en empate, miembro descendente (como `ZREVRANGE`).
//!
//! Un miembro es el hash del replay (`hash16`), no el nombre: una misma corrida verificada
//! tiene una sola entrada por tablero, sin importar bajo qué nombre se envíe.

use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard, PoisonError};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    pub member: String,
    pub name: String,
    pub score: u32,
    pub at: u64,
}

/// Una corrida verificada lista para entrar a un tablero.
#[derive(Debug, Clone, Copy)]
pub struct Candidate<'a> {
    /// `hash16`: hash del estado final re-simulado.
    pub member: &'a str,
    pub name: &'a str,
    pub score: u32,
    pub at: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StoreError {
    Unavailable,
}

pub trait Store: Send + Sync {
    /// Inserta `candidate` solo si su miembro no existe. Si ya existe no cambia nada: ni puntaje,
    /// ni nombre, ni hora. Devuelve `true` si la entrada es nueva.
    fn zadd_nx(&self, board: &str, candidate: &Candidate<'_>) -> Result<bool, StoreError>;
    /// Posición 1-based en el orden descendente del tablero.
    fn rank(&self, board: &str, member: &str) -> Result<Option<u64>, StoreError>;
    fn total(&self, board: &str) -> Result<u64, StoreError>;
    /// Los `limit` mejores, en orden de ranking.
    fn top(&self, board: &str, limit: usize) -> Result<Vec<Entry>, StoreError>;
    /// Cuenta un golpe en `bucket` y devuelve el total de la ventana, incluido este.
    fn rate_limit_hit(&self, bucket: &str) -> Result<u64, StoreError>;
}

#[derive(Debug, Clone)]
struct Stored {
    name: String,
    score: u32,
    at: u64,
}

type Board = HashMap<String, Stored>;

#[derive(Default)]
pub struct MemoryStore {
    boards: Mutex<HashMap<String, Board>>,
    buckets: Mutex<HashMap<String, u64>>,
}

impl MemoryStore {
    fn boards(&self) -> MutexGuard<'_, HashMap<String, Board>> {
        self.boards.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn buckets(&self) -> MutexGuard<'_, HashMap<String, u64>> {
        self.buckets.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// Orden de ranking de Redis: score descendente, luego miembro descendente en bytes.
fn ranked(board: &Board) -> Vec<(&String, &Stored)> {
    let mut rows: Vec<_> = board.iter().collect();
    rows.sort_by(|a, b| b.1.score.cmp(&a.1.score).then_with(|| b.0.cmp(a.0)));
    rows
}

impl Store for MemoryStore {
    fn zadd_nx(&self, board: &str, candidate: &Candidate<'_>) -> Result<bool, StoreError> {
        let mut boards = self.boards();
        let entries = boards.entry(board.to_string()).or_default();
        if entries.contains_key(candidate.member) {
            return Ok(false);
        }
        entries.insert(
            candidate.member.to_string(),
            Stored {
                name: candidate.name.to_string(),
                score: candidate.score,
                at: candidate.at,
            },
        );
        Ok(true)
    }

    fn rank(&self, board: &str, member: &str) -> Result<Option<u64>, StoreError> {
        let boards = self.boards();
        let Some(entries) = boards.get(board) else {
            return Ok(None);
        };
        Ok(ranked(entries)
            .iter()
            .position(|(candidate, _)| candidate.as_str() == member)
            .map(|index| index as u64 + 1))
    }

    fn total(&self, board: &str) -> Result<u64, StoreError> {
        Ok(self
            .boards()
            .get(board)
            .map_or(0, |entries| entries.len() as u64))
    }

    fn top(&self, board: &str, limit: usize) -> Result<Vec<Entry>, StoreError> {
        let boards = self.boards();
        let Some(entries) = boards.get(board) else {
            return Ok(Vec::new());
        };
        Ok(ranked(entries)
            .into_iter()
            .take(limit)
            .map(|(member, stored)| Entry {
                member: member.clone(),
                name: stored.name.clone(),
                score: stored.score,
                at: stored.at,
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

    fn cand<'a>(member: &'a str, name: &'a str, score: u32, at: u64) -> Candidate<'a> {
        Candidate {
            member,
            name,
            score,
            at,
        }
    }

    #[test]
    fn ranks_by_score_descending() {
        let store = MemoryStore::default();
        store.zadd_nx("b", &cand("0a", "low", 10, 1)).unwrap();
        store.zadd_nx("b", &cand("0b", "high", 90, 2)).unwrap();
        store.zadd_nx("b", &cand("0c", "mid", 50, 3)).unwrap();
        assert_eq!(store.rank("b", "0b").unwrap(), Some(1));
        assert_eq!(store.rank("b", "0c").unwrap(), Some(2));
        assert_eq!(store.rank("b", "0a").unwrap(), Some(3));
    }

    #[test]
    fn breaks_score_ties_by_member_descending_like_zrevrange() {
        let store = MemoryStore::default();
        store.zadd_nx("b", &cand("aa", "x", 7, 1)).unwrap();
        store.zadd_nx("b", &cand("zz", "y", 7, 1)).unwrap();
        let top = store.top("b", 10).unwrap();
        assert_eq!(top[0].member, "zz");
        assert_eq!(top[1].member, "aa");
        assert_eq!(store.rank("b", "zz").unwrap(), Some(1));
    }

    #[test]
    fn zadd_nx_never_overwrites_an_existing_member() {
        let store = MemoryStore::default();
        assert!(store.zadd_nx("b", &cand("m1", "first", 5, 100)).unwrap());
        assert!(!store.zadd_nx("b", &cand("m1", "second", 999, 200)).unwrap());
        let top = store.top("b", 1).unwrap();
        assert_eq!(
            (top[0].name.as_str(), top[0].score, top[0].at),
            ("first", 5, 100)
        );
    }

    #[test]
    fn boards_are_independent() {
        let store = MemoryStore::default();
        store.zadd_nx("overflow", &cand("m1", "x", 5, 1)).unwrap();
        assert_eq!(store.total("overflow").unwrap(), 1);
        assert_eq!(store.total("mission:s01").unwrap(), 0);
        assert_eq!(store.rank("mission:s01", "m1").unwrap(), None);
    }

    #[test]
    fn top_respects_the_limit() {
        let store = MemoryStore::default();
        for n in 0..5 {
            store
                .zadd_nx("b", &cand(&format!("m{n}"), "p", n, 1))
                .unwrap();
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
