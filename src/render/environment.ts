import * as THREE from 'three';
// HDRLoader is RGBELoader's non-deprecated implementation in Three r181.
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

const HDR_URL = `${import.meta.env.BASE_URL}assets/hdri/industrial_pipe_and_valve_02_1k.hdr`;

/** Own the decoded source through a context restore, but never use it as a skybox. */
export class IndustrialEnvironment {
  private source: THREE.DataTexture | null = null;
  private target: THREE.WebGLRenderTarget | null = null;
  private disposed = false;

  async load(): Promise<void> {
    const source = await new HDRLoader().loadAsync(HDR_URL);
    if (this.disposed) source.dispose();
    else this.source = source;
  }

  install(renderer: THREE.WebGLRenderer, scene: THREE.Scene): void {
    if (!this.source || this.disposed) return;
    const generator = new THREE.PMREMGenerator(renderer);
    try {
      const target = generator.fromEquirectangular(this.source);
      this.target?.dispose();
      this.target = target;
      scene.environment = target.texture;
    } finally {
      generator.dispose();
    }
  }

  dispose(scene: THREE.Scene): void {
    this.disposed = true;
    scene.environment = null;
    this.target?.dispose();
    this.source?.dispose();
    this.target = this.source = null;
  }
}
