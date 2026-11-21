//! Derivación del tablero desde la cabecera verificada y el resultado. Sin reloj: la hora
//! llega como `now_unix` para que los tests sean deterministas.

use bp_core::{
    Header, Outcome, LOSE, MAP_COUNT, MAX_TICKS, MODE_DAILY, MODE_MISSION, MODE_OVERFLOW, WIN,
};

use crate::error::ApiError;

// Las fases llegan como `f32` desde el núcleo; el resultado las guarda como `u8`.
const PHASE_WIN: u8 = WIN as u8;
const PHASE_LOSE: u8 = LOSE as u8;

const OVERFLOW_BOARD: &str = "overflow";
const OVERFLOW_MIN_TICKS: u32 = 60;
const SECONDS_PER_DAY: u64 = 86_400;

/// Tablero de una partida verificada. Práctica y derrotas de misión no cuentan.
pub fn derive_board(header: &Header, outcome: &Outcome, now_unix: u64) -> Result<String, ApiError> {
    match header.mode {
        MODE_MISSION => {
            if !outcome.won {
                return Err(ApiError::NotQualified);
            }
            mission_key(header.map).ok_or(ApiError::NotQualified)
        }
        MODE_OVERFLOW => {
            // One second excludes stubs; a kill or a natural death (Overflow's only
            // LOSE condition) comes from the sim, not from padding or stopping the log.
            // Death lets a short, unsuccessful run qualify without requiring a kill.
            if outcome.ticks < OVERFLOW_MIN_TICKS
                || (outcome.kills == 0 && outcome.phase != PHASE_LOSE)
            {
                return Err(ApiError::NotQualified);
            }
            Ok(OVERFLOW_BOARD.to_string())
        }
        MODE_DAILY => {
            if !ended_for_scoring(header, outcome) {
                return Err(ApiError::NotQualified);
            }
            daily_board(header.seed, now_unix)
        }
        // Práctica (y cualquier modo desconocido) nunca entra a un tablero.
        _ => Err(ApiError::NotQualified),
    }
}

/// Regla del techo (`docs/architecture.md`, "Registro de partidas y truncamiento"). Un registro
/// que llega a `MAX_TICKS` con la partida todavía en curso se puntúa como terminado al final del
/// registro. Eso no convierte una partida en victoria: misión sigue exigiendo `won`.
fn ended_for_scoring(header: &Header, outcome: &Outcome) -> bool {
    outcome.phase == PHASE_WIN || outcome.phase == PHASE_LOSE || header.ticks == MAX_TICKS
}

fn mission_key(map: u8) -> Option<String> {
    (map < MAP_COUNT).then(|| format!("mission:s{:02}", u32::from(map) + 1))
}

/// Claves válidas para `GET /api/leaderboard`.
pub fn is_known_board(key: &str, now_unix: u64) -> bool {
    if key == OVERFLOW_BOARD {
        return true;
    }
    if (0..MAP_COUNT).any(|map| mission_key(map).as_deref() == Some(key)) {
        return true;
    }
    key.strip_prefix("daily:")
        .and_then(seed_of_date)
        .is_some_and(|seed| daily_board(seed, now_unix).is_ok())
}

/// `YYYY-MM-DD` a la semilla `YYYYMMDD`, solo si es una fecha que el núcleo acepta.
fn seed_of_date(text: &str) -> Option<u32> {
    if text.len() != 10 || text.get(4..5) != Some("-") || text.get(7..8) != Some("-") {
        return None;
    }
    let compact = [text.get(0..4)?, text.get(5..7)?, text.get(8..10)?].concat();
    if !compact.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    let seed = compact.parse::<u32>().ok()?;
    bp_core::is_valid_date(seed).then_some(seed)
}

/// La semilla diaria es la fecha UTC como `YYYYMMDD`, y solo vale hoy o ayer.
fn daily_board(seed: u32, now_unix: u64) -> Result<String, ApiError> {
    let today = i64::try_from(now_unix / SECONDS_PER_DAY).map_err(|_| ApiError::NotQualified)?;
    for days in [today, today - 1] {
        let (year, month, day) = civil_from_days(days);
        if yyyymmdd(year, month, day) == Some(seed) {
            return Ok(format!("daily:{year:04}-{month:02}-{day:02}"));
        }
    }
    Err(ApiError::NotQualified)
}

fn yyyymmdd(year: i64, month: u32, day: u32) -> Option<u32> {
    let year = u32::try_from(year).ok()?;
    year.checked_mul(10_000)?.checked_add(month * 100 + day)
}

/// Inverso de la conversión a días desde 1970-01-01 (algoritmo de Howard Hinnant, dominio
/// público): (año, mes, día) en UTC.
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
    use bp_core::MODE_PRACTICE;

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

    /// Cabecera con un registro corto (lejos del techo).
    fn header(mode: u8, map: u8, seed: u32) -> Header {
        Header {
            mode,
            map,
            flags: 0,
            seed,
            ticks: 1_200,
        }
    }

    /// Cabecera de un registro que llegó al techo de `MAX_TICKS`.
    fn at_cap(mode: u8, map: u8, seed: u32) -> Header {
        Header {
            ticks: MAX_TICKS,
            ..header(mode, map, seed)
        }
    }

    const PLAYING: u8 = bp_core::PLAYING as u8;
    const EXTRACTION: u8 = bp_core::EXTRACTION as u8;

    #[test]
    fn civil_dates_match_known_points() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(11_017), (2000, 3, 1));
        assert_eq!(civil_from_days(20_777), (2026, 11, 20));
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
            derive_board(&header(MODE_MISSION, 0, 1), &won, NOW),
            Ok("mission:s01".into())
        );
        assert_eq!(
            derive_board(&header(MODE_MISSION, 2, 1), &won, NOW),
            Ok("mission:s03".into())
        );
    }

    #[test]
    fn mission_loss_does_not_qualify() {
        let lost = outcome(PHASE_LOSE, false);
        assert_eq!(
            derive_board(&header(MODE_MISSION, 0, 1), &lost, NOW),
            Err(ApiError::NotQualified)
        );
    }

    #[test]
    fn mission_on_an_unknown_sector_does_not_qualify() {
        let won = outcome(PHASE_WIN, true);
        assert_eq!(
            derive_board(&header(MODE_MISSION, MAP_COUNT, 1), &won, NOW),
            Err(ApiError::NotQualified)
        );
    }

    #[test]
    fn one_kill_overflow_at_the_minimum_qualifies_without_death() {
        let one_kill = Outcome {
            ticks: 60,
            kills: 1,
            ..outcome(PLAYING, false)
        };
        assert_eq!(
            derive_board(&header(MODE_OVERFLOW, 0, 1), &one_kill, NOW),
            Ok("overflow".into())
        );
    }

    #[test]
    fn overflow_requires_both_simulated_ticks_and_a_real_outcome() {
        let mut outcome = Outcome {
            ticks: 59,
            kills: 1,
            ..outcome(PLAYING, false)
        };
        let header = header(MODE_OVERFLOW, 0, 1);
        assert_eq!(
            derive_board(&header, &outcome, NOW),
            Err(ApiError::NotQualified)
        );
        outcome.ticks = 60;
        outcome.kills = 0;
        assert_eq!(
            derive_board(&header, &outcome, NOW),
            Err(ApiError::NotQualified)
        );
    }

    #[test]
    fn daily_counts_win_or_lose_on_the_seed_date() {
        let won = outcome(PHASE_WIN, true);
        let lost = outcome(PHASE_LOSE, false);
        assert_eq!(
            derive_board(&header(MODE_DAILY, 0, 20_261_120), &won, NOW),
            Ok("daily:2026-11-20".into())
        );
        assert_eq!(
            derive_board(&header(MODE_DAILY, 0, 20_261_120), &lost, NOW),
            Ok("daily:2026-11-20".into())
        );
    }

    #[test]
    fn daily_accepts_yesterday_and_names_the_board_after_the_seed_date() {
        let lost = outcome(PHASE_LOSE, false);
        assert_eq!(
            derive_board(&header(MODE_DAILY, 0, 20_261_119), &lost, NOW),
            Ok("daily:2026-11-19".into())
        );
    }

    #[test]
    fn daily_rejects_other_days_and_tomorrow() {
        let lost = outcome(PHASE_LOSE, false);
        for seed in [20_260_101, 20_261_118, 20_261_121] {
            assert_eq!(
                derive_board(&header(MODE_DAILY, 0, seed), &lost, NOW),
                Err(ApiError::NotQualified)
            );
        }
    }

    #[test]
    fn daily_rejects_seeds_that_are_not_calendar_dates() {
        let lost = outcome(PHASE_LOSE, false);
        assert_eq!(
            derive_board(&header(MODE_DAILY, 0, 20_261_132), &lost, NOW),
            Err(ApiError::NotQualified)
        );
    }

    #[test]
    fn daily_run_still_playing_below_the_cap_does_not_count() {
        let playing = outcome(PLAYING, false);
        assert_eq!(
            derive_board(&header(MODE_DAILY, 0, 20_261_120), &playing, NOW),
            Err(ApiError::NotQualified)
        );
    }

    #[test]
    fn practice_never_counts() {
        let won = outcome(PHASE_WIN, true);
        let lost = outcome(PHASE_LOSE, false);
        assert_eq!(
            derive_board(&header(MODE_PRACTICE, 0, 1), &won, NOW),
            Err(ApiError::NotQualified)
        );
        assert_eq!(
            derive_board(&header(MODE_PRACTICE, 0, 1), &lost, NOW),
            Err(ApiError::NotQualified)
        );
    }

    #[test]
    fn cap_rule_counts_a_daily_still_playing_at_the_tick_cap() {
        let playing = outcome(PLAYING, false);
        assert_eq!(
            derive_board(&at_cap(MODE_DAILY, 0, 20_261_120), &playing, NOW),
            Ok("daily:2026-11-20".into())
        );
    }

    #[test]
    fn cap_rule_counts_an_extraction_still_running_at_the_cap() {
        let extracting = outcome(EXTRACTION, false);
        assert_eq!(
            derive_board(&at_cap(MODE_DAILY, 0, 20_261_120), &extracting, NOW),
            Ok("daily:2026-11-20".into())
        );
    }

    #[test]
    fn cap_rule_is_only_for_logs_that_reach_the_cap() {
        let playing = outcome(PLAYING, false);
        let one_short = Header {
            ticks: MAX_TICKS - 1,
            ..header(MODE_DAILY, 0, 20_261_120)
        };
        assert_eq!(
            derive_board(&one_short, &playing, NOW),
            Err(ApiError::NotQualified)
        );
    }

    #[test]
    fn cap_rule_does_not_turn_a_mission_still_playing_into_a_win() {
        let playing = outcome(PLAYING, false);
        assert_eq!(
            derive_board(&at_cap(MODE_MISSION, 0, 1), &playing, NOW),
            Err(ApiError::NotQualified)
        );
    }

    #[test]
    fn cap_rule_accepts_qualified_overflow_but_not_practice() {
        let playing = Outcome {
            ticks: MAX_TICKS,
            ..outcome(PLAYING, false)
        };
        let one_kill = Outcome {
            kills: 1,
            ..playing.clone()
        };
        assert_eq!(
            derive_board(&at_cap(MODE_OVERFLOW, 0, 1), &one_kill, NOW),
            Ok("overflow".into())
        );
        assert_eq!(
            derive_board(&at_cap(MODE_OVERFLOW, 0, 1), &playing, NOW),
            Err(ApiError::NotQualified)
        );
        assert_eq!(
            derive_board(&at_cap(MODE_PRACTICE, 0, 1), &playing, NOW),
            Err(ApiError::NotQualified)
        );
    }

    #[test]
    fn daily_window_follows_the_clock_across_utc_midnight() {
        let lost = outcome(PHASE_LOSE, false);
        let just_after_midnight = 1_795_132_800 + 60;
        assert_eq!(
            derive_board(
                &header(MODE_DAILY, 0, 20_261_120),
                &lost,
                just_after_midnight
            ),
            Ok("daily:2026-11-20".into())
        );
        let just_before_midnight = 1_795_132_800 - 1;
        assert_eq!(
            derive_board(
                &header(MODE_DAILY, 0, 20_261_119),
                &lost,
                just_before_midnight
            ),
            Ok("daily:2026-11-19".into())
        );
        assert_eq!(
            derive_board(
                &header(MODE_DAILY, 0, 20_261_120),
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
            "daily:2026-11-19",
        ] {
            assert!(is_known_board(key, NOW), "{key} should be known");
        }
        for key in [
            "practice",
            "mission:s04",
            "mission:s00",
            "daily:2026-02-29",
            "daily:2026-13-01",
            "daily:2026-11-2",
            "daily:2026-11-20T",
            "daily:1999-01-01",
            "daily:+026-11-20",
            "daily:2026-1+-20",
            "Overflow",
            "",
        ] {
            assert!(!is_known_board(key, NOW), "{key} should be rejected");
        }
    }
}
