//! The match: composition root for player, enemies, waves, objectives and scoring.
//!
//! Everything here is deterministic given (seed, arena, input sequence). No DOM,
//! no WebGL, no allocations inside `tick`.

use crate::arena::Arena;
use crate::enemy::{self, Action, Enemy, EnemyContext, EMPTY_ENEMY};
use crate::math::{clamp, forward_from_yaw, right_from_yaw, v3, V3};
use crate::player::{Input, Player, EYE_HEIGHT, HEIGHT, RADIUS};
use crate::protocol::*;
use crate::rng::Rng;
use crate::waves::Waves;
use crate::weapons;

pub const MATCH_SECONDS: f32 = 180.0;
pub const EXTRACTION_SECONDS: f32 = 12.0;
pub const NODE_RADIUS: f32 = 1.9;
pub const NODE_CHANNEL: f32 = 1.2;
pub const NODE_CANCEL_DAMAGE: f32 = 15.0;
pub const MAX_SPAWNS: usize = 24;

/// Paso fijo canónico. El cliente y el servidor avanzan siempre con este valor,
/// de modo que un registro de entradas basta para reproducir una partida.
pub const FIXED_DT: f32 = 1.0 / 60.0;

pub const MODE_MISSION: u8 = 0;
pub const MODE_OVERFLOW: u8 = 1;
pub const MODE_DAILY: u8 = 2;
pub const MODE_PRACTICE: u8 = 3;

/// Versión de la fórmula de puntaje; el servidor la guarda junto a cada marca.
pub const SCORE_VERSION: u8 = 1;

pub const FLAG_AIM_ASSIST: u8 = 1;
pub const FLAG_AUTO_RELOAD: u8 = 2;
/// El arma 3 (SG-08) puede equiparse. El progreso es del cliente; el servidor lo registra pero no lo juzga.
pub const FLAG_SHOTGUN: u8 = 4;

/// Alcance vertical (m) dentro del cual una terminal responde al jugador.
const NODE_VERTICAL_REACH: f32 = 1.2;

const AIM_ASSIST_EXPAND: f32 = 0.22;

#[derive(Clone, Copy, Debug)]
pub struct Node {
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub progress: f32,
    pub active: bool,
}

impl Node {
    pub const fn new(x: f32, z: f32) -> Node {
        Node::at(x, 0.0, z)
    }

    pub const fn at(x: f32, y: f32, z: f32) -> Node {
        Node {
            x,
            y,
            z,
            progress: 0.0,
            active: false,
        }
    }
}

pub struct Game {
    pub arena: Arena,
    pub player: Player,
    pub enemies: [Enemy; MAX_ENEMIES],
    pub nodes: [Node; MAX_NODES],
    pub spawns: [(f32, f32); MAX_SPAWNS],
    pub spawn_count: usize,
    pub waves: Waves,
    pub rng: Rng,
    pub seed: u32,
    pub tick: u32,
    pub dropped: u32,
    pub phase: f32,
    pub time_elapsed: f32,
    pub time_left: f32,
    pub extraction: f32,
    pub kills: u32,
    pub shots: u32,
    pub hits: u32,
    pub damage_taken: f32,
    pub nodes_active: u32,
    pub interacting: i32,
    pub snapshot: [f32; SNAPSHOT_LEN],
    pub event_head: usize,
    pub event_count: usize,
    pub event_seq: u32,
    pub player_start: V3,
    pub player_start_yaw: f32,
    pub aim_assist: bool,
    pub practice: bool,
    pub auto_reload: bool,
    pub map_id: u8,
    pub mode: u8,
    pub input: Input,
    pub recorder: Option<crate::replay::Recorder>,
    pub log_flags: u8,
    /// Búfer de salida hacia el host: registro codificado y tabla del mapa.
    pub log_out: Vec<u8>,
    pub map_data: Vec<f32>,
}

impl Game {
    pub fn new(seed: u32) -> Game {
        let mut g = Game {
            arena: Arena::new(),
            player: Player::new(v3(0.0, 0.0, 13.0), 0.0),
            enemies: [EMPTY_ENEMY; MAX_ENEMIES],
            nodes: [
                Node::new(-12.0, 0.0),
                Node::new(12.0, 0.0),
                Node::new(0.0, -12.0),
            ],
            spawns: [(0.0, 0.0); MAX_SPAWNS],
            spawn_count: 0,
            waves: Waves::new(),
            rng: Rng::new(seed),
            seed,
            tick: 0,
            dropped: 0,
            phase: phase::IDLE,
            time_elapsed: 0.0,
            time_left: MATCH_SECONDS,
            extraction: 0.0,
            kills: 0,
            shots: 0,
            hits: 0,
            damage_taken: 0.0,
            nodes_active: 0,
            interacting: -1,
            snapshot: [0.0; SNAPSHOT_LEN],
            event_head: 0,
            event_count: 0,
            event_seq: 0,
            player_start: v3(0.0, 0.0, 13.0),
            player_start_yaw: 0.0,
            aim_assist: false,
            practice: false,
            auto_reload: true,
            map_id: 0,
            mode: MODE_MISSION,
            input: Input::default(),
            recorder: None,
            log_flags: 0,
            log_out: Vec::new(),
            map_data: Vec::new(),
        };
        g.load_map(0);
        g.player = Player::new(g.player_start, g.player_start_yaw);
        g.write_snapshot();
        g
    }

    pub fn set_nodes(&mut self, data: &[f32]) {
        let mut i = 0;
        while i < MAX_NODES && (i * 2 + 1) < data.len() {
            self.nodes[i] = Node::new(data[i * 2], data[i * 2 + 1]);
            i += 1;
        }
    }

    pub fn set_spawns(&mut self, data: &[f32]) {
        self.spawn_count = 0;
        let mut i = 0;
        while i < MAX_SPAWNS && (i * 2 + 1) < data.len() {
            self.spawns[i] = (data[i * 2], data[i * 2 + 1]);
            self.spawn_count += 1;
            i += 1;
        }
    }

    /// Practice range: no timer, no defeat, endless waves and infinite reserve.
    pub fn set_practice(&mut self, enabled: bool) {
        self.practice = enabled;
    }

    /// Carga geometría, terminales, puntos de aparición y salida del sector `id`.
    pub fn load_map(&mut self, id: u8) -> bool {
        let Some(map) = crate::maps::get(id) else {
            return false;
        };
        self.arena.load_solids(map.solids);
        for (i, n) in map.nodes.iter().enumerate().take(MAX_NODES) {
            self.nodes[i] = Node::at(n[0], n[1], n[2]);
        }
        self.spawn_count = 0;
        for sp in map.spawns.iter().take(MAX_SPAWNS) {
            self.spawns[self.spawn_count] = (sp[0], sp[1]);
            self.spawn_count += 1;
        }
        self.set_player_start(map.start[0], map.start[1], map.start[2]);
        self.map_id = id;
        self.build_map_data(map);
        true
    }

    /// Inicia una partida completa. Es el único punto de entrada que reproduce el servidor.
    pub fn start(&mut self, mode: u8, map: u8, seed: u32, flags: u8) -> bool {
        if mode > MODE_PRACTICE || !self.load_map(map) {
            return false;
        }
        self.mode = mode;
        self.practice = mode == MODE_PRACTICE;
        self.aim_assist = flags & FLAG_AIM_ASSIST != 0;
        self.auto_reload = flags & FLAG_AUTO_RELOAD != 0;
        self.log_flags = flags & (FLAG_AIM_ASSIST | FLAG_AUTO_RELOAD | FLAG_SHOTGUN);
        if let Some(rec) = self.recorder.as_mut() {
            *rec = crate::replay::Recorder::new();
        }
        self.reset(seed);
        true
    }

    /// Tabla plana para el host: 16 floats de cabecera, luego sólidos (7), terminales (3), spawns (2).
    fn build_map_data(&mut self, map: &crate::maps::MapDef) {
        let d = &mut self.map_data;
        d.clear();
        d.extend_from_slice(&[
            map.theme as f32,
            map.solids.len() as f32,
            map.nodes.len() as f32,
            map.spawns.len() as f32,
            map.start[0],
            map.start[1],
            map.start[2],
            map.half_x,
            map.half_z,
            map.id as f32,
            0.0,
            0.0,
            0.0,
            0.0,
            0.0,
            0.0,
        ]);
        for s in map.solids {
            d.extend_from_slice(&[s.min[0], s.min[1], s.min[2], s.max[0], s.max[1], s.max[2]]);
            d.push(s.kind as f32);
        }
        for n in map.nodes {
            d.extend_from_slice(n);
        }
        for sp in map.spawns {
            d.extend_from_slice(sp);
        }
    }

    pub fn enable_recording(&mut self) {
        self.recorder = Some(crate::replay::Recorder::new());
    }

    /// Codifica el registro actual en `log_out` y devuelve su longitud.
    pub fn encode_log(&mut self) -> usize {
        let header = crate::replay::Header {
            mode: self.mode,
            map: self.map_id,
            flags: self.log_flags,
            seed: self.seed,
            ticks: self.recorder.as_ref().map_or(0, |r| r.ticks()),
        };
        self.log_out = match &self.recorder {
            Some(r) => r.encode(&header),
            None => Vec::new(),
        };
        self.log_out.len()
    }

    /// Avanza un tick con el paso fijo y entradas cuantizadas (lo que registra el replay).
    pub fn step(&mut self, input: Input) {
        let input = input.quantized();
        if self.phase == phase::PLAYING || self.phase == phase::EXTRACTION {
            if let Some(rec) = self.recorder.as_mut() {
                rec.push(&input);
            }
        }
        self.tick(FIXED_DT, input);
    }

    pub fn set_player_start(&mut self, x: f32, z: f32, yaw: f32) {
        self.player_start = v3(x, 0.0, z);
        self.player_start_yaw = yaw;
    }

    /// Begins a fresh match with a new seed. Arena, nodes and spawns are kept.
    pub fn reset(&mut self, seed: u32) {
        self.seed = seed;
        self.rng = Rng::new(seed);
        self.player = Player::new(self.player_start, self.player_start_yaw);
        for e in self.enemies.iter_mut() {
            *e = EMPTY_ENEMY;
        }
        for n in self.nodes.iter_mut() {
            *n = Node::at(n.x, n.y, n.z);
        }
        self.waves.reset();
        self.tick = 0;
        self.dropped = 0;
        self.phase = phase::PLAYING;
        self.time_elapsed = 0.0;
        self.time_left = MATCH_SECONDS;
        self.extraction = 0.0;
        self.kills = 0;
        self.shots = 0;
        self.hits = 0;
        self.damage_taken = 0.0;
        self.nodes_active = 0;
        self.interacting = -1;
        self.event_head = 0;
        self.event_count = 0;
        // Estado de eventos viejo no debe sobrevivir a una partida nueva: el replay del
        // servidor arranca de cero y los hashes tienen que coincidir.
        self.event_seq = 0;
        self.snapshot = [0.0; SNAPSHOT_LEN];
        self.input = Input::default();
        self.waves.begin(1);
        self.push_event(ev::WAVE_START, 1.0, 0.0, 0.0, 0.0);
        self.write_snapshot();
    }

    fn push_event(&mut self, kind: f32, a: f32, b: f32, c: f32, d: f32) {
        let slot = EVENT_BASE + self.event_head * EVENT_STRIDE;
        self.event_seq = self.event_seq.wrapping_add(1);
        self.snapshot[slot + EV_TYPE] = kind;
        self.snapshot[slot + EV_A] = a;
        self.snapshot[slot + EV_B] = b;
        self.snapshot[slot + EV_C] = c;
        self.snapshot[slot + EV_D] = d;
        self.snapshot[slot + EV_SEQ] = self.event_seq as f32;
        self.event_head = (self.event_head + 1) % MAX_EVENTS;
        self.event_count = (self.event_count + 1).min(MAX_EVENTS);
    }

    pub fn alive_count(&self) -> u32 {
        self.enemies.iter().filter(|e| e.is_alive()).count() as u32
    }

    /// Enemies still to come in the current wave (alive plus queued).
    fn enemies_remaining(&self) -> u32 {
        let queued = if self.waves.running {
            self.waves.queued() as u32
        } else {
            0
        };
        self.alive_count() + queued
    }

    pub fn compute_score(&self) -> f32 {
        let accuracy = if self.shots > 0 {
            self.hits as f32 / self.shots as f32
        } else {
            0.0
        };
        let time_bonus = if self.phase == phase::WIN {
            self.time_left.max(0.0) * 10.0
        } else {
            0.0
        };
        let raw = 100.0 * self.kills as f32
            + 500.0 * self.nodes_active as f32
            + time_bonus
            + 500.0 * accuracy
            - 2.0 * self.damage_taken;
        raw.max(0.0)
    }

    /// Puntaje entero que guarda el ranking; lo calcula el servidor al re-simular.
    pub fn final_score(&self) -> u32 {
        self.compute_score().round() as u32
    }

    pub fn accuracy(&self) -> f32 {
        if self.shots == 0 {
            0.0
        } else {
            self.hits as f32 / self.shots as f32
        }
    }

    // ---------------------------------------------------------------- tick

    pub fn tick(&mut self, dt: f32, input: Input) {
        if self.phase != phase::PLAYING && self.phase != phase::EXTRACTION {
            self.write_snapshot();
            return;
        }
        let dt = clamp(dt, 0.0, 0.1);
        if dt <= 0.0 {
            self.write_snapshot();
            return;
        }
        self.input = input;
        self.tick = self.tick.wrapping_add(1);
        self.time_elapsed += dt;
        self.time_left = (MATCH_SECONDS - self.time_elapsed).max(0.0);

        self.update_weapons(dt, input);
        self.player.tick(dt, &input, &self.arena);
        self.update_nodes(dt, input);
        self.update_enemies(dt);
        self.update_waves(dt);
        self.update_phase(dt);
        self.write_snapshot();
    }

    fn update_weapons(&mut self, dt: f32, input: Input) {
        let _ = dt;
        let def = *weapons::def(self.player.weapon);
        if self.practice && self.player.reserve < 999 {
            self.player.reserve = 999;
        }

        if input.switch != 0
            && input.switch != self.player.weapon
            && self.player.equip(input.switch)
        {
            self.push_event(ev::RELOAD_END, self.player.weapon as f32, 0.0, 0.0, 0.0);
        }

        if input.reload && self.player.start_reload() {
            self.push_event(ev::RELOAD_START, self.player.weapon as f32, 0.0, 0.0, 0.0);
        }

        let wants = weapons::wants_shot(&def, input.fire_held, input.fire_pressed);
        if !wants || self.player.fire_cd > 0.0 || self.player.is_reloading() {
            return;
        }
        if self.player.ammo == 0 {
            self.push_event(ev::EMPTY_MAG, 0.0, 0.0, 0.0, 0.0);
            self.player.fire_cd = 0.25;
            self.player.start_reload();
            return;
        }

        self.player.ammo -= 1;
        self.player.fire_cd = weapons::interval(&def);
        self.shots += 1;

        let origin = self.player.eye();
        let spread = self.player.spread();
        let aim = self.player.aim_dir();
        let right = right_from_yaw(self.player.yaw);
        let up = right.cross(aim).norm_or(V3::UP);
        let mut enemy_hit = false;

        for _ in 0..def.pellets.max(1) {
            let dir =
                (aim + right * self.rng.signed(spread) + up * self.rng.signed(spread)).norm_or(aim);
            if self.fire_ray(origin, dir, &def) {
                enemy_hit = true;
            }
        }

        if enemy_hit {
            self.player.hit_age = 0.0;
        }

        self.push_event(ev::SHOT, def.id as f32, origin.x, origin.y, origin.z);
        self.player
            .add_recoil(def.recoil_pitch, self.rng.signed(def.recoil_yaw));

        if self.auto_reload
            && self.player.ammo == 0
            && self.player.reserve > 0
            && self.player.start_reload()
        {
            self.push_event(ev::RELOAD_START, self.player.weapon as f32, 0.0, 0.0, 0.0);
        }
    }

    /// Fires one pellet. Returns whether an enemy was hit.
    fn fire_ray(&mut self, origin: V3, dir: V3, def: &weapons::WeaponDef) -> bool {
        let mut best_t = def.range;
        let mut best_enemy: i32 = -1;

        for (i, e) in self.enemies.iter().enumerate() {
            if !e.is_alive() {
                continue;
            }
            let mut body = e.body();
            if self.aim_assist {
                body = body.expand(AIM_ASSIST_EXPAND);
            }
            if let Some(t) = body.ray(origin, dir, best_t) {
                if t < best_t {
                    best_t = t;
                    best_enemy = i as i32;
                }
            }
        }

        let wall = self.arena.ray(origin, dir, def.range);
        if let Some(wall_t) = wall {
            if best_enemy < 0 || wall_t < best_t {
                let p = origin + dir * wall_t;
                self.push_event(ev::WALL_HIT, p.x, p.y, p.z, 0.0);
                return false;
            }
        }

        if best_enemy < 0 {
            return false;
        }

        let idx = best_enemy as usize;
        let point = origin + dir * best_t;
        let enemy_pos = self.enemies[idx].pos;
        let enemy_height = enemy::def(self.enemies[idx].kind).height;
        let head = point.y > enemy_pos.y + enemy_height * 0.78;
        let mut damage = def.damage;
        if head {
            damage *= def.headshot_mult;
        }

        self.hits += 1;
        let killed = self.enemies[idx].hurt(damage);
        self.push_event(ev::ENEMY_HIT, point.x, point.y, point.z, damage);
        if killed {
            self.on_enemy_killed(idx);
        }
        true
    }

    fn on_enemy_killed(&mut self, idx: usize) {
        let e = self.enemies[idx];
        self.kills += 1;
        self.waves.killed += 1;
        self.push_event(ev::ENEMY_DIED, e.pos.x, e.pos.y, e.pos.z, e.kind as f32);
    }

    fn update_enemies(&mut self, dt: f32) {
        let player_eye = self.player.eye();
        let player_feet = self.player.pos;
        let player_forward = forward_from_yaw(self.player.yaw);
        // Fase 1: cada enemigo decide con préstamos separados; los efectos van en fase 2.
        let mut pending: [Option<(Action, V3, u8)>; MAX_ENEMIES] = [None; MAX_ENEMIES];
        for (slot, enemy) in pending.iter_mut().zip(self.enemies.iter_mut()) {
            if !enemy.is_alive() {
                continue;
            }
            let ctx = EnemyContext {
                arena: &self.arena,
                player_eye,
                player_feet,
                player_forward,
                player_radius: RADIUS,
                player_height: HEIGHT,
            };
            let mut rng = self.rng;
            *slot = enemy
                .tick(dt, &ctx, &mut rng)
                .map(|a| (a, enemy.pos, enemy.kind));
            self.rng = rng;
        }

        let mut damage_events: [(f32, f32, f32, f32); 8] = [(0.0, 0.0, 0.0, 0.0); 8];
        let mut damage_len = 0usize;
        for &(action, pos, kind) in pending.iter().flatten() {
            match action {
                Action::Windup => {
                    self.push_event(ev::ENEMY_WINDUP, pos.x, pos.y, pos.z, kind as f32);
                }
                Action::Melee { damage } => {
                    if damage_len < damage_events.len() {
                        damage_events[damage_len] = (damage, pos.x, pos.y, pos.z);
                        damage_len += 1;
                    }
                }
                Action::Shot {
                    origin,
                    dir,
                    damage,
                } => {
                    self.push_event(ev::ENEMY_SHOT, origin.x, origin.y, origin.z, kind as f32);
                    let body = crate::math::Aabb::from_feet(player_feet, RADIUS, HEIGHT);
                    if body.ray(origin, dir, 60.0).is_some() {
                        // The wall must not be closer than the player along this ray.
                        let to_player = body.ray(origin, dir, 60.0).unwrap_or(0.0);
                        let clear = self.arena.ray(origin, dir, to_player).is_none();
                        if clear && damage_len < damage_events.len() {
                            damage_events[damage_len] = (damage, origin.x, origin.y, origin.z);
                            damage_len += 1;
                        }
                    }
                }
            }
        }

        self.separate_enemies();

        if self.practice {
            return;
        }

        for &(damage, sx, sy, sz) in &damage_events[..damage_len] {
            let applied = self.player.take_damage(damage);
            if applied > 0.0 {
                self.damage_taken += applied;
                self.push_event(ev::PLAYER_DAMAGED, applied, sx, sy, sz);
                if applied > NODE_CANCEL_DAMAGE {
                    for n in self.nodes.iter_mut() {
                        if !n.active {
                            n.progress = 0.0;
                        }
                    }
                }
            }
        }
    }

    /// Cheap pairwise push-apart so enemies do not stack into one silhouette.
    fn separate_enemies(&mut self) {
        for i in 0..MAX_ENEMIES {
            if !self.enemies[i].is_alive() {
                continue;
            }
            for j in (i + 1)..MAX_ENEMIES {
                if !self.enemies[j].is_alive() {
                    continue;
                }
                let a = self.enemies[i].pos;
                let b = self.enemies[j].pos;
                let delta = b - a;
                let d = delta.len_xz();
                let min_d = 0.95;
                if d > 0.001 && d < min_d {
                    let push = (min_d - d) * 0.5;
                    let dir = delta * (1.0 / d);
                    self.enemies[i].pos.x -= dir.x * push;
                    self.enemies[i].pos.z -= dir.z * push;
                    self.enemies[j].pos.x += dir.x * push;
                    self.enemies[j].pos.z += dir.z * push;
                }
            }
        }
    }

    fn update_nodes(&mut self, dt: f32, input: Input) {
        self.interacting = -1;
        let nodes = self.nodes;
        for (i, &n) in nodes.iter().enumerate() {
            if n.active {
                continue;
            }
            let dx = self.player.pos.x - n.x;
            let dz = self.player.pos.z - n.z;
            let dist = (dx * dx + dz * dz).sqrt();
            let off_level = (self.player.pos.y - n.y).abs() > NODE_VERTICAL_REACH;
            if dist > NODE_RADIUS || off_level {
                self.nodes[i].progress = (n.progress - dt * 2.0).max(0.0);
                continue;
            }
            if self.interacting < 0 {
                self.interacting = i as i32;
            }
            if input.interact {
                self.nodes[i].progress = clamp(n.progress + dt / NODE_CHANNEL, 0.0, 1.0);
                if self.nodes[i].progress >= 1.0 {
                    self.nodes[i].active = true;
                    self.nodes_active += 1;
                    self.push_event(ev::NODE_ACTIVATED, i as f32, n.x, n.y, n.z);
                }
            } else {
                self.nodes[i].progress = (n.progress - dt * 1.5).max(0.0);
            }
        }
    }

    fn update_waves(&mut self, dt: f32) {
        if self.practice && self.waves.finished {
            self.waves.finished = false;
            self.waves.begin(1);
            self.push_event(ev::WAVE_START, 1.0, 0.0, 0.0, 0.0);
        }
        let boost = if self.phase == phase::EXTRACTION {
            2.0
        } else {
            1.0
        };

        if self.waves.running {
            let alive = self.alive_count() as usize;
            if self.waves.queued() > 0 && alive < self.waves.alive_target() {
                self.waves.spawn_timer -= dt * boost;
                if self.waves.spawn_timer <= 0.0 {
                    self.spawn_one();
                    self.waves.spawn_timer = self.waves.spawn_interval / boost;
                }
            }
            if self.waves.queued() == 0 && alive == 0 {
                self.waves.running = false;
                if self.waves.wave >= self.waves.total {
                    self.waves.finished = true;
                } else {
                    self.waves.intermission = 4.0;
                }
            }
        } else if self.waves.intermission > 0.0 {
            self.waves.intermission -= dt;
            if self.waves.intermission <= 0.0 && self.waves.wave < self.waves.total {
                let next = self.waves.wave + 1;
                self.waves.begin(next);
                self.push_event(ev::WAVE_START, next as f32, 0.0, 0.0, 0.0);
            }
        }
    }

    fn spawn_one(&mut self) {
        let slot = self.enemies.iter().position(|e| !e.is_alive());
        let Some(idx) = slot else { return };
        if self.waves.queue_head >= self.waves.queue_len {
            return;
        }
        let kind = self.waves.queue[self.waves.queue_head];
        self.waves.queue_head += 1;
        self.waves.spawned += 1;

        let (x, z) = self.waves.pick_spawn(
            &self.spawns[..self.spawn_count],
            self.player.pos.x,
            self.player.pos.z,
            &mut self.rng,
        );
        let yaw = enemy::dir_to_yaw(v3(self.player.pos.x - x, 0.0, self.player.pos.z - z));
        self.enemies[idx] = Enemy::spawn(v3(x, 0.0, z), kind, yaw, (self.waves.spawned % 7) as u8);
        self.push_event(ev::SPAWN, x, 0.0, z, kind as f32);
    }

    fn update_phase(&mut self, dt: f32) {
        if self.practice {
            // The range never ends: a downed operator simply re-enters.
            self.time_left = MATCH_SECONDS;
            if self.player.hp <= 0.0 {
                self.player.hp = self.player.hp_max;
                self.player.pos = self.player_start;
                self.player.vel = V3::ZERO;
                self.player.recoil_pitch = 0.0;
                self.player.recoil_yaw = 0.0;
            }
            return;
        }
        if self.player.hp <= 0.0 {
            self.phase = phase::LOSE;
            self.push_event(ev::LOSE, 0.0, 0.0, 0.0, 0.0);
            return;
        }

        if self.phase == phase::PLAYING && self.nodes_active >= MAX_NODES as u32 {
            self.phase = phase::EXTRACTION;
            self.extraction = EXTRACTION_SECONDS;
            self.push_event(ev::EXTRACTION, EXTRACTION_SECONDS, 0.0, 0.0, 0.0);
        }

        if self.phase == phase::EXTRACTION {
            self.extraction -= dt;
            if self.extraction <= 0.0 {
                self.extraction = 0.0;
                self.phase = phase::WIN;
                self.push_event(ev::WIN, 0.0, 0.0, 0.0, 0.0);
                return;
            }
        }

        if self.time_left <= 0.0 {
            self.phase = phase::LOSE;
            self.push_event(ev::LOSE, 0.0, 0.0, 0.0, 0.0);
        }
    }

    // ------------------------------------------------------------ snapshot

    pub fn write_snapshot(&mut self) {
        let remaining = self.enemies_remaining() as f32;
        let alive = self.alive_count() as f32;
        let score = self.compute_score();
        let s = &mut self.snapshot;
        s[H_PROTOCOL] = PROTOCOL_VERSION as f32;
        s[H_TIME_ELAPSED] = self.time_elapsed;
        s[H_TIME_LEFT] = self.time_left;
        s[H_PHASE] = self.phase;
        s[H_WAVE] = self.waves.wave as f32;
        s[H_WAVE_TOTAL] = self.waves.total as f32;
        s[H_ENEMIES_REMAINING] = remaining;
        s[H_ENEMIES_ALIVE] = alive;
        s[H_SCORE] = score;
        s[H_KILLS] = self.kills as f32;
        s[H_SHOTS] = self.shots as f32;
        s[H_HITS] = self.hits as f32;
        s[H_DAMAGE_TAKEN] = self.damage_taken;
        s[H_HP] = self.player.hp;
        s[H_HP_MAX] = self.player.hp_max;
        s[H_PLAYER_X] = self.player.pos.x;
        s[H_PLAYER_Y] = self.player.pos.y;
        s[H_PLAYER_Z] = self.player.pos.z;
        s[H_YAW] = self.player.yaw;
        s[H_PITCH] = self.player.pitch;
        s[H_GROUNDED] = if self.player.grounded { 1.0 } else { 0.0 };
        s[H_WEAPON] = self.player.weapon as f32;
        s[H_AMMO] = self.player.ammo as f32;
        s[H_MAG] = weapons::def(self.player.weapon).mag as f32;
        s[H_RESERVE] = self.player.reserve as f32;
        s[H_RELOADING] = if self.player.is_reloading() { 1.0 } else { 0.0 };
        s[H_RELOAD_PROGRESS] = self.player.reload_progress();
        s[H_SPREAD] = self.player.spread();
        s[H_NODE_0] = self.nodes[0].progress;
        s[H_NODE_1] = self.nodes[1].progress;
        s[H_NODE_2] = self.nodes[2].progress;
        s[H_NODES_ACTIVE] = self.nodes_active as f32;
        s[H_INTERACTING] = self.interacting as f32;
        s[H_INTERMISSION] = self.waves.intermission;
        s[H_TICK] = self.tick as f32;
        s[H_DROPPED_TICKS] = self.dropped as f32;
        s[H_EXTRACTION] = self.extraction;
        s[H_AIM_ASSIST] = if self.aim_assist { 1.0 } else { 0.0 };
        s[H_SPEED] = self.player.speed;
        s[H_HIT_AGE] = self.player.hit_age;
        s[H_RECOIL_PITCH] = self.player.recoil_pitch;
        s[H_RECOIL_YAW] = self.player.recoil_yaw;
        s[H_FIRE_COOLDOWN] = self.player.fire_cd;
        s[H_DAMAGE_AGE] = self.player.damage_age;
        s[H_WAVE_ENEMIES_LEFT] = remaining;
        s[H_ADS] = self.player.ads;
        s[H_EVENTS_HEAD] = self.event_head as f32;
        s[H_EVENTS_COUNT] = self.event_count as f32;

        for (i, e) in self.enemies.iter().enumerate() {
            let base = ENEMY_BASE + i * ENEMY_STRIDE;
            s[base + E_X] = e.pos.x;
            s[base + E_Y] = e.pos.y;
            s[base + E_Z] = e.pos.z;
            s[base + E_YAW] = e.yaw;
            s[base + E_HP] = e.hp / e.hp_max.max(1.0);
            s[base + E_STATE] = if e.is_alive() {
                e.state as f32
            } else {
                enemy::ST_DEAD as f32
            };
            s[base + E_KIND] = e.kind as f32;
            s[base + E_ANIM] = e.anim;
        }

        for (i, n) in self.nodes.iter().enumerate() {
            let base = NODE_BASE + i * NODE_STRIDE;
            s[base + N_X] = n.x;
            s[base + N_Z] = n.z;
            s[base + N_PROGRESS] = n.progress;
            s[base + N_ACTIVE] = if n.active { 1.0 } else { 0.0 };
        }
    }

    pub fn node_positions(&self) -> [Node; MAX_NODES] {
        self.nodes
    }

    pub fn player_eye(&self) -> V3 {
        v3(
            self.player.pos.x,
            self.player.pos.y + EYE_HEIGHT,
            self.player.pos.z,
        )
    }

    pub fn aim_direction(&self) -> V3 {
        self.player.aim_dir()
    }

    pub fn note_dropped(&mut self, n: u32) {
        self.dropped = self.dropped.saturating_add(n);
    }
}

/// Convenience for tests: run `steps` fixed ticks with a constant input.
#[cfg(test)]
pub fn run_steps(game: &mut Game, steps: u32, input: Input) {
    for _ in 0..steps {
        game.tick(1.0 / 60.0, input);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::enemy::Enemy;

    fn game_with_arena() -> Game {
        let mut g = Game::new(42);
        let mut data: Vec<f32> = Vec::new();
        data.extend_from_slice(&[-40.0, -1.0, -40.0, 40.0, 0.0, 40.0, 1.0]);
        // four walls
        data.extend_from_slice(&[-19.0, 0.0, -19.0, -18.0, 4.0, 19.0, 0.0]);
        data.extend_from_slice(&[18.0, 0.0, -19.0, 19.0, 4.0, 19.0, 0.0]);
        data.extend_from_slice(&[-19.0, 0.0, -19.0, 19.0, 4.0, -18.0, 0.0]);
        data.extend_from_slice(&[-19.0, 0.0, 18.0, 19.0, 4.0, 19.0, 0.0]);
        g.arena.load(&data);
        let spawns: Vec<f32> = vec![
            -14.0, -14.0, 14.0, -14.0, -14.0, 14.0, 14.0, 14.0, 0.0, -14.0, 0.0, 14.0, -14.0, 0.0,
            14.0, 0.0,
        ];
        g.set_spawns(&spawns);
        let nodes = vec![-12.0, 0.0, 12.0, 0.0, 0.0, -12.0];
        g.set_nodes(&nodes);
        g.set_player_start(0.0, 13.0, 0.0);
        g.reset(42);
        g
    }

    #[test]
    fn reset_starts_playing_with_full_health() {
        let g = game_with_arena();
        assert_eq!(g.phase, phase::PLAYING);
        assert_eq!(g.player.hp, 100.0);
        assert_eq!(g.time_left, MATCH_SECONDS);
        assert_eq!(g.waves.wave, 1);
        assert_eq!(g.nodes_active, 0);
    }

    #[test]
    fn idle_player_does_not_die_immediately() {
        let mut g = game_with_arena();
        run_steps(&mut g, 60, Input::default());
        assert_eq!(g.phase, phase::PLAYING);
        assert_eq!(g.tick, 60);
    }

    #[test]
    fn firing_consumes_ammo_and_recoils() {
        let mut g = game_with_arena();
        let input = Input {
            fire_pressed: true,
            ..Default::default()
        };
        g.tick(1.0 / 60.0, input);
        assert_eq!(g.player.ammo, weapons::SIDEARM.mag - 1);
        assert_eq!(g.shots, 1);
        run_steps(&mut g, 30, Input::default());
        assert!(g.player.recoil_pitch.abs() < 0.02);
    }

    #[test]
    fn hitscan_kills_an_enemy_in_front_of_the_player() {
        let mut g = game_with_arena();
        g.enemies[0] = Enemy::spawn(v3(0.0, 0.0, 4.0), enemy::KIND_SCOUT, 0.0, 0);
        g.enemies[0].state = enemy::ST_CHASE;
        g.player.pos = v3(0.0, 0.0, 10.0);
        g.player.yaw = 0.0;
        let mut killed = 0;
        for _ in 0..6 {
            g.tick(
                1.0 / 60.0,
                Input {
                    fire_pressed: true,
                    fire_held: true,
                    ..Default::default()
                },
            );
            run_steps(&mut g, 12, Input::default());
            if g.kills > killed {
                killed = g.kills;
            }
        }
        assert_eq!(killed, 1);
        assert!(g.hits >= 1);
    }

    #[test]
    fn wall_blocks_hitscan() {
        let mut g = Game::new(7);
        g.arena.load(&[
            -40.0, -1.0, -40.0, 40.0, 0.0, 40.0, 1.0, //
            -5.0, 0.0, 0.0, 5.0, 4.0, 1.0, 0.0,
        ]);
        g.set_spawns(&[0.0, -10.0]);
        g.set_player_start(0.0, 10.0, 0.0);
        g.reset(7);
        g.enemies[0] = Enemy::spawn(v3(0.0, 0.0, -4.0), enemy::KIND_SCOUT, 0.0, 0);
        g.tick(
            1.0 / 60.0,
            Input {
                fire_pressed: true,
                ..Default::default()
            },
        );
        assert_eq!(g.hits, 0, "bullet passed through a wall");
        assert_eq!(g.enemies[0].hp, enemy::SCOUT.hp);
    }

    #[test]
    fn terminal_channel_requires_hold() {
        let mut g = game_with_arena();
        g.player.pos = v3(-12.0, 0.0, 0.8);
        // short tap does not complete
        run_steps(
            &mut g,
            10,
            Input {
                interact: true,
                ..Default::default()
            },
        );
        assert!(g.nodes[0].progress > 0.0 && g.nodes[0].progress < 1.0);
        run_steps(&mut g, 10, Input::default());
        assert!(
            g.nodes[0].progress < 0.3,
            "progress must decay when released"
        );
        // full hold completes
        run_steps(
            &mut g,
            90,
            Input {
                interact: true,
                ..Default::default()
            },
        );
        assert!(g.nodes[0].active);
        assert_eq!(g.nodes_active, 1);
    }

    #[test]
    fn all_terminals_start_extraction_then_win() {
        let mut g = game_with_arena();
        for n in g.nodes.iter_mut() {
            n.active = true;
        }
        g.nodes_active = 3;
        g.tick(1.0 / 60.0, Input::default());
        assert_eq!(g.phase, phase::EXTRACTION);
        assert!(g.extraction > 11.0);
        run_steps(
            &mut g,
            (EXTRACTION_SECONDS * 60.0) as u32 + 5,
            Input::default(),
        );
        assert_eq!(g.phase, phase::WIN);
    }

    #[test]
    fn death_loses_the_match() {
        let mut g = game_with_arena();
        g.player.hp = 0.0;
        g.tick(1.0 / 60.0, Input::default());
        assert_eq!(g.phase, phase::LOSE);
    }

    #[test]
    fn timeout_loses_the_match() {
        let mut g = game_with_arena();
        g.time_elapsed = MATCH_SECONDS - 0.001;
        g.tick(1.0 / 60.0, Input::default());
        assert_eq!(g.phase, phase::LOSE);
    }

    #[test]
    fn wave_one_spawns_scouts_over_time() {
        let mut g = game_with_arena();
        for _ in 0..(60 * 12) {
            g.tick(1.0 / 60.0, Input::default());
            if g.alive_count() >= 3 {
                break;
            }
        }
        assert!(g.alive_count() >= 1, "no enemies spawned");
        assert!(g.waves.spawned >= 1);
        assert!(g
            .enemies
            .iter()
            .filter(|e| e.is_alive())
            .all(|e| e.kind == enemy::KIND_SCOUT));
    }

    #[test]
    fn same_seed_same_world() {
        let mut a = game_with_arena();
        let mut b = game_with_arena();
        let input = Input {
            move_z: 1.0,
            fire_held: true,
            ..Default::default()
        };
        for _ in 0..240 {
            a.tick(1.0 / 60.0, input);
            b.tick(1.0 / 60.0, input);
        }
        assert!((a.player.pos.x - b.player.pos.x).abs() < 1e-6);
        assert!((a.player.pos.z - b.player.pos.z).abs() < 1e-6);
        assert_eq!(a.kills, b.kills);
        for i in 0..MAX_ENEMIES {
            assert_eq!(a.enemies[i].pos.x, b.enemies[i].pos.x);
            assert_eq!(a.enemies[i].state, b.enemies[i].state);
        }
    }

    #[test]
    fn score_rewards_kills_and_nodes() {
        let mut g = game_with_arena();
        let base = g.compute_score();
        g.kills = 3;
        g.nodes_active = 2;
        g.damage_taken = 20.0;
        g.shots = 10;
        g.hits = 5;
        let s = g.compute_score();
        assert!(s > base);
        // 300 + 1000 + 250 - 40
        assert!((s - 1510.0).abs() < 1e-3, "{s}");
    }

    #[test]
    fn events_are_written_in_order() {
        let mut g = game_with_arena();
        g.reset(1);
        let before = g.event_seq;
        g.tick(
            1.0 / 60.0,
            Input {
                fire_pressed: true,
                ..Default::default()
            },
        );
        assert!(g.event_seq > before);
        let head = g.event_head;
        let slot = if head == 0 { MAX_EVENTS - 1 } else { head - 1 };
        let kind = g.snapshot[EVENT_BASE + slot * EVENT_STRIDE + EV_TYPE];
        assert_eq!(kind, ev::SHOT);
    }

    #[test]
    fn aim_assist_widens_the_hitbox() {
        let mut g = game_with_arena();
        g.player.pos = v3(0.0, 0.0, 10.0);
        g.player.yaw = 0.0;
        g.enemies[0] = Enemy::spawn(v3(0.72, 0.0, 4.0), enemy::KIND_SCOUT, 0.0, 0);
        g.enemies[0].state = enemy::ST_CHASE;
        g.aim_assist = false;
        g.tick(
            1.0 / 60.0,
            Input {
                fire_pressed: true,
                ..Default::default()
            },
        );
        let without = g.hits;
        g.player.ammo = 10;
        g.player.fire_cd = 0.0;
        g.aim_assist = true;
        g.hits = 0;
        g.shots = 0;
        g.tick(
            1.0 / 60.0,
            Input {
                fire_pressed: true,
                ..Default::default()
            },
        );
        assert!(g.hits >= without);
    }

    #[test]
    fn snapshot_reports_consistent_values() {
        let mut g = game_with_arena();
        run_steps(&mut g, 30, Input::default());
        let s = &g.snapshot;
        assert_eq!(s[H_PROTOCOL], PROTOCOL_VERSION as f32);
        assert!((s[H_HP] - g.player.hp).abs() < 1e-4);
        assert!((s[H_PLAYER_X] - g.player.pos.x).abs() < 1e-4);
        assert_eq!(s[H_WAVE], 1.0);
        assert!(s[H_TIME_LEFT] < MATCH_SECONDS);
        assert!(s[H_NODE_0] >= 0.0 && s[H_NODE_0] <= 1.0);
    }

    #[test]
    fn interceptor_state_shows_the_telegraph_before_damage() {
        let mut g = game_with_arena();
        g.waves.queue_head = g.waves.queue_len;
        g.player.pos = v3(0.0, 0.0, 0.0);
        g.enemies[0] = Enemy::spawn(v3(3.2, 0.0, 0.0), enemy::KIND_INTERCEPTOR, 0.0, 0);
        g.enemies[0].state = enemy::ST_FLANK;
        let telegraph_ticks = (enemy::INTERCEPTOR.telegraph / FIXED_DT).round() as u32;
        let mut charging_before_hit = 0u32;
        let mut hit = false;
        for _ in 0..(3 * 60) {
            let before = g.damage_taken;
            g.tick(FIXED_DT, Input::default());
            if g.damage_taken > before {
                hit = true;
                break;
            }
            if g.snapshot[ENEMY_BASE + E_STATE] == enemy::ST_CHARGE as f32 {
                charging_before_hit += 1;
            }
        }
        assert!(hit, "interceptor never hit the stationary player");
        assert!(
            charging_before_hit >= telegraph_ticks,
            "telegraph visible for {charging_before_hit} ticks, needs {telegraph_ticks}"
        );
    }

    #[test]
    fn interceptors_do_not_stack_on_top_of_each_other() {
        let mut g = game_with_arena();
        g.waves.queue_head = g.waves.queue_len;
        g.player.pos = v3(0.0, 0.0, 0.0);
        g.enemies[0] = Enemy::spawn(v3(5.0, 0.0, -5.0), enemy::KIND_INTERCEPTOR, 0.0, 0);
        g.enemies[1] = Enemy::spawn(v3(5.0, 0.0, -4.5), enemy::KIND_INTERCEPTOR, 0.0, 0);
        g.enemies[0].state = enemy::ST_FLANK;
        g.enemies[1].state = enemy::ST_FLANK;
        for _ in 0..120 {
            g.tick(FIXED_DT, Input::default());
            let d = g.enemies[0].pos.dist_xz(g.enemies[1].pos);
            assert!(d >= 0.9, "interceptors stacked at {d} m");
        }
    }
}
