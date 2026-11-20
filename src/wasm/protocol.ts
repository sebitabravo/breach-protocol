/**
 * Binary protocol shared with `core/src/protocol.rs`.
 *
 * Both sides index the SAME float buffer, so any change here must be mirrored in
 * Rust and in `snapshot_layout_is_stable`. Do not reorder: the version field is
 * checked at boot and a mismatch is a hard error.
 */
export const PROTOCOL_VERSION = 1;

export const H = {
  protocol: 0,
  timeElapsed: 1,
  timeLeft: 2,
  phase: 3,
  wave: 4,
  waveTotal: 5,
  enemiesRemaining: 6,
  enemiesAlive: 7,
  score: 8,
  kills: 9,
  shots: 10,
  hits: 11,
  damageTaken: 12,
  hp: 13,
  hpMax: 14,
  px: 15,
  py: 16,
  pz: 17,
  yaw: 18,
  pitch: 19,
  grounded: 20,
  weapon: 21,
  ammo: 22,
  mag: 23,
  reserve: 24,
  reloading: 25,
  reloadProgress: 26,
  spread: 27,
  node0: 28,
  node1: 29,
  node2: 30,
  nodesActive: 31,
  interacting: 32,
  intermission: 33,
  tick: 34,
  droppedTicks: 35,
  extraction: 36,
  aimAssist: 37,
  speed: 38,
  hitAge: 39,
  recoilPitch: 40,
  recoilYaw: 41,
  fireCooldown: 42,
  damageAge: 43,
  waveEnemiesLeft: 44,
  ads: 45,
  eventsHead: 46,
  eventsCount: 47,
} as const;

export const HEADER_LEN = 64;

export const E = { x: 0, y: 1, z: 2, yaw: 3, hp: 4, state: 5, kind: 6, anim: 7 } as const;
export const ENEMY_BASE = HEADER_LEN;
export const ENEMY_STRIDE = 8;
export const MAX_ENEMIES = 32;

export const N = { x: 0, z: 1, progress: 2, active: 3 } as const;
export const NODE_BASE = ENEMY_BASE + ENEMY_STRIDE * MAX_ENEMIES;
export const NODE_STRIDE = 4;
export const MAX_NODES = 3;

export const EV = { type: 0, a: 1, b: 2, c: 3, d: 4, seq: 5 } as const;
export const EVENT_BASE = NODE_BASE + NODE_STRIDE * MAX_NODES;
export const EVENT_STRIDE = 6;
export const MAX_EVENTS = 48;
export const SNAPSHOT_LEN = EVENT_BASE + EVENT_STRIDE * MAX_EVENTS;

export const EVT = {
  shot: 1,
  enemyHit: 2,
  wallHit: 3,
  enemyDied: 4,
  nodeActivated: 5,
  playerDamaged: 6,
  waveStart: 7,
  enemyShot: 8,
  win: 9,
  lose: 10,
  extraction: 11,
  spawn: 12,
  reloadStart: 13,
  reloadEnd: 14,
  nodeProgress: 15,
  emptyMag: 16,
  enemyWindup: 17,
} as const;

export const PHASE = {
  idle: 0,
  playing: 1,
  extraction: 2,
  win: 3,
  lose: 4,
} as const;

/** Enemy FSM states, mirrored from `core/src/enemy.rs`. */
export const ENEMY_STATE = {
  spawn: 0,
  patrol: 1,
  chase: 2,
  aim: 3,
  strike: 4,
  recover: 5,
  dead: 6,
} as const;

export const ENEMY_KIND = { scout: 0, sentinel: 1 } as const;

export const I = {
  moveX: 0,
  moveZ: 1,
  lookDx: 2,
  lookDy: 3,
  fireHeld: 4,
  firePressed: 5,
  jump: 6,
  interact: 7,
  reload: 8,
  run: 9,
  switch: 10,
  ads: 11,
} as const;

export const INPUT_LEN = 16;

export const WEAPON = { sidearm: 1, carbine: 2 } as const;

export const WEAPON_LABEL: Record<number, string> = {
  [WEAPON.sidearm]: 'PB-01 SIDEARM',
  [WEAPON.carbine]: 'AR-04 CARBINE',
};

export function assertProtocol(version: number): void {
  if (version !== PROTOCOL_VERSION) {
    throw new Error(
      `protocol mismatch: wasm reports v${version}, shell expects v${PROTOCOL_VERSION}. Run npm run build:wasm.`,
    );
  }
}
