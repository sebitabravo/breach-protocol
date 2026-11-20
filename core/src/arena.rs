//! Static collision world. Sector geometry lives in `maps.rs`; the renderer reads
//! it back through the ABI so the simulation and the view never disagree.

use crate::math::{v3, Aabb, EPS, V3};

pub const MAX_BOXES: usize = 512;
pub const FLOATS_PER_BOX: usize = 7;

#[derive(Clone, Copy, Debug)]
pub struct BoxCollider {
    pub aabb: Aabb,
    /// Layout role, useful for filtering and debugging: 0 wall, 1 floor, 2 crate, 3 pillar, 4 terminal.
    pub kind: u8,
}

pub const EMPTY_BOX: BoxCollider = BoxCollider {
    aabb: crate::math::EMPTY_AABB,
    kind: 0,
};

pub struct Arena {
    pub boxes: [BoxCollider; MAX_BOXES],
    pub len: usize,
    pub floor_y: f32,
    pub bounds: Aabb,
}

impl Arena {
    pub fn new() -> Self {
        Arena {
            boxes: [EMPTY_BOX; MAX_BOXES],
            len: 0,
            floor_y: 0.0,
            bounds: Aabb::from_min_max(v3(-18.0, 0.0, -18.0), v3(18.0, 6.0, 18.0)),
        }
    }

    pub fn clear(&mut self) {
        self.len = 0;
    }

    /// `data` is `[min_x, min_y, min_z, max_x, max_y, max_z, kind]` per box.
    pub fn load(&mut self, data: &[f32]) -> usize {
        self.load_boxes(
            data.chunks_exact(FLOATS_PER_BOX)
                .map(|c| (v3(c[0], c[1], c[2]), v3(c[3], c[4], c[5]), c[6] as u8)),
        )
    }

    /// Carga la geometría de un sector definido en `maps.rs`.
    pub fn load_solids(&mut self, solids: &[crate::maps::Solid]) -> usize {
        self.load_boxes(solids.iter().map(|s| {
            (
                V3::new(s.min[0], s.min[1], s.min[2]),
                V3::new(s.max[0], s.max[1], s.max[2]),
                s.kind,
            )
        }))
    }

    fn load_boxes(&mut self, boxes: impl Iterator<Item = (V3, V3, u8)>) -> usize {
        self.clear();
        let mut bounds_min = v3(f32::MAX, f32::MAX, f32::MAX);
        let mut bounds_max = v3(f32::MIN, f32::MIN, f32::MIN);
        for (min, max, kind) in boxes {
            if self.len >= MAX_BOXES {
                break;
            }
            let aabb = Aabb::from_min_max(min, max);
            bounds_min.x = bounds_min.x.min(aabb.min.x);
            bounds_min.y = bounds_min.y.min(aabb.min.y);
            bounds_min.z = bounds_min.z.min(aabb.min.z);
            bounds_max.x = bounds_max.x.max(aabb.max.x);
            bounds_max.y = bounds_max.y.max(aabb.max.y);
            bounds_max.z = bounds_max.z.max(aabb.max.z);
            self.boxes[self.len] = BoxCollider { aabb, kind };
            self.len += 1;
        }
        if self.len > 0 {
            self.bounds = Aabb::from_min_max(bounds_min, bounds_max);
        } else {
            self.bounds = Aabb::from_min_max(v3(-18.0, 0.0, -18.0), v3(18.0, 6.0, 18.0));
        }
        self.len
    }

    pub fn solids(&self) -> &[BoxCollider] {
        &self.boxes[..self.len]
    }

    /// Nearest wall hit along a ray. Used by hitscan and line of sight.
    pub fn ray(&self, origin: V3, dir: V3, t_max: f32) -> Option<f32> {
        let mut best = t_max;
        let mut hit = false;
        for b in self.solids() {
            if let Some(t) = b.aabb.ray(origin, dir, best) {
                if t < best {
                    best = t;
                    hit = true;
                }
            }
        }
        if hit {
            Some(best)
        } else {
            None
        }
    }

    pub fn blocked(&self, from: V3, to: V3) -> bool {
        let d = to - from;
        let len = d.len();
        if len < EPS {
            return false;
        }
        self.ray(from, d * (1.0 / len), len).is_some()
    }

    /// Pushes a feet-anchored capsule out of the world, one axis at a time.
    /// Returns whether the body ended up on the ground.
    pub fn move_body(
        &self,
        pos: &mut V3,
        vel: &mut V3,
        radius: f32,
        height: f32,
        dt: f32,
        step_height: f32,
    ) -> bool {
        // --- horizontal X ---
        pos.x += vel.x * dt;
        for b in self.solids() {
            let body = Aabb::from_feet(*pos, radius, height);
            if !body.overlaps(&b.aabb) {
                continue;
            }
            if b.aabb.max.y - pos.y <= step_height && b.aabb.max.y > pos.y {
                pos.y = b.aabb.max.y;
                continue;
            }
            if vel.x > 0.0 {
                pos.x = b.aabb.min.x - radius - EPS;
            } else if vel.x < 0.0 {
                pos.x = b.aabb.max.x + radius + EPS;
            }
            vel.x = 0.0;
        }

        // --- horizontal Z ---
        pos.z += vel.z * dt;
        for b in self.solids() {
            let body = Aabb::from_feet(*pos, radius, height);
            if !body.overlaps(&b.aabb) {
                continue;
            }
            if b.aabb.max.y - pos.y <= step_height && b.aabb.max.y > pos.y {
                pos.y = b.aabb.max.y;
                continue;
            }
            if vel.z > 0.0 {
                pos.z = b.aabb.min.z - radius - EPS;
            } else if vel.z < 0.0 {
                pos.z = b.aabb.max.z + radius + EPS;
            }
            vel.z = 0.0;
        }

        // --- vertical ---
        let mut grounded = false;
        pos.y += vel.y * dt;
        if pos.y <= self.floor_y {
            pos.y = self.floor_y;
            vel.y = 0.0;
            grounded = true;
        } else if vel.y <= 0.0 {
            for b in self.solids() {
                let body = Aabb::from_feet(*pos, radius, height);
                if !body.overlaps(&b.aabb) {
                    continue;
                }
                let top = b.aabb.max.y;
                if pos.y < top && pos.y + height > b.aabb.min.y {
                    pos.y = top;
                    vel.y = 0.0;
                    grounded = true;
                }
            }
        } else {
            for b in self.solids() {
                let body = Aabb::from_feet(*pos, radius, height);
                if !body.overlaps(&b.aabb) {
                    continue;
                }
                if body.min.y + 0.05 < b.aabb.min.y && body.max.y > b.aabb.min.y + 0.05 {
                    pos.y = b.aabb.min.y - height - EPS;
                    vel.y = 0.0;
                }
            }
        }

        // Hard safety net: never leave the arena envelope even if a future
        // layout has a gap the collider solver cannot see.
        let pad = 0.5;
        pos.x = pos
            .x
            .clamp(self.bounds.min.x + pad, self.bounds.max.x - pad);
        pos.z = pos
            .z
            .clamp(self.bounds.min.z + pad, self.bounds.max.z - pad);
        grounded
    }
}

impl Default for Arena {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wall() -> Arena {
        let mut a = Arena::new();
        a.load(&[
            // full floor plate
            -18.0, -1.0, -18.0, 18.0, 0.0, 18.0, 1.0, //
            // wall across z = 0, from x = -2 to 2
            -2.0, 0.0, -0.5, 2.0, 3.0, 0.5, 0.0,
        ]);
        a
    }

    #[test]
    fn loads_box_data() {
        let a = wall();
        assert_eq!(a.len, 2);
        assert_eq!(a.solids()[1].aabb.max.y, 3.0);
    }

    #[test]
    fn player_stops_at_wall() {
        let a = wall();
        let mut p = v3(0.0, 0.0, 4.0);
        let mut v = v3(0.0, 0.0, -10.0);
        for _ in 0..120 {
            a.move_body(&mut p, &mut v, 0.35, 1.8, 1.0 / 60.0, 0.3);
        }
        assert!(p.z > 0.5, "player tunneled through the wall: {p:?}");
        assert!(p.z < 0.95, "player stopped too early: {p:?}");
        assert_eq!(v.z, 0.0);
    }

    #[test]
    fn gravity_lands_on_floor() {
        let a = wall();
        let mut p = v3(0.0, 4.0, 8.0);
        let mut v = v3(0.0, 0.0, 0.0);
        let mut grounded = false;
        for _ in 0..240 {
            v.y -= 20.0 / 60.0;
            grounded = a.move_body(&mut p, &mut v, 0.35, 1.8, 1.0 / 60.0, 0.3);
            if grounded {
                break;
            }
        }
        assert!(grounded);
        assert!((p.y - 0.0).abs() < 1e-3, "{p:?}");
    }

    #[test]
    fn lands_on_top_of_crate() {
        let mut a = Arena::new();
        a.load(&[
            -18.0, -1.0, -18.0, 18.0, 0.0, 18.0, 1.0, -1.5, 0.0, -1.5, 1.5, 1.2, 1.5, 2.0,
        ]);
        let mut p = v3(0.0, 3.0, 0.0);
        let mut v = v3(0.0, 0.0, 0.0);
        for _ in 0..240 {
            v.y -= 20.0 / 60.0;
            if a.move_body(&mut p, &mut v, 0.35, 1.8, 1.0 / 60.0, 0.3) {
                break;
            }
        }
        assert!(
            (p.y - 1.2).abs() < 1e-3,
            "expected to rest on crate top: {p:?}"
        );
    }

    #[test]
    fn stays_inside_bounds_when_pushed_out() {
        let a = wall();
        let mut p = v3(0.0, 0.0, 0.0);
        let mut v = v3(200.0, 0.0, 0.0);
        a.move_body(&mut p, &mut v, 0.35, 1.8, 1.0, 0.3);
        assert!(p.x <= a.bounds.max.x, "{p:?}");
    }

    #[test]
    fn line_of_sight_blocked_by_wall() {
        let a = wall();
        assert!(a.blocked(v3(0.0, 1.6, 4.0), v3(0.0, 1.6, -4.0)));
        assert!(!a.blocked(v3(6.0, 1.6, 4.0), v3(6.0, 1.6, -4.0)));
    }
}
