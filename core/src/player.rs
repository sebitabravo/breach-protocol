//! First-person player: movement, gravity, collision resolution, look, health.

use crate::arena::Arena;
use crate::math::{clamp, dir_from_yaw_pitch, forward_from_yaw, right_from_yaw, v3, V3};
use crate::weapons;

pub const RADIUS: f32 = 0.36;
pub const HEIGHT: f32 = 1.8;
pub const EYE_HEIGHT: f32 = 1.62;
pub const STEP_HEIGHT: f32 = 0.32;

const WALK_SPEED: f32 = 4.7;
const RUN_SPEED: f32 = 6.9;
const ACCEL: f32 = 62.0;
const AIR_ACCEL: f32 = 14.0;
const FRICTION: f32 = 11.0;
const JUMP_SPEED: f32 = 5.9;
pub const GRAVITY: f32 = 21.0;
const PITCH_LIMIT: f32 = 1.5;

/// Health regeneration only starts after this long without taking damage.
const REGEN_DELAY: f32 = 7.0;
const REGEN_PER_SEC: f32 = 4.0;

const RECOIL_RECOVER: f32 = 6.5;

/// Escala fija de la mirada cuantizada: unidades por radián.
pub const LOOK_UNITS_PER_RAD: f32 = 4096.0;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Input {
    pub move_x: f32,
    pub move_z: f32,
    pub look_dx: f32,
    pub look_dy: f32,
    pub fire_held: bool,
    pub fire_pressed: bool,
    pub jump: bool,
    pub interact: bool,
    pub reload: bool,
    pub run: bool,
    pub switch: u8,
    pub ads: bool,
}

impl Input {
    /// Redondea movimiento a i8 y mirada a i16: el registro guarda exactamente
    /// lo que la simulación consumió, así el replay reproduce bit a bit.
    pub fn quantized(mut self) -> Input {
        self.move_x = quantize_axis(self.move_x) as f32 / 127.0;
        self.move_z = quantize_axis(self.move_z) as f32 / 127.0;
        self.look_dx = quantize_look(self.look_dx) as f32 / LOOK_UNITS_PER_RAD;
        self.look_dy = quantize_look(self.look_dy) as f32 / LOOK_UNITS_PER_RAD;
        self.switch = self.switch.min(3);
        self
    }
}

pub fn quantize_axis(v: f32) -> i8 {
    if v.is_nan() {
        return 0;
    }
    (v.clamp(-1.0, 1.0) * 127.0).round() as i8
}

pub fn quantize_look(v: f32) -> i16 {
    if v.is_nan() {
        return 0;
    }
    (v * LOOK_UNITS_PER_RAD).clamp(-32767.0, 32767.0).round() as i16
}

impl Default for Input {
    fn default() -> Self {
        Input {
            move_x: 0.0,
            move_z: 0.0,
            look_dx: 0.0,
            look_dy: 0.0,
            fire_held: false,
            fire_pressed: false,
            jump: false,
            interact: false,
            reload: false,
            run: false,
            switch: 0,
            ads: false,
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct WeaponSlot {
    id: u8,
    pub(crate) ammo: u16,
    pub(crate) reserve: u16,
}

impl WeaponSlot {
    const fn full(def: &weapons::WeaponDef) -> Self {
        Self {
            id: def.id,
            ammo: def.mag,
            reserve: def.reserve,
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Player {
    pub pos: V3,
    pub vel: V3,
    pub yaw: f32,
    pub pitch: f32,
    pub hp: f32,
    pub hp_max: f32,
    pub grounded: bool,
    pub recoil_pitch: f32,
    pub recoil_yaw: f32,
    pub damage_age: f32,
    /// One-based active slot index, also the weapon ID used by input and snapshots.
    pub weapon: u8,
    slots: [WeaponSlot; 3],
    pub reload_t: f32,
    pub fire_cd: f32,
    pub hit_age: f32,
    pub speed: f32,
    pub ads: f32,
}

impl Player {
    pub fn new(start: V3, yaw: f32) -> Self {
        Player {
            pos: start,
            vel: V3::ZERO,
            yaw,
            pitch: 0.0,
            hp: 100.0,
            hp_max: 100.0,
            grounded: true,
            recoil_pitch: 0.0,
            recoil_yaw: 0.0,
            damage_age: 999.0,
            weapon: weapons::ID_SIDEARM,
            slots: [
                WeaponSlot::full(&weapons::SIDEARM),
                WeaponSlot::full(&weapons::CARBINE),
                WeaponSlot::full(&weapons::SHOTGUN),
            ],
            reload_t: 0.0,
            fire_cd: 0.0,
            hit_age: 999.0,
            speed: 0.0,
            ads: 0.0,
        }
    }

    pub fn eye(&self) -> V3 {
        v3(self.pos.x, self.pos.y + EYE_HEIGHT, self.pos.z)
    }

    /// Look direction including the transient recoil offset.
    pub fn aim_dir(&self) -> V3 {
        dir_from_yaw_pitch(self.yaw + self.recoil_yaw, self.pitch + self.recoil_pitch)
    }

    pub fn body(&self) -> crate::math::Aabb {
        crate::math::Aabb::from_feet(self.pos, RADIUS, HEIGHT)
    }

    pub fn is_reloading(&self) -> bool {
        self.reload_t > 0.0
    }

    pub(crate) fn active_slot(&self) -> &WeaponSlot {
        &self.slots[usize::from(self.weapon - 1)]
    }

    pub(crate) fn active_slot_mut(&mut self) -> &mut WeaponSlot {
        &mut self.slots[usize::from(self.weapon - 1)]
    }

    pub(crate) fn scale_starting_reserves(&mut self, multiplier: u16) {
        for slot in &mut self.slots {
            slot.reserve = slot.reserve.saturating_mul(multiplier);
        }
    }

    pub fn reload_progress(&self) -> f32 {
        let def = weapons::def(self.weapon);
        if self.reload_t <= 0.0 {
            0.0
        } else {
            clamp(1.0 - self.reload_t / def.reload_time, 0.0, 1.0)
        }
    }

    pub fn spread(&self) -> f32 {
        let def = weapons::def(self.weapon);
        let base = if self.ads > 0.5 {
            def.ads_spread
        } else {
            def.spread
        };
        // Moving destabilises the shot a little, airborne more so.
        let move_penalty = clamp(self.vel.len_xz() / RUN_SPEED, 0.0, 1.0) * 0.012;
        let air_penalty = if self.grounded { 0.0 } else { 0.02 };
        base + move_penalty + air_penalty
    }

    pub fn heal(&mut self, amount: f32) {
        self.hp = (self.hp + amount).min(self.hp_max);
    }

    pub fn take_damage(&mut self, amount: f32) -> f32 {
        if amount <= 0.0 {
            return 0.0;
        }
        let before = self.hp;
        self.hp = (self.hp - amount).max(0.0);
        self.damage_age = 0.0;
        before - self.hp
    }

    /// Applies look input. Recoil is part of the aim, not of the stored angles,
    /// so a player who keeps fighting never loses the mouse mapping to it.
    pub fn look(&mut self, dx: f32, dy: f32) {
        self.yaw -= dx;
        self.pitch = clamp(self.pitch - dy, -PITCH_LIMIT, PITCH_LIMIT);
        // Moving the mouse absorbs pending recoil instead of stacking on top of it.
        self.recoil_pitch -= dy * 0.45;
        self.recoil_yaw -= dx * 0.45;
    }

    pub fn tick(&mut self, dt: f32, input: &Input, arena: &Arena) -> bool {
        self.look(input.look_dx, input.look_dy);

        let ads_target = if input.ads { 1.0 } else { 0.0 };
        self.ads = crate::math::approach(self.ads, ads_target, dt * 8.0);

        let wish = (right_from_yaw(self.yaw) * input.move_x
            + forward_from_yaw(self.yaw) * input.move_z)
            .flat();
        let wish_len = wish.len();
        let wish_dir = if wish_len > 1.0 {
            wish * (1.0 / wish_len)
        } else {
            wish
        };

        let mut target_speed = if input.run { RUN_SPEED } else { WALK_SPEED };
        target_speed *= 1.0 - 0.4 * self.ads;
        if self.is_reloading() {
            target_speed *= 0.85;
        }

        let accel = if self.grounded { ACCEL } else { AIR_ACCEL };
        let desired = wish_dir * target_speed;
        let dv = v3(desired.x - self.vel.x, 0.0, desired.z - self.vel.z);
        let dv_len = dv.len();
        if dv_len > 1e-5 {
            let step = (accel * dt).min(dv_len);
            self.vel.x += dv.x / dv_len * step;
            self.vel.z += dv.z / dv_len * step;
        }

        if wish_len < 0.05 && self.grounded {
            let speed = self.vel.len_xz();
            if speed > 0.01 {
                let drop = FRICTION * dt * speed.max(1.0);
                let scale = ((speed - drop) / speed).max(0.0);
                self.vel.x *= scale;
                self.vel.z *= scale;
            } else {
                self.vel.x = 0.0;
                self.vel.z = 0.0;
            }
        }

        if input.jump && self.grounded {
            self.vel.y = JUMP_SPEED;
            self.grounded = false;
        }

        self.vel.y -= GRAVITY * dt;
        if self.vel.y < -60.0 {
            self.vel.y = -60.0;
        }

        self.grounded = arena.move_body(
            &mut self.pos,
            &mut self.vel,
            RADIUS,
            HEIGHT,
            dt,
            STEP_HEIGHT,
        );

        // Recoil decay, frame-rate independent.
        let decay = crate::math::exp(-RECOIL_RECOVER * dt);
        self.recoil_pitch *= decay;
        self.recoil_yaw *= decay;
        if self.recoil_pitch.abs() < 1e-4 {
            self.recoil_pitch = 0.0;
        }
        if self.recoil_yaw.abs() < 1e-4 {
            self.recoil_yaw = 0.0;
        }

        self.speed = self.vel.len_xz();
        self.damage_age += dt;
        self.hit_age = (self.hit_age + dt).min(9.99);
        self.fire_cd = (self.fire_cd - dt).max(0.0);

        if self.hp > 0.0 && self.hp < self.hp_max && self.damage_age > REGEN_DELAY {
            self.heal(REGEN_PER_SEC * dt);
        }

        if self.reload_t > 0.0 {
            self.reload_t -= dt;
            if self.reload_t <= 0.0 {
                self.reload_t = 0.0;
                self.finish_reload();
                return true;
            }
        }
        false
    }

    pub fn start_reload(&mut self) -> bool {
        let def = weapons::def(self.weapon);
        let slot = self.active_slot();
        if self.reload_t > 0.0 || slot.ammo >= def.mag || slot.reserve == 0 {
            return false;
        }
        self.reload_t = def.reload_time;
        true
    }

    fn finish_reload(&mut self) {
        let slot = self.active_slot_mut();
        let need = weapons::def(slot.id).mag - slot.ammo;
        let take = need.min(slot.reserve);
        slot.ammo += take;
        slot.reserve -= take;
    }

    /// Consume one round when the trigger is ready, leaving dry-fire handling to the game.
    pub(crate) fn fire(&mut self) -> bool {
        let slot = self.active_slot_mut();
        if slot.ammo == 0 {
            return false;
        }
        slot.ammo -= 1;
        self.fire_cd = weapons::interval(weapons::def(slot.id));
        true
    }

    pub fn equip(&mut self, id: u8) -> bool {
        if id == self.weapon || !(1..=self.slots.len()).contains(&usize::from(id)) {
            return false;
        }
        self.weapon = id;
        self.reload_t = 0.0;
        self.fire_cd = 0.2;
        true
    }

    pub fn add_recoil(&mut self, pitch: f32, yaw: f32) {
        self.recoil_pitch += pitch;
        self.recoil_yaw += yaw;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn flat_arena() -> Arena {
        let mut a = Arena::new();
        a.load(&[-40.0, -1.0, -40.0, 40.0, 0.0, 40.0, 1.0]);
        a
    }

    #[test]
    fn walks_forward_along_negative_z() {
        let arena = flat_arena();
        let mut p = Player::new(v3(0.0, 0.0, 0.0), 0.0);
        let input = Input {
            move_z: 1.0,
            ..Default::default()
        };
        for _ in 0..60 {
            p.tick(1.0 / 60.0, &input, &arena);
        }
        assert!(p.pos.z < -2.0, "expected forward travel, got {:?}", p.pos);
        assert!(p.pos.z > -6.0, "speed looks wrong: {:?}", p.pos);
        assert!(p.pos.x.abs() < 0.01);
    }

    #[test]
    fn strafe_right_moves_positive_x() {
        let arena = flat_arena();
        let mut p = Player::new(v3(0.0, 0.0, 0.0), 0.0);
        let input = Input {
            move_x: 1.0,
            ..Default::default()
        };
        for _ in 0..30 {
            p.tick(1.0 / 60.0, &input, &arena);
        }
        assert!(p.pos.x > 1.0, "{:?}", p.pos);
    }

    #[test]
    fn run_is_faster_than_walk() {
        let arena = flat_arena();
        let mut walker = Player::new(v3(0.0, 0.0, 0.0), 0.0);
        let mut runner = Player::new(v3(0.0, 0.0, 0.0), 0.0);
        let input = Input {
            move_z: 1.0,
            ..Default::default()
        };
        let run_input = Input {
            move_z: 1.0,
            run: true,
            ..Default::default()
        };
        for _ in 0..90 {
            walker.tick(1.0 / 60.0, &input, &arena);
            runner.tick(1.0 / 60.0, &run_input, &arena);
        }
        assert!(runner.pos.z.abs() > walker.pos.z.abs());
    }

    #[test]
    fn jump_leaves_ground_and_lands() {
        let arena = flat_arena();
        let mut p = Player::new(v3(0.0, 0.0, 0.0), 0.0);
        let jump = Input {
            jump: true,
            ..Default::default()
        };
        p.tick(1.0 / 60.0, &jump, &arena);
        assert!(!p.grounded);
        let idle = Input::default();
        let mut peak: f32 = 0.0;
        for _ in 0..180 {
            p.tick(1.0 / 60.0, &idle, &arena);
            peak = peak.max(p.pos.y);
        }
        assert!(peak > 0.6, "jump too low: {peak}");
        assert!(p.grounded, "player never landed");
        assert!(p.pos.y.abs() < 1e-3);
    }

    #[test]
    fn movement_is_frame_rate_independent() {
        let arena = flat_arena();
        let mut a = Player::new(v3(0.0, 0.0, 0.0), 0.0);
        let mut b = Player::new(v3(0.0, 0.0, 0.0), 0.0);
        let input = Input {
            move_z: 1.0,
            ..Default::default()
        };
        for _ in 0..60 {
            a.tick(1.0 / 60.0, &input, &arena);
        }
        for _ in 0..30 {
            b.tick(2.0 / 60.0, &input, &arena);
        }
        assert!(
            (a.pos.z - b.pos.z).abs() < 0.8,
            "{} vs {}",
            a.pos.z,
            b.pos.z
        );
    }

    #[test]
    fn damage_never_goes_below_zero() {
        let mut p = Player::new(V3::ZERO, 0.0);
        let applied = p.take_damage(250.0);
        assert_eq!(applied, 100.0);
        assert_eq!(p.hp, 0.0);
    }

    #[test]
    fn health_regenerates_only_after_delay() {
        let arena = flat_arena();
        let mut p = Player::new(V3::ZERO, 0.0);
        p.take_damage(50.0);
        let idle = Input::default();
        for _ in 0..120 {
            p.tick(1.0 / 60.0, &idle, &arena);
        }
        assert!(
            (p.hp - 50.0).abs() < 1e-3,
            "regenerated too early: {}",
            p.hp
        );
        for _ in 0..(60 * 8) {
            p.tick(1.0 / 60.0, &idle, &arena);
        }
        assert!(p.hp > 60.0, "should have regenerated by now: {}", p.hp);
        assert!(p.hp <= p.hp_max);
    }

    #[test]
    fn reload_moves_ammo_from_reserve() {
        let mut p = Player::new(V3::ZERO, 0.0);
        p.active_slot_mut().ammo = 2;
        assert!(p.start_reload());
        assert!(!p.start_reload(), "second reload must be refused");
        let arena = flat_arena();
        let idle = Input::default();
        for _ in 0..120 {
            p.tick(1.0 / 60.0, &idle, &arena);
        }
        assert_eq!(p.active_slot().ammo, weapons::SIDEARM.mag);
        assert_eq!(
            p.active_slot().reserve,
            weapons::SIDEARM.reserve - (weapons::SIDEARM.mag - 2)
        );
    }

    #[test]
    fn pitch_is_clamped() {
        let mut p = Player::new(V3::ZERO, 0.0);
        for _ in 0..500 {
            p.look(0.0, 1.0);
        }
        assert!(p.pitch >= -PITCH_LIMIT - 1e-4);
        for _ in 0..1000 {
            p.look(0.0, -1.0);
        }
        assert!(p.pitch <= PITCH_LIMIT + 1e-4);
    }

    #[test]
    fn switching_weapon_preserves_magazine_after_two_shots() {
        let mut p = Player::new(V3::ZERO, 0.0);
        let arena = flat_arena();
        assert!(p.fire());
        while p.fire_cd > 0.0 {
            p.tick(1.0 / 60.0, &Input::default(), &arena);
        }
        assert!(p.fire());
        assert!(p.equip(weapons::ID_CARBINE));
        assert_eq!(p.active_slot().ammo, weapons::CARBINE.mag);
        assert_eq!(p.active_slot().reserve, weapons::CARBINE.reserve);
        assert!(!p.equip(weapons::ID_CARBINE), "re-equipping is a no-op");
        assert!(p.equip(weapons::ID_SIDEARM));
        assert_eq!(p.active_slot().ammo, weapons::SIDEARM.mag - 2);
    }

    #[test]
    fn switching_weapon_does_not_refill_empty_reserve() {
        let mut p = Player::new(V3::ZERO, 0.0);
        p.active_slot_mut().reserve = 0;
        assert!(p.equip(weapons::ID_CARBINE));
        assert!(p.equip(weapons::ID_SIDEARM));
        assert_eq!(p.active_slot().reserve, 0);
    }
}
