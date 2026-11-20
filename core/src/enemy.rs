//! Enemy archetypes driven by deterministic finite-state machines.
//!
//! Decisions are taken at a reduced rate (`THINK_HZ`) while movement integrates
//! every fixed step, which keeps 30+ agents cheap without making them twitchy.

use crate::arena::Arena;
use crate::math::{clamp, forward_from_yaw, v3, wrap_pi, Aabb, V3};
use crate::rng::Rng;

pub const KIND_SCOUT: u8 = 0;
pub const KIND_SENTINEL: u8 = 1;

pub const ST_SPAWN: u8 = 0;
pub const ST_PATROL: u8 = 1;
pub const ST_CHASE: u8 = 2;
pub const ST_AIM: u8 = 3;
pub const ST_STRIKE: u8 = 4;
pub const ST_RECOVER: u8 = 5;
pub const ST_DEAD: u8 = 6;

const THINK_HZ: f32 = 12.0;
const GRAVITY: f32 = 21.0;

#[derive(Clone, Copy, Debug)]
pub struct KindDef {
    pub hp: f32,
    pub speed: f32,
    pub radius: f32,
    pub height: f32,
    pub discover: f32,
    pub attack_range: f32,
    pub preferred_range: f32,
    pub damage: f32,
    pub telegraph: f32,
    pub cooldown: f32,
    pub burst: u8,
    pub burst_interval: f32,
    pub spawn_grace: f32,
}

pub const SCOUT: KindDef = KindDef {
    hp: 35.0,
    speed: 3.5,
    radius: 0.42,
    height: 1.7,
    discover: 26.0,
    attack_range: 2.6,
    preferred_range: 1.5,
    damage: 12.0,
    telegraph: 0.36,
    cooldown: 1.15,
    burst: 1,
    burst_interval: 0.0,
    spawn_grace: 0.55,
};

pub const SENTINEL: KindDef = KindDef {
    hp: 55.0,
    speed: 2.0,
    radius: 0.45,
    height: 1.95,
    discover: 32.0,
    attack_range: 20.0,
    preferred_range: 11.0,
    damage: 8.0,
    telegraph: 0.62,
    cooldown: 2.3,
    burst: 3,
    burst_interval: 0.14,
    spawn_grace: 0.6,
};

pub fn def(kind: u8) -> &'static KindDef {
    match kind {
        KIND_SENTINEL => &SENTINEL,
        _ => &SCOUT,
    }
}

/// A single outgoing effect produced by an enemy this tick.
#[derive(Clone, Copy, Debug)]
pub enum Action {
    /// Telegraph started: the renderer/audio can play a warning.
    Windup,
    Melee {
        damage: f32,
    },
    Shot {
        origin: V3,
        dir: V3,
        damage: f32,
    },
}

pub struct EnemyContext<'a> {
    pub arena: &'a Arena,
    pub player_eye: V3,
    pub player_feet: V3,
    pub player_radius: f32,
    pub player_height: f32,
}

#[derive(Clone, Copy, Debug)]
pub struct Enemy {
    pub active: bool,
    pub kind: u8,
    pub pos: V3,
    pub vy: f32,
    pub yaw: f32,
    pub hp: f32,
    pub hp_max: f32,
    pub state: u8,
    pub state_time: f32,
    pub think: f32,
    pub fire_cd: f32,
    pub burst_left: u8,
    pub burst_cd: f32,
    pub anim: f32,
    pub waypoint: u8,
    pub stuck: f32,
    pub avoid_dir: f32,
    pub los: bool,
    pub dist: f32,
}

pub const EMPTY_ENEMY: Enemy = Enemy {
    active: false,
    kind: KIND_SCOUT,
    pos: V3::ZERO,
    vy: 0.0,
    yaw: 0.0,
    hp: 0.0,
    hp_max: 0.0,
    state: ST_DEAD,
    state_time: 0.0,
    think: 0.0,
    fire_cd: 0.0,
    burst_left: 0,
    burst_cd: 0.0,
    anim: 0.0,
    waypoint: 0,
    stuck: 0.0,
    avoid_dir: 1.0,
    los: false,
    dist: 0.0,
};

pub fn dir_to_yaw(d: V3) -> f32 {
    if d.x.abs() < 1e-6 && d.z.abs() < 1e-6 {
        return 0.0;
    }
    crate::math::atan2(-d.x, -d.z)
}

impl Enemy {
    pub fn spawn(pos: V3, kind: u8, yaw: f32, waypoint: u8) -> Enemy {
        let d = def(kind);
        Enemy {
            active: true,
            kind,
            pos,
            yaw,
            hp: d.hp,
            hp_max: d.hp,
            state: ST_SPAWN,
            state_time: 0.0,
            anim: 0.0,
            waypoint,
            ..EMPTY_ENEMY
        }
    }

    pub fn is_alive(&self) -> bool {
        self.active && self.state != ST_DEAD
    }

    pub fn body(&self) -> Aabb {
        let d = def(self.kind);
        Aabb::from_feet(self.pos, d.radius, d.height)
    }

    pub fn eye(&self) -> V3 {
        v3(
            self.pos.x,
            self.pos.y + def(self.kind).height * 0.82,
            self.pos.z,
        )
    }

    /// Applies damage. Returns true when this hit killed the enemy.
    pub fn hurt(&mut self, amount: f32) -> bool {
        if !self.is_alive() {
            return false;
        }
        self.hp -= amount;
        if self.hp <= 0.0 {
            self.hp = 0.0;
            self.state = ST_DEAD;
            self.active = false;
            self.state_time = 0.0;
            return true;
        }
        false
    }

    fn set_state(&mut self, state: u8) {
        self.state = state;
        self.state_time = 0.0;
    }

    pub fn tick(&mut self, dt: f32, ctx: &EnemyContext, rng: &mut Rng) -> Option<Action> {
        if !self.is_alive() {
            return None;
        }
        let d = *def(self.kind);
        self.state_time += dt;
        self.think += dt;
        self.anim += dt;
        self.fire_cd = (self.fire_cd - dt).max(0.0);

        self.dist = self.pos.dist_xz(ctx.player_feet);
        self.los = !ctx.arena.blocked(self.eye(), ctx.player_eye);

        let mut action: Option<Action> = None;

        match self.state {
            ST_SPAWN => {
                if self.state_time >= d.spawn_grace {
                    self.set_state(ST_PATROL);
                }
            }
            ST_PATROL => {
                if self.dist < d.discover && self.los {
                    self.set_state(ST_CHASE);
                }
            }
            ST_CHASE => {
                let in_range = self.dist <= d.attack_range;
                let ready = self.los && self.fire_cd <= 0.0;
                if in_range && ready && (self.kind == KIND_SCOUT || self.los) {
                    self.set_state(ST_AIM);
                    action = Some(Action::Windup);
                }
            }
            ST_AIM => {
                if self.state_time >= d.telegraph {
                    if self.kind == KIND_SCOUT {
                        self.set_state(ST_STRIKE);
                    } else {
                        self.set_state(ST_STRIKE);
                        self.burst_left = d.burst;
                        self.burst_cd = 0.0;
                    }
                }
            }
            ST_STRIKE => {
                if self.kind == KIND_SCOUT {
                    // Melee lands on the frame the windup ends, if still in reach.
                    if self.dist <= d.attack_range + 0.6 && self.los {
                        action = Some(Action::Melee { damage: d.damage });
                    }
                    self.set_state(ST_RECOVER);
                    self.fire_cd = d.cooldown;
                } else {
                    self.burst_cd -= dt;
                    if self.burst_left > 0 && self.burst_cd <= 0.0 {
                        self.burst_left -= 1;
                        self.burst_cd = d.burst_interval;
                        let origin = self.eye();
                        let target = ctx.player_eye;
                        let base = (target - origin).norm_or(forward_from_yaw(self.yaw));
                        let jitter = v3(rng.signed(0.028), rng.signed(0.02), rng.signed(0.028));
                        action = Some(Action::Shot {
                            origin,
                            dir: (base + jitter).norm_or(base),
                            damage: d.damage,
                        });
                    }
                    if self.burst_left == 0 && self.burst_cd <= 0.0 {
                        self.set_state(ST_RECOVER);
                        self.fire_cd = d.cooldown;
                    }
                }
            }
            ST_RECOVER => {
                if self.state_time >= d.cooldown * 0.55 {
                    self.set_state(ST_CHASE);
                }
            }
            _ => {}
        }

        // --- movement -----------------------------------------------------
        let target = match self.state {
            ST_PATROL => self.patrol_target(),
            ST_CHASE => {
                if self.kind == KIND_SENTINEL {
                    let toward = (ctx.player_feet - self.pos).norm_or(forward_from_yaw(self.yaw));
                    if !self.los || self.dist > d.preferred_range + 3.0 {
                        ctx.player_feet
                    } else if self.dist < d.preferred_range - 3.0 {
                        self.pos - toward * 4.0
                    } else {
                        // Strafe to stay awkward to hit without charging in.
                        self.pos + v3(-toward.z, 0.0, toward.x) * 4.0 * self.avoid_dir
                    }
                } else {
                    ctx.player_feet
                }
            }
            ST_RECOVER => {
                let away = (self.pos - ctx.player_feet).norm_or(forward_from_yaw(self.yaw));
                self.pos + away * 3.0
            }
            _ => self.pos,
        };

        let speed = match self.state {
            ST_PATROL => d.speed * 0.45,
            ST_CHASE => d.speed,
            ST_RECOVER => d.speed * 0.6,
            ST_AIM | ST_STRIKE => d.speed * 0.1,
            _ => 0.0,
        };

        if speed > 0.01 {
            self.steer(target, speed, dt, ctx.arena);
        } else {
            self.apply_gravity(dt, ctx.arena);
            self.face_towards(ctx.player_feet, dt, 6.0);
        }

        // Periodically re-read the target so patrolling agents keep moving.
        if self.think >= 1.0 / THINK_HZ {
            self.think = 0.0;
            if self.state == ST_PATROL {
                self.waypoint = self.waypoint.wrapping_add(1);
            }
        }

        action
    }

    fn patrol_target(&self) -> V3 {
        let angle = self.waypoint as f32 * 0.9;
        v3(
            crate::math::cos(angle) * 6.0,
            self.pos.y,
            crate::math::sin(angle) * 6.0,
        )
    }

    fn face_towards(&mut self, target: V3, dt: f32, rate: f32) {
        let desired = dir_to_yaw((target - self.pos).flat());
        let delta = wrap_pi(desired - self.yaw);
        self.yaw += clamp(delta, -rate * dt, rate * dt);
        self.yaw = wrap_pi(self.yaw);
    }

    fn apply_gravity(&mut self, dt: f32, arena: &Arena) {
        let d = def(self.kind);
        let mut vel = v3(0.0, self.vy - GRAVITY * dt, 0.0);
        arena.move_body(&mut self.pos, &mut vel, d.radius, d.height, dt, 0.3);
        self.vy = vel.y;
    }

    fn steer(&mut self, target: V3, speed: f32, dt: f32, arena: &Arena) {
        let d = *def(self.kind);
        let to = (target - self.pos).flat();
        let len = to.len_xz();
        if len > 0.15 {
            let dir = to * (1.0 / len);
            let perp = v3(-dir.z, 0.0, dir.x) * (self.avoid_dir * 0.9);
            let move_dir = (dir + perp).norm_or(dir);
            let mut vel = move_dir * speed;
            vel.y = self.vy - GRAVITY * dt;
            let before = self.pos;
            arena.move_body(&mut self.pos, &mut vel, d.radius, d.height, dt, 0.3);
            self.vy = vel.y;

            let travelled = (self.pos - before).len_xz();
            if travelled < speed * dt * 0.3 {
                self.stuck += dt;
            } else {
                self.stuck = (self.stuck - dt * 2.0).max(0.0);
            }
            if self.stuck > 0.3 {
                self.avoid_dir = -self.avoid_dir;
                self.stuck = 0.0;
            }
            self.face_towards(target, dt, 8.0);
        } else {
            self.apply_gravity(dt, arena);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn flat() -> Arena {
        let mut a = Arena::new();
        a.load(&[-40.0, -1.0, -40.0, 40.0, 0.0, 40.0, 1.0]);
        a
    }

    fn ctx<'a>(arena: &'a Arena, player: V3) -> EnemyContext<'a> {
        EnemyContext {
            arena,
            player_eye: v3(player.x, player.y + 1.62, player.z),
            player_feet: player,
            player_radius: 0.36,
            player_height: 1.8,
        }
    }

    #[test]
    fn yaw_from_direction_matches_convention() {
        assert!((dir_to_yaw(v3(0.0, 0.0, -1.0))).abs() < 1e-5);
        assert!((dir_to_yaw(v3(-1.0, 0.0, 0.0)) - core::f32::consts::FRAC_PI_2).abs() < 1e-5);
    }

    #[test]
    fn spawn_grace_then_patrol() {
        let arena = flat();
        let mut e = Enemy::spawn(v3(0.0, 0.0, 0.0), KIND_SCOUT, 0.0, 0);
        let mut rng = Rng::new(1);
        let c = ctx(&arena, v3(0.0, 0.0, -30.0));
        e.tick(0.1, &c, &mut rng);
        assert_eq!(e.state, ST_SPAWN);
        for _ in 0..10 {
            e.tick(0.1, &c, &mut rng);
        }
        assert_eq!(e.state, ST_PATROL);
    }

    #[test]
    fn scout_detects_and_closes_distance() {
        let arena = flat();
        let mut e = Enemy::spawn(v3(0.0, 0.0, 0.0), KIND_SCOUT, 0.0, 0);
        let mut rng = Rng::new(7);
        let player = v3(0.0, 0.0, -14.0);
        let c = ctx(&arena, player);
        let start = e.pos.dist_xz(player);
        for _ in 0..240 {
            e.tick(1.0 / 60.0, &c, &mut rng);
        }
        assert_ne!(e.state, ST_PATROL, "scout should be hunting");
        assert!(
            e.pos.dist_xz(player) < start - 3.0,
            "scout did not approach"
        );
    }

    #[test]
    fn scout_melee_produces_one_hit_after_telegraph() {
        let arena = flat();
        let mut e = Enemy::spawn(v3(0.0, 0.0, 0.0), KIND_SCOUT, 0.0, 0);
        let mut rng = Rng::new(3);
        let c = ctx(&arena, v3(0.0, 0.0, -1.6));
        let mut melee_hits = 0;
        let mut windups = 0;
        for _ in 0..120 {
            if let Some(a) = e.tick(1.0 / 60.0, &c, &mut rng) {
                match a {
                    Action::Windup => windups += 1,
                    Action::Melee { .. } => melee_hits += 1,
                    _ => {}
                }
            }
        }
        assert!(windups >= 1, "telegraph must precede damage");
        assert!(
            melee_hits >= 1 && melee_hits <= 2,
            "melee hits: {melee_hits}"
        );
    }

    #[test]
    fn sentinel_bursts_three_times_then_recovers() {
        let arena = flat();
        let mut e = Enemy::spawn(v3(0.0, 0.0, 0.0), KIND_SENTINEL, 0.0, 0);
        let mut rng = Rng::new(11);
        let c = ctx(&arena, v3(0.0, 0.0, -10.0));
        let mut shots = 0;
        let mut saw_recover = false;
        for _ in 0..240 {
            if let Some(Action::Shot { .. }) = e.tick(1.0 / 60.0, &c, &mut rng) {
                shots += 1;
            }
            if e.state == ST_RECOVER {
                saw_recover = true;
            }
        }
        assert_eq!(shots, 3, "one burst of three");
        assert!(saw_recover);
    }

    #[test]
    fn no_attack_without_line_of_sight() {
        let mut arena = Arena::new();
        arena.load(&[
            -40.0, -1.0, -40.0, 40.0, 0.0, 40.0, 1.0, //
            -6.0, 0.0, -1.0, 6.0, 4.0, 1.0, 0.0,
        ]);
        let mut e = Enemy::spawn(v3(0.0, 0.0, 4.0), KIND_SENTINEL, 0.0, 0);
        let mut rng = Rng::new(5);
        let c = ctx(&arena, v3(0.0, 0.0, -4.0));
        for _ in 0..180 {
            let a = e.tick(1.0 / 60.0, &c, &mut rng);
            assert!(a.is_none(), "enemy shot through a wall");
        }
    }

    #[test]
    fn hurt_kills_and_deactivates() {
        let mut e = Enemy::spawn(v3(0.0, 0.0, 0.0), KIND_SCOUT, 0.0, 0);
        assert!(!e.hurt(10.0));
        assert!(e.hurt(100.0));
        assert!(!e.is_alive());
        assert!(!e.hurt(10.0));
    }

    #[test]
    fn enemy_stays_on_the_floor() {
        let arena = flat();
        let mut e = Enemy::spawn(v3(0.0, 5.0, 0.0), KIND_SCOUT, 0.0, 0);
        let mut rng = Rng::new(2);
        let c = ctx(&arena, v3(0.0, 0.0, -3.0));
        for _ in 0..180 {
            e.tick(1.0 / 60.0, &c, &mut rng);
        }
        assert!(e.pos.y.abs() < 1e-3, "{:?}", e.pos);
    }
}
