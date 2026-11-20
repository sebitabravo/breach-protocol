//! Orquestación de `POST /api/runs`. Orden: tamaño (413), límite de tasa (429), forma del
//! JSON (400), verificación del registro (400/422), tablero (422) y almacén (503). El límite
//! va antes de re-simular para proteger la CPU.

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde_json::{json, Value};

use crate::board::{derive_board, RunHeader};
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

pub fn submit(store: &dyn Store, input: &Submission<'_>) -> Result<Accepted, ApiError> {
    if input.body.len() > MAX_BODY_BYTES {
        return Err(ApiError::BodyTooLarge);
    }

    let minute = input.now_unix / 60;
    let bucket = format!("rl:{}:{minute}", input.client);
    if store.rate_limit_hit(&bucket)? > RATE_LIMIT_PER_MINUTE {
        return Err(ApiError::RateLimited);
    }

    let request: Value = serde_json::from_slice(input.body).map_err(|_| ApiError::BadJson)?;
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
    let outcome = bp_core::run(&log).map_err(|_| ApiError::LogInvalid)?;

    let header = RunHeader {
        mode: log.header.mode,
        map: log.header.map,
        seed: log.header.seed,
    };
    let board = derive_board(header, &outcome, input.now_unix)?;

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
