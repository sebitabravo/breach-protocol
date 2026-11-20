/**
 * Interpolación de la cámara entre ticks fijos. Los extremos solo avanzan
 * cuando cambia `tick`; si se actualizaran en cada frame de render la cámara
 * saltaría a 60 Hz en vez de interpolar.
 */
export interface Pose {
  px: number;
  py: number;
  pz: number;
  yaw: number;
  pitch: number;
}

export class PoseInterpolator {
  private prev: Pose | null = null;
  private last: Pose | null = null;
  private lastTick = -1;

  sample(pose: Pose, tick: number, alpha: number): Pose {
    if (this.last === null || tick < this.lastTick) {
      this.prev = { ...pose };
      this.last = { ...pose };
      this.lastTick = tick;
      return { ...pose };
    }
    if (tick !== this.lastTick) {
      this.prev = this.last;
      this.last = { ...pose };
      this.lastTick = tick;
    }
    const a = Math.min(Math.max(alpha, 0), 1);
    const prev = this.prev as Pose;
    const last = this.last;
    const dyaw = last.yaw - prev.yaw;
    return {
      px: prev.px + (last.px - prev.px) * a,
      py: prev.py + (last.py - prev.py) * a,
      pz: prev.pz + (last.pz - prev.pz) * a,
      yaw: prev.yaw + Math.atan2(Math.sin(dyaw), Math.cos(dyaw)) * a,
      pitch: prev.pitch + (last.pitch - prev.pitch) * a,
    };
  }

  reset(): void {
    this.prev = null;
    this.last = null;
    this.lastTick = -1;
  }
}
