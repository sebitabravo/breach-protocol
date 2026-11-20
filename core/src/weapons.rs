//! Weapon data tables. Balance lives in data, not in the shooting code.

pub const ID_SIDEARM: u8 = 1;
pub const ID_CARBINE: u8 = 2;

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
};

pub fn def(id: u8) -> &'static WeaponDef {
    match id {
        ID_CARBINE => &CARBINE,
        _ => &SIDEARM,
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
    fn data_tables_are_sane() {
        for d in [SIDEARM, CARBINE] {
            assert!(d.damage > 0.0);
            assert!(d.mag > 0);
            assert!(d.reserve >= d.mag);
            assert!(d.spread >= 0.0 && d.ads_spread <= d.spread);
            assert!(d.reload_time > 0.0);
        }
    }
}
