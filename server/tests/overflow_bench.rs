//! Native synthetic stress benchmark: cargo test --release -p bp-server --test overflow_bench -- --ignored --nocapture

use std::time::{Duration, Instant};

use bp_core::{Game, Input, MODE_OVERFLOW, PLAYING};

#[test]
#[ignore = "native stress benchmark; run in release mode"]
fn overflow_through_wave_30() {
    const LAST_WAVE: u32 = 30;
    const SEED: u32 = 4242;
    // Map 2 mixes all three robot types. Let real spawns and AI run for two
    // seconds at each wave's peak (queue drained or all live slots full).
    const PEAK_TICKS: u32 = 120;
    let mut game = Game::new(SEED);
    assert!(game.start(MODE_OVERFLOW, 2, SEED, 0));
    let mut max_alive = 0;
    let mut busy_ticks = 0;
    let mut step_time = Duration::ZERO;
    let mut cleared_waves = 0;
    let mut wave_30_queue = 0;
    let wall_start = Instant::now();
    loop {
        assert!(
            game.tick < 200_000,
            "Overflow stalled before clearing wave 30"
        );
        // Benchmark fixture only: no human-input or survivability claim.
        game.player.hp = game.player.hp_max;
        let step_start = Instant::now();
        game.step(Input::default());
        step_time += step_start.elapsed();
        assert_eq!(game.phase, PLAYING);
        let alive = game.alive_count();
        max_alive = max_alive.max(alive);
        if game.waves.wave == LAST_WAVE {
            wave_30_queue = game.waves.queue_len;
        }
        if !game.waves.running || alive == 0 {
            continue;
        }
        let drained = game.waves.queued() == 0;
        if drained || alive as usize == game.waves.alive_target() {
            busy_ticks += 1;
            if busy_ticks == PEAK_TICKS {
                // Retire only enough to unblock spawns when the queue exceeds
                // the live cap; retire the whole wave once it has spawned.
                let retire = if drained { alive } else { alive / 2 };
                for enemy in game
                    .enemies
                    .iter_mut()
                    .filter(|enemy| enemy.is_alive())
                    .take(retire as usize)
                {
                    assert!(enemy.hurt(f32::MAX));
                }
                busy_ticks = 0;
                if drained {
                    cleared_waves += 1;
                    if game.waves.wave == LAST_WAVE {
                        break;
                    }
                }
            }
        }
    }
    let wall = wall_start.elapsed();
    assert_eq!(cleared_waves, LAST_WAVE);
    println!(
        "overflow wave={} queue={} ticks={} max_alive={} avg_tick_us={:.3} wall_ms={:.3}",
        game.waves.wave,
        wave_30_queue,
        game.tick,
        max_alive,
        step_time.as_secs_f64() * 1_000_000.0 / f64::from(game.tick),
        wall.as_secs_f64() * 1_000.0,
    );
}
