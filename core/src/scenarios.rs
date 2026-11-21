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

/// Sonda: ¿algún enemigo se queda sin alcanzar jamás a un jugador pasivo?
/// Si alguno se atasca, la oleada nunca cierra (no hay timeout en `update_waves`).
#[test]
fn every_spawn_point_reaches_a_passive_player_on_every_map() {
    use crate::enemy::{self, Enemy};
    let mut stuck: Vec<String> = Vec::new();
    for map in 0..3u8 {
        let mut probe = Game::new(7);
        assert!(probe.start(MODE_MISSION, map, 7, 0));
        let spawns: Vec<(f32, f32)> = probe.spawns[..probe.spawn_count].to_vec();
        for kind in [
            enemy::KIND_SCOUT,
            enemy::KIND_SENTINEL,
            enemy::KIND_INTERCEPTOR,
        ] {
            for &(sx, sz) in &spawns {
                let mut g = Game::new(7);
                assert!(g.start(MODE_MISSION, map, 7, 0));
                g.waves.queue_head = g.waves.queue_len;
                let yaw = enemy::dir_to_yaw(v3(g.player.pos.x - sx, 0.0, g.player.pos.z - sz));
                g.enemies[0] = Enemy::spawn(v3(sx, 0.0, sz), kind, yaw, 0);
                let reach = enemy::def(kind).attack_range + 1.0;
                let mut closest = f32::MAX;
                for _ in 0..(60 * 60) {
                    g.player.hp = g.player.hp_max;
                    g.step(Input::default());
                    closest = closest.min(g.enemies[0].pos.dist_xz(g.player.pos));
                    if closest <= reach.max(enemy::def(kind).preferred_range + 4.0) {
                        break;
                    }
                }
                let limit = reach.max(enemy::def(kind).preferred_range + 4.0);
                if closest > limit {
                    stuck.push(format!(
                        "map {map} kind {kind} spawn ({sx},{sz}) closest {closest:.1} m, ended at {:?}",
                        g.enemies[0].pos
                    ));
                }
            }
        }
    }
    assert!(
        stuck.is_empty(),
        "enemies never reached the player:\n{}",
        stuck.join("\n")
    );
}

/// Resultado de una partida del bot de referencia.
#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct BotRun {
    pub died: bool,
    pub seconds: f32,
    pub kills: u32,
    pub damage: f32,
}

/// Bot "competente" de referencia para medir dificultad: se queda en su punto de aparición,
/// alterna strafe izquierda/derecha, reacciona 0.25 s después de ver un objetivo, gira a lo
/// sumo 6 rad/s y dispara la carabina cuando el error de mira es menor a 0.06 rad.
/// No busca terminales: mide cuánto resiste un tirador razonable, no si gana la misión.
pub(crate) fn competent_bot(map: u8, seed: u32, max_seconds: f32) -> BotRun {
    use crate::enemy::dir_to_yaw;
    use crate::player::EYE_HEIGHT;
    let mut g = Game::new(seed);
    assert!(g.start(MODE_MISSION, map, seed, crate::sim::FLAG_AUTO_RELOAD));
    let dt = FIXED_DT;
    let mut target: i32 = -1;
    let mut reaction = 0.0f32;
    let mut t = 0.0f32;
    let mut first = true;
    while (g.phase == phase::PLAYING || g.phase == phase::EXTRACTION) && t < max_seconds {
        let eye = v3(g.player.pos.x, g.player.pos.y + EYE_HEIGHT, g.player.pos.z);
        let mut best = -1i32;
        let mut best_d = f32::MAX;
        for (i, e) in g.enemies.iter().enumerate() {
            if !e.is_alive() {
                continue;
            }
            let d = e.pos.dist_xz(g.player.pos);
            if d < best_d && !g.arena.blocked(eye, e.eye()) {
                best_d = d;
                best = i as i32;
            }
        }
        if best != target {
            target = best;
            reaction = 0.25;
        }
        reaction = (reaction - dt).max(0.0);
        let mut input = Input {
            move_x: if ((t / 1.2) as u32).is_multiple_of(2) {
                1.0
            } else {
                -1.0
            },
            switch: if first { crate::weapons::ID_CARBINE } else { 0 },
            ..Input::default()
        };
        first = false;
        if target >= 0 && reaction <= 0.0 {
            let e = g.enemies[target as usize];
            let chest = v3(
                e.pos.x,
                e.pos.y + crate::enemy::def(e.kind).height * 0.6,
                e.pos.z,
            );
            let to = chest - eye;
            let want_yaw = dir_to_yaw(v3(to.x, 0.0, to.z));
            let want_pitch = to.y.atan2(to.len_xz());
            let yaw_err = wrap_pi(want_yaw - g.player.yaw);
            let pitch_err = want_pitch - g.player.pitch;
            let turn = 6.0 * dt;
            input.look_dx = -yaw_err.clamp(-turn, turn);
            input.look_dy = -pitch_err.clamp(-turn, turn);
            input.fire_held = yaw_err.abs() < 0.06 && pitch_err.abs() < 0.08;
            input.fire_pressed = input.fire_held;
        }
        g.step(input);
        t += dt;
    }
    BotRun {
        died: g.phase == phase::LOSE && g.player.hp <= 0.0,
        seconds: t,
        kills: g.kills,
        damage: g.damage_taken,
    }
}

/// Segundos hasta que muere un jugador quieto que no hace nada.
pub(crate) fn idle_death_seconds(map: u8, seed: u32) -> f32 {
    let mut g = Game::new(seed);
    assert!(g.start(MODE_MISSION, map, seed, crate::sim::FLAG_AUTO_RELOAD));
    let mut t = 0.0;
    while g.phase == phase::PLAYING && t < 180.0 {
        g.step(Input::default());
        t += FIXED_DT;
    }
    t
}

/// Informe de dificultad: `cargo test --release --lib difficulty_report -- --ignored --nocapture`.
#[test]
#[ignore]
fn difficulty_report() {
    for map in 0..3u8 {
        let runs: Vec<BotRun> = (0..10u32)
            .map(|s| competent_bot(map, 1000 + s, 180.0))
            .collect();
        let deaths = runs.iter().filter(|r| r.died).count();
        let alive = runs.iter().map(|r| r.seconds).sum::<f32>() / runs.len() as f32;
        let kills = runs.iter().map(|r| r.kills).sum::<u32>() as f32 / runs.len() as f32;
        let damage = runs.iter().map(|r| r.damage).sum::<f32>() / runs.len() as f32;
        let idle = (0..10u32)
            .map(|s| idle_death_seconds(map, 1000 + s))
            .sum::<f32>()
            / 10.0;
        println!(
            "DIFF map {map}: bot deaths {deaths}/10, mean alive {alive:.1} s, kills {kills:.1}, damage {damage:.0}, idle death {idle:.1} s"
        );
    }
}

/// Banda de dificultad acordada (docs/GAMEPLAY_SPEC.md): un tirador competente que no juega el
/// objetivo cae en la mayoría de las semillas de cada sector, y quedarse quieto no dura medio minuto.
#[test]
fn difficulty_stays_in_the_agreed_band() {
    for map in 0..3u8 {
        let deaths = (0..6u32)
            .filter(|s| competent_bot(map, 2000 + s, 180.0).died)
            .count();
        assert!(
            deaths >= 3,
            "sector {map}: the competent bot died only {deaths}/6 times"
        );
        let idle = idle_death_seconds(map, 2000);
        assert!(
            idle < 32.0,
            "sector {map}: an idle player survived {idle:.1} s"
        );
    }
}
