/**
 * Postprocesado: RenderPass -> UnrealBloomPass -> OutputPass (OutputPass último
 * para que la conversión a sRGB y el tone mapping ocurran una sola vez). Solo
 * medium y high usan composer; low renderiza directo al canvas. Decisión y
 * costo en docs/adr/0004-bloom-postprocessing.md.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { QualityName } from './presets';

export interface PostPlan {
  /** Composer + bloom. False renders the scene straight to the canvas. */
  bloom: boolean;
  /** MSAA samples on the composer target (the canvas itself is never antialiased). */
  msaaSamples: number;
}

export function postPlan(name: QualityName): PostPlan {
  return name === 'low' ? { bloom: false, msaaSamples: 0 } : { bloom: true, msaaSamples: 4 };
}

/** Bloom tuning: only emissive strips (>1 in HDR) pass the threshold. */
export const BLOOM = { strength: 0.35, radius: 0.35, threshold: 1.0 } as const;

export class PostFx {
  private composer: EffectComposer | null = null;
  private quality: QualityName = 'medium';
  private plan: PostPlan = postPlan('medium');
  private width = 1;
  private height = 1;
  private pixelRatio = 1;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
  ) {}

  /** Applies a quality plan and the current drawing-buffer geometry. */
  configure(name: QualityName, pixelRatio: number, width: number, height: number): void {
    this.quality = name;
    this.plan = postPlan(name);
    this.pixelRatio = pixelRatio;
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    if (!this.plan.bloom) {
      this.disposeComposer();
      return;
    }
    if (!this.composer) this.createComposer();
    this.composer?.setPixelRatio(this.pixelRatio);
    this.composer?.setSize(this.width, this.height);
  }

  /** Renders one frame through the composer, or directly when bloom is off. */
  render(): void {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  /** Drops GPU targets so the next configure allocates fresh ones (context restore). */
  rebuild(): void {
    this.disposeComposer();
    this.configure(this.quality, this.pixelRatio, this.width, this.height);
  }

  dispose(): void {
    this.disposeComposer();
  }

  get usesComposer(): boolean {
    return this.composer !== null;
  }

  private createComposer(): void {
    const target = new THREE.WebGLRenderTarget(this.width, this.height, {
      type: THREE.HalfFloatType,
      samples: this.plan.msaaSamples,
    });
    const composer = new EffectComposer(this.renderer, target);
    composer.addPass(new RenderPass(this.scene, this.camera));
    composer.addPass(
      new UnrealBloomPass(new THREE.Vector2(this.width, this.height), BLOOM.strength, BLOOM.radius, BLOOM.threshold),
    );
    composer.addPass(new OutputPass());
    this.composer = composer;
  }

  private disposeComposer(): void {
    if (!this.composer) return;
    this.composer.dispose();
    this.composer = null;
  }
}
