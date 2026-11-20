/**
 * Fixed-step accumulator.
 *
 * The renderer may run at any refresh rate; the simulation always advances in
 * whole 1/60 s steps. When the machine cannot keep up, surplus time is dropped
 * on purpose and counted so Engineering Mode can report it honestly instead of
 * falling into a spiral of death.
 */
export const FIXED_DT = 1 / 60;
export const MAX_FRAME_DT = 0.1;
export const MAX_STEPS = 5;

export interface StepResult {
  steps: number;
  alpha: number;
  dropped: number;
}

export class FixedStepLoop {
  private accumulator = 0;

  constructor(
    readonly fixedDt: number = FIXED_DT,
    readonly maxSteps: number = MAX_STEPS,
    readonly maxFrameDt: number = MAX_FRAME_DT,
  ) {}

  reset(): void {
    this.accumulator = 0;
  }

  get pending(): number {
    return this.accumulator;
  }

  advance(frameDt: number): StepResult {
    const dt = Math.min(Math.max(frameDt, 0), this.maxFrameDt);
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= this.fixedDt && steps < this.maxSteps) {
      this.accumulator -= this.fixedDt;
      steps += 1;
    }
    let dropped = 0;
    if (steps === this.maxSteps && this.accumulator >= this.fixedDt) {
      dropped = Math.floor(this.accumulator / this.fixedDt);
      this.accumulator = 0;
    }
    return { steps, alpha: this.accumulator / this.fixedDt, dropped };
  }
}
