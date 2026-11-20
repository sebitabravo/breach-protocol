//! Errores de la API con código estable y estado HTTP (contrato: docs/api-contract.md).

use serde_json::{json, Value};

use crate::store::StoreError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApiError {
    MethodNotAllowed,
    BodyTooLarge,
    BadJson,
    BadRequest,
    BadName,
    BadBase64,
    /// El registro no es BPL1 v1 válido: estructura, magic, versión o campos fuera de rango.
    MalformedLog,
    /// El registro decodifica pero no reproduce una partida válida hasta su final.
    LogInvalid,
    /// Partida verificada que no cuenta en ningún tablero (práctica, derrota en misión, fecha ajena).
    NotQualified,
    BadBoard,
    BadLimit,
    RateLimited,
    StoreUnavailable,
    Internal,
}

impl ApiError {
    pub fn status(self) -> u16 {
        match self {
            Self::BadJson
            | Self::BadRequest
            | Self::BadName
            | Self::BadBase64
            | Self::MalformedLog
            | Self::BadBoard
            | Self::BadLimit => 400,
            Self::MethodNotAllowed => 405,
            Self::BodyTooLarge => 413,
            Self::LogInvalid | Self::NotQualified => 422,
            Self::RateLimited => 429,
            Self::StoreUnavailable => 503,
            Self::Internal => 500,
        }
    }

    pub fn code(self) -> &'static str {
        match self {
            Self::MethodNotAllowed => "method_not_allowed",
            Self::BodyTooLarge => "body_too_large",
            Self::BadJson => "bad_json",
            Self::BadRequest => "bad_request",
            Self::BadName => "bad_name",
            Self::BadBase64 => "bad_base64",
            Self::MalformedLog => "malformed_log",
            Self::LogInvalid => "log_invalid",
            Self::NotQualified => "not_qualified",
            Self::BadBoard => "bad_board",
            Self::BadLimit => "bad_limit",
            Self::RateLimited => "rate_limited",
            Self::StoreUnavailable => "store_unavailable",
            Self::Internal => "internal",
        }
    }

    pub fn to_json(self) -> Value {
        json!({ "ok": false, "error": self.code() })
    }
}

impl From<StoreError> for ApiError {
    fn from(_: StoreError) -> Self {
        Self::StoreUnavailable
    }
}
