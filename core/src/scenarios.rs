//! Escenarios guionados de extremo a extremo (solo tests): navegan con entradas
//! reales y comprueban condiciones de partida sin depender de un navegador.

use crate::math::{v3, wrap_pi, V3};
use crate::player::Input;
use crate::protocol::phase;
use crate::sim::{Game, FIXED_DT, MODE_MISSION, NODE_CHANNEL};

/// Controlador mínimo: gira hacia `target` y avanza; salta cuando `jump` es verdadero.
fn drive(g: &mut Game, target: (f32, f32), jump: bool) {
    let dx = target.0 - g.player.pos.x;
    let dz = target.1 - g.player.pos.z;
    let want = crate::enemy::dir_to_yaw(v3(dx, 0.0, dz));
    let err = wrap_pi(want - g.player.yaw);
    let input = Input {
        move_z: if err.abs() < 0.6 { 1.0 } else { 0.0 },
        look_dx: -err.clamp(-0.09, 0.09),
        jump,
        ..Input::default()
    };
    g.step(input);
}

/// Camina hasta `target` (radio 0.35 m) en a lo sumo `max_ticks`. Devuelve si llegó.
fn walk_to(g: &mut Game, target: (f32, f32), max_ticks: u32) -> bool {
    for _ in 0..max_ticks {
        let d = ((g.player.pos.x - target.0).powi(2) + (g.player.pos.z - target.1).powi(2)).sqrt();
        if d < 0.35 {
            return true;
        }
        drive(g, target, false);
    }
    false
}

fn quiet_game(map: u8) -> Game {
    let mut g = Game::new(7);
    assert!(g.start(MODE_MISSION, map, 7, 0));
    // Sin enemigos: estos escenarios prueban geometría, no combate.
    g.waves.queue_head = g.waves.queue_len;
    g
}

#[test]
fn sector_03_catwalk_terminal_is_reachable_on_foot() {
    let mut g = quiet_game(2);
    let route = [
        (-16.5, 15.0),
        (-16.5, 4.0),
        (-16.5, 1.8),
        (-14.0, 1.2),
        (-14.0, -1.2),
        (-16.5, -1.8),
        (-16.5, -4.0),
        (-16.5, -10.6),
    ];
    for wp in route {
        assert!(
            walk_to(&mut g, wp, 900),
            "stuck before {wp:?} at {:?}",
            g.player.pos
        );
    }
    // Escalera: cada peldaño sube 0.7 m, justo el alcance de un salto.
    let mut ticks = 0;
    while !(g.player.grounded && g.player.pos.y > 2.7) && ticks < 900 {
        let grounded = g.player.grounded;
        drive(&mut g, (-16.5, -16.3), grounded && ticks % 12 == 0);
        ticks += 1;
    }
    assert!(
        g.player.grounded && g.player.pos.y > 2.7,
        "never stood on the deck: {:?}",
        g.player.pos
    );
    assert!(
        walk_to(&mut g, (-10.0, -16.3), 900),
        "stuck on the deck at {:?}",
        g.player.pos
    );
    assert!(
        walk_to(&mut g, (0.0, -14.9), 900),
        "cannot reach the terminal at {:?}",
        g.player.pos
    );
    assert!(
        (g.player.pos.y - 2.8).abs() < 0.05,
        "should stand on the deck: {:?}",
        g.player.pos
    );
}

#[test]
fn deck_terminal_ignores_a_player_standing_underneath() {
    let mut g = quiet_game(2);
    g.player.pos = v3(0.0, 0.0, -16.3);
    for _ in 0..((NODE_CHANNEL / FIXED_DT) as u32 + 60) {
        g.step(Input {
            interact: true,
            ..Input::default()
        });
    }
    assert_eq!(
        g.nodes_active, 0,
        "terminal on the deck must not respond from below"
    );
}

#[test]
fn deck_terminal_responds_to_a_player_on_the_deck() {
    let mut g = quiet_game(2);
    g.player.pos = v3(0.0, 2.8, -14.9);
    for _ in 0..((NODE_CHANNEL / FIXED_DT) as u32 + 30) {
        g.step(Input {
            interact: true,
            ..Input::default()
        });
    }
    assert_eq!(g.nodes_active, 1);
}

#[test]
fn activating_every_terminal_then_surviving_extraction_wins_with_a_time_bonus() {
    for map in 0..crate::maps::MAP_COUNT {
        let mut g = quiet_game(map);
        let nodes = g.nodes;
        for n in nodes {
            g.player.pos = V3::new(n.x, n.y, n.z + 1.0);
            g.player.vel = V3::ZERO;
            for _ in 0..((NODE_CHANNEL / FIXED_DT) as u32 + 30) {
                g.step(Input {
                    interact: true,
                    ..Input::default()
                });
            }
        }
        assert_eq!(g.nodes_active, 3, "map {map}");
        assert_eq!(g.phase, phase::EXTRACTION, "map {map}");
        for _ in 0..(13.0 / FIXED_DT) as u32 {
            // Objective waves now spawn; isolate the extraction timer from combat survival.
            g.player.hp = g.player.hp_max;
            g.step(Input::default());
        }
        assert_eq!(g.phase, phase::WIN, "map {map}");
        assert!(
            g.final_score() >= 1500,
            "3 terminals alone are worth 1500, got {}",
            g.final_score()
        );
    }
}

#[test]
fn director_pacing_with_and_without_fast_objectives() {
    let run = |fast: bool| {
        let mut g = Game::new(7);
        assert!(g.start(MODE_MISSION, 0, 7, 0));
        let channel_ticks = (NODE_CHANNEL / FIXED_DT).round() as u32;
        let activation_ticks = [20 * 60, 40 * 60, 60 * 60];
        let mut activations = Vec::new();
        let mut waves = vec![0];
        let mut peak_alive = 0;
        for t in 1..=90 * 60 {
            // Controlled combat: one elimination every two seconds in both cases;
            // restore HP so the comparison measures director pacing, not survival.
            g.player.hp = g.player.hp_max;
            if t % 120 == 0 {
                if let Some(enemy) = g.enemies.iter_mut().find(|e| e.is_alive()) {
                    enemy.hurt(f32::MAX);
                }
            }
            let mut input = Input::default();
            if fast {
                for (i, &activate_at) in activation_ticks.iter().enumerate() {
                    if t == activate_at - channel_ticks + 1 {
                        let n = g.nodes[i];
                        g.player.pos = v3(n.x, n.y, n.z + 1.0);
                        g.player.vel = V3::ZERO;
                    }
                    if (activate_at - channel_ticks + 1..=activate_at + 1).contains(&t) {
                        input.interact = true;
                    }
                }
            }
            g.step(input);
            if g.nodes_active as usize > activations.len() {
                activations.push(t);
            }
            if g.waves.wave as usize > waves.len() {
                waves.push(t);
            }
            peak_alive = peak_alive.max(g.alive_count());
            if g.waves.wave == 5 {
                break;
            }
        }
        assert_eq!(waves.len(), 5, "wave 5 wasn't reached: {waves:?}");
        if fast {
            assert_eq!(activations, activation_ticks);
            assert_eq!(g.phase, phase::EXTRACTION);
        } else {
            assert!(activations.is_empty());
            assert_eq!(g.phase, phase::PLAYING);
        }
        let seconds = |ticks: &[u32]| {
            ticks
                .iter()
                .map(|&t| f64::from(t) / 60.0)
                .collect::<Vec<_>>()
        };
        println!(
            "fast={fast} waves(s)={:?} activations(s)={:?} peak_alive={peak_alive} remaining_at_wave_5={}",
            seconds(&waves),
            seconds(&activations),
            g.waves.queued() + u64::from(g.alive_count())
        );
        waves[4]
    };
    let fast = run(true);
    let slow = run(false);
    assert!(fast < slow && fast <= 61 * 60);
}

#[test]
fn an_idle_operator_loses() {
    let mut g = Game::new(11);
    g.start(MODE_MISSION, 0, 11, 0);
    for _ in 0..(200.0 / FIXED_DT) as u32 {
        if g.phase != phase::PLAYING {
            break;
        }
        g.step(Input::default());
    }
    assert_eq!(g.phase, phase::LOSE);
}
