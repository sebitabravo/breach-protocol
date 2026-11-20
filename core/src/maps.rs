//! Datos de los sectores: colisiones, terminales, puntos de aparición y tema.
//!
//! Viven en Rust (y no en TypeScript) porque el servidor de clasificación
//! necesita el mismo mapa para re-simular una partida, y porque así el cliente
//! y la simulación nunca discrepan sobre la geometría. La decoración puramente
//! visual (luminarias, vigas, paneles) sigue en el renderer: no colisiona.

pub const KIND_WALL: u8 = 0;
pub const KIND_FLOOR: u8 = 1;
pub const KIND_CRATE: u8 = 2;
pub const KIND_PILLAR: u8 = 3;
pub const KIND_PLINTH: u8 = 4;
pub const KIND_COVER: u8 = 5;
pub const KIND_RACK: u8 = 6;
pub const KIND_DECK: u8 = 7;

pub const THEME_CONTROL: u8 = 0;
pub const THEME_CRYO: u8 = 1;
pub const THEME_ARCHIVE: u8 = 2;

pub const MAP_COUNT: u8 = 3;

#[derive(Clone, Copy, Debug)]
pub struct Solid {
    pub min: [f32; 3],
    pub max: [f32; 3],
    pub kind: u8,
}

pub struct MapDef {
    pub id: u8,
    pub name: &'static str,
    pub theme: u8,
    pub solids: &'static [Solid],
    /// Terminales: `[x, y, z]`, con `y` la altura del suelo donde se para el jugador.
    pub nodes: &'static [[f32; 3]],
    pub spawns: &'static [[f32; 2]],
    pub start: [f32; 3],
    /// Mitad del lado visible del recinto, para cámaras y límites.
    pub half_x: f32,
    pub half_z: f32,
}

/// Caja definida por centro y tamaño.
const fn s(cx: f32, cy: f32, cz: f32, sx: f32, sy: f32, sz: f32, kind: u8) -> Solid {
    Solid {
        min: [cx - sx * 0.5, cy - sy * 0.5, cz - sz * 0.5],
        max: [cx + sx * 0.5, cy + sy * 0.5, cz + sz * 0.5],
        kind,
    }
}

pub fn get(id: u8) -> Option<&'static MapDef> {
    match id {
        0 => Some(&SECTOR_01),
        1 => Some(&SECTOR_02),
        2 => Some(&SECTOR_03),
        _ => None,
    }
}

// ------------------------------------------------------------------ SECTOR_01
// Control de Acceso: arena cerrada con núcleo central, enseña el bucle básico.

pub static SECTOR_01: MapDef = MapDef {
    id: 0,
    name: "SECTOR_01 · Control de Acceso",
    theme: THEME_CONTROL,
    solids: &[
        s(0.0, -0.5, 0.0, 36.0, 1.0, 36.0, KIND_FLOOR),
        s(0.0, 3.0, -17.5, 36.0, 6.0, 1.0, KIND_WALL),
        s(0.0, 3.0, 17.5, 36.0, 6.0, 1.0, KIND_WALL),
        s(-17.5, 3.0, 0.0, 1.0, 6.0, 36.0, KIND_WALL),
        s(17.5, 3.0, 0.0, 1.0, 6.0, 36.0, KIND_WALL),
        s(0.0, 3.0, 0.0, 4.0, 6.0, 4.0, KIND_PILLAR),
        s(-7.0, 1.0, -7.0, 4.0, 2.0, 2.4, KIND_COVER),
        s(7.0, 1.0, -7.0, 2.4, 2.0, 4.0, KIND_COVER),
        s(-7.0, 1.0, 7.0, 2.4, 2.0, 4.0, KIND_COVER),
        s(7.0, 1.0, 7.0, 4.0, 2.0, 2.4, KIND_COVER),
        s(-4.0, 0.35, 10.5, 1.6, 0.7, 1.6, KIND_CRATE),
        s(4.0, 0.35, 10.5, 1.6, 0.7, 1.6, KIND_CRATE),
        s(-4.0, 0.35, -10.5, 1.6, 0.7, 1.6, KIND_CRATE),
        s(4.0, 0.35, -10.5, 1.6, 0.7, 1.6, KIND_CRATE),
        s(-13.0, 1.6, -9.0, 0.8, 3.2, 6.0, KIND_WALL),
        s(-13.0, 1.6, 9.0, 0.8, 3.2, 6.0, KIND_WALL),
        s(13.0, 1.6, -9.0, 0.8, 3.2, 6.0, KIND_WALL),
        s(13.0, 1.6, 9.0, 0.8, 3.2, 6.0, KIND_WALL),
        s(-12.0, 0.6, 0.0, 1.3, 1.2, 1.3, KIND_PLINTH),
        s(12.0, 0.6, 0.0, 1.3, 1.2, 1.3, KIND_PLINTH),
        s(0.0, 0.6, -12.0, 1.3, 1.2, 1.3, KIND_PLINTH),
    ],
    nodes: &[[-12.0, 0.0, 0.0], [12.0, 0.0, 0.0], [0.0, 0.0, -12.0]],
    spawns: &[
        [9.0, 14.5],
        [14.2, 2.0],
        [-14.2, 2.0],
        [0.0, -14.5],
        [10.0, 10.0],
        [-10.0, 10.0],
        [10.0, -10.0],
        [-10.0, -10.0],
    ],
    start: [0.0, 13.0, 0.0],
    half_x: 18.0,
    half_z: 18.0,
};

// ------------------------------------------------------------------ SECTOR_02
// Refrigeración: pasillo largo con torres de enfriamiento; presenta al Interceptor.

pub static SECTOR_02: MapDef = MapDef {
    id: 1,
    name: "SECTOR_02 · Refrigeración",
    theme: THEME_CRYO,
    solids: &[
        s(0.0, -0.5, 0.0, 60.0, 1.0, 32.0, KIND_FLOOR),
        s(0.0, 3.5, -15.5, 60.0, 7.0, 1.0, KIND_WALL),
        s(0.0, 3.5, 15.5, 60.0, 7.0, 1.0, KIND_WALL),
        s(-29.5, 3.5, 0.0, 1.0, 7.0, 32.0, KIND_WALL),
        s(29.5, 3.5, 0.0, 1.0, 7.0, 32.0, KIND_WALL),
        s(-20.0, 3.5, -7.0, 3.0, 7.0, 3.0, KIND_PILLAR),
        s(-8.0, 3.5, -7.0, 3.0, 7.0, 3.0, KIND_PILLAR),
        s(8.0, 3.5, -7.0, 3.0, 7.0, 3.0, KIND_PILLAR),
        s(20.0, 3.5, -7.0, 3.0, 7.0, 3.0, KIND_PILLAR),
        s(-20.0, 3.5, 7.0, 3.0, 7.0, 3.0, KIND_PILLAR),
        s(-8.0, 3.5, 7.0, 3.0, 7.0, 3.0, KIND_PILLAR),
        s(8.0, 3.5, 7.0, 3.0, 7.0, 3.0, KIND_PILLAR),
        s(20.0, 3.5, 7.0, 3.0, 7.0, 3.0, KIND_PILLAR),
        s(0.0, 0.55, 0.0, 8.0, 1.1, 1.0, KIND_COVER),
        s(-14.0, 0.55, 0.0, 1.0, 1.1, 5.0, KIND_COVER),
        s(14.0, 0.55, 0.0, 1.0, 1.1, 5.0, KIND_COVER),
        s(-26.0, 0.35, -11.0, 1.6, 0.7, 1.6, KIND_CRATE),
        s(26.0, 0.35, 11.0, 1.6, 0.7, 1.6, KIND_CRATE),
        s(-26.0, 0.35, 11.0, 1.6, 0.7, 1.6, KIND_CRATE),
        s(26.0, 0.35, -11.0, 1.6, 0.7, 1.6, KIND_CRATE),
        s(-26.0, 0.6, 0.0, 1.3, 1.2, 1.3, KIND_PLINTH),
        s(0.0, 0.6, -12.5, 1.3, 1.2, 1.3, KIND_PLINTH),
        s(0.0, 0.6, 12.5, 1.3, 1.2, 1.3, KIND_PLINTH),
    ],
    nodes: &[[-26.0, 0.0, 0.0], [0.0, 0.0, -12.5], [0.0, 0.0, 12.5]],
    spawns: &[
        [-27.0, -12.0],
        [-27.0, 12.0],
        [-17.0, 0.0],
        [-10.0, -12.0],
        [-10.0, 12.0],
        [10.0, -12.0],
        [10.0, 12.0],
        [0.0, -6.0],
    ],
    // yaw = PI/2 mira hacia -x (el extremo con la primera terminal).
    start: [25.0, 0.0, core::f32::consts::FRAC_PI_2],
    half_x: 30.0,
    half_z: 16.0,
};

// ------------------------------------------------------------------ SECTOR_03
// Archivo: pasillos estrechos entre racks y una pasarela elevada con una terminal.

pub static SECTOR_03: MapDef = MapDef {
    id: 2,
    name: "SECTOR_03 · Archivo",
    theme: THEME_ARCHIVE,
    solids: &[
        s(0.0, -0.5, 0.0, 38.0, 1.0, 38.0, KIND_FLOOR),
        s(0.0, 3.5, -18.5, 38.0, 7.0, 1.0, KIND_WALL),
        s(0.0, 3.5, 18.5, 38.0, 7.0, 1.0, KIND_WALL),
        s(-18.5, 3.5, 0.0, 1.0, 7.0, 38.0, KIND_WALL),
        s(18.5, 3.5, 0.0, 1.0, 7.0, 38.0, KIND_WALL),
        s(-13.5, 1.3, -7.25, 2.6, 2.6, 9.5, KIND_RACK),
        s(-13.5, 1.3, 7.25, 2.6, 2.6, 9.5, KIND_RACK),
        s(-6.75, 1.3, -7.25, 2.6, 2.6, 9.5, KIND_RACK),
        s(-6.75, 1.3, 7.25, 2.6, 2.6, 9.5, KIND_RACK),
        s(0.0, 1.3, -7.25, 2.6, 2.6, 9.5, KIND_RACK),
        s(0.0, 1.3, 7.25, 2.6, 2.6, 9.5, KIND_RACK),
        s(6.75, 1.3, -7.25, 2.6, 2.6, 9.5, KIND_RACK),
        s(6.75, 1.3, 7.25, 2.6, 2.6, 9.5, KIND_RACK),
        s(13.5, 1.3, -7.25, 2.6, 2.6, 9.5, KIND_RACK),
        s(13.5, 1.3, 7.25, 2.6, 2.6, 9.5, KIND_RACK),
        s(0.0, 2.65, -16.3, 35.6, 0.3, 3.0, KIND_DECK),
        s(-16.5, 0.35, -11.6, 2.0, 0.7, 1.2, KIND_CRATE),
        s(-16.5, 0.7, -12.8, 2.0, 1.4, 1.2, KIND_CRATE),
        s(-16.5, 1.05, -14.0, 2.0, 2.1, 1.2, KIND_CRATE),
        s(16.5, 0.35, -11.6, 2.0, 0.7, 1.2, KIND_CRATE),
        s(16.5, 0.7, -12.8, 2.0, 1.4, 1.2, KIND_CRATE),
        s(16.5, 1.05, -14.0, 2.0, 2.1, 1.2, KIND_CRATE),
        s(0.0, 3.4, -16.3, 1.3, 1.2, 1.3, KIND_PLINTH),
        s(-16.5, 0.6, 0.0, 1.3, 1.2, 1.3, KIND_PLINTH),
        s(16.5, 0.6, 0.0, 1.3, 1.2, 1.3, KIND_PLINTH),
    ],
    nodes: &[[-16.5, 0.0, 0.0], [16.5, 0.0, 0.0], [0.0, 2.8, -16.3]],
    spawns: &[
        [-10.1, -7.0],
        [-3.4, -7.0],
        [3.4, -7.0],
        [10.1, -7.0],
        [-10.1, 7.0],
        [10.1, 7.0],
        [0.0, -13.5],
        [0.0, 0.0],
    ],
    start: [0.0, 16.0, 0.0],
    half_x: 19.0,
    half_z: 19.0,
};

#[cfg(test)]
mod tests {
    use super::*;
    use crate::player::{HEIGHT, RADIUS};
    use crate::sim::NODE_RADIUS;

    fn all() -> impl Iterator<Item = &'static MapDef> {
        (0..MAP_COUNT).map(|id| get(id).expect("map exists"))
    }

    /// Obstáculos que frenan a un jugador a pie: no pisables (> 0.75 m) y a su altura.
    fn blocks_walking(s: &Solid) -> bool {
        s.kind != KIND_FLOOR && s.min[1] < HEIGHT && s.max[1] > 0.75
    }

    fn inside_xz(s: &Solid, x: f32, z: f32, margin: f32) -> bool {
        x > s.min[0] - margin
            && x < s.max[0] + margin
            && z > s.min[2] - margin
            && z < s.max[2] + margin
    }

    #[test]
    fn ids_are_dense_and_unknown_ids_are_rejected() {
        for (i, m) in all().enumerate() {
            assert_eq!(m.id as usize, i);
        }
        assert!(get(MAP_COUNT).is_none());
    }

    #[test]
    fn every_solid_has_positive_volume() {
        for m in all() {
            for s in m.solids {
                for axis in 0..3 {
                    assert!(
                        s.min[axis] < s.max[axis],
                        "{} has a degenerate solid {:?}",
                        m.name,
                        s
                    );
                }
            }
        }
    }

    #[test]
    fn solids_never_overlap_in_volume() {
        for m in all() {
            for (i, a) in m.solids.iter().enumerate() {
                for b in &m.solids[i + 1..] {
                    let overlap =
                        (0..3).all(|k| a.min[k] < b.max[k] - 1e-4 && b.min[k] < a.max[k] - 1e-4);
                    // Las esquinas de los muros perimetrales se solapan sin consecuencia.
                    let corner = a.kind == KIND_WALL && b.kind == KIND_WALL;
                    assert!(!overlap || corner, "{}: {:?} overlaps {:?}", m.name, a, b);
                }
            }
        }
    }

    #[test]
    fn spawns_are_free_and_far_from_the_player_start() {
        for m in all() {
            assert_eq!(m.spawns.len(), 8, "{}", m.name);
            for sp in m.spawns {
                assert!(
                    sp[0].abs() < m.half_x && sp[1].abs() < m.half_z,
                    "{} spawn out of bounds",
                    m.name
                );
                for s in m.solids.iter().filter(|s| blocks_walking(s)) {
                    assert!(
                        !inside_xz(s, sp[0], sp[1], 0.5),
                        "{}: spawn {:?} inside {:?}",
                        m.name,
                        sp,
                        s
                    );
                }
                let d = ((sp[0] - m.start[0]).powi(2) + (sp[1] - m.start[1]).powi(2)).sqrt();
                assert!(d >= 9.0, "{}: spawn {:?} only {d} m from start", m.name, sp);
            }
        }
    }

    #[test]
    fn start_is_free() {
        for m in all() {
            for s in m.solids.iter().filter(|s| blocks_walking(s)) {
                assert!(
                    !inside_xz(s, m.start[0], m.start[1], RADIUS),
                    "{}: start inside {:?}",
                    m.name,
                    s
                );
            }
        }
    }

    #[test]
    fn every_map_has_three_distinct_nodes_inside_bounds() {
        for m in all() {
            assert_eq!(m.nodes.len(), 3, "{}", m.name);
            for (i, a) in m.nodes.iter().enumerate() {
                assert!(a[0].abs() < m.half_x && a[2].abs() < m.half_z);
                for b in &m.nodes[i + 1..] {
                    assert!((a[0] - b[0]).abs() + (a[2] - b[2]).abs() > 2.0 * NODE_RADIUS);
                }
            }
        }
    }

    /// BFS sobre una grilla de 0.25 m con los obstáculos inflados por el radio del jugador.
    #[test]
    fn ground_nodes_are_reachable_on_foot_from_the_start() {
        const CELL: f32 = 0.25;
        for m in all() {
            let w = (m.half_x * 2.0 / CELL) as usize;
            let h = (m.half_z * 2.0 / CELL) as usize;
            let blockers: Vec<&Solid> = m.solids.iter().filter(|s| blocks_walking(s)).collect();
            let center = |ix: usize, iz: usize| {
                (
                    -m.half_x + (ix as f32 + 0.5) * CELL,
                    -m.half_z + (iz as f32 + 0.5) * CELL,
                )
            };
            let free = |ix: usize, iz: usize| {
                let (x, z) = center(ix, iz);
                !blockers.iter().any(|s| inside_xz(s, x, z, RADIUS))
            };
            let cell_of = |x: f32, z: f32| {
                (
                    ((x + m.half_x) / CELL) as usize,
                    ((z + m.half_z) / CELL) as usize,
                )
            };
            let (sx, sz) = cell_of(m.start[0], m.start[1]);
            let mut seen = vec![false; w * h];
            let mut queue = std::collections::VecDeque::new();
            seen[sz * w + sx] = true;
            queue.push_back((sx, sz));
            while let Some((x, z)) = queue.pop_front() {
                for (dx, dz) in [(1i32, 0i32), (-1, 0), (0, 1), (0, -1)] {
                    let nx = x as i32 + dx;
                    let nz = z as i32 + dz;
                    if nx < 0 || nz < 0 || nx as usize >= w || nz as usize >= h {
                        continue;
                    }
                    let (nx, nz) = (nx as usize, nz as usize);
                    if !seen[nz * w + nx] && free(nx, nz) {
                        seen[nz * w + nx] = true;
                        queue.push_back((nx, nz));
                    }
                }
            }
            for n in m.nodes.iter().filter(|n| n[1] == 0.0) {
                let reachable = (0..h).any(|iz| {
                    (0..w).any(|ix| {
                        let (x, z) = center(ix, iz);
                        seen[iz * w + ix]
                            && ((x - n[0]).powi(2) + (z - n[2]).powi(2)).sqrt() < NODE_RADIUS
                    })
                });
                assert!(reachable, "{}: node {:?} unreachable on foot", m.name, n);
            }
        }
    }
}
