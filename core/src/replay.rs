//! Registro de entradas y re-simulación determinista.
//!
//! El cliente graba, tick a tick, exactamente las entradas cuantizadas que la
//! simulación consumió. El servidor decodifica ese registro, vuelve a correr el
//! mismo crate de Rust con el mismo mapa y semilla, y calcula el puntaje él
//! mismo: la marca enviada por el cliente nunca se acepta como dato.
//!
//! Límite conocido: un replay impide puntajes falsificados, no impide un bot
//! que apunte perfecto. La entrada sigue siendo "humana" solo por confianza.

use crate::player::{quantize_axis, quantize_look, Input, LOOK_UNITS_PER_RAD};
use crate::protocol::phase;
use crate::sim::{Game, MODE_PRACTICE};

pub const MAGIC: [u8; 4] = *b"BPL1";
pub const LOG_VERSION: u8 = 1;
/// Techo de duración de una partida registrada: 20 minutos a 60 Hz.
pub const MAX_TICKS: u32 = 60 * 60 * 20;
const HEADER_LEN: usize = 16;
const MAX_RUN: u32 = 256;

const F_FIRE_HELD: u16 = 1 << 0;
const F_FIRE_PRESSED: u16 = 1 << 1;
const F_JUMP: u16 = 1 << 2;
const F_INTERACT: u16 = 1 << 3;
const F_RELOAD: u16 = 1 << 4;
const F_RUN: u16 = 1 << 5;
const F_ADS: u16 = 1 << 6;
const SWITCH_SHIFT: u16 = 7;
const FLAGS_MASK: u16 = 0x01FF;

const M_FLAGS: u8 = 1 << 0;
const M_MOVE_X: u8 = 1 << 1;
const M_MOVE_Z: u8 = 1 << 2;
const M_LOOK_X: u8 = 1 << 3;
const M_LOOK_Y: u8 = 1 << 4;
const MASK_ALL: u8 = 0x1F;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct Frame {
    pub flags: u16,
    pub move_x: i8,
    pub move_z: i8,
    pub look_x: i16,
    pub look_y: i16,
}

impl Frame {
    pub fn from_input(i: &Input) -> Frame {
        let mut flags = 0u16;
        if i.fire_held {
            flags |= F_FIRE_HELD;
        }
        if i.fire_pressed {
            flags |= F_FIRE_PRESSED;
        }
        if i.jump {
            flags |= F_JUMP;
        }
        if i.interact {
            flags |= F_INTERACT;
        }
        if i.reload {
            flags |= F_RELOAD;
        }
        if i.run {
            flags |= F_RUN;
        }
        if i.ads {
            flags |= F_ADS;
        }
        flags |= (i.switch.min(2) as u16) << SWITCH_SHIFT;
        Frame {
            flags,
            move_x: quantize_axis(i.move_x),
            move_z: quantize_axis(i.move_z),
            look_x: quantize_look(i.look_dx),
            look_y: quantize_look(i.look_dy),
        }
    }

    pub fn to_input(self) -> Input {
        Input {
            move_x: self.move_x as f32 / 127.0,
            move_z: self.move_z as f32 / 127.0,
            look_dx: self.look_x as f32 / LOOK_UNITS_PER_RAD,
            look_dy: self.look_y as f32 / LOOK_UNITS_PER_RAD,
            fire_held: self.flags & F_FIRE_HELD != 0,
            fire_pressed: self.flags & F_FIRE_PRESSED != 0,
            jump: self.flags & F_JUMP != 0,
            interact: self.flags & F_INTERACT != 0,
            reload: self.flags & F_RELOAD != 0,
            run: self.flags & F_RUN != 0,
            switch: ((self.flags >> SWITCH_SHIFT) & 3) as u8,
            ads: self.flags & F_ADS != 0,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Header {
    pub mode: u8,
    pub map: u8,
    pub flags: u8,
    pub seed: u32,
    pub ticks: u32,
}

/// Graba frames comprimiendo repeticiones consecutivas idénticas.
#[derive(Clone, Debug, Default)]
pub struct Recorder {
    runs: Vec<(u16, Frame)>,
    ticks: u32,
    truncated: bool,
}

impl Recorder {
    pub fn new() -> Recorder {
        Recorder::default()
    }

    pub fn push(&mut self, input: &Input) {
        if self.ticks >= MAX_TICKS {
            self.truncated = true;
            return;
        }
        let frame = Frame::from_input(input);
        match self.runs.last_mut() {
            Some((count, last)) if *last == frame && (*count as u32) < MAX_RUN => *count += 1,
            _ => self.runs.push((1, frame)),
        }
        self.ticks += 1;
    }

    pub fn ticks(&self) -> u32 {
        self.ticks
    }

    /// Una partida más larga que `MAX_TICKS` no es verificable.
    pub fn truncated(&self) -> bool {
        self.truncated
    }

    pub fn encode(&self, header: &Header) -> Vec<u8> {
        let mut out = Vec::with_capacity(HEADER_LEN + self.runs.len() * 6);
        out.extend_from_slice(&MAGIC);
        out.push(LOG_VERSION);
        out.push(header.mode);
        out.push(header.map);
        out.push(header.flags);
        out.extend_from_slice(&header.seed.to_le_bytes());
        out.extend_from_slice(&self.ticks.to_le_bytes());
        for (count, f) in &self.runs {
            out.push((*count - 1) as u8);
            let mut mask = 0u8;
            if f.flags != 0 {
                mask |= M_FLAGS;
            }
            if f.move_x != 0 {
                mask |= M_MOVE_X;
            }
            if f.move_z != 0 {
                mask |= M_MOVE_Z;
            }
            if f.look_x != 0 {
                mask |= M_LOOK_X;
            }
            if f.look_y != 0 {
                mask |= M_LOOK_Y;
            }
            out.push(mask);
            if mask & M_FLAGS != 0 {
                out.extend_from_slice(&f.flags.to_le_bytes());
            }
            if mask & M_MOVE_X != 0 {
                out.push(f.move_x as u8);
            }
            if mask & M_MOVE_Z != 0 {
                out.push(f.move_z as u8);
            }
            if mask & M_LOOK_X != 0 {
                out.extend_from_slice(&f.look_x.to_le_bytes());
            }
            if mask & M_LOOK_Y != 0 {
                out.extend_from_slice(&f.look_y.to_le_bytes());
            }
        }
        out
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReplayError {
    TooShort,
    BadMagic,
    BadVersion,
    BadMode,
    BadMap,
    TooManyTicks,
    Truncated,
    BadField,
    TickMismatch,
    TrailingBytes,
}

pub struct Log {
    pub header: Header,
    pub frames: Vec<Frame>,
}

struct Cursor<'a> {
    data: &'a [u8],
    at: usize,
}

impl<'a> Cursor<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8], ReplayError> {
        let end = self.at.checked_add(n).ok_or(ReplayError::Truncated)?;
        let slice = self.data.get(self.at..end).ok_or(ReplayError::Truncated)?;
        self.at = end;
        Ok(slice)
    }
    fn u8(&mut self) -> Result<u8, ReplayError> {
        Ok(self.take(1)?[0])
    }
    fn i8(&mut self) -> Result<i8, ReplayError> {
        Ok(self.take(1)?[0] as i8)
    }
    fn u16(&mut self) -> Result<u16, ReplayError> {
        let b = self.take(2)?;
        Ok(u16::from_le_bytes([b[0], b[1]]))
    }
    fn i16(&mut self) -> Result<i16, ReplayError> {
        Ok(self.u16()? as i16)
    }
    fn u32(&mut self) -> Result<u32, ReplayError> {
        let b = self.take(4)?;
        Ok(u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    }
}

/// Decodifica y valida un registro. Cualquier campo fuera de rango se rechaza:
/// el cuerpo viene de un cliente no confiable.
pub fn decode(bytes: &[u8]) -> Result<Log, ReplayError> {
    if bytes.len() < HEADER_LEN {
        return Err(ReplayError::TooShort);
    }
    let mut c = Cursor { data: bytes, at: 0 };
    if c.take(4)? != MAGIC {
        return Err(ReplayError::BadMagic);
    }
    if c.u8()? != LOG_VERSION {
        return Err(ReplayError::BadVersion);
    }
    let mode = c.u8()?;
    if mode > MODE_PRACTICE {
        return Err(ReplayError::BadMode);
    }
    let map = c.u8()?;
    if map >= crate::maps::MAP_COUNT {
        return Err(ReplayError::BadMap);
    }
    let flags = c.u8()?;
    if flags & !(crate::sim::FLAG_AIM_ASSIST | crate::sim::FLAG_AUTO_RELOAD) != 0 {
        return Err(ReplayError::BadField);
    }
    let seed = c.u32()?;
    let ticks = c.u32()?;
    if ticks > MAX_TICKS {
        return Err(ReplayError::TooManyTicks);
    }
    let mut frames: Vec<Frame> = Vec::with_capacity(ticks as usize);
    while frames.len() < ticks as usize {
        let count = c.u8()? as usize + 1;
        let mask = c.u8()?;
        if mask & !MASK_ALL != 0 {
            return Err(ReplayError::BadField);
        }
        let mut f = Frame::default();
        if mask & M_FLAGS != 0 {
            f.flags = c.u16()?;
            if f.flags & !FLAGS_MASK != 0 || (f.flags >> SWITCH_SHIFT) & 3 == 3 {
                return Err(ReplayError::BadField);
            }
        }
        if mask & M_MOVE_X != 0 {
            f.move_x = c.i8()?;
        }
        if mask & M_MOVE_Z != 0 {
            f.move_z = c.i8()?;
        }
        if mask & M_LOOK_X != 0 {
            f.look_x = c.i16()?;
        }
        if mask & M_LOOK_Y != 0 {
            f.look_y = c.i16()?;
        }
        if f.move_x == i8::MIN
            || f.move_z == i8::MIN
            || f.look_x == i16::MIN
            || f.look_y == i16::MIN
        {
            return Err(ReplayError::BadField);
        }
        if frames.len() + count > ticks as usize {
            return Err(ReplayError::TickMismatch);
        }
        frames.extend(std::iter::repeat(f).take(count));
    }
    if c.at != bytes.len() {
        return Err(ReplayError::TrailingBytes);
    }
    Ok(Log {
        header: Header {
            mode,
            map,
            flags,
            seed,
            ticks,
        },
        frames,
    })
}

#[derive(Clone, Debug, PartialEq)]
pub struct Outcome {
    pub score_version: u8,
    pub phase: u8,
    pub won: bool,
    pub ticks: u32,
    pub score: u32,
    pub kills: u32,
    pub shots: u32,
    pub hits: u32,
    pub nodes_active: u32,
    pub wave: u32,
    pub damage_taken: f32,
    pub time_elapsed: f32,
    /// FNV-1a del snapshot final: detecta cualquier divergencia entre objetivos.
    pub hash: u64,
}

pub fn hash_snapshot(g: &Game) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for v in g.snapshot.iter() {
        for b in v.to_bits().to_le_bytes() {
            h ^= b as u64;
            h = h.wrapping_mul(0x0000_0100_0000_01b3);
        }
    }
    h
}

pub fn outcome_of(g: &Game, ticks: u32) -> Outcome {
    Outcome {
        score_version: crate::sim::SCORE_VERSION,
        phase: g.phase as u8,
        won: g.phase == phase::WIN,
        ticks,
        score: g.final_score(),
        kills: g.kills,
        shots: g.shots,
        hits: g.hits,
        nodes_active: g.nodes_active,
        wave: g.waves.wave,
        damage_taken: g.damage_taken,
        time_elapsed: g.time_elapsed,
        hash: hash_snapshot(g),
    }
}

/// Re-simula un registro completo y devuelve el resultado calculado localmente.
pub fn run(log: &Log) -> Result<Outcome, ReplayError> {
    let mut g = Game::new(log.header.seed);
    if !g.start(
        log.header.mode,
        log.header.map,
        log.header.seed,
        log.header.flags,
    ) {
        return Err(ReplayError::BadMap);
    }
    let mut ticks = 0u32;
    for f in &log.frames {
        if g.phase != phase::PLAYING && g.phase != phase::EXTRACTION {
            // Un registro no puede continuar después del final de la partida.
            return Err(ReplayError::TickMismatch);
        }
        g.step(f.to_input());
        ticks += 1;
    }
    Ok(outcome_of(&g, ticks))
}

pub fn run_bytes(bytes: &[u8]) -> Result<Outcome, ReplayError> {
    run(&decode(bytes)?)
}

/// Entradas deterministas para el test dorado: una función pura del índice.
pub fn golden_input(t: u32) -> Input {
    let phase = t / 45;
    Input {
        move_x: match phase % 4 {
            1 => 1.0,
            3 => -1.0,
            _ => 0.0,
        },
        move_z: if phase % 3 == 2 { 0.0 } else { -1.0 },
        look_dx: (((t * 7) % 13) as i32 - 6) as f32 / LOOK_UNITS_PER_RAD * 40.0,
        look_dy: (((t * 5) % 7) as i32 - 3) as f32 / LOOK_UNITS_PER_RAD * 12.0,
        fire_held: t % 90 < 40,
        fire_pressed: t % 90 == 0,
        jump: t % 150 == 149,
        interact: t % 300 > 250,
        reload: t % 400 == 399,
        run: phase % 5 == 0,
        switch: if t % 500 == 250 {
            2
        } else if t % 500 == 0 {
            1
        } else {
            0
        },
        ads: t % 200 < 60,
    }
}

/// Corre la partida dorada (campo de práctica: el jugador nunca muere, así que
/// ejercita oleadas, disparos, recarga y daño durante todos los ticks).
pub fn golden_hash(ticks: u32) -> u64 {
    let mut g = Game::new(0x00C0_FFEE);
    g.start(MODE_PRACTICE, 0, 0x00C0_FFEE, crate::sim::FLAG_AUTO_RELOAD);
    for t in 0..ticks {
        if g.phase != phase::PLAYING && g.phase != phase::EXTRACTION {
            break;
        }
        g.step(golden_input(t));
    }
    hash_snapshot(&g)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sim::{FLAG_AUTO_RELOAD, MODE_MISSION};

    fn record(mode: u8, map: u8, seed: u32, flags: u8, ticks: u32) -> (Vec<u8>, Outcome) {
        let mut g = Game::new(seed);
        assert!(g.start(mode, map, seed, flags));
        let mut rec = Recorder::new();
        for t in 0..ticks {
            if g.phase != phase::PLAYING && g.phase != phase::EXTRACTION {
                break;
            }
            let q = golden_input(t).quantized();
            rec.push(&q);
            g.step(q);
        }
        let header = Header {
            mode,
            map,
            flags,
            seed,
            ticks: rec.ticks(),
        };
        (rec.encode(&header), outcome_of(&g, rec.ticks()))
    }

    #[test]
    fn frame_roundtrips_through_quantization() {
        for t in 0..2000 {
            let q = golden_input(t).quantized();
            assert_eq!(Frame::from_input(&q).to_input(), q, "tick {t}");
        }
    }

    #[test]
    fn replay_reproduces_the_live_run_exactly() {
        for map in 0..crate::maps::MAP_COUNT {
            let (bytes, live) =
                record(MODE_MISSION, map, 1234 + map as u32, FLAG_AUTO_RELOAD, 1500);
            let replayed = run_bytes(&bytes).expect("valid log");
            assert_eq!(replayed, live, "map {map}");
        }
    }

    #[test]
    fn different_seeds_produce_different_outcomes() {
        let (_, a) = record(MODE_MISSION, 0, 1, FLAG_AUTO_RELOAD, 1200);
        let (_, b) = record(MODE_MISSION, 0, 2, FLAG_AUTO_RELOAD, 1200);
        assert_ne!(a.hash, b.hash);
    }

    #[test]
    fn rle_shrinks_idle_input() {
        let mut rec = Recorder::new();
        for _ in 0..1000 {
            rec.push(&Input::default());
        }
        let header = Header {
            mode: 0,
            map: 0,
            flags: 0,
            seed: 1,
            ticks: rec.ticks(),
        };
        assert!(rec.encode(&header).len() < HEADER_LEN + 12);
    }

    #[test]
    fn decode_rejects_malformed_logs() {
        let (good, _) = record(MODE_MISSION, 0, 9, 0, 200);
        assert!(decode(&good).is_ok());
        assert_eq!(decode(&good[..8]).err(), Some(ReplayError::TooShort));
        let mut bad = good.clone();
        bad[0] = b'X';
        assert_eq!(decode(&bad).err(), Some(ReplayError::BadMagic));
        let mut bad = good.clone();
        bad[4] = 99;
        assert_eq!(decode(&bad).err(), Some(ReplayError::BadVersion));
        let mut bad = good.clone();
        bad[5] = 9;
        assert_eq!(decode(&bad).err(), Some(ReplayError::BadMode));
        let mut bad = good.clone();
        bad[6] = 9;
        assert_eq!(decode(&bad).err(), Some(ReplayError::BadMap));
        let mut bad = good.clone();
        bad[7] = 0x80;
        assert_eq!(decode(&bad).err(), Some(ReplayError::BadField));
        let mut bad = good.clone();
        bad.push(0);
        assert_eq!(decode(&bad).err(), Some(ReplayError::TrailingBytes));
        assert_eq!(
            decode(&good[..good.len() - 1]).err(),
            Some(ReplayError::Truncated)
        );
    }

    #[test]
    fn decode_rejects_absurd_tick_counts_without_allocating() {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&MAGIC);
        bytes.extend_from_slice(&[LOG_VERSION, 0, 0, 0]);
        bytes.extend_from_slice(&1u32.to_le_bytes());
        bytes.extend_from_slice(&u32::MAX.to_le_bytes());
        assert_eq!(decode(&bytes).err(), Some(ReplayError::TooManyTicks));
    }

    #[test]
    fn replay_rejects_frames_after_the_match_ended() {
        // Jugador quieto: la partida termina en derrota por daño o por tiempo.
        let mut g = Game::new(5);
        g.start(MODE_MISSION, 0, 5, 0);
        let mut rec = Recorder::new();
        while g.phase == phase::PLAYING {
            rec.push(&Input::default());
            g.step(Input::default());
        }
        assert_eq!(g.phase, phase::LOSE);
        let header = |ticks| Header {
            mode: 0,
            map: 0,
            flags: 0,
            seed: 5,
            ticks,
        };
        let exact = run_bytes(&rec.encode(&header(rec.ticks()))).expect("exact log replays");
        assert!(!exact.won);

        for _ in 0..5 {
            rec.push(&Input::default());
        }
        let padded = rec.encode(&header(rec.ticks()));
        assert_eq!(run_bytes(&padded).err(), Some(ReplayError::TickMismatch));
    }

    #[test]
    fn restarting_a_used_game_equals_a_fresh_game() {
        let play = |g: &mut Game| {
            g.start(MODE_MISSION, 1, 77, FLAG_AUTO_RELOAD);
            for t in 0..900 {
                g.step(golden_input(t));
            }
            hash_snapshot(g)
        };
        let mut used = Game::new(1);
        used.start(MODE_MISSION, 2, 5, 0);
        for t in 0..600 {
            used.step(golden_input(t + 31));
        }
        let mut fresh = Game::new(1);
        assert_eq!(play(&mut used), play(&mut fresh));
    }

    #[test]
    fn golden_hash_is_pinned() {
        // Si este valor cambia, cambió el comportamiento de la simulación o la
        // aritmética dejó de ser reproducible. El mismo número lo comprueba
        // vitest contra el wasm (tests/unit/determinism.test.ts).
        assert_eq!(golden_hash(GOLDEN_TICKS), GOLDEN_HASH);
    }

    const GOLDEN_TICKS: u32 = 4000;
    const GOLDEN_HASH: u64 = 6051080362437244339;
}
