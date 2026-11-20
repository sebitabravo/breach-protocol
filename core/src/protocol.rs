//! Binary protocol shared with `src/wasm/protocol.ts`.
//!
//! Both sides read the SAME layout, so a change here must be mirrored there and
//! `snapshot_layout_is_stable` pins it. Everything is `f32` in one linear buffer:
//! JavaScript reads it as a `Float32Array` over WebAssembly memory without copying.

pub const PROTOCOL_VERSION: u32 = 1;

// --- header ---------------------------------------------------------------
pub const H_PROTOCOL: usize = 0;
pub const H_TIME_ELAPSED: usize = 1;
pub const H_TIME_LEFT: usize = 2;
pub const H_PHASE: usize = 3;
pub const H_WAVE: usize = 4;
pub const H_WAVE_TOTAL: usize = 5;
pub const H_ENEMIES_REMAINING: usize = 6;
pub const H_ENEMIES_ALIVE: usize = 7;
pub const H_SCORE: usize = 8;
pub const H_KILLS: usize = 9;
pub const H_SHOTS: usize = 10;
pub const H_HITS: usize = 11;
pub const H_DAMAGE_TAKEN: usize = 12;
pub const H_HP: usize = 13;
pub const H_HP_MAX: usize = 14;
pub const H_PLAYER_X: usize = 15;
pub const H_PLAYER_Y: usize = 16;
pub const H_PLAYER_Z: usize = 17;
pub const H_YAW: usize = 18;
pub const H_PITCH: usize = 19;
pub const H_GROUNDED: usize = 20;
pub const H_WEAPON: usize = 21;
pub const H_AMMO: usize = 22;
pub const H_MAG: usize = 23;
pub const H_RESERVE: usize = 24;
pub const H_RELOADING: usize = 25;
pub const H_RELOAD_PROGRESS: usize = 26;
pub const H_SPREAD: usize = 27;
pub const H_NODE_0: usize = 28;
pub const H_NODE_1: usize = 29;
pub const H_NODE_2: usize = 30;
pub const H_NODES_ACTIVE: usize = 31;
pub const H_INTERACTING: usize = 32;
pub const H_INTERMISSION: usize = 33;
pub const H_TICK: usize = 34;
pub const H_DROPPED_TICKS: usize = 35;
pub const H_EXTRACTION: usize = 36;
pub const H_AIM_ASSIST: usize = 37;
pub const H_SPEED: usize = 38;
pub const H_HIT_AGE: usize = 39;
pub const H_RECOIL_PITCH: usize = 40;
pub const H_RECOIL_YAW: usize = 41;
pub const H_FIRE_COOLDOWN: usize = 42;
pub const H_DAMAGE_AGE: usize = 43;
pub const H_WAVE_ENEMIES_LEFT: usize = 44;
pub const H_ADS: usize = 45;
pub const H_EVENTS_HEAD: usize = 46;
pub const H_EVENTS_COUNT: usize = 47;
// 48 libre (sin uso desde protocol 1).
pub const H_RESERVED_LAST: usize = 49;

pub const HEADER_LEN: usize = 64;

// --- enemies --------------------------------------------------------------
pub const ENEMY_BASE: usize = HEADER_LEN;
pub const ENEMY_STRIDE: usize = 8;
pub const MAX_ENEMIES: usize = 32;

pub const E_X: usize = 0;
pub const E_Y: usize = 1;
pub const E_Z: usize = 2;
pub const E_YAW: usize = 3;
pub const E_HP: usize = 4;
pub const E_STATE: usize = 5;
pub const E_KIND: usize = 6;
pub const E_ANIM: usize = 7;

pub const ENEMY_BLOCK_LEN: usize = ENEMY_STRIDE * MAX_ENEMIES;

// --- terminals ------------------------------------------------------------
pub const NODE_BASE: usize = ENEMY_BASE + ENEMY_BLOCK_LEN;
pub const NODE_STRIDE: usize = 4;
pub const MAX_NODES: usize = 3;

pub const N_X: usize = 0;
pub const N_Z: usize = 1;
pub const N_PROGRESS: usize = 2;
pub const N_ACTIVE: usize = 3;

pub const NODE_BLOCK_LEN: usize = NODE_STRIDE * MAX_NODES;

// --- events ---------------------------------------------------------------
pub const EVENT_BASE: usize = NODE_BASE + NODE_BLOCK_LEN;
pub const EVENT_STRIDE: usize = 6;
pub const MAX_EVENTS: usize = 48;

pub const EV_TYPE: usize = 0;
pub const EV_A: usize = 1;
pub const EV_B: usize = 2;
pub const EV_C: usize = 3;
pub const EV_D: usize = 4;
pub const EV_SEQ: usize = 5;

pub const EVENT_BLOCK_LEN: usize = EVENT_STRIDE * MAX_EVENTS;

pub const SNAPSHOT_LEN: usize = EVENT_BASE + EVENT_BLOCK_LEN;

/// Event type ids. Mirrored in `src/wasm/protocol.ts`.
pub mod ev {
    pub const SHOT: f32 = 1.0;
    pub const ENEMY_HIT: f32 = 2.0;
    pub const WALL_HIT: f32 = 3.0;
    pub const ENEMY_DIED: f32 = 4.0;
    pub const NODE_ACTIVATED: f32 = 5.0;
    pub const PLAYER_DAMAGED: f32 = 6.0;
    pub const WAVE_START: f32 = 7.0;
    pub const ENEMY_SHOT: f32 = 8.0;
    pub const WIN: f32 = 9.0;
    pub const LOSE: f32 = 10.0;
    pub const EXTRACTION: f32 = 11.0;
    pub const SPAWN: f32 = 12.0;
    pub const RELOAD_START: f32 = 13.0;
    pub const RELOAD_END: f32 = 14.0;
    // 15 reservado: el shell lo declara en `EVT.nodeProgress`, pero el núcleo no lo emite.
    pub const EMPTY_MAG: f32 = 16.0;
    pub const ENEMY_WINDUP: f32 = 17.0;
}

/// Simulation phases. Mirrored in `src/wasm/protocol.ts`.
pub mod phase {
    pub const IDLE: f32 = 0.0;
    pub const PLAYING: f32 = 1.0;
    pub const EXTRACTION: f32 = 2.0;
    pub const WIN: f32 = 3.0;
    pub const LOSE: f32 = 4.0;
}

/// Input buffer offsets. JavaScript writes, Rust reads.
pub const I_MOVE_X: usize = 0;
pub const I_MOVE_Z: usize = 1;
pub const I_LOOK_DX: usize = 2;
pub const I_LOOK_DY: usize = 3;
pub const I_FIRE_HELD: usize = 4;
pub const I_FIRE_PRESSED: usize = 5;
pub const I_JUMP: usize = 6;
pub const I_INTERACT: usize = 7;
pub const I_RELOAD: usize = 8;
pub const I_RUN: usize = 9;
pub const I_SWITCH: usize = 10;
pub const I_ADS: usize = 11;
pub const INPUT_LEN: usize = 16;

// Un solapamiento de bloques es un error de compilación, no un fallo de test.
const _: () = {
    assert!(ENEMY_BASE + ENEMY_BLOCK_LEN <= NODE_BASE);
    assert!(NODE_BASE + NODE_BLOCK_LEN <= EVENT_BASE);
    assert!(EVENT_BASE + EVENT_BLOCK_LEN <= SNAPSHOT_LEN);
    assert!(H_RESERVED_LAST < HEADER_LEN);
};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_layout_is_stable() {
        // Protocol 1 contract; bump PROTOCOL_VERSION when these change.
        assert_eq!(PROTOCOL_VERSION, 1);
        assert_eq!(HEADER_LEN, 64);
        assert_eq!(ENEMY_BASE, 64);
        assert_eq!(NODE_BASE, 320);
        assert_eq!(EVENT_BASE, 332);
        assert_eq!(SNAPSHOT_LEN, 620);
    }
}
