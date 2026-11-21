//! `POST /api/runs`: clasifica sin simular, limita por clase y cliente y solo entonces
//! verifica el registro. El tráfico malformado no consume la cuota de re-simulación.

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde_json::{json, Value};

use crate::board::derive_board;
use crate::error::ApiError;
use crate::name::sanitize_name;
use crate::store::{Candidate, Store};
use crate::MAX_BODY_BYTES;

/// Envíos por minuto y por cliente (contrato).
pub const RATE_LIMIT_PER_MINUTE: u64 = 10;

#[derive(Debug, Clone, Copy)]
pub struct Submission<'a> {
    pub body: &'a [u8],
    /// Identidad ya hasheada del cliente (`client::client_key`). La IP nunca llega aquí.
    pub client: &'a str,
    pub now_unix: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Accepted {
    pub board: String,
    pub score: u32,
    pub score_version: u8,
    pub won: bool,
    pub rank: u64,
    pub total: u64,
}

impl Accepted {
    pub fn to_json(&self) -> Value {
        json!({
            "ok": true,
            "board": self.board,
            "score": self.score,
            "scoreVersion": self.score_version,
            "won": self.won,
            "rank": self.rank,
            "total": self.total,
        })
    }
}

fn check_rate(
    store: &dyn Store,
    prefix: &str,
    client: &str,
    now_unix: u64,
) -> Result<(), ApiError> {
    let minute = now_unix / 60;
    let bucket = format!("{prefix}:{client}:{minute}");
    if store.rate_limit_hit(&bucket)? > RATE_LIMIT_PER_MINUTE {
        return Err(ApiError::RateLimited);
    }
    Ok(())
}

/// Cuenta errores de lectura y de estructura en la misma cuota separada.
pub fn malformed_response(
    store: &dyn Store,
    client: &str,
    now_unix: u64,
    error: ApiError,
) -> ApiError {
    check_rate(store, "rlbad", client, now_unix)
        .err()
        .unwrap_or(error)
}

fn parse(body: &[u8]) -> Result<(String, bp_core::Log), ApiError> {
    if body.len() > MAX_BODY_BYTES {
        return Err(ApiError::BodyTooLarge);
    }
    let request: Value = serde_json::from_slice(body).map_err(|_| ApiError::BadJson)?;
    let raw_name = request
        .get("name")
        .and_then(Value::as_str)
        .ok_or(ApiError::BadRequest)?;
    let log_b64 = request
        .get("log")
        .and_then(Value::as_str)
        .ok_or(ApiError::BadRequest)?;
    let name = sanitize_name(raw_name)?;
    let bytes = STANDARD.decode(log_b64).map_err(|_| ApiError::BadBase64)?;
    let log = bp_core::decode(&bytes).map_err(|_| ApiError::MalformedLog)?;
    Ok((name, log))
}

pub fn submit(store: &dyn Store, input: &Submission<'_>) -> Result<Accepted, ApiError> {
    let (name, log) = match parse(input.body) {
        Ok(parsed) => parsed,
        Err(error) => {
            return Err(malformed_response(
                store,
                input.client,
                input.now_unix,
                error,
            ))
        }
    };
    check_rate(store, "rl", input.client, input.now_unix)?;

    // BPL1 only claims an unlock; it cannot prove a prior SECTOR_02 win. A win in
    // this replay cannot grant a weapon retroactively (src/core/progress.ts).
    if log.header.flags & bp_core::FLAG_SHOTGUN != 0 {
        return Err(ApiError::NotQualified);
    }
    let outcome = bp_core::run(&log).map_err(|_| ApiError::LogInvalid)?;

    let board = derive_board(&log.header, &outcome, input.now_unix)?;

    // `hash16`: el hash del estado final que calculó el servidor. Identifica la corrida, no a
    // quien la envía; por eso una misma corrida no puede entrar dos veces al mismo tablero.
    let member = format!("{:016x}", outcome.hash);
    let candidate = Candidate {
        member: &member,
        name: &name,
        score: outcome.score,
        at: input.now_unix,
    };
    store.zadd_nx(&board, &candidate)?;
    let rank = store
        .rank(&board, &member)?
        .ok_or(ApiError::StoreUnavailable)?;
    let total = store.total(&board)?;

    Ok(Accepted {
        board,
        score: outcome.score,
        score_version: outcome.score_version,
        won: outcome.won,
        rank,
        total,
    })
}
