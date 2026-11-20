//! Lectura de `GET /api/leaderboard?board=<key>&limit=<1..50>`.

use serde_json::{json, Value};

use crate::board::is_known_board;
use crate::error::ApiError;
use crate::store::Store;

pub const DEFAULT_LIMIT: usize = 10;
pub const MAX_LIMIT: usize = 50;

pub fn read(store: &dyn Store, query: Option<&str>) -> Result<Value, ApiError> {
    let (board, limit) = parse_query(query)?;
    let total = store.total(&board)?;
    let entries = store
        .top(&board, limit)?
        .into_iter()
        .enumerate()
        .map(|(index, entry)| {
            json!({
                "rank": index + 1,
                "name": name_of(&entry.member),
                "score": entry.score,
                "at": entry.at,
            })
        })
        .collect::<Vec<_>>();
    Ok(json!({ "board": board, "total": total, "entries": entries }))
}

/// Un límite fuera de rango se acota a 1..=50; uno que no es entero es `bad_limit`.
pub fn parse_query(query: Option<&str>) -> Result<(String, usize), ApiError> {
    let mut board = None;
    let mut limit = None;
    for pair in query
        .unwrap_or("")
        .split('&')
        .filter(|pair| !pair.is_empty())
    {
        let (key, raw) = pair.split_once('=').unwrap_or((pair, ""));
        match key {
            "board" => board = Some(percent_decode(raw).ok_or(ApiError::BadBoard)?),
            "limit" => limit = Some(percent_decode(raw).ok_or(ApiError::BadLimit)?),
            _ => {}
        }
    }

    let board = board.ok_or(ApiError::BadBoard)?;
    if !is_known_board(&board) {
        return Err(ApiError::BadBoard);
    }
    let limit = match limit {
        None => DEFAULT_LIMIT,
        Some(text) => {
            let value = text.parse::<i64>().map_err(|_| ApiError::BadLimit)?;
            usize::try_from(value.clamp(1, MAX_LIMIT as i64)).unwrap_or(DEFAULT_LIMIT)
        }
    };
    Ok((board, limit))
}

/// El miembro es `nombre|hash16`; el nombre nunca contiene `|` porque el saneado lo quita.
fn name_of(member: &str) -> &str {
    member.rsplit_once('|').map_or(member, |(name, _)| name)
}

/// Decodifica `%XX` (y `+` como espacio) de un valor de query. `None` si no es UTF-8 válido.
fn percent_decode(raw: &str) -> Option<String> {
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'+' => out.push(b' '),
            b'%' => {
                let hex = raw.get(index + 1..index + 3)?;
                out.push(u8::from_str_radix(hex, 16).ok()?);
                index += 2;
            }
            byte => out.push(byte),
        }
        index += 1;
    }
    String::from_utf8(out).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_a_plain_board_key() {
        assert_eq!(
            parse_query(Some("board=overflow")).unwrap(),
            ("overflow".into(), DEFAULT_LIMIT)
        );
    }

    #[test]
    fn decodes_percent_encoded_board_keys() {
        assert_eq!(
            parse_query(Some("board=mission%3As01&limit=3")).unwrap(),
            ("mission:s01".into(), 3)
        );
    }

    #[test]
    fn clamps_limit_into_one_to_fifty() {
        assert_eq!(
            parse_query(Some("board=overflow&limit=999")).unwrap().1,
            MAX_LIMIT
        );
        assert_eq!(parse_query(Some("board=overflow&limit=0")).unwrap().1, 1);
        assert_eq!(parse_query(Some("board=overflow&limit=-7")).unwrap().1, 1);
        assert_eq!(parse_query(Some("board=overflow&limit=50")).unwrap().1, 50);
    }

    #[test]
    fn rejects_a_missing_or_unknown_board() {
        assert_eq!(parse_query(None), Err(ApiError::BadBoard));
        assert_eq!(parse_query(Some("board=practice")), Err(ApiError::BadBoard));
        assert_eq!(parse_query(Some("limit=5")), Err(ApiError::BadBoard));
    }

    #[test]
    fn rejects_a_limit_that_is_not_an_integer() {
        assert_eq!(
            parse_query(Some("board=overflow&limit=abc")),
            Err(ApiError::BadLimit)
        );
        assert_eq!(
            parse_query(Some("board=overflow&limit=")),
            Err(ApiError::BadLimit)
        );
    }

    #[test]
    fn rejects_malformed_percent_escapes() {
        assert_eq!(
            parse_query(Some("board=overflow%")),
            Err(ApiError::BadBoard)
        );
        assert_eq!(parse_query(Some("board=%zz")), Err(ApiError::BadBoard));
    }

    #[test]
    fn strips_the_hash_suffix_from_members() {
        assert_eq!(name_of("SEBITA|00ff00ff00ff00ff"), "SEBITA");
        assert_eq!(name_of("Ñuñoa 2|0000000000000001"), "Ñuñoa 2");
    }

    #[test]
    fn lists_entries_in_rank_order_with_name_score_and_time() {
        let store = crate::store::MemoryStore::default();
        store
            .zadd_nx("overflow", "LOW|0000000000000001", 10, 100)
            .unwrap();
        store
            .zadd_nx("overflow", "HIGH|0000000000000002", 90, 200)
            .unwrap();
        store
            .zadd_nx("overflow", "MID|0000000000000003", 50, 300)
            .unwrap();
        let body = read(&store, Some("board=overflow&limit=2")).unwrap();
        assert_eq!(body["board"], "overflow");
        assert_eq!(body["total"], 3);
        assert_eq!(
            body["entries"],
            json!([
                { "rank": 1, "name": "HIGH", "score": 90, "at": 200 },
                { "rank": 2, "name": "MID", "score": 50, "at": 300 },
            ])
        );
    }

    #[test]
    fn empty_board_reads_as_zero_entries() {
        let store = crate::store::MemoryStore::default();
        let body = read(&store, Some("board=overflow")).unwrap();
        assert_eq!(
            body,
            json!({ "board": "overflow", "total": 0, "entries": [] })
        );
    }
}
