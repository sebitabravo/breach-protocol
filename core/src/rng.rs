//! Seeded, allocation-free RNG so wave/behaviour tests are reproducible.

#[derive(Clone, Copy, Debug)]
pub struct Rng {
    state: u32,
}

impl Rng {
    pub fn new(seed: u32) -> Self {
        // Any non-zero state works for xorshift32; fold zero seeds forward.
        Rng {
            state: if seed == 0 { 0x9E37_79B9 } else { seed },
        }
    }

    pub fn next_u32(&mut self) -> u32 {
        let mut x = self.state;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.state = x;
        x
    }

    /// Uniform in `[0, 1)`.
    pub fn next_f32(&mut self) -> f32 {
        (self.next_u32() >> 8) as f32 * (1.0 / 16_777_216.0)
    }

    pub fn range(&mut self, lo: f32, hi: f32) -> f32 {
        lo + (hi - lo) * self.next_f32()
    }

    /// Uniform in `[-half, half]`.
    pub fn signed(&mut self, half: f32) -> f32 {
        self.range(-half, half)
    }

    pub fn below(&mut self, n: usize) -> usize {
        if n == 0 {
            0
        } else {
            (self.next_u32() as usize) % n
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_seed_same_sequence() {
        let mut a = Rng::new(1234);
        let mut b = Rng::new(1234);
        for _ in 0..64 {
            assert_eq!(a.next_u32(), b.next_u32());
        }
    }

    #[test]
    fn different_seed_diverges() {
        let mut a = Rng::new(1234);
        let mut b = Rng::new(4321);
        let mut same = 0;
        for _ in 0..32 {
            if a.next_u32() == b.next_u32() {
                same += 1;
            }
        }
        assert!(same < 2);
    }

    #[test]
    fn zero_seed_is_usable() {
        let mut a = Rng::new(0);
        assert_ne!(a.next_u32(), 0);
    }

    #[test]
    fn float_range_bounded() {
        let mut a = Rng::new(99);
        for _ in 0..1000 {
            let v = a.next_f32();
            assert!((0.0..1.0).contains(&v));
        }
    }
}
