//! Desafío diario: la fecha UTC (`yyyymmdd`) fija el mapa y el mutador.
//!
//! Solo aritmética entera (sin flotantes): el servidor y cada cliente tienen que
//! derivar exactamente la misma configuración a partir de la fecha.

use crate::maps::MAP_COUNT;
use crate::waves::Composition;

pub const MUTATOR_NONE: u8 = 0;
/// Más enemigos y con menos vida.
pub const MUTATOR_SWARM: u8 = 1;
/// Vida máxima del jugador a la mitad.
pub const MUTATOR_GLASS: u8 = 2;
/// Enemigos más resistentes y menos, con reserva de munición doble.
pub const MUTATOR_IRONHIDE: u8 = 3;
const MUTATOR_COUNT: u32 = 3;

/// Efectos de un mutador. Porcentajes y fracciones enteras para no depender de flotantes.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rules {
    /// Vida de los enemigos en porcentaje de su vida base.
    pub enemy_hp_pct: u32,
    /// Cantidad de enemigos por oleada: `n * count_num / count_den`, mínimo 1 si `n > 0`.
    pub count_num: u32,
    pub count_den: u32,
    pub player_hp_max: f32,
    /// Factor entero sobre la reserva de munición de cada arma.
    pub reserve_mult: u16,
}

pub fn rules(mutator: u8) -> Rules {
    match mutator {
        MUTATOR_SWARM => Rules {
            enemy_hp_pct: 70,
            count_num: 3,
            count_den: 2,
            player_hp_max: 100.0,
            reserve_mult: 1,
        },
        MUTATOR_GLASS => Rules {
            enemy_hp_pct: 100,
            count_num: 1,
            count_den: 1,
            player_hp_max: 50.0,
            reserve_mult: 1,
        },
        MUTATOR_IRONHIDE => Rules {
            enemy_hp_pct: 150,
            count_num: 2,
            count_den: 3,
            player_hp_max: 100.0,
            reserve_mult: 2,
        },
        _ => Rules {
            enemy_hp_pct: 100,
            count_num: 1,
            count_den: 1,
            player_hp_max: 100.0,
            reserve_mult: 1,
        },
    }
}

impl Rules {
    pub fn scale(&self, c: Composition) -> Composition {
        Composition {
            scouts: self.count(c.scouts),
            sentinels: self.count(c.sentinels),
            interceptors: self.count(c.interceptors),
        }
    }

    fn count(&self, n: u32) -> u32 {
        if n == 0 {
            0
        } else {
            (n * self.count_num / self.count_den).max(1)
        }
    }
}

/// Mapa y mutador del desafío de la fecha `yyyymmdd`. El mutador nunca es `MUTATOR_NONE`.
pub fn daily_config(date: u32) -> (u8, u8) {
    let h = mix(date);
    let map = (h % MAP_COUNT as u32) as u8;
    let mutator = MUTATOR_SWARM + ((h / MAP_COUNT as u32) % MUTATOR_COUNT) as u8;
    (map, mutator)
}

/// Fecha `yyyymmdd` del calendario gregoriano, años 2000 a 2999.
pub fn is_valid_date(date: u32) -> bool {
    let (y, m, d) = (date / 10_000, date / 100 % 100, date % 100);
    (2000..=2999).contains(&y) && (1..=12).contains(&m) && (1..=days_in_month(y, m)).contains(&d)
}

fn days_in_month(year: u32, month: u32) -> u32 {
    match month {
        2 if is_leap(year) => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

fn is_leap(year: u32) -> bool {
    year.is_multiple_of(4) && (!year.is_multiple_of(100) || year.is_multiple_of(400))
}

/// Finalizador de 32 bits (estilo murmur3): difunde la fecha sin depender de flotantes.
fn mix(date: u32) -> u32 {
    let mut x = date.wrapping_mul(0x9E37_79B1);
    x ^= x >> 16;
    x = x.wrapping_mul(0x85EB_CA6B);
    x ^= x >> 13;
    x = x.wrapping_mul(0xC2B2_AE35);
    x ^ (x >> 16)
}

/// Todas las fechas válidas de 2026, en orden.
#[cfg(test)]
pub fn calendar_2026() -> impl Iterator<Item = u32> {
    (1..=12u32)
        .flat_map(|m| (1..=31u32).map(move |d| 20_260_000 + m * 100 + d))
        .filter(|&date| is_valid_date(date))
}

/// Primera fecha de 2026 cuyo desafío trae ese mutador.
#[cfg(test)]
pub fn date_with_mutator(mutator: u8) -> u32 {
    calendar_2026()
        .find(|&date| daily_config(date).1 == mutator)
        .expect("every mutator appears in a year of dates")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_date_gives_the_same_config() {
        assert_eq!(daily_config(20261120), daily_config(20261120));
    }

    #[test]
    fn pinned_config_for_a_known_date() {
        // Regresión: cambiar la mezcla cambia el desafío de todos los jugadores.
        assert_eq!(daily_config(20261120), (2, 3));
    }

    #[test]
    fn config_is_always_in_range() {
        for date in calendar_2026() {
            let (map, mutator) = daily_config(date);
            assert!(map < MAP_COUNT, "{date}");
            assert!(
                (MUTATOR_SWARM..=MUTATOR_IRONHIDE).contains(&mutator),
                "{date}"
            );
        }
    }

    #[test]
    fn a_year_of_dates_covers_every_map_and_mutator() {
        let configs: Vec<(u8, u8)> = calendar_2026().map(daily_config).collect();
        for map in 0..MAP_COUNT {
            assert!(configs.iter().any(|c| c.0 == map), "map {map} never picked");
        }
        for mutator in MUTATOR_SWARM..=MUTATOR_IRONHIDE {
            assert!(
                configs.iter().any(|c| c.1 == mutator),
                "mutator {mutator} never picked"
            );
        }
    }

    #[test]
    fn date_validation_follows_the_gregorian_calendar() {
        assert!(is_valid_date(20261120));
        assert!(is_valid_date(20240229), "2024 is a leap year");
        assert!(is_valid_date(20261231));
        assert!(!is_valid_date(20230229));
        assert!(!is_valid_date(20260431), "April has 30 days");
        assert!(!is_valid_date(20261301));
        assert!(!is_valid_date(20260000));
        assert!(!is_valid_date(19991231));
        assert!(!is_valid_date(30000101));
    }

    #[test]
    fn swarm_adds_enemies_and_ironhide_removes_them_but_never_to_zero() {
        let base = Composition {
            scouts: 4,
            sentinels: 2,
            interceptors: 0,
        };
        let swarm = rules(MUTATOR_SWARM).scale(base);
        assert_eq!((swarm.scouts, swarm.sentinels), (6, 3));
        let iron = rules(MUTATOR_IRONHIDE).scale(base);
        assert_eq!((iron.scouts, iron.sentinels), (2, 1));
        assert_eq!(iron.interceptors, 0, "an empty kind stays empty");
        let lone = rules(MUTATOR_IRONHIDE).scale(Composition {
            scouts: 1,
            sentinels: 0,
            interceptors: 0,
        });
        assert_eq!(lone.scouts, 1, "a non-empty kind keeps at least one");
    }

    #[test]
    fn no_mutator_leaves_the_composition_unchanged() {
        let c = Composition {
            scouts: 7,
            sentinels: 3,
            interceptors: 2,
        };
        assert_eq!(rules(MUTATOR_NONE).scale(c), c);
    }
}
