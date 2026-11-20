//! Wave director: composition, spawn pacing and intermissions.
//!
//! Composition is a pure function of the wave number, so the same seed always
//! produces the same encounter.

use crate::protocol::MAX_ENEMIES;
use crate::rng::Rng;

pub const WAVE_TOTAL: u32 = 5;
pub const MAX_QUEUE: usize = 32;

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

    pub fn scouts(wave: u32) -> u32 {
        3 + wave
    }

    pub fn sentinels(wave: u32) -> u32 {
        if wave >= 2 {
            wave
        } else {
            0
        }
    }

    pub fn spawn_interval_for(wave: u32) -> f32 {
        (1.65 - 0.16 * (wave.saturating_sub(1)) as f32).max(0.6)
    }

    /// Fills the queue for a wave number (1-based).
    pub fn begin(&mut self, wave: u32) {
        self.wave = wave;
        self.queue_head = 0;
        self.queue_len = 0;
        self.spawn_timer = 0.35;
        self.spawn_interval = Self::spawn_interval_for(wave);
        self.running = true;
        self.intermission = 0.0;

        let scouts = Self::scouts(wave);
        let sentinels = Self::sentinels(wave);
        // Interleave so a wave never opens with a full volley of ranged units.
        let mut scout_left = scouts;
        let mut sentinel_left = sentinels;
        while scout_left > 0 || sentinel_left > 0 {
            if scout_left > 0 && self.queue_len < MAX_QUEUE {
                self.queue[self.queue_len] = crate::enemy::KIND_SCOUT;
                self.queue_len += 1;
                scout_left -= 1;
            }
            if sentinel_left > 0 && self.queue_len < MAX_QUEUE {
                self.queue[self.queue_len] = crate::enemy::KIND_SENTINEL;
                self.queue_len += 1;
                sentinel_left -= 1;
            }
            // Two scouts per sentinel keeps the mix melee-leaning.
            if scout_left > 0 && self.queue_len < MAX_QUEUE {
                self.queue[self.queue_len] = crate::enemy::KIND_SCOUT;
                self.queue_len += 1;
                scout_left -= 1;
            }
        }
    }

    pub fn queued(&self) -> usize {
        self.queue_len - self.queue_head
    }

    pub fn total_planned(&self) -> u32 {
        Self::scouts(self.wave) + Self::sentinels(self.wave)
    }

    pub fn alive_target(&self) -> usize {
        MAX_ENEMIES.min(12)
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

/// Queue composition for a wave, used by tests and the HUD legend.
pub fn composition(wave: u32) -> (u32, u32) {
    (Waves::scouts(wave), Waves::sentinels(wave))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wave_composition_grows() {
        assert_eq!(composition(1), (4, 0));
        assert_eq!(composition(2), (5, 2));
        assert_eq!(composition(5), (8, 5));
    }

    #[test]
    fn queue_matches_composition() {
        for wave in 1..=WAVE_TOTAL {
            let mut w = Waves::new();
            w.begin(wave);
            let (s, t) = composition(wave);
            assert_eq!(w.queue_len, (s + t) as usize, "wave {wave}");
            let scouts = w.queue[..w.queue_len]
                .iter()
                .filter(|k| **k == crate::enemy::KIND_SCOUT)
                .count();
            assert_eq!(scouts as u32, s);
        }
    }

    #[test]
    fn wave_one_never_spawns_sentinels() {
        let mut w = Waves::new();
        w.begin(1);
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
        w.begin(1);
        let n = w.queued();
        w.queue_head += 2;
        assert_eq!(w.queued(), n - 2);
    }
}
