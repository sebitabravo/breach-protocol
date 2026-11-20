//! C ABI for the Rust simulation core.
//!
//! Deliberately no `wasm-bindgen`: the module exports plain functions and one
//! linear memory, so the JavaScript side is ~150 lines with zero dependencies and
//! the snapshot is read in place instead of being serialised every frame.
//!
//! Contract (see `src/wasm/protocol.ts`):
//!   bp_init(seed)                      -> protocol version
//!   bp_start(mode, map, seed, flags)   -> 1 on success; also arms the input recorder
//!   bp_tick_fixed(input_ptr)           -> tick count (fixed step, host never picks dt)
//!   bp_snapshot_ptr() / bp_snapshot_len()
//!   bp_map_data_ptr() / bp_map_data_len() / bp_load_map(id)
//!   bp_log_encode() / bp_log_ptr() / bp_log_truncated()
//!   bp_replay_hash(ptr, len) / bp_golden_hash(ticks)
//!   bp_note_dropped(n)
//!   bp_alloc(len) / bp_free(ptr, len)

mod arena;
mod enemy;
mod maps;
mod math;
mod player;
mod protocol;
mod replay;
mod rng;
#[cfg(test)]
mod scenarios;
mod sim;
mod waves;
mod weapons;

pub use replay::{decode, run, run_bytes, Log, Outcome, ReplayError};
pub use sim::Game;

use core::ptr;
use std::alloc::{alloc, dealloc, Layout};

static mut GAME: *mut Game = ptr::null_mut();

/// Reads the game pointer. Copying the raw pointer out of the static is sound
/// because WebAssembly is single threaded and the pointer is only ever written
/// by `bp_init`.
#[inline]
fn game() -> &'static mut Game {
    unsafe {
        let p = GAME;
        debug_assert!(!p.is_null(), "bp_init must be called before use");
        &mut *p
    }
}

#[no_mangle]
pub extern "C" fn bp_init(seed: u32) -> u32 {
    unsafe {
        if !GAME.is_null() {
            drop(Box::from_raw(GAME));
        }
        let boxed = Box::new(Game::new(seed));
        GAME = Box::into_raw(boxed);
    }
    protocol::PROTOCOL_VERSION
}

/// Inicia una partida: `flags` bit0 = aim assist, bit1 = recarga automática.
/// Devuelve 1 si el modo y el mapa son válidos. Activa el registro de entradas.
#[no_mangle]
pub extern "C" fn bp_start(mode: u32, map: u32, seed: u32, flags: u32) -> u32 {
    let g = game();
    g.enable_recording();
    let ok = g.start(mode as u8, map as u8, seed, flags as u8);
    g.write_snapshot();
    ok as u32
}

/// Un tick de paso fijo (`sim::FIXED_DT`). El host no elige `dt`: así el registro
/// de entradas basta para reproducir la partida en el servidor.
///
/// # Safety
/// `input_ptr` debe ser nulo o apuntar a `INPUT_LEN` `f32` legibles.
#[no_mangle]
pub unsafe extern "C" fn bp_tick_fixed(input_ptr: *const f32) -> u32 {
    let g = game();
    let input = unsafe { read_input(input_ptr) };
    g.step(input);
    g.tick
}

/// # Safety
/// `ptr` debe ser nulo o apuntar a `protocol::INPUT_LEN` `f32` legibles.
unsafe fn read_input(ptr: *const f32) -> player::Input {
    use protocol::*;
    if ptr.is_null() {
        return player::Input::default();
    }
    let s = unsafe { core::slice::from_raw_parts(ptr, INPUT_LEN) };
    player::Input {
        move_x: s[I_MOVE_X],
        move_z: s[I_MOVE_Z],
        look_dx: s[I_LOOK_DX],
        look_dy: s[I_LOOK_DY],
        fire_held: s[I_FIRE_HELD] > 0.5,
        fire_pressed: s[I_FIRE_PRESSED] > 0.5,
        jump: s[I_JUMP] > 0.5,
        interact: s[I_INTERACT] > 0.5,
        reload: s[I_RELOAD] > 0.5,
        run: s[I_RUN] > 0.5,
        switch: s[I_SWITCH] as u8,
        ads: s[I_ADS] > 0.5,
    }
}

#[no_mangle]
pub extern "C" fn bp_snapshot_ptr() -> *const f32 {
    game().snapshot.as_ptr()
}

#[no_mangle]
pub extern "C" fn bp_snapshot_len() -> usize {
    protocol::SNAPSHOT_LEN
}

#[no_mangle]
pub extern "C" fn bp_input_len() -> usize {
    protocol::INPUT_LEN
}

/// Tabla del mapa cargado (ver `Game::build_map_data`).
#[no_mangle]
pub extern "C" fn bp_map_data_ptr() -> *const f32 {
    game().map_data.as_ptr()
}

#[no_mangle]
pub extern "C" fn bp_map_data_len() -> usize {
    game().map_data.len()
}

/// Carga un mapa sin iniciar partida (menú y vista previa). Devuelve 1 si existe.
#[no_mangle]
pub extern "C" fn bp_load_map(id: u32) -> u32 {
    let g = game();
    let ok = g.load_map(id as u8);
    g.write_snapshot();
    ok as u32
}

/// Codifica el registro de entradas de la partida actual y devuelve su longitud.
#[no_mangle]
pub extern "C" fn bp_log_encode() -> usize {
    game().encode_log()
}

#[no_mangle]
pub extern "C" fn bp_log_ptr() -> *const u8 {
    game().log_out.as_ptr()
}

/// 1 si la partida superó el techo de ticks verificables.
#[no_mangle]
pub extern "C" fn bp_log_truncated() -> u32 {
    game().recorder.as_ref().is_some_and(|r| r.truncated()) as u32
}

/// Re-simula un registro y devuelve el hash del estado final (0 si es inválido).
/// Sirve de prueba cruzada nativo/wasm.
///
/// # Safety
/// `ptr` debe ser nulo o apuntar a `len` bytes legibles.
#[no_mangle]
pub unsafe extern "C" fn bp_replay_hash(ptr: *const u8, len: usize) -> u64 {
    if ptr.is_null() {
        return 0;
    }
    let bytes = core::slice::from_raw_parts(ptr, len);
    replay::run_bytes(bytes).map_or(0, |o| o.hash)
}

/// Hash de la partida dorada: la misma constante la fija un test nativo.
#[no_mangle]
pub extern "C" fn bp_golden_hash(ticks: u32) -> u64 {
    replay::golden_hash(ticks)
}

#[no_mangle]
pub extern "C" fn bp_note_dropped(n: u32) {
    game().note_dropped(n);
}

#[no_mangle]
pub extern "C" fn bp_alloc(len: usize) -> *mut u8 {
    if len == 0 {
        return ptr::null_mut();
    }
    unsafe {
        let layout = Layout::from_size_align_unchecked(len, 4);
        alloc(layout)
    }
}

/// # Safety
/// `p` debe venir de `bp_alloc(len)` con el mismo `len`, y no usarse después.
#[no_mangle]
pub unsafe extern "C" fn bp_free(p: *mut u8, len: usize) {
    if p.is_null() || len == 0 {
        return;
    }
    dealloc(p, Layout::from_size_align_unchecked(len, 4));
}

// Re-exported for the native integration tests.
pub use protocol::SNAPSHOT_LEN;
