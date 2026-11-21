//! Superficie pública de `bp_core` que usa el crate de API. Este archivo compila desde fuera
//! del crate: si una reexportación desaparece, el test deja de compilar.

use bp_core::{
    daily_config, decode, is_valid_date, phase, run, Game, Input, Log, Outcome, MAP_COUNT,
    MAX_TICKS, MODE_DAILY, MODE_MISSION, MODE_OVERFLOW, MODE_PRACTICE, OVERFLOW_SCORE_VERSION,
    SCORE_VERSION,
};

#[test]
fn mode_score_and_phase_constants_are_exported() {
    assert_eq!(
        (MODE_MISSION, MODE_OVERFLOW, MODE_DAILY, MODE_PRACTICE),
        (0, 1, 2, 3)
    );
    assert_eq!((SCORE_VERSION, OVERFLOW_SCORE_VERSION), (3, 3));
    assert_eq!(MAP_COUNT, 3);
    assert_eq!(MAX_TICKS, 72_000);
    assert_eq!(phase::PLAYING, 1.0);
    assert_eq!(phase::WIN, 3.0);
    assert_eq!(phase::LOSE, 4.0);
    // Las mismas constantes, por la ruta de la raíz que usa el crate de API.
    assert_eq!(
        (
            bp_core::PLAYING,
            bp_core::EXTRACTION,
            bp_core::WIN,
            bp_core::LOSE
        ),
        (phase::PLAYING, phase::EXTRACTION, phase::WIN, phase::LOSE)
    );
}

#[test]
fn abi_reports_the_active_score_version_and_encodes_v3_logs() {
    bp_core::bp_init(5);
    for (mode, version) in [(MODE_MISSION, SCORE_VERSION), (MODE_OVERFLOW, OVERFLOW_SCORE_VERSION)] {
        assert_eq!(bp_core::bp_start(u32::from(mode), 0, 5, 0), 1);
        assert_eq!(bp_core::bp_score_version(), u32::from(version));
        assert!(bp_core::bp_log_encode() >= 16);
        assert_eq!(unsafe { *bp_core::bp_log_ptr().add(4) }, 3);
    }
}

#[test]
fn a_live_run_round_trips_through_the_public_log_api() {
    let mut g = Game::new(9);
    // El host arma el registro antes de iniciar la partida (como hace `bp_start`).
    g.enable_recording();
    assert!(g.start(MODE_MISSION, 0, 9, 0));
    for _ in 0..120 {
        g.step(Input::default());
    }
    let len = g.encode_log();
    assert_eq!(len, g.log_out.len());

    let log: Log = decode(&g.log_out).expect("the live log decodes");
    assert_eq!(
        (log.header.mode, log.header.map, log.header.seed),
        (MODE_MISSION, 0, 9)
    );
    let outcome: Outcome = run(&log).expect("the live log replays");
    assert_eq!(outcome.ticks, 120);
    assert_eq!(outcome.score, g.final_score());
    assert_eq!(outcome.phase, g.phase as u8);
    assert!(!g.log_truncated());
}

#[test]
fn fifty_weapon_switches_cannot_exceed_the_starting_ammo_budget() {
    use bp_core::FLAG_AUTO_RELOAD;

    let mut g = Game::new(5);
    assert!(g.start(MODE_OVERFLOW, 0, 5, FLAG_AUTO_RELOAD));
    g.waves.running = false; // Isolate weapons from combat; use normal fixed steps and reloads.

    for t in 0..50 {
        let switch = if t % 2 == 0 { 2 } else { 1 };
        g.step(Input {
            switch,
            ..Input::default()
        });
        for _ in 0..600 {
            g.step(Input {
                fire_held: true,
                fire_pressed: true,
                ..Input::default()
            });
        }
    }
    // PB-01: 12 + 60, AR-04: 30 + 120. Equality also proves both reserves were spent.
    assert_eq!(g.shots, 222);
}

#[test]
fn daily_config_is_a_pure_export_and_drives_the_daily_start() {
    assert_eq!(daily_config(20_261_120), (2, 3));
    assert!(is_valid_date(20_261_120));
    assert!(!is_valid_date(20_261_332));

    let mut g = Game::new(1);
    assert!(g.start(MODE_DAILY, 0, 20_261_120, 0));
    assert_eq!(g.map_id, daily_config(20_261_120).0);
}

#[test]
fn overflow_past_the_tick_limit_marks_the_log_truncated_but_still_decodes() {
    let mut g = Game::new(5);
    g.enable_recording();
    assert!(g.start(MODE_OVERFLOW, 0, 5, 0));
    for _ in 0..=MAX_TICKS {
        g.player.hp = g.player.hp_max;
        g.step(Input::default());
    }
    assert_eq!(g.phase, phase::PLAYING, "overflow never ends without death");
    assert!(g.log_truncated());

    g.encode_log();
    let log = decode(&g.log_out).expect("a truncated log is well formed");
    assert_eq!(log.header.ticks, MAX_TICKS);
}

#[test]
fn a_capped_log_replays_to_the_cap_with_the_run_still_playing() {
    // El operador de Overflow solo sobrevive con el arnés, y su vida no se graba: su replay
    // divergería. Práctica nunca termina y no usa arnés, así que prueba la señal del servidor:
    // header.ticks == MAX_TICKS con la partida todavía en PLAYING.
    let mut g = Game::new(5);
    g.enable_recording();
    assert!(g.start(MODE_PRACTICE, 0, 5, 0));
    for _ in 0..=MAX_TICKS {
        g.step(Input::default());
    }
    assert!(g.log_truncated());
    g.encode_log();
    let log = decode(&g.log_out).expect("the capped log decodes");
    assert_eq!(log.header.ticks, MAX_TICKS);
    let outcome = run(&log).expect("the capped prefix replays");
    assert_eq!(outcome.ticks, MAX_TICKS);
    assert_eq!(outcome.phase, phase::PLAYING as u8);
}
