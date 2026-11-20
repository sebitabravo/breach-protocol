/**
 * HUD: reads the simulation snapshot and writes DOM only when a value actually
 * changed. The minimap is a separate 2D canvas redrawn every other frame.
 */
import type { Snapshot } from '../wasm/bridge';
import { ENEMY_STATE, PHASE, WEAPON_LABEL } from '../wasm/protocol';
import type { MapData } from '../world/map';

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing HUD element #${id}`);
  return el as T;
}

function thousands(value: number): string {
  const rounded = Math.max(0, Math.round(value));
  return rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function clock(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const m = Math.floor(clamped / 60);
  const s = Math.floor(clamped % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

interface FeedEntry {
  text: string;
  kind: 'good' | 'danger' | 'plain';
  born: number;
  el: HTMLElement;
}

export class Hud {
  private wave = byId('hud-wave');
  private waveBar = byId('hud-wave-bar');
  private score = byId('hud-score');
  private objectiveLine = byId('hud-objective-line');
  private time = byId('hud-time');
  private remaining = byId('hud-remaining');
  private objective = byId('hud-objective');
  private nodes = Array.from(document.querySelectorAll<HTMLElement>('#hud-nodes .node'));
  private hp = byId('hud-hp');
  private hpBar = byId('hud-hp-bar');
  private ammo = byId('hud-ammo');
  private reserve = byId('hud-reserve');
  private weaponName = byId('hud-weapon');
  private reloadBar = byId('hud-reload-bar');
  private reloadHint = byId('hud-reload-hint');
  private ammoBlock = document.querySelector<HTMLElement>('.ammo');
  private crosshair = byId('crosshair');
  private hitmarker = document.querySelector<HTMLElement>('.hitmarker');
  private damage = byId('damage-flash');
  private extraction = byId('hud-extraction');
  private extractionTime = byId('hud-extraction-time');
  private feed = byId('hud-feed');
  private buffAssist = byId('buff-assist');
  private buffRegen = byId('buff-regen');
  private interactBtn = document.querySelector<HTMLElement>('.tbtn--interact');
  private minimap = byId<HTMLCanvasElement>('minimap');
  private minimapCtx = this.minimap.getContext('2d');

  private cache = new Map<string, string | number | boolean>();
  private entries: FeedEntry[] = [];
  private frame = 0;

  private set(key: string, value: string | number | boolean, apply: () => void): void {
    if (this.cache.get(key) === value) return;
    this.cache.set(key, value);
    apply();
  }

  reset(): void {
    this.cache.clear();
    for (const entry of this.entries) entry.el.remove();
    this.entries = [];
  }

  update(state: Snapshot, dt: number, usingTouch: boolean): void {
    this.frame += 1;

    this.set('wave', state.wave, () => {
      this.wave.textContent = String(state.wave);
    });
    this.set('waveBar', state.wave, () => {
      this.waveBar.style.width = `${Math.min(100, (state.wave / Math.max(1, state.waveTotal)) * 100)}%`;
    });
    this.set('score', Math.round(state.score), () => {
      this.score.textContent = thousands(state.score);
    });
    this.set('time', clock(state.timeLeft), () => {
      this.time.textContent = clock(state.timeLeft);
    });
    this.set('remaining', state.enemiesRemaining, () => {
      this.remaining.textContent = String(state.enemiesRemaining);
    });

    const nodesText =
      state.phase === PHASE.extraction
        ? 'extracción en curso'
        : `reactivá el terminal de control (${state.nodesActive}/3)`;
    this.set('objLine', nodesText, () => {
      this.objectiveLine.textContent = nodesText;
    });

    const objectiveText =
      state.phase === PHASE.extraction
        ? 'Sostené la posición hasta la extracción'
        : state.nodesActive >= 3
          ? 'Núcleo recuperado'
          : 'Reactivá los nodos de red';
    this.set('objective', objectiveText, () => {
      this.objective.textContent = objectiveText;
    });

    for (let i = 0; i < this.nodes.length; i += 1) {
      const node = state.node(i);
      const key = `node${i}`;
      const value = node.active ? 'active' : node.progress > 0.01 ? `p${node.progress.toFixed(2)}` : 'idle';
      this.set(key, value, () => {
        const el = this.nodes[i];
        el.classList.toggle('is-active', node.active);
        el.classList.toggle('is-charging', !node.active && node.progress > 0.01);
        el.style.setProperty('--p', `${Math.round(node.progress * 100)}%`);
      });
    }

    const hp = Math.max(0, Math.round(state.hp));
    this.set('hp', hp, () => {
      this.hp.textContent = String(hp);
    });
    this.set('hpBar', hp, () => {
      this.hpBar.style.width = `${(hp / Math.max(1, state.hpMax)) * 100}%`;
      const low = hp / Math.max(1, state.hpMax) < 0.32;
      this.hpBar.style.background = low ? 'var(--danger)' : 'var(--primary)';
    });

    const ammo = Math.max(0, Math.round(state.ammo));
    this.set('ammo', ammo, () => {
      this.ammo.textContent = String(ammo);
      this.ammoBlock?.classList.toggle('is-low', ammo <= Math.max(1, state.mag * 0.2));
    });
    this.set('reserve', Math.round(state.reserve), () => {
      this.reserve.textContent = String(Math.round(state.reserve));
    });
    this.set('weapon', state.weapon, () => {
      this.weaponName.textContent = WEAPON_LABEL[state.weapon] ?? 'PB-01';
    });
    this.set('reload', Math.round(state.reloadProgress * 100), () => {
      this.reloadBar.style.width = `${Math.round(state.reloadProgress * 100)}%`;
    });
    const hint = state.reloading
      ? 'recargando'
      : ammo === 0
        ? usingTouch
          ? 'tocá ⟳'
          : 'R para recargar'
        : '';
    this.set('hint', hint, () => {
      this.reloadHint.textContent = hint;
    });

    const gap = Math.round(4 + Math.min(28, state.spread * 520));
    this.set('gap', gap, () => {
      this.crosshair.style.setProperty('--gap', `${gap}px`);
    });

    const showHit = state.hitAge < 0.14;
    this.set('hit', showHit, () => {
      this.hitmarker?.classList.toggle('is-hot', showHit);
    });

    const damageAlpha = Math.max(0, 1 - state.damageAge / 0.6) * 0.9;
    this.set('damage', Math.round(damageAlpha * 20), () => {
      this.damage.style.opacity = String(damageAlpha.toFixed(2));
    });

    const extracting = state.phase === PHASE.extraction;
    this.set('extracting', extracting, () => {
      this.extraction.hidden = !extracting;
    });
    if (extracting) {
      this.set('extractionTime', state.extraction.toFixed(1), () => {
        this.extractionTime.textContent = state.extraction.toFixed(1);
      });
    }

    this.set('regen', state.damageAge > 7 && state.hp < state.hpMax, () => {
      this.buffRegen.hidden = !(state.damageAge > 7 && state.hp < state.hpMax);
    });
    this.set('assist', state.aimAssist && usingTouch, () => {
      this.buffAssist.hidden = !(state.aimAssist && usingTouch);
    });

    const canInteract = state.interacting >= 0;
    this.set('interactAvailable', canInteract, () => {
      this.interactBtn?.classList.toggle('is-available', canInteract);
    });

    this.tickFeed(dt);
    if (this.frame % 2 === 0) this.drawMinimap(state);
  }

  private map: MapData | null = null;

  setMap(map: MapData): void {
    this.map = map;
  }

  pushFeed(text: string, kind: FeedEntry['kind'] = 'plain'): void {
    const el = document.createElement('div');
    el.className = `feedline${kind === 'plain' ? '' : ` feedline--${kind}`}`;
    el.textContent = text;
    this.feed.appendChild(el);
    this.entries.push({ text, kind, born: performance.now(), el });
    while (this.entries.length > 4) {
      this.entries.shift()?.el.remove();
    }
  }

  private tickFeed(_dt: number): void {
    const now = performance.now();
    while (this.entries.length > 0 && now - this.entries[0].born > 3600) {
      this.entries.shift()?.el.remove();
    }
  }

  private drawMinimap(state: Snapshot): void {
    const ctx = this.minimapCtx;
    if (!ctx) return;
    const size = this.minimap.width;
    const scale = size / 40;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = 'rgba(8,15,20,0.85)';
    ctx.fillRect(0, 0, size, size);

    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.rotate(state.yaw);
    ctx.translate(-state.px * scale, -state.pz * scale);

    ctx.fillStyle = 'rgba(46,63,79,0.85)';
    for (const solid of this.map?.solids ?? []) {
      if (solid.kind === 1) continue;
      ctx.fillRect(
        solid.min[0] * scale,
        solid.min[2] * scale,
        Math.max(1, (solid.max[0] - solid.min[0]) * scale),
        Math.max(1, (solid.max[2] - solid.min[2]) * scale),
      );
    }

    const nodes = this.map?.nodes ?? [];
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      const live = state.node(i);
      ctx.fillStyle = live.active ? '#5ce08b' : 'rgba(150,170,186,0.75)';
      ctx.fillRect(node.x * scale - 2, node.z * scale - 2, 4, 4);
    }

    for (let i = 0; i < 32; i += 1) {
      const enemy = state.enemy(i);
      if (enemy.state === ENEMY_STATE.dead) continue;
      ctx.fillStyle = enemy.kind === 1 ? '#ffce6b' : '#ff5b6b';
      ctx.beginPath();
      ctx.arc(enemy.x * scale, enemy.z * scale, 1.9, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Player marker + view cone, drawn after restore so it stays upright-ish.
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.fillStyle = 'rgba(92,224,139,0.16)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, size * 0.42, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#5ce08b';
    ctx.beginPath();
    ctx.moveTo(0, -5);
    ctx.lineTo(3.4, 4);
    ctx.lineTo(-3.4, 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
