//! Wave director: composition, spawn pacing and intermissions.
//!
//! Composition is a pure function of (sector, wave), so the same seed always
//! produces the same encounter.

use core::ops::Index;

use crate::enemy::{KIND_INTERCEPTOR, KIND_SCOUT, KIND_SENTINEL};
use crate::protocol::{MAX_ENEMIES, MAX_NODES};
use crate::rng::Rng;

pub const WAVE_TOTAL: u32 = 5;
// Ensures the largest requested plan still fits in a u32 (and a wasm32 index).
const MAX_OVERFLOW_EXTRA: u32 = u32::MAX / 2;

/// Enemigos vivos a la vez en misión: mantiene la dificultad acotada (SPEC §3.3).
const MISSION_ALIVE_CAP: usize = 12;
/// Overflow: cada oleada extra suma un scout y, cada dos oleadas, un especialista.
const ENDLESS_SPECIALIST_EVERY: u32 = 2;

/// Cuántos enemigos de cada tipo entran en una oleada.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Composition {
    pub scouts: u32,
    pub sentinels: u32,
    pub interceptors: u32,
}

impl Composition {
    pub const fn total(self) -> u32 {
        self.scouts + self.sentinels + self.interceptors
    }
}

/// Oleada del modo Overflow. Hasta la oleada 5 es la de misión; después crece sin tope de
/// oleadas. El especialista del sector: sentinel (0), interceptor (1), o ambos en el sector 2.
pub fn endless_composition(sector: u8, wave: u32) -> Composition {
    let base = mission_composition(sector, wave);
    let extra = wave.saturating_sub(WAVE_TOTAL).min(MAX_OVERFLOW_EXTRA);
    if extra == 0 {
        return base;
    }
    let specialists = extra.div_ceil(ENDLESS_SPECIALIST_EVERY);
    let mut c = Composition {
        scouts: base.scouts + extra,
        ..base
    };
    match sector {
        0 => c.sentinels += specialists,
        1 => c.interceptors += specialists,
        _ => {
            c.sentinels += specialists.div_ceil(2);
            c.interceptors += specialists / 2;
        }
    }
    c
}

/// Oleada de misión para el sector `sector` (= id del mapa), oleada 1-based.
/// Sector 0 solo tiene scouts y sentinels; el sector 1 introduce interceptores desde la
/// oleada 2; el sector 2 mezcla los tres. Oleadas fuera de 1..=5 se acotan.
pub fn mission_composition(sector: u8, wave: u32) -> Composition {
    let w = wave.clamp(1, WAVE_TOTAL);
    match sector {
        0 => Composition {
            scouts: 3 + w,
            sentinels: if w >= 2 { w } else { 0 },
            interceptors: 0,
        },
        1 => Composition {
            scouts: 3 + w,
            sentinels: 0,
            interceptors: if w >= 2 { 1 + w / 2 } else { 0 },
        },
        _ => Composition {
            scouts: 4 + w,
            sentinels: if w >= 2 { w.div_ceil(2) } else { 0 },
            interceptors: if w >= 2 { 2 + u32::from(w >= 4) } else { 0 },
        },
    }
}

/// Refuerzos al completar una terminal en la última oleada: dos scouts y un especialista.
pub const fn surge_composition(sector: u8) -> Composition {
    Composition {
        scouts: 2,
        sentinels: if sector == 0 { 1 } else { 0 },
        interceptors: if sector == 0 { 0 } else { 1 },
    }
}

// Each composition is a virtual queue: rounds interleave scout, sentinel,
// interceptor, scout, skipping exhausted kinds. No per-enemy storage.
impl Composition {
    fn before_round(self, round: u32) -> u32 {
        self.scouts.min(round.saturating_mul(2))
            + self.sentinels.min(round)
            + self.interceptors.min(round)
    }

    fn kind_at(self, index: u32) -> &'static u8 {
        let c = self;
        // Find the last round whose prefix is at or before this index.
        let mut lo = 0;
        let mut hi = c.scouts.div_ceil(2).max(c.sentinels).max(c.interceptors);
        while lo + 1 < hi {
            let mid = lo + (hi - lo) / 2;
            if c.before_round(mid) <= index {
                lo = mid;
            } else {
                hi = mid;
            }
        }
        let mut offset = index - c.before_round(lo);
        let scout = lo * 2;
        for (available, kind) in [
            (scout < c.scouts, &KIND_SCOUT),
            (lo < c.sentinels, &KIND_SENTINEL),
            (lo < c.interceptors, &KIND_INTERCEPTOR),
            (scout + 1 < c.scouts, &KIND_SCOUT),
        ] {
            if available {
                if offset == 0 {
                    return kind;
                }
                offset -= 1;
            }
        }
        unreachable!("queue index must belong to the composition")
    }
}

// One natural wave plus at most one appended composition per one-shot terminal.
// Use u64 cursors: even if several enormous Overflow plans are stacked on
// wasm32, their sum need not fit in a usize.
#[derive(Clone, Copy, Debug)]
pub struct SpawnQueue {
    plans: [Composition; 1 + MAX_NODES],
    len: usize,
}

impl SpawnQueue {
    const fn new() -> Self {
        Self {
            plans: [Composition {
                scouts: 0,
                sentinels: 0,
                interceptors: 0,
            }; 1 + MAX_NODES],
            len: 0,
        }
    }

    fn push(&mut self, plan: Composition) {
        self.plans[self.len] = plan;
        self.len += 1;
    }
}

impl Index<u64> for SpawnQueue {
    type Output = u8;

    fn index(&self, mut index: u64) -> &u8 {
        for &plan in &self.plans[..self.len] {
            if index < u64::from(plan.total()) {
                return plan.kind_at(index as u32);
            }
            index -= u64::from(plan.total());
        }
        panic!("spawn queue index out of bounds");
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Waves {
    pub wave: u32,
    pub total: u32,
    pub queue: SpawnQueue,
    pub queue_len: u64,
    pub queue_head: u64,
    pub spawn_timer: f32,
    pub spawn_grace: f32,
    pub spawn_interval: f32,
    pub intermission: f32,
    pub running: bool,
    pub finished: bool,
    pub spawned: u32,
    pub killed: u32,
    pub alive_cap: usize,
}

impl Waves {
    pub const fn new() -> Self {
        Waves {
            wave: 0,
            total: WAVE_TOTAL,
            queue: SpawnQueue::new(),
            queue_len: 0,
            queue_head: 0,
            spawn_timer: 0.0,
            spawn_grace: 0.0,
            spawn_interval: 1.5,
            intermission: 2.5,
            running: false,
            finished: false,
            spawned: 0,
            killed: 0,
            alive_cap: MISSION_ALIVE_CAP,
        }
    }

    /// `endless` activa el modo Overflow: sin tope de oleadas y hasta `MAX_ENEMIES` vivos.
    pub fn reset(&mut self, endless: bool) {
        *self = Waves::new();
        if endless {
            self.total = 0;
            self.alive_cap = MAX_ENEMIES;
        }
    }

    /// Queda al menos una oleada por jugar. En modo infinito (`total == 0`) siempre hay.
    pub fn has_next(&self) -> bool {
        self.total == 0 || self.wave < self.total
    }

    pub fn spawn_interval_for(wave: u32) -> f32 {
        (1.4 - 0.16 * (wave.saturating_sub(1)) as f32).max(0.55)
    }

    /// Planifica la composición de una oleada normal, tras vaciar la anterior.
    pub fn begin(&mut self, wave: u32, comp: Composition) {
        self.queue = SpawnQueue::new();
        self.queue_head = 0;
        self.queue_len = 0;
        self.start_plan(wave, comp);
        self.spawn_timer = 0.35;
        self.spawn_grace = 0.0;
    }

    /// Empieza la siguiente oleada (o un refuerzo en la última) sin descartar pendientes.
    pub fn accelerate(&mut self, wave: u32, comp: Composition) {
        if self.queued() == 0 {
            self.begin(wave, comp);
        } else {
            self.start_plan(wave, comp);
        }
        self.spawn_timer = 0.0;
        self.spawn_grace = 1.0;
    }

    fn start_plan(&mut self, wave: u32, comp: Composition) {
        self.queue.push(comp);
        self.queue_len += u64::from(comp.total());
        self.wave = wave;
        self.spawn_interval = Self::spawn_interval_for(wave);
        self.running = true;
        self.finished = false;
        self.intermission = 0.0;
    }

    pub fn queued(&self) -> u64 {
        self.queue_len - self.queue_head
    }

    pub fn alive_target(&self) -> usize {
        self.alive_cap.min(MAX_ENEMIES)
    }

    /// Picks the safest spawn point: far from the player and inside the arena.
    /// `points` is `[x, z]` per entry.
    pub fn pick_spawn(
        &self,
        points: &[(f32, f32)],
        player_x: f32,
        player_z: f32,
        rng: &mut Rng,
    ) -> (f32, f32) {
        if points.is_empty() {
            return (0.0, 0.0);
        }
        let mut best = points[0];
        let mut best_score = f32::MIN;
        for (i, p) in points.iter().enumerate() {
            let dx = p.0 - player_x;
            let dz = p.1 - player_z;
            let d = (dx * dx + dz * dz).sqrt();
            if d < 9.0 {
                continue;
            }
            // Prefer far points, with a deterministic per-index nudge so waves differ.
            let score = d + (i as f32 * 0.37 + rng.next_f32() * 0.001);
            if score > best_score {
                best_score = score;
                best = *p;
            }
        }
        if best_score == f32::MIN {
            // Every point is too close: fall back to the farthest one available.
            let mut far = points[0];
            let mut far_d = f32::MIN;
            for p in points.iter() {
                let dx = p.0 - player_x;
                let dz = p.1 - player_z;
                let d = dx * dx + dz * dz;
                if d > far_d {
                    far_d = d;
                    far = *p;
                }
            }
            return far;
        }
        best
    }
}

impl Default for Waves {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kinds_in_queue(w: &Waves) -> Vec<u8> {
        (0..w.queue_len).map(|index| w.queue[index]).collect()
    }

    fn count(kinds: &[u8], kind: u8) -> u32 {
        kinds.iter().filter(|k| **k == kind).count() as u32
    }

    #[test]
    fn sector_zero_keeps_scouts_and_sentinels_only() {
        let waves: Vec<Composition> = (1..=WAVE_TOTAL)
            .map(|w| mission_composition(0, w))
            .collect();
        assert_eq!(
            waves[0],
            Composition {
                scouts: 4,
                sentinels: 0,
                interceptors: 0
            }
        );
        assert_eq!(
            waves[1],
            Composition {
                scouts: 5,
                sentinels: 2,
                interceptors: 0
            }
        );
        assert_eq!(
            waves[4],
            Composition {
                scouts: 8,
                sentinels: 5,
                interceptors: 0
            }
        );
    }

    #[test]
    fn sector_one_introduces_interceptors_from_wave_two() {
        assert_eq!(mission_composition(1, 1).interceptors, 0);
        for wave in 2..=WAVE_TOTAL {
            let c = mission_composition(1, wave);
            assert!(c.interceptors >= 1, "wave {wave}");
            assert_eq!(c.sentinels, 0, "wave {wave}");
        }
    }

    #[test]
    fn sector_two_mixes_all_three_kinds_from_wave_two() {
        for wave in 2..=WAVE_TOTAL {
            let c = mission_composition(2, wave);
            assert!(
                c.scouts > 0 && c.sentinels > 0 && c.interceptors > 0,
                "wave {wave}"
            );
        }
    }

    #[test]
    fn queue_matches_composition_in_every_sector() {
        for sector in 0..3 {
            for wave in 1..=WAVE_TOTAL {
                let mut w = Waves::new();
                let c = mission_composition(sector, wave);
                w.begin(wave, c);
                let kinds = kinds_in_queue(&w);
                assert_eq!(
                    kinds.len(),
                    c.total() as usize,
                    "sector {sector} wave {wave}"
                );
                assert_eq!(count(&kinds, KIND_SCOUT), c.scouts);
                assert_eq!(count(&kinds, KIND_SENTINEL), c.sentinels);
                assert_eq!(count(&kinds, KIND_INTERCEPTOR), c.interceptors);
            }
        }
    }

    #[test]
    fn endless_waves_match_the_mission_until_wave_five_then_grow() {
        for sector in 0..3 {
            for wave in 1..=WAVE_TOTAL {
                assert_eq!(
                    endless_composition(sector, wave),
                    mission_composition(sector, wave)
                );
            }
            let mut last = 0;
            for wave in 1..=60 {
                let c = endless_composition(sector, wave);
                assert!(c.total() > last, "sector {sector} wave {wave} did not grow");
                last = c.total();
            }
        }
        assert_eq!(
            endless_composition(0, 6).scouts,
            mission_composition(0, 5).scouts + 1
        );
    }

    #[test]
    fn overflow_alive_cap_is_the_whole_array_and_mission_keeps_twelve() {
        let mut w = Waves::new();
        assert_eq!(w.alive_target(), 12);
        w.reset(true);
        assert_eq!(w.alive_target(), MAX_ENEMIES);
        assert!(w.has_next());
        assert_eq!(w.total, 0);
    }

    #[test]
    fn overflow_wave_40_keeps_spawning_after_live_slots_are_freed() {
        let mut game = overflow_at_wave_40();
        for _ in 0..1600 {
            game.player.hp = game.player.hp_max;
            game.step(crate::Input::default());
        }
        assert_eq!(game.waves.wave, 40);
        assert_eq!(game.alive_count() as usize, MAX_ENEMIES);
        let spawned = game.waves.spawned;
        game.enemies
            .iter_mut()
            .find(|e| e.is_alive())
            .unwrap()
            .hurt(f32::MAX);
        for _ in 0..60 {
            game.player.hp = game.player.hp_max;
            game.step(crate::Input::default());
        }
        assert_eq!(
            game.waves.spawned,
            spawned + 1,
            "director did not refill the free slot"
        );
        assert_eq!(game.alive_count() as usize, MAX_ENEMIES);
    }

    #[test]
    fn overflow_delivers_the_full_mixed_wave_over_time() {
        let mut game = overflow_at_wave_40();
        let mut actual = Composition::default();
        let mut previous = 0;
        for _ in 0..3000 {
            game.step(crate::Input::default());
            if game.waves.spawned != previous {
                assert_eq!(game.waves.spawned, previous + 1, "spawn pacing changed");
                let enemy = game.enemies.iter_mut().find(|e| e.is_alive()).unwrap();
                match enemy.kind {
                    KIND_SCOUT => actual.scouts += 1,
                    KIND_SENTINEL => actual.sentinels += 1,
                    KIND_INTERCEPTOR => actual.interceptors += 1,
                    kind => panic!("unexpected enemy kind {kind}"),
                }
                enemy.hurt(f32::MAX);
                previous = game.waves.spawned;
            }
            if !game.waves.running && game.waves.wave == 40 {
                break;
            }
        }
        let planned = Composition {
            scouts: 44,
            sentinels: 12,
            interceptors: 12,
        };
        assert_eq!(actual, planned);
        assert_eq!(actual, endless_composition(2, 40));
        assert!(!game.waves.running);
    }

    fn overflow_at_wave_40() -> crate::Game {
        let mut game = crate::Game::new(42);
        assert!(game.start(crate::MODE_OVERFLOW, 2, 42, 0));
        game.waves.wave = 39;
        game.waves.running = false;
        game.waves.intermission = 0.001;
        game
    }

    #[test]
    fn queue_preserves_the_interleaved_opening_at_any_size() {
        let mut w = Waves::new();
        let plan = endless_composition(2, u32::MAX);
        w.begin(u32::MAX, plan);
        assert_eq!(w.queued(), u64::from(plan.total()));
        let first = [KIND_SCOUT, KIND_SENTINEL, KIND_INTERCEPTOR, KIND_SCOUT];
        for (i, kind) in first.into_iter().enumerate() {
            assert_eq!(w.queue[i as u64], kind);
        }
        assert_eq!(w.queue[w.queue_len - 1], KIND_SCOUT);
    }

    #[test]
    fn wave_one_never_spawns_sentinels() {
        let mut w = Waves::new();
        w.begin(1, mission_composition(0, 1));
        assert!(kinds_in_queue(&w).into_iter().all(|k| k == KIND_SCOUT));
    }

    #[test]
    fn spawn_interval_decreases_but_has_a_floor() {
        assert!(Waves::spawn_interval_for(2) < Waves::spawn_interval_for(1));
        assert!(Waves::spawn_interval_for(99) >= 0.55);
    }

    #[test]
    fn spawn_choice_avoids_the_player() {
        let mut rng = Rng::new(4);
        let points = [
            (-14.0, 0.0),
            (14.0, 0.0),
            (0.0, 14.0),
            (0.0, -14.0),
            (2.0, 2.0),
        ];
        let w = Waves::new();
        let (x, z) = w.pick_spawn(&points, 0.0, 0.0, &mut rng);
        let d = (x * x + z * z).sqrt();
        assert!(d > 9.0, "spawned too close: {x},{z}");
    }

    #[test]
    fn queued_counts_down() {
        let mut w = Waves::new();
        w.begin(1, mission_composition(0, 1));
        let n = w.queued();
        w.queue_head += 2;
        assert_eq!(w.queued(), n - 2);
    }
}
