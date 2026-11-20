//! Weapon data tables. Balance lives in data, not in the shooting code.

pub const ID_SIDEARM: u8 = 1;
pub const ID_CARBINE: u8 = 2;
/// SG-08 Scatter. Solo disponible si la partida se inicia con `FLAG_SHOTGUN`.
pub const ID_SHOTGUN: u8 = 3;

/// Caída de daño por distancia: pleno hasta `full_until`, lineal hasta `min_at`.
#[derive(Clone, Copy, Debug)]
pub struct Falloff {
    pub full_until: f32,
    pub min_at: f32,
    pub min_mult: f32,
}

#[derive(Clone, Copy, Debug)]
pub struct WeaponDef {
    pub id: u8,
    pub damage: f32,
    pub rpm: f32,
    pub mag: u16,
    pub reserve: u16,
    pub automatic: bool,
    pub pellets: u8,
    pub spread: f32,
    pub ads_spread: f32,
    pub recoil_pitch: f32,
    pub recoil_yaw: f32,
    pub reload_time: f32,
    pub range: f32,
    pub headshot_mult: f32,
    pub falloff: Option<Falloff>,
}

pub const SIDEARM: WeaponDef = WeaponDef {
    id: ID_SIDEARM,
    damage: 26.0,
    rpm: 320.0,
    mag: 12,
    reserve: 60,
    automatic: false,
    pellets: 1,
    spread: 0.005,
    ads_spread: 0.0015,
    recoil_pitch: 0.016,
    recoil_yaw: 0.004,
    reload_time: 1.05,
    range: 90.0,
    headshot_mult: 2.0,
    falloff: None,
};

pub const CARBINE: WeaponDef = WeaponDef {
    id: ID_CARBINE,
    damage: 15.0,
    rpm: 660.0,
    mag: 30,
    reserve: 120,
    automatic: true,
    pellets: 1,
    spread: 0.019,
    ads_spread: 0.009,
    recoil_pitch: 0.0075,
    recoil_yaw: 0.0045,
    reload_time: 1.55,
    range: 80.0,
    headshot_mult: 2.0,
    falloff: None,
};

/// Ocho perdigones por disparo; el daño es por perdigón, así que el cono reparte el daño.
pub const SHOTGUN: WeaponDef = WeaponDef {
    id: ID_SHOTGUN,
    damage: 6.0,
    rpm: 70.0,
    mag: 6,
    reserve: 24,
    automatic: false,
    pellets: 8,
    spread: 0.085,
    ads_spread: 0.06,
    recoil_pitch: 0.03,
    recoil_yaw: 0.008,
    reload_time: 2.0,
    range: 24.0,
    headshot_mult: 1.15,
    falloff: Some(Falloff {
        full_until: 6.0,
        min_at: 20.0,
        min_mult: 0.25,
    }),
};

pub fn def(id: u8) -> &'static WeaponDef {
    match id {
        ID_CARBINE => &CARBINE,
        ID_SHOTGUN => &SHOTGUN,
        _ => &SIDEARM,
    }
}

/// Multiplicador de daño a `dist` metros. Las armas sin caída devuelven 1 exacto.
pub fn falloff_mult(def: &WeaponDef, dist: f32) -> f32 {
    let Some(f) = def.falloff else {
        return 1.0;
    };
    if dist <= f.full_until {
        1.0
    } else if dist >= f.min_at {
        f.min_mult
    } else {
        let t = (dist - f.full_until) / (f.min_at - f.full_until);
        1.0 + (f.min_mult - 1.0) * t
    }
}

/// Seconds between shots.
pub fn interval(def: &WeaponDef) -> f32 {
    if def.rpm <= 0.0 {
        return 1.0;
    }
    60.0 / def.rpm
}

/// Whether a trigger change should produce a shot.
pub fn wants_shot(def: &WeaponDef, fire_held: bool, fire_pressed: bool) -> bool {
    if def.automatic {
        fire_held
    } else {
        fire_pressed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sidearm_is_semianutomatic() {
        assert!(!wants_shot(&SIDEARM, true, false));
        assert!(wants_shot(&SIDEARM, false, true));
    }

    #[test]
    fn carbine_is_automatic() {
        assert!(wants_shot(&CARBINE, true, false));
    }

    #[test]
    fn unknown_weapon_falls_back_to_sidearm() {
        assert_eq!(def(42).id, ID_SIDEARM);
    }

    #[test]
    fn cadence_matches_rpm() {
        assert!((interval(&SIDEARM) - 60.0 / 320.0).abs() < 1e-6);
    }

    #[test]
    fn shotgun_fires_eight_pellets_at_pump_cadence_from_a_six_shell_mag() {
        assert_eq!(SHOTGUN.pellets, 8);
        assert_eq!(SHOTGUN.mag, 6);
        assert!((interval(&SHOTGUN) - 60.0 / 70.0).abs() < 1e-6);
        assert!(
            !wants_shot(&SHOTGUN, true, false),
            "pump action is not automatic"
        );
    }

    #[test]
    fn shotgun_falloff_is_full_close_quarter_far_and_linear_between() {
        assert_eq!(falloff_mult(&SHOTGUN, 0.0), 1.0);
        assert_eq!(falloff_mult(&SHOTGUN, 6.0), 1.0);
        assert!((falloff_mult(&SHOTGUN, 13.0) - 0.625).abs() < 1e-6);
        assert_eq!(falloff_mult(&SHOTGUN, 20.0), 0.25);
        assert_eq!(falloff_mult(&SHOTGUN, 40.0), 0.25);
    }

    #[test]
    fn rifles_have_no_falloff() {
        assert_eq!(falloff_mult(&SIDEARM, 60.0), 1.0);
        assert_eq!(falloff_mult(&CARBINE, 60.0), 1.0);
    }

    #[test]
    fn data_tables_are_sane() {
        for d in [SIDEARM, CARBINE, SHOTGUN] {
            assert!(d.damage > 0.0);
            assert!(d.mag > 0);
            assert!(d.reserve >= d.mag);
            assert!(d.spread >= 0.0 && d.ads_spread <= d.spread);
            assert!(d.reload_time > 0.0);
        }
    }
}
