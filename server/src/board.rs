//! Derivación del tablero desde la cabecera verificada y el resultado. Sin reloj: la hora
//! llega como `now_unix` para que los tests sean deterministas.

use bp_core::Outcome;

use crate::error::ApiError;

// Espejo de `core/src/sim.rs` y `core/src/protocol.rs`: esas constantes no están exportadas.
pub const MODE_MISSION: u8 = 0;
pub const MODE_OVERFLOW: u8 = 1;
pub const MODE_DAILY: u8 = 2;
pub const MODE_PRACTICE: u8 = 3;
const PHASE_WIN: u8 = 3;
const PHASE_LOSE: u8 = 4;

const MISSION_BOARDS: [&str; 3] = ["mission:s01", "mission:s02", "mission:s03"];
const OVERFLOW_BOARD: &str = "overflow";
const SECONDS_PER_DAY: u64 = 86_400;

/// Campos de la cabecera BPL1 que deciden el tablero.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RunHeader {
    pub mode: u8,
    pub map: u8,
    pub seed: u32,
}

/// Tablero de una partida verificada. Práctica y derrotas de misión no cuentan.
pub fn derive_board(
    header: RunHeader,
    outcome: &Outcome,
    now_unix: u64,
) -> Result<String, ApiError> {
    match header.mode {
        MODE_MISSION => {
            if !outcome.won {
                return Err(ApiError::NotQualified);
            }
            MISSION_BOARDS
                .get(usize::from(header.map))
                .map(|key| (*key).to_string())
                .ok_or(ApiError::NotQualified)
        }
        MODE_OVERFLOW => Ok(OVERFLOW_BOARD.to_string()),
        MODE_DAILY => {
            if outcome.phase != PHASE_WIN && outcome.phase != PHASE_LOSE {
                return Err(ApiError::NotQualified);
            }
            daily_board(header.seed, now_unix)
        }
        // Práctica (y cualquier modo desconocido) nunca entra a un tablero.
        _ => Err(ApiError::NotQualified),
    }
}

/// Claves válidas para `GET /api/leaderboard`.
pub fn is_known_board(key: &str) -> bool {
    if key == OVERFLOW_BOARD || MISSION_BOARDS.contains(&key) {
        return true;
    }
    key.strip_prefix("daily:").is_some_and(is_real_date)
}

/// La semilla diaria es la fecha UTC como `YYYYMMDD`, y solo vale hoy o ayer.
fn daily_board(seed: u32, now_unix: u64) -> Result<String, ApiError> {
    let today = i64::try_from(now_unix / SECONDS_PER_DAY).map_err(|_| ApiError::NotQualified)?;
    for days in [today, today - 1] {
        let (year, month, day) = civil_from_days(days);
        if year_month_day_to_seed(year, month, day) == seed {
            return Ok(format!("daily:{year:04}-{month:02}-{day:02}"));
        }
    }
    Err(ApiError::NotQualified)
}

fn year_month_day_to_seed(year: i64, month: u32, day: u32) -> u32 {
    // Año < 0 no ocurre en el rango que aceptamos; el cast a u32 no puede envolver aquí.
    u32::try_from(year).unwrap_or(0) * 10_000 + month * 100 + day
}

fn is_real_date(text: &str) -> bool {
    let bytes = text.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return false;
    }
    let parse = |range: std::ops::Range<usize>| text.get(range).and_then(|s| s.parse::<u32>().ok());
    let (Some(year), Some(month), Some(day)) = (parse(0..4), parse(5..7), parse(8..10)) else {
        return false;
    };
    if !(1..=12).contains(&month) || day == 0 {
        return false;
    }
    let days = days_from_civil(i64::from(year), month, day);
    civil_from_days(days) == (i64::from(year), month, day)
}

/// Días desde 1970-01-01 (algoritmo de Howard Hinnant, dominio público).
pub fn days_from_civil(year: i64, month: u32, day: u32) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y.rem_euclid(400);
    let mp = i64::from(if month > 2 { month - 3 } else { month + 9 });
    let doy = (153 * mp + 2) / 5 + i64::from(day) - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// Inverso de `days_from_civil`: (año, mes, día) en UTC.
pub fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = u32::try_from(doy - (153 * mp + 2) / 5 + 1).unwrap_or(1);
    let month = u32::try_from(if mp < 10 { mp + 3 } else { mp - 9 }).unwrap_or(1);
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 2026-11-20T12:00:00Z
    const NOW: u64 = 1_795_132_800 + 12 * 3600;

    fn outcome(phase: u8, won: bool) -> Outcome {
        Outcome {
            score_version: 1,
            phase,
            won,
            ticks: 1,
            score: 10,
            kills: 0,
            shots: 0,
            hits: 0,
            nodes_active: 0,
            wave: 1,
            damage_taken: 0.0,
            time_elapsed: 0.0,
            hash: 0xabc,
        }
    }

    fn header(mode: u8, map: u8, seed: u32) -> RunHeader {
        RunHeader { mode, map, seed }
    }

    #[test]
    fn civil_dates_round_trip_known_points() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(11_017), (2000, 3, 1));
        assert_eq!(days_from_civil(2000, 3, 1), 11_017);
        assert_eq!(
            civil_from_days(days_from_civil(2026, 11, 20)),
            (2026, 11, 20)
        );
    }

    #[test]
    fn now_unix_maps_to_the_utc_date_of_the_fixture() {
        let (year, month, day) = civil_from_days((NOW / SECONDS_PER_DAY) as i64);
        assert_eq!((year, month, day), (2026, 11, 20));
    }

    #[test]
    fn mission_counts_only_wins_and_maps_to_its_sector() {
        let won = outcome(PHASE_WIN, true);
        assert_eq!(
            derive_board(header(MODE_MISSION, 0, 1), &won, NOW),
            Ok("mission:s01".into())
        );
        assert_eq!(
            derive_board(header(MODE_MISSION, 2, 1), &won, NOW),
            Ok("mission:s03".into())
        );
    }

    #[test]
    fn mission_loss_does_not_qualify() {
        let lost = outcome(PHASE_LOSE, false);
        assert_eq!(
            derive_board(header(MODE_MISSION, 0, 1), &lost, NOW),
            Err(ApiError::NotQualified)
        );
    }

    #[test]
    fn mission_on_an_unknown_sector_does_not_qualify() {
        let won = outcome(PHASE_WIN, true);
        assert_eq!(
            derive_board(header(MODE_MISSION, 3, 1), &won, NOW),
            Err(ApiError::NotQualified)
        );
    }

    #[test]
    fn overflow_counts_whether_it_ends_in_death_or_at_log_end() {
        let playing = outcome(1, false);
        let lost = outcome(PHASE_LOSE, false);
        assert_eq!(
            derive_board(header(MODE_OVERFLOW, 0, 1), &playing, NOW),
            Ok("overflow".into())
        );
        assert_eq!(
            derive_board(header(MODE_OVERFLOW, 0, 1), &lost, NOW),
            Ok("overflow".into())
        );
    }

    #[test]
    fn daily_counts_win_or_lose_on_the_seed_date() {
        let won = outcome(PHASE_WIN, true);
        let lost = outcome(PHASE_LOSE, false);
        assert_eq!(
            derive_board(header(MODE_DAILY, 0, 20_261_120), &won, NOW),
            Ok("daily:2026-11-20".into())
        );
        assert_eq!(
            derive_board(header(MODE_DAILY, 0, 20_261_120), &lost, NOW),
            Ok("daily:2026-11-20".into())
        );
    }

    #[test]
    fn daily_accepts_yesterday_and_names_the_board_after_the_seed_date() {
        let lost = outcome(PHASE_LOSE, false);
        assert_eq!(
            derive_board(header(MODE_DAILY, 0, 20_261_119), &lost, NOW),
            Ok("daily:2026-11-19".into())
        );
    }

    #[test]
    fn daily_rejects_other_days_and_tomorrow() {
        let lost = outcome(PHASE_LOSE, false);
        for seed in [20_260_101, 20_261_118, 20_261_121] {
            assert_eq!(
                derive_board(header(MODE_DAILY, 0, seed), &lost, NOW),
                Err(ApiError::NotQualified)
            );
        }
    }

    #[test]
    fn daily_rejects_seeds_that_are_not_calendar_dates() {
        let lost = outcome(PHASE_LOSE, false);
        assert_eq!(
            derive_board(header(MODE_DAILY, 0, 20_261_132), &lost, NOW),
            Err(ApiError::NotQualified)
        );
    }

    #[test]
    fn daily_run_still_playing_at_log_end_does_not_count() {
        let playing = outcome(1, false);
        assert_eq!(
            derive_board(header(MODE_DAILY, 0, 20_261_120), &playing, NOW),
            Err(ApiError::NotQualified)
        );
    }

    #[test]
    fn practice_never_counts() {
        let won = outcome(PHASE_WIN, true);
        let lost = outcome(PHASE_LOSE, false);
        assert_eq!(
            derive_board(header(MODE_PRACTICE, 0, 1), &won, NOW),
            Err(ApiError::NotQualified)
        );
        assert_eq!(
            derive_board(header(MODE_PRACTICE, 0, 1), &lost, NOW),
            Err(ApiError::NotQualified)
        );
    }

    #[test]
    fn daily_window_follows_the_clock_across_utc_midnight() {
        let lost = outcome(PHASE_LOSE, false);
        let just_after_midnight = 1_795_132_800 + 60;
        assert_eq!(
            derive_board(
                header(MODE_DAILY, 0, 20_261_120),
                &lost,
                just_after_midnight
            ),
            Ok("daily:2026-11-20".into())
        );
        let just_before_midnight = 1_795_132_800 - 1;
        assert_eq!(
            derive_board(
                header(MODE_DAILY, 0, 20_261_119),
                &lost,
                just_before_midnight
            ),
            Ok("daily:2026-11-19".into())
        );
        assert_eq!(
            derive_board(
                header(MODE_DAILY, 0, 20_261_120),
                &lost,
                just_before_midnight
            ),
            Err(ApiError::NotQualified)
        );
    }

    #[test]
    fn known_board_keys_are_exactly_the_contract_boards() {
        for key in [
            "overflow",
            "mission:s01",
            "mission:s02",
            "mission:s03",
            "daily:2026-11-20",
            "daily:2028-02-29",
        ] {
            assert!(is_known_board(key), "{key} should be known");
        }
        for key in [
            "practice",
            "mission:s04",
            "daily:2026-02-29",
            "daily:2026-13-01",
            "daily:2026-11-2",
            "daily:2026-11-20T",
            "Overflow",
            "",
        ] {
            assert!(!is_known_board(key), "{key} should be rejected");
        }
    }
}
