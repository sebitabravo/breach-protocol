/**
 * Interpolación de la cámara entre ticks fijos. Los extremos solo avanzan
 * cuando cambia `tick`; si se actualizaran en cada frame de render la cámara
 * saltaría a 60 Hz en vez de interpolar.
 *
 * `sampleInto` no aloca: escribe en un `Pose` que el llamador reutiliza. `sample`
 * queda para tests y lectura casual.
 */
export interface Pose {
  px: number;
  py: number;
  pz: number;
  yaw: number;
  pitch: number;
}

function zeroPose(): Pose {
  return { px: 0, py: 0, pz: 0, yaw: 0, pitch: 0 };
}

function copyPose(src: Pose, dst: Pose): Pose {
  dst.px = src.px;
  dst.py = src.py;
  dst.pz = src.pz;
  dst.yaw = src.yaw;
  dst.pitch = src.pitch;
  return dst;
}

export class PoseInterpolator {
  private readonly prev = zeroPose();
  private readonly last = zeroPose();
  private primed = false;
  private lastTick = -1;

  /** Interpolación sin allocations: escribe el resultado en `out`. */
  sampleInto(pose: Pose, tick: number, alpha: number, out: Pose): Pose {
    if (!this.primed || tick < this.lastTick) {
      copyPose(pose, this.prev);
      copyPose(pose, this.last);
      this.primed = true;
      this.lastTick = tick;
      return copyPose(pose, out);
    }
    if (tick !== this.lastTick) {
      copyPose(this.last, this.prev);
      copyPose(pose, this.last);
      this.lastTick = tick;
    }
    const a = Math.min(Math.max(alpha, 0), 1);
    const { prev, last } = this;
    const dyaw = last.yaw - prev.yaw;
    out.px = prev.px + (last.px - prev.px) * a;
    out.py = prev.py + (last.py - prev.py) * a;
    out.pz = prev.pz + (last.pz - prev.pz) * a;
    out.yaw = prev.yaw + Math.atan2(Math.sin(dyaw), Math.cos(dyaw)) * a;
    out.pitch = prev.pitch + (last.pitch - prev.pitch) * a;
    return out;
  }

  sample(pose: Pose, tick: number, alpha: number): Pose {
    return this.sampleInto(pose, tick, alpha, zeroPose());
  }

  reset(): void {
    this.primed = false;
    this.lastTick = -1;
  }
}
