//! Enemy archetypes driven by deterministic finite-state machines.
//!
//! Movement integrates every fixed step; patrol waypoints advance on arrival or on a
//! seconds-scale timer, which keeps 30+ agents cheap without making them twitchy.

use crate::arena::Arena;
use crate::math::{clamp, cos, forward_from_yaw, sin, v3, wrap_pi, Aabb, V3};
use crate::rng::Rng;

pub const KIND_SCOUT: u8 = 0;
pub const KIND_SENTINEL: u8 = 1;
/// Interceptor (SPEC §3.5): flanquea, telegrafía la embestida y se retira.
pub const KIND_INTERCEPTOR: u8 = 2;

pub const ST_SPAWN: u8 = 0;
pub const ST_PATROL: u8 = 1;
pub const ST_CHASE: u8 = 2;
pub const ST_AIM: u8 = 3;
pub const ST_STRIKE: u8 = 4;
pub const ST_RECOVER: u8 = 5;
pub const ST_DEAD: u8 = 6;
pub const ST_FLANK: u8 = 7;
pub const ST_CHARGE: u8 = 8;

/// Segundos de patrulla sin detectar al jugador antes de salir a buscarlo: sin esto, un enemigo
/// aparecido fuera de línea de visión deja la oleada abierta para siempre.
const PATROL_HUNT_AFTER: f32 = 20.0;
/// Radio del lazo de patrulla alrededor del punto de aparición.
const PATROL_RADIUS: f32 = 4.0;
/// Paso angular entre waypoints del lazo (rad); lo bastante chico para que las curvas no inviertan el rumbo.
const PATROL_STEP: f32 = 0.6;
/// Distancia a la que un waypoint de patrulla cuenta como alcanzado.
const PATROL_ARRIVE: f32 = 0.8;
/// Tope de segundos por tramo: si un obstáculo impide llegar, se pasa al siguiente waypoint.
const PATROL_LEG_MAX: f32 = 4.0;
const GRAVITY: f32 = 21.0;

/// Interceptor: la carga arranca a lo sumo `CHARGE_REACH` más allá del anillo de flanqueo.
const CHARGE_REACH: f32 = 1.2;
/// Coseno del ángulo frente al jugador. Por debajo (60°) el enemigo está en el costado o la espalda.
const FLANK_ARC_COS: f32 = 0.5;
/// Paso angular de la órbita por tick de decisión (rad, a 12 Hz equivale a ~29° por paso).
const ORBIT_STEP: f32 = 0.5;
/// Tiempo máximo flanqueando; pasado este plazo carga aunque no esté en el costado.
const FLANK_MAX: f32 = 6.0;
/// Tiempo tras el telegrafo en que la embestida sigue viva antes de cortarse (pared o jugador esquivado).
const DASH_MAX: f32 = 0.9;
/// La embestida apunta un tramo más allá del jugador para que el contacto siempre ocurra.
const DASH_OVERSHOOT: f32 = 1.5;

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
    /// Velocidad de la embestida; 0 para los tipos que no cargan.
    pub dash_speed: f32,
    /// Radio del anillo donde el interceptor orbita al jugador; 0 para los demás.
    pub flank_radius: f32,
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
    dash_speed: 0.0,
    flank_radius: 0.0,
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
    dash_speed: 0.0,
    flank_radius: 0.0,
};

pub const INTERCEPTOR: KindDef = KindDef {
    hp: 28.0,
    speed: 5.5,
    radius: 0.40,
    height: 1.75,
    discover: 26.0,
    attack_range: 1.4,
    preferred_range: 0.0,
    damage: 18.0,
    telegraph: 0.45,
    cooldown: 1.6,
    burst: 0,
    burst_interval: 0.0,
    spawn_grace: 0.5,
    dash_speed: 12.0,
    flank_radius: 3.2,
};

pub fn def(kind: u8) -> &'static KindDef {
    match kind {
        KIND_SENTINEL => &SENTINEL,
        KIND_INTERCEPTOR => &INTERCEPTOR,
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
    /// Frente horizontal del jugador (vector unitario en XZ).
    pub player_forward: V3,
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
    /// Centro del lazo de patrulla: el punto donde apareció.
    pub anchor: V3,
    pub stuck: f32,
    pub avoid_dir: f32,
    pub los: bool,
    pub dist: f32,
    /// Punto de la embestida, fijado al terminar el telegrafo.
    pub dash_target: V3,
    pub dash_locked: bool,
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
    anchor: V3::ZERO,
    stuck: 0.0,
    avoid_dir: 1.0,
    los: false,
    dist: 0.0,
    dash_target: V3::ZERO,
    dash_locked: false,
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
            anchor: pos,
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
        self.dash_locked = false;
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
                let hunting = self.state_time >= PATROL_HUNT_AFTER;
                if (self.dist < d.discover && self.los) || hunting {
                    let next = if self.kind == KIND_INTERCEPTOR {
                        ST_FLANK
                    } else {
                        ST_CHASE
                    };
                    self.set_state(next);
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
            ST_FLANK => {
                if self.ready_to_charge(&d, ctx) {
                    self.set_state(ST_CHARGE);
                    action = Some(Action::Windup);
                }
            }
            ST_CHARGE if self.state_time >= d.telegraph => {
                if !self.dash_locked {
                    self.lock_dash(ctx);
                }
                if self.dist <= d.attack_range {
                    self.set_state(ST_STRIKE);
                } else if self.state_time >= d.telegraph + DASH_MAX {
                    self.set_state(ST_RECOVER);
                    self.fire_cd = d.cooldown;
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
                if self.kind != KIND_SENTINEL {
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
            ST_RECOVER if self.state_time >= d.cooldown * 0.55 => {
                let next = if self.kind == KIND_INTERCEPTOR {
                    ST_FLANK
                } else {
                    ST_CHASE
                };
                self.set_state(next);
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
            ST_FLANK => self.flank_target(&d, ctx),
            _ => self.pos,
        };

        let speed = match self.state {
            ST_PATROL => d.speed * 0.45,
            ST_CHASE | ST_FLANK => d.speed,
            ST_RECOVER => d.speed * 0.6,
            ST_AIM | ST_STRIKE => d.speed * 0.1,
            _ => 0.0,
        };

        if self.state == ST_CHARGE && self.state_time >= d.telegraph {
            self.dash(self.dash_target, d.dash_speed, dt, ctx.arena);
        } else if speed > 0.01 {
            self.steer(target, speed, dt, ctx.arena);
        } else {
            self.apply_gravity(dt, ctx.arena);
            self.face_towards(ctx.player_feet, dt, 6.0);
        }

        if self.state == ST_PATROL {
            let arrived = self.pos.dist_xz(target) < PATROL_ARRIVE;
            if arrived || self.think >= PATROL_LEG_MAX {
                self.think = 0.0;
                self.waypoint = self.waypoint.wrapping_add(1);
            }
        } else {
            self.think = 0.0;
        }

        action
    }

    /// Unit direction from the player to the enemy on the ground.
    fn outward(&self, ctx: &EnemyContext) -> V3 {
        (self.pos - ctx.player_feet)
            .flat()
            .norm_or(-ctx.player_forward)
    }

    /// Punto de órbita sobre el anillo de flanqueo; lejos del anillo, se acerca en línea recta.
    fn flank_target(&self, d: &KindDef, ctx: &EnemyContext) -> V3 {
        let out = self.outward(ctx);
        if self.dist > d.flank_radius * 2.0 {
            return ctx.player_feet + out * d.flank_radius;
        }
        let s = sin(ORBIT_STEP) * self.avoid_dir;
        let c = cos(ORBIT_STEP);
        let rot = v3(out.x * c - out.z * s, 0.0, out.x * s + out.z * c);
        ctx.player_feet + rot * d.flank_radius
    }

    /// Posición de carga: en el costado o la espalda, a distancia de embestida y con disparo listo.
    fn ready_to_charge(&self, d: &KindDef, ctx: &EnemyContext) -> bool {
        if !self.los || self.fire_cd > 0.0 || self.dist > d.flank_radius + CHARGE_REACH {
            return false;
        }
        let on_side = self.outward(ctx).dot(ctx.player_forward) < FLANK_ARC_COS;
        on_side || self.state_time >= FLANK_MAX
    }

    fn lock_dash(&mut self, ctx: &EnemyContext) {
        let toward = (ctx.player_feet - self.pos)
            .flat()
            .norm_or(ctx.player_forward);
        self.dash_target = ctx.player_feet + toward * DASH_OVERSHOOT;
        self.dash_locked = true;
    }

    /// Embestida en línea recta hacia el punto fijado. Sin desvío lateral: el telegrafo
    /// anuncia una trayectoria real. Las paredes la frenan y `DASH_MAX` la corta.
    fn dash(&mut self, target: V3, speed: f32, dt: f32, arena: &Arena) {
        let d = *def(self.kind);
        let dir = (target - self.pos)
            .flat()
            .norm_or(forward_from_yaw(self.yaw));
        let mut vel = dir * speed;
        vel.y = self.vy - GRAVITY * dt;
        arena.move_body(&mut self.pos, &mut vel, d.radius, d.height, dt, 0.3);
        self.vy = vel.y;
        self.face_towards(target, dt, 12.0);
    }

    fn patrol_target(&self) -> V3 {
        let angle = self.waypoint as f32 * PATROL_STEP;
        v3(
            self.anchor.x + crate::math::cos(angle) * PATROL_RADIUS,
            self.pos.y,
            self.anchor.z + crate::math::sin(angle) * PATROL_RADIUS,
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
            player_forward: v3(0.0, 0.0, -1.0),
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
    fn patrol_walks_a_loop_around_its_spawn_without_jitter() {
        let arena = flat();
        let spawn = v3(20.0, 0.0, 20.0);
        let mut e = Enemy::spawn(spawn, KIND_SCOUT, 0.0, 0);
        let mut rng = Rng::new(3);
        let c = ctx(&arena, v3(-30.0, 0.0, -30.0));
        for _ in 0..40 {
            e.tick(1.0 / 60.0, &c, &mut rng);
        }
        assert_eq!(e.state, ST_PATROL);

        let mut heading_flips = 0;
        let mut last_step = v3(0.0, 0.0, 0.0);
        let mut max_from_spawn = 0.0f32;
        for _ in 0..1000 {
            let before = e.pos;
            e.tick(1.0 / 60.0, &c, &mut rng);
            let step = (e.pos - before).flat();
            if step.len_xz() > 1e-4 && last_step.len_xz() > 1e-4 && step.dot(last_step) < 0.0 {
                heading_flips += 1;
            }
            if step.len_xz() > 1e-4 {
                last_step = step;
            }
            max_from_spawn = max_from_spawn.max(e.pos.dist_xz(spawn));
        }
        assert!(max_from_spawn > 1.5, "patrol barely moved");
        assert!(heading_flips <= 2, "heading reversed {heading_flips} times");
        assert!(
            max_from_spawn < 8.0,
            "patrol drifted {max_from_spawn} m from its anchor"
        );
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
        assert!((1..=2).contains(&melee_hits), "melee hits: {melee_hits}");
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

    #[test]
    fn interceptor_ids_match_the_shell_mirror() {
        // src/wasm/protocol.ts declares the same numbers; change both sides together.
        assert_eq!(KIND_INTERCEPTOR, 2);
        assert_eq!(ST_FLANK, 7);
        assert_eq!(ST_CHARGE, 8);
    }

    #[test]
    fn interceptor_orbits_to_the_side_before_charging() {
        let arena = flat();
        let mut e = Enemy::spawn(v3(0.0, 0.0, -6.0), KIND_INTERCEPTOR, 0.0, 0);
        e.state = ST_FLANK;
        let mut rng = Rng::new(9);
        let c = ctx(&arena, v3(0.0, 0.0, 0.0));
        let mut charged = false;
        for _ in 0..(6 * 60) {
            e.tick(1.0 / 60.0, &c, &mut rng);
            if e.state == ST_CHARGE {
                charged = true;
                break;
            }
        }
        assert!(charged, "interceptor never charged");
        // El jugador mira hacia -z: la carga debe salir fuera del cono frontal.
        let cos_from_front = -e.pos.z / (e.pos.x * e.pos.x + e.pos.z * e.pos.z).sqrt();
        assert!(
            cos_from_front < FLANK_ARC_COS,
            "charged from the front at {:?}",
            e.pos
        );
    }

    #[test]
    fn interceptor_telegraphs_before_the_dash_and_strikes_once_per_charge() {
        let arena = flat();
        let mut e = Enemy::spawn(v3(3.2, 0.0, 0.0), KIND_INTERCEPTOR, 0.0, 0);
        e.state = ST_FLANK;
        let mut rng = Rng::new(4);
        let c = ctx(&arena, v3(0.0, 0.0, 0.0));
        let (mut windups, mut melees) = (0u32, 0u32);
        let (mut first_windup, mut first_melee) = (None, None);
        for t in 0..(8 * 60) {
            match e.tick(1.0 / 60.0, &c, &mut rng) {
                Some(Action::Windup) => {
                    windups += 1;
                    first_windup.get_or_insert(t);
                }
                Some(Action::Melee { .. }) => {
                    melees += 1;
                    first_melee.get_or_insert(t);
                }
                _ => {}
            }
        }
        assert!(windups >= 2, "expected repeated charges, got {windups}");
        assert!(melees >= 1, "stationary player was never hit");
        assert!(
            melees <= windups,
            "{melees} hits for {windups} charges: more than one hit per charge"
        );
        let gap = first_melee.unwrap() - first_windup.unwrap();
        let telegraph_ticks = (INTERCEPTOR.telegraph * 60.0).round() as u32;
        assert!(
            gap + 1 >= telegraph_ticks,
            "damage landed {gap} ticks after the windup, telegraph is {telegraph_ticks}"
        );
    }

    #[test]
    fn interceptor_dash_gives_up_when_a_low_wall_blocks_the_path() {
        let mut arena = Arena::new();
        // Muro de 0.9 m: frena al andar (escalón máximo 0.32 m) pero deja pasar la vista a la altura de los ojos.
        arena.load(&[
            -40.0, -1.0, -40.0, 40.0, 0.0, 40.0, 1.0, //
            -18.0, 0.0, -2.2, 18.0, 0.9, -1.8, 0.0,
        ]);
        let mut e = Enemy::spawn(v3(0.0, 0.0, -4.0), KIND_INTERCEPTOR, 0.0, 0);
        e.state = ST_CHARGE;
        e.state_time = INTERCEPTOR.telegraph;
        let mut rng = Rng::new(8);
        let c = ctx(&arena, v3(0.0, 0.0, 0.0));
        let mut melees = 0;
        for _ in 0..72 {
            if let Some(Action::Melee { .. }) = e.tick(1.0 / 60.0, &c, &mut rng) {
                melees += 1;
            }
        }
        assert_eq!(melees, 0, "dash went through the wall");
        assert!(e.pos.z < -1.8, "enemy crossed the wall: {:?}", e.pos);
        assert_eq!(e.state, ST_RECOVER, "blocked dash must end in retreat");
    }

    #[test]
    fn interceptor_retreats_then_reflanks_and_never_chases() {
        let arena = flat();
        let mut e = Enemy::spawn(v3(3.2, 0.0, 0.0), KIND_INTERCEPTOR, 0.0, 0);
        e.state = ST_FLANK;
        let mut rng = Rng::new(6);
        let c = ctx(&arena, v3(0.0, 0.0, 0.0));
        let mut seq: Vec<u8> = Vec::new();
        for _ in 0..(6 * 60) {
            e.tick(1.0 / 60.0, &c, &mut rng);
            if seq.last() != Some(&e.state) {
                seq.push(e.state);
            }
        }
        assert!(!seq.contains(&ST_CHASE), "fell back to chase: {seq:?}");
        let strike = seq
            .iter()
            .position(|&s| s == ST_STRIKE)
            .expect("the interceptor struck");
        assert_eq!(seq.get(strike + 1), Some(&ST_RECOVER), "{seq:?}");
        assert_eq!(seq.get(strike + 2), Some(&ST_FLANK), "{seq:?}");
    }
}
