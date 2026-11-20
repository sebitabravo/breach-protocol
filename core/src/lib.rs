//! C ABI for the Rust simulation core.
//!
//! Deliberately no `wasm-bindgen`: the module exports plain functions and one
//! linear memory, so the JavaScript side is ~150 lines with zero dependencies and
//! the snapshot is read in place instead of being serialised every frame.
//!
//! Contract (see `src/wasm/protocol.ts`):
//!   bp_init(seed)                      -> protocol version
//!   bp_reset(seed)                     -> starts a new match
//!   bp_tick(dt, input_ptr)             -> tick count
//!   bp_snapshot_ptr() / bp_snapshot_len()
//!   bp_set_arena(ptr, count)           -> boxes loaded
//!   bp_set_nodes(ptr, count)
//!   bp_set_spawns(ptr, count)
//!   bp_set_player_start(x, z, yaw)
//!   bp_set_aim_assist(flag)
//!   bp_set_practice(flag)
//!   bp_note_dropped(n)
//!   bp_alloc(len) / bp_free(ptr, len)

#![allow(clippy::missing_safety_doc)]

mod arena;
mod enemy;
mod math;
mod player;
mod protocol;
mod rng;
mod sim;
mod waves;
mod weapons;

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

#[no_mangle]
pub extern "C" fn bp_reset(seed: u32) {
    game().reset(seed);
}

#[no_mangle]
pub extern "C" fn bp_tick(dt: f32, input_ptr: *const f32) -> u32 {
    let g = game();
    let input = read_input(input_ptr);
    g.tick(dt, input);
    g.tick
}

fn read_input(ptr: *const f32) -> player::Input {
    use protocol::*;
    if ptr.is_null() {
        return player::Input::default();
    }
    unsafe {
        let s = core::slice::from_raw_parts(ptr, INPUT_LEN);
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

#[no_mangle]
pub extern "C" fn bp_set_arena(ptr: *const f32, count: usize) -> usize {
    if ptr.is_null() || count == 0 {
        return 0;
    }
    let data = unsafe { core::slice::from_raw_parts(ptr, count) };
    let g = game();
    g.arena.load(data);
    g.write_snapshot();
    g.arena.len
}

#[no_mangle]
pub extern "C" fn bp_set_nodes(ptr: *const f32, count: usize) {
    if ptr.is_null() || count == 0 {
        return;
    }
    let data = unsafe { core::slice::from_raw_parts(ptr, count) };
    let g = game();
    g.set_nodes(data);
    g.write_snapshot();
}

#[no_mangle]
pub extern "C" fn bp_set_spawns(ptr: *const f32, count: usize) {
    if ptr.is_null() || count == 0 {
        return;
    }
    let data = unsafe { core::slice::from_raw_parts(ptr, count) };
    let g = game();
    g.set_spawns(data);
}

#[no_mangle]
pub extern "C" fn bp_set_player_start(x: f32, z: f32, yaw: f32) {
    let g = game();
    g.set_player_start(x, z, yaw);
}

#[no_mangle]
pub extern "C" fn bp_set_aim_assist(flag: u32) {
    game().aim_assist = flag != 0;
}

#[no_mangle]
pub extern "C" fn bp_set_practice(flag: u32) {
    game().set_practice(flag != 0);
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

#[no_mangle]
pub unsafe extern "C" fn bp_free(p: *mut u8, len: usize) {
    if p.is_null() || len == 0 {
        return;
    }
    dealloc(p, Layout::from_size_align_unchecked(len, 4));
}

// Re-exported for the native integration tests.
pub use protocol::SNAPSHOT_LEN;
