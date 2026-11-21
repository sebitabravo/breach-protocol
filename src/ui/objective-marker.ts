import { CLOSE_OBJECTIVE_METRES, fitObjective, formatObjectiveDistance, projectObjective, roundedObjectiveDistance, type ObjectiveClip, type ObjectiveProjection, type ScreenRect } from '../render/objective-projection';
import { byId } from './dom';

const PROTECTED = '.hud__minimap, .hud__block, .hud__objective-track, .hud__feed, .vitals, .ammo, #crosshair, #tutorial, .touch__stick, .tbtn';
const GUTTER = 8;
// Marker envelope in SVG user units, including the icon above and the label below.
const HALF_WIDTH = 67, ABOVE = 14, BELOW = 46;

export class ObjectiveMarker {
  private readonly root = document.querySelector<SVGSVGElement>('#objective-marker')!;
  private readonly status = byId('objective-status');
  private readonly name = this.root.querySelector<HTMLElement>('[data-objective-name]')!;
  private readonly hold = this.root.querySelector<HTMLElement>('[data-objective-hold]')!;
  private readonly distance = byId('hud-objective-distance');
  private readonly anchor = this.attachTransform('#objective-anchor');
  private readonly scale = this.attachTransform('#objective-scale');
  private readonly chevron = this.attachTransform('#objective-chevron');
  private readonly obstacles = document.querySelectorAll<HTMLElement>(PROTECTED);
  private readonly blocks = Array.from(this.obstacles, (): ScreenRect => ({ left: 0, top: 0, right: 0, bottom: 0 }));
  private readonly size = { width: 0, height: 0 };
  private readonly safe: ScreenRect = { left: 0, top: 0, right: 0, bottom: 0 };
  private readonly projection: ObjectiveProjection = { x: 0, y: 0, angle: 0, mode: 'onscreen', edge: 'none' };
  private readonly observer = new ResizeObserver(() => { this.invalidate(); });
  private readonly insets = byId('objective-insets');
  private count = 0;
  private dirty = true;
  private shownDistance = -1;
  private target = -1;
  private close = false;
  private usingTouch = false;
  private ready = false;
  private occluded = false;
  private mode: ObjectiveProjection['mode'] | 'hidden' = 'hidden';

  constructor() {
    this.observer.observe(this.root);
    for (const item of this.obstacles) this.observer.observe(item);
  }

  private attachTransform(selector: string): SVGTransform {
    // Numeric SVG transforms update in place; no CSS transform strings per frame.
    return this.root.querySelector<SVGGraphicsElement>(selector)!.transform.baseVal.initialize(this.root.createSVGTransform());
  }

  invalidate(): void { this.dirty = true; }
  dispose(): void { this.observer.disconnect(); }

  hide(): void {
    this.setMode('hidden');
    if (this.target >= 0) this.status.textContent = '';
    this.target = -1;
  }

  update(clip: ObjectiveClip, target: number, metres: number, usingTouch: boolean, ready: boolean, hudScale: number): void {
    if (this.dirty) this.measure(hudScale);
    const safe = this.safe;
    if (safe.left > safe.right || safe.top > safe.bottom) { this.hide(); return; }
    projectObjective(clip.x, clip.y, clip.z, clip.w, this.size, safe, this.projection);
    const clear = fitObjective(this.projection, safe, this.blocks, this.count);
    this.setMode(clear ? this.projection.mode : 'hidden');
    this.anchor.setTranslate(this.projection.x, this.projection.y);
    if (this.projection.mode !== 'onscreen') this.chevron.setRotate(this.projection.angle * 180 / Math.PI, 0, 0);
    if (clip.occluded !== this.occluded) {
      this.occluded = clip.occluded;
      this.root.toggleAttribute('data-occluded', clip.occluded);
    }
    const close = metres < CLOSE_OBJECTIVE_METRES;
    const changed = target !== this.target;
    if (changed) this.name.textContent = `Terminal ${String(target + 1).padStart(2, '0')}`;
    if (close !== this.close) {
      this.root.toggleAttribute('data-close', close);
      this.distance.hidden = close;
      this.hold.hidden = !close;
    }
    if (!close) {
      const rounded = roundedObjectiveDistance(metres);
      if (rounded !== this.shownDistance) {
        this.shownDistance = rounded;
        this.distance.textContent = formatObjectiveDistance(rounded);
      }
    } else if (usingTouch !== this.usingTouch || !this.close) {
      this.hold.textContent = usingTouch ? 'mantené Ⓔ' : 'mantené E';
    }
    // Do not make distance or camera movement live regions.
    if (changed || ready !== this.ready || (ready && usingTouch !== this.usingTouch)) {
      this.root.toggleAttribute('data-ready', ready);
      this.status.textContent = ready
        ? `${this.name.textContent}. Mantené ${usingTouch ? 'el botón de interactuar' : 'E'} para activar.`
        : `Objetivo marcado: ${this.name.textContent}.`;
    }
    this.target = target;
    this.close = close;
    this.ready = ready;
    this.usingTouch = usingTouch;
  }

  private setMode(mode: typeof this.mode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.root.dataset.mode = mode;
  }

  private measure(hudScale: number): void {
    this.dirty = false;
    const { width, height, left, top } = this.root.getBoundingClientRect();
    const inset = this.insets.getBoundingClientRect();
    this.size.width = width;
    this.size.height = height;
    this.scale.setScale(hudScale, hudScale);
    const side = HALF_WIDTH * hudScale, above = ABOVE * hudScale, below = BELOW * hudScale;
    this.safe.left = inset.left - left + side + GUTTER;
    this.safe.right = inset.right - left - side - GUTTER;
    this.safe.top = inset.top - top + above + GUTTER;
    this.safe.bottom = inset.bottom - top - below - GUTTER;
    this.count = 0;
    for (const item of this.obstacles) {
      const b = item.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) continue;
      const extra = item.id === 'crosshair' ? 21 * hudScale : 0; // Max weapon spread extends past the reticle box.
      const block = this.blocks[this.count++];
      block.left = b.left - left - side - GUTTER - extra;
      block.right = b.right - left + side + GUTTER + extra;
      block.top = b.top - top - below - GUTTER - extra;
      block.bottom = b.bottom - top + above + GUTTER + extra;
    }
  }
}
