//! Minimal vector / AABB math. No allocations, deterministic order of operations.
//!
//! Convention matches Three.js: `y` is up, `yaw = 0` looks down `-z`, positive yaw turns left.

use core::ops::{Add, AddAssign, Div, Mul, Neg, Sub, SubAssign};

pub const EPS: f32 = 1e-4;

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct V3 {
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

pub const fn v3(x: f32, y: f32, z: f32) -> V3 {
    V3 { x, y, z }
}

impl V3 {
    pub const ZERO: V3 = v3(0.0, 0.0, 0.0);
    pub const UP: V3 = v3(0.0, 1.0, 0.0);

    pub const fn new(x: f32, y: f32, z: f32) -> Self {
        V3 { x, y, z }
    }

    pub fn dot(self, o: V3) -> f32 {
        self.x * o.x + self.y * o.y + self.z * o.z
    }

    pub fn cross(self, o: V3) -> V3 {
        v3(
            self.y * o.z - self.z * o.y,
            self.z * o.x - self.x * o.z,
            self.x * o.y - self.y * o.x,
        )
    }

    pub fn len(self) -> f32 {
        self.dot(self).sqrt()
    }

    pub fn len_xz(self) -> f32 {
        (self.x * self.x + self.z * self.z).sqrt()
    }

    pub fn dist(self, o: V3) -> f32 {
        (self - o).len()
    }

    pub fn dist_xz(self, o: V3) -> f32 {
        (self - o).len_xz()
    }

    pub fn norm_or(self, fallback: V3) -> V3 {
        let l = self.len();
        if l > 1e-6 {
            self * (1.0 / l)
        } else {
            fallback
        }
    }

    /// Projection onto the ground plane (y = 0).
    pub fn flat(self) -> V3 {
        v3(self.x, 0.0, self.z)
    }

    pub fn with_y(self, y: f32) -> V3 {
        v3(self.x, y, self.z)
    }

    pub fn lerp(self, o: V3, t: f32) -> V3 {
        self + (o - self) * t
    }
}

impl Add for V3 {
    type Output = V3;
    fn add(self, o: V3) -> V3 {
        v3(self.x + o.x, self.y + o.y, self.z + o.z)
    }
}

impl Sub for V3 {
    type Output = V3;
    fn sub(self, o: V3) -> V3 {
        v3(self.x - o.x, self.y - o.y, self.z - o.z)
    }
}

impl Mul<f32> for V3 {
    type Output = V3;
    fn mul(self, s: f32) -> V3 {
        v3(self.x * s, self.y * s, self.z * s)
    }
}

impl Div<f32> for V3 {
    type Output = V3;
    fn div(self, s: f32) -> V3 {
        v3(self.x / s, self.y / s, self.z / s)
    }
}

impl Neg for V3 {
    type Output = V3;
    fn neg(self) -> V3 {
        v3(-self.x, -self.y, -self.z)
    }
}

impl AddAssign for V3 {
    fn add_assign(&mut self, o: V3) {
        *self = *self + o;
    }
}

impl SubAssign for V3 {
    fn sub_assign(&mut self, o: V3) {
        *self = *self - o;
    }
}

pub fn clamp(v: f32, lo: f32, hi: f32) -> f32 {
    if v < lo {
        lo
    } else if v > hi {
        hi
    } else {
        v
    }
}

pub fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}

/// Frame-rate independent approach: closes `delta` units towards the target.
pub fn approach(cur: f32, target: f32, delta: f32) -> f32 {
    if cur < target {
        (cur + delta).min(target)
    } else {
        (cur - delta).max(target)
    }
}

/// Exponential smoothing that stays stable for any `dt`.
pub fn damp(cur: f32, target: f32, lambda: f32, dt: f32) -> f32 {
    lerp(cur, target, 1.0 - (-lambda * dt).exp())
}

/// Wraps an angle into `(-PI, PI]`.
pub fn wrap_pi(mut a: f32) -> f32 {
    const TAU: f32 = core::f32::consts::TAU;
    while a > core::f32::consts::PI {
        a -= TAU;
    }
    while a <= -core::f32::consts::PI {
        a += TAU;
    }
    a
}

/// Forward unit vector for a first-person camera (Three.js `YXZ` order).
pub fn dir_from_yaw_pitch(yaw: f32, pitch: f32) -> V3 {
    let cp = pitch.cos();
    v3(-yaw.sin() * cp, pitch.sin(), -yaw.cos() * cp)
}

/// Ground-plane forward vector (ignores pitch).
pub fn forward_from_yaw(yaw: f32) -> V3 {
    v3(-yaw.sin(), 0.0, -yaw.cos())
}

/// Ground-plane right vector (ignores pitch).
pub fn right_from_yaw(yaw: f32) -> V3 {
    v3(yaw.cos(), 0.0, -yaw.sin())
}

/// Axis-aligned box, the only collider primitive the slice needs.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Aabb {
    pub min: V3,
    pub max: V3,
}

pub const EMPTY_AABB: Aabb = Aabb {
    min: V3::ZERO,
    max: V3::ZERO,
};

impl Aabb {
    pub fn from_center_size(center: V3, size: V3) -> Aabb {
        let h = size * 0.5;
        Aabb {
            min: center - h,
            max: center + h,
        }
    }

    pub fn from_min_max(min: V3, max: V3) -> Aabb {
        Aabb { min, max }
    }

    /// Feet-anchored capsule approximation: `feet` is the centre of the bottom face.
    pub fn from_feet(feet: V3, radius: f32, height: f32) -> Aabb {
        Aabb {
            min: v3(feet.x - radius, feet.y, feet.z - radius),
            max: v3(feet.x + radius, feet.y + height, feet.z + radius),
        }
    }

    pub fn center(&self) -> V3 {
        (self.min + self.max) * 0.5
    }

    pub fn size(&self) -> V3 {
        self.max - self.min
    }

    pub fn expand(&self, m: f32) -> Aabb {
        Aabb {
            min: self.min - v3(m, m, m),
            max: self.max + v3(m, m, m),
        }
    }

    pub fn overlaps(&self, o: &Aabb) -> bool {
        self.min.x < o.max.x
            && self.max.x > o.min.x
            && self.min.y < o.max.y
            && self.max.y > o.min.y
            && self.min.z < o.max.z
            && self.max.z > o.min.z
    }

    pub fn contains_point(&self, p: V3) -> bool {
        p.x >= self.min.x
            && p.x <= self.max.x
            && p.y >= self.min.y
            && p.y <= self.max.y
            && p.z >= self.min.z
            && p.z <= self.max.z
    }

    /// Slab ray test. Returns the entry distance along `dir` when `dir` is unit
    /// length, or `None` when the ray misses inside `t_max`.
    pub fn ray(&self, origin: V3, dir: V3, t_max: f32) -> Option<f32> {
        let mut t_near = 0.0f32;
        let mut t_far = t_max;
        let axes = [
            (origin.x, dir.x, self.min.x, self.max.x),
            (origin.y, dir.y, self.min.y, self.max.y),
            (origin.z, dir.z, self.min.z, self.max.z),
        ];
        for (o, d, lo, hi) in axes {
            if d.abs() < 1e-8 {
                if o < lo || o > hi {
                    return None;
                }
                continue;
            }
            let inv = 1.0 / d;
            let mut t1 = (lo - o) * inv;
            let mut t2 = (hi - o) * inv;
            if t1 > t2 {
                core::mem::swap(&mut t1, &mut t2);
            }
            t_near = t_near.max(t1);
            t_far = t_far.min(t2);
            if t_near > t_far {
                return None;
            }
        }
        Some(t_near)
    }

    pub fn ray_hits(&self, origin: V3, dir: V3, t_max: f32) -> bool {
        self.ray(origin, dir, t_max).is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn yaw_zero_looks_down_negative_z() {
        let f = dir_from_yaw_pitch(0.0, 0.0);
        assert!((f.z + 1.0).abs() < 1e-5, "{f:?}");
        assert!(f.y.abs() < 1e-5);
    }

    #[test]
    fn quarter_turn_yaw_looks_down_negative_x() {
        let f = dir_from_yaw_pitch(core::f32::consts::FRAC_PI_2, 0.0);
        assert!((f.x + 1.0).abs() < 1e-5, "{f:?}");
    }

    #[test]
    fn forward_and_right_are_orthogonal() {
        for yaw in [-2.1f32, 0.0, 0.7, 3.0] {
            let f = forward_from_yaw(yaw);
            let r = right_from_yaw(yaw);
            assert!(f.dot(r).abs() < 1e-5);
        }
    }

    #[test]
    fn right_of_default_view_is_positive_x() {
        let r = right_from_yaw(0.0);
        assert!((r.x - 1.0).abs() < 1e-5);
    }

    #[test]
    fn ray_hits_box_from_outside() {
        let b = Aabb::from_min_max(v3(-1.0, 0.0, -1.0), v3(1.0, 2.0, 1.0));
        let t = b.ray(v3(0.0, 1.0, 5.0), v3(0.0, 0.0, -1.0), 10.0).unwrap();
        assert!((t - 4.0).abs() < 1e-4, "{t}");
    }

    #[test]
    fn ray_misses_box_beside_it() {
        let b = Aabb::from_min_max(v3(-1.0, 0.0, -1.0), v3(1.0, 2.0, 1.0));
        assert!(b.ray(v3(4.0, 1.0, 5.0), v3(0.0, 0.0, -1.0), 10.0).is_none());
    }

    #[test]
    fn ray_respects_max_distance() {
        let b = Aabb::from_min_max(v3(-1.0, 0.0, -1.0), v3(1.0, 2.0, 1.0));
        assert!(b.ray(v3(0.0, 1.0, 5.0), v3(0.0, 0.0, -1.0), 2.0).is_none());
    }

    #[test]
    fn parallel_ray_outside_slab_misses() {
        let b = Aabb::from_min_max(v3(-1.0, 0.0, -1.0), v3(1.0, 2.0, 1.0));
        assert!(b.ray(v3(3.0, 1.0, 5.0), v3(0.0, 0.0, -1.0), 10.0).is_none());
    }

    #[test]
    fn overlap_detects_containment_but_not_touching() {
        let a = Aabb::from_center_size(v3(0.0, 0.0, 0.0), v3(2.0, 2.0, 2.0));
        let inner = Aabb::from_center_size(v3(0.0, 0.0, 0.0), v3(0.5, 0.5, 0.5));
        let touching = Aabb::from_min_max(v3(1.0, -1.0, -1.0), v3(2.0, 1.0, 1.0));
        assert!(a.overlaps(&inner));
        assert!(!a.overlaps(&touching));
    }

    #[test]
    fn wrap_pi_bounds() {
        assert!((wrap_pi(7.0) - (7.0 - core::f32::consts::TAU)).abs() < 1e-4);
        assert!((wrap_pi(-7.0) + (7.0 - core::f32::consts::TAU)).abs() < 1e-4);
    }
}
