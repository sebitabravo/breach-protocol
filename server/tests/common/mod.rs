//! Construcción de registros reales con `bp_core`. Nada de puntajes ni ticks fijos:
//! los tests calculan lo esperado con `bp_core::run`, porque el núcleo sigue cambiando.
#![allow(dead_code)]

use std::sync::OnceLock;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use bp_core::Game;

pub use bp_core::{MODE_DAILY, MODE_MISSION, MODE_OVERFLOW, MODE_PRACTICE};

pub const FLAG_AUTO_RELOAD: u8 = 2;

/// 2026-11-20T12:00:00Z. Fecha fija para que los tests de daily sean deterministas.
pub const NOW_UNIX: u64 = 1_795_132_800 + 12 * 3600;

/// Espejo de `phase::PLAYING` y `phase::EXTRACTION` (`core/src/protocol.rs`), que no están exportados.
const PHASE_PLAYING: f32 = bp_core::PLAYING;
const PHASE_EXTRACTION: f32 = bp_core::EXTRACTION;

/// Techo de ticks de un registro verificable (`bp_core` lo rechaza por encima).
const MAX_TICKS: u32 = bp_core::MAX_TICKS;

/// Graba una partida hasta que termina o se alcanza `cap` ticks. `fire` aprieta el gatillo
/// en un patrón fijo para que haya disparos y, con suerte, puntaje distinto de cero.
pub fn record(mode: u8, map: u8, seed: u32, flags: u8, fire: bool, cap: u32) -> Vec<u8> {
    let cap = cap.min(MAX_TICKS);
    let mut g = Game::new(seed);
    g.enable_recording();
    assert!(
        g.start(mode, map, seed, flags),
        "start rejected mode {mode} map {map}"
    );
    let mut t = 0u32;
    while (g.phase == PHASE_PLAYING || g.phase == PHASE_EXTRACTION) && t < cap {
        if fire {
            let mut input = g.input;
            // Giro constante: las patrullas ya no convergen frente al jugador, hay que barrer.
            input.look_dx = 0.02;
            input.fire_held = t % 90 < 40;
            input.fire_pressed = t.is_multiple_of(90);
            g.step(input);
        } else {
            g.step(Default::default());
        }
        t += 1;
    }
    g.encode_log();
    g.log_out.clone()
}

/// Cuerpo JSON de `POST /api/runs`.
pub fn body(name: &str, log: &[u8]) -> Vec<u8> {
    serde_json::json!({ "name": name, "log": STANDARD.encode(log) })
        .to_string()
        .into_bytes()
}

/// Registros compartidos entre tests (grabarlos es lo más caro de la suite).
pub struct Logs {
    pub overflow_idle: Vec<u8>,
    pub overflow_fire: Vec<u8>,
    pub practice_fire: Vec<u8>,
    pub mission_idle: Vec<u8>,
    pub daily_today: Vec<u8>,
    pub daily_yesterday: Vec<u8>,
    pub daily_wrong_day: Vec<u8>,
}

pub fn logs() -> &'static Logs {
    static LOGS: OnceLock<Logs> = OnceLock::new();
    LOGS.get_or_init(|| Logs {
        overflow_idle: record(MODE_OVERFLOW, 0, 4242, FLAG_AUTO_RELOAD, false, 30_000),
        overflow_fire: record(MODE_OVERFLOW, 0, 7, FLAG_AUTO_RELOAD, true, 30_000),
        practice_fire: record(MODE_PRACTICE, 0, 11, FLAG_AUTO_RELOAD, true, 3_000),
        mission_idle: record(MODE_MISSION, 0, 13, FLAG_AUTO_RELOAD, false, 12_000),
        daily_today: record(MODE_DAILY, 0, 20_261_120, FLAG_AUTO_RELOAD, false, 12_000),
        daily_yesterday: record(MODE_DAILY, 0, 20_261_119, FLAG_AUTO_RELOAD, false, 12_000),
        daily_wrong_day: record(MODE_DAILY, 0, 20_260_101, FLAG_AUTO_RELOAD, false, 12_000),
    })
}

/// Espejo de la cabecera BPL1 (`core/src/replay.rs`): los ticks van en los bytes 12..16.
pub const TICKS_OFFSET: usize = 12;
