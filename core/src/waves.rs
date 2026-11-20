//! Wave director: composition, spawn pacing and intermissions.
//!
//! Composition is a pure function of (sector, wave), so the same seed always
//! produces the same encounter.

use crate::enemy::{KIND_INTERCEPTOR, KIND_SCOUT, KIND_SENTINEL};
use crate::protocol::MAX_ENEMIES;
use crate::rng::Rng;

pub const WAVE_TOTAL: u32 = 5;
pub const MAX_QUEUE: usize = 32;

/// Enemigos vivos a la vez en misión: mantiene la dificultad acotada (SPEC §3.3).
const MISSION_ALIVE_CAP: usize = 12;

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
            interceptors: if w >= 2 { w / 2 } else { 0 },
        },
        _ => Composition {
            scouts: 2 + w,
            sentinels: if w >= 2 { w / 2 } else { 0 },
            interceptors: if w >= 2 { 1 + u32::from(w >= 4) } else { 0 },
        },
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Waves {
    pub wave: u32,
    pub total: u32,
    pub queue: [u8; MAX_QUEUE],
    pub queue_len: usize,
    pub queue_head: usize,
    pub spawn_timer: f32,
    pub spawn_interval: f32,
    pub intermission: f32,
    pub running: bool,
    pub finished: bool,
    pub spawned: u32,
    pub killed: u32,
}

impl Waves {
    pub const fn new() -> Self {
        Waves {
            wave: 0,
            total: WAVE_TOTAL,
            queue: [0; MAX_QUEUE],
            queue_len: 0,
            queue_head: 0,
            spawn_timer: 0.0,
            spawn_interval: 1.5,
            intermission: 2.5,
            running: false,
            finished: false,
            spawned: 0,
            killed: 0,
        }
    }

    pub fn reset(&mut self) {
        *self = Waves::new();
    }

    pub fn spawn_interval_for(wave: u32) -> f32 {
        (1.65 - 0.16 * (wave.saturating_sub(1)) as f32).max(0.6)
    }

    /// Llena la cola con la composición dada para la oleada `wave` (1-based).
    pub fn begin(&mut self, wave: u32, comp: Composition) {
        self.wave = wave;
        self.queue_head = 0;
        self.queue_len = 0;
        self.spawn_timer = 0.35;
        self.spawn_interval = Self::spawn_interval_for(wave);
        self.running = true;
        self.intermission = 0.0;
        self.fill(comp);
    }

    /// Intercala los tipos para que una oleada nunca abra con una salva de tiradores.
    /// La condición del `while` incluye el tope de la cola: sin él, una composición
    /// mayor que `MAX_QUEUE` no avanzaba y el bucle no terminaba.
    fn fill(&mut self, comp: Composition) {
        let (mut scouts, mut sentinels, mut interceptors) =
            (comp.scouts, comp.sentinels, comp.interceptors);
        while (scouts > 0 || sentinels > 0 || interceptors > 0) && self.queue_len < MAX_QUEUE {
            self.push_one(&mut scouts, KIND_SCOUT);
            self.push_one(&mut sentinels, KIND_SENTINEL);
            self.push_one(&mut interceptors, KIND_INTERCEPTOR);
            // Dos scouts por cada tirador mantienen la mezcla orientada al cuerpo a cuerpo.
            self.push_one(&mut scouts, KIND_SCOUT);
        }
    }

    fn push_one(&mut self, left: &mut u32, kind: u8) {
        if *left > 0 && self.queue_len < MAX_QUEUE {
            self.queue[self.queue_len] = kind;
            self.queue_len += 1;
            *left -= 1;
        }
    }

    pub fn queued(&self) -> usize {
        self.queue_len - self.queue_head
    }

    pub fn alive_target(&self) -> usize {
        MISSION_ALIVE_CAP.min(MAX_ENEMIES)
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
        w.queue[..w.queue_len].to_vec()
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
    fn every_mission_wave_fits_the_queue() {
        for sector in 0..3 {
            for wave in 1..=WAVE_TOTAL {
                let total = mission_composition(sector, wave).total();
                assert!(total as usize <= MAX_QUEUE, "sector {sector} wave {wave}");
            }
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
    fn filling_stops_at_queue_capacity() {
        // Sin el tope en el `while`, esta llamada nunca termina: el test cuelga en vez de fallar.
        let mut w = Waves::new();
        w.begin(
            1,
            Composition {
                scouts: 40,
                sentinels: 0,
                interceptors: 0,
            },
        );
        assert_eq!(w.queue_len, MAX_QUEUE);
    }

    #[test]
    fn wave_one_never_spawns_sentinels() {
        let mut w = Waves::new();
        w.begin(1, mission_composition(0, 1));
        assert!(w.queue[..w.queue_len]
            .iter()
            .all(|k| *k == crate::enemy::KIND_SCOUT));
    }

    #[test]
    fn spawn_interval_decreases_but_has_a_floor() {
        assert!(Waves::spawn_interval_for(2) < Waves::spawn_interval_for(1));
        assert!(Waves::spawn_interval_for(99) >= 0.6);
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
