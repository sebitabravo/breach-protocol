//! Lógica del tablero de BREACH PROTOCOL. Sin reloj ni red en la lógica pura: la hora
//! llega como parámetro y el almacén es un trait (implementado en memoria y en Upstash).

pub mod board;
pub mod client;
pub mod error;
pub mod leaderboard;
pub mod name;
pub mod store;
pub mod submit;
pub mod upstash;
pub mod wire;

/// Tope del cuerpo de `POST /api/runs`. El límite de Vercel es 4.5 MB; el contrato pide 1 MiB.
pub const MAX_BODY_BYTES: usize = 1024 * 1024;
