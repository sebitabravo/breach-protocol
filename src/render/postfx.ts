/**
 * Postprocesado: RenderPass -> UnrealBloomPass -> OutputPass (OutputPass último
 * para que la conversión a sRGB y el tone mapping ocurran una sola vez). Solo
 * medium y high usan composer; low renderiza directo al canvas. El override
 * del jugador (T5a) retira únicamente el pase de bloom: el composer y su MSAA
 * siguen siendo del preset. Decisión y costo en docs/adr/0004-bloom-postprocessing.md.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { QualityName } from './presets';
import type { GfxOverride } from '../core/settings';

export interface PostPlan {
  /** Composer con o sin pase de bloom. False en low = render directo al canvas. */
  bloom: boolean;
  /** MSAA del target del composer (el canvas nunca tiene antialiasing). Del preset: los overrides no lo tocan. */
  msaaSamples: number;
}

/**
 * Derivación de postprocesado por preset. `bloom` acepta el override del
 * jugador (auto = derivación del preset: medium y high con bloom, low sin
 * composer). El MSAA es del preset y se mantiene aunque se apague el bloom:
 * medium/high conservan el composer (RenderPass → OutputPass con 4× MSAA) y
 * solo se retira el pase de bloom; `on` en low crea composer con 0 muestras.
 */
export function postPlan(name: QualityName, bloom: GfxOverride = 'auto'): PostPlan {
  return {
    bloom: bloom === 'auto' ? name !== 'low' : bloom === 'on',
    msaaSamples: name === 'low' ? 0 : 4,
  };
}

/** HDR soft knee picks up cyan tubes and the less luminous orange strips. */
export const BLOOM = { strength: 0.39, radius: 0.39, threshold: 0.65 } as const;

/**
 * Niveles de desenfoque que se usan: 3 de los 5 que trae UnrealBloomPass. Cada
 * nivel cuesta dos pases de pantalla completa; los dos más anchos no aportan lo
 * suficiente frente a su costo en el presupuesto de draw calls (ver ADR 0004).
 */
const BLOOM_MIPS = 3;

/** Recorta la cadena de desenfoque sin tocar el shader: los pesos de los niveles sobrantes van a cero. */
function trimBloomMips(pass: UnrealBloomPass, preset: QualityName): void {
  // Medium retains the tight highlight halo, without four wider blur draws.
  const levels = preset === 'medium' ? 1 : BLOOM_MIPS;
  pass.nMips = levels;
  const factors = pass.compositeMaterial.uniforms.bloomFactors.value as number[];
  for (let i = levels; i < factors.length; i += 1) factors[i] = 0;
}

export class PostFx {
  private composer: EffectComposer | null = null;
  private quality: QualityName = 'medium';
  private plan: PostPlan = postPlan('medium');
  private bloomOverride: GfxOverride = 'auto';
  private width = 1;
  private height = 1;
  private pixelRatio = 1;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
  ) {}

  /** Applies a quality plan, the bloom override and the current drawing-buffer geometry. */
  configure(name: QualityName, pixelRatio: number, width: number, height: number, bloom: GfxOverride = 'auto'): void {
    const plan = postPlan(name, bloom);
    // Rebuild cuando cambia preset o el estado de bloom: el target y sus
    // pases no se pueden reconfigurar en caliente.
    if (this.quality !== name || this.plan.bloom !== plan.bloom) this.disposeComposer();
    this.quality = name;
    this.bloomOverride = bloom;
    this.plan = plan;
    this.pixelRatio = pixelRatio;
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    // Composer solo cuando el preset lo trae (medium/high) o el bloom forced
    // on lo pide en low: el MSAA del preset nunca se pierde con el bloom off,
    // solo se retira el pase de bloom. Low en auto sigue directo al canvas.
    if (!this.plan.bloom && this.plan.msaaSamples === 0) {
      this.disposeComposer();
      return;
    }
    if (!this.composer) this.createComposer();
    // Keep the fullscreen pass budget stable on wide screens. High has no cap.
    const mediumDpr = Math.min(this.pixelRatio * 0.76, Math.sqrt(420_000 / (this.width * this.height)));
    this.composer?.setPixelRatio(name === 'medium' ? mediumDpr : this.pixelRatio);
    this.composer?.setSize(this.width, this.height);
  }

  /** Renders one frame through the composer, or directly when bloom is off. */
  render(): void {
    if (this.composer) this.composer.render();
    else {
      this.renderer.setRenderTarget(null);
      // A solid-color Scene.background forces the color/depth clear even when
      // autoClear is disabled for the foreground pass.
      this.renderer.render(this.scene, this.camera);
    }
  }

  /** Drops GPU targets so the next configure allocates fresh ones (context restore). */
  rebuild(): void {
    this.disposeComposer();
    this.configure(this.quality, this.pixelRatio, this.width, this.height, this.bloomOverride);
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
    if (this.plan.bloom) {
      const bloom = new UnrealBloomPass(new THREE.Vector2(this.width, this.height), BLOOM.strength, BLOOM.radius, BLOOM.threshold);
      trimBloomMips(bloom, this.quality);
      composer.addPass(bloom);
    }
    composer.addPass(new OutputPass());
    this.composer = composer;
  }

  private disposeComposer(): void {
    if (!this.composer) return;
    for (const pass of this.composer.passes) pass.dispose();
    this.composer.dispose();
    this.composer = null;
  }
}
