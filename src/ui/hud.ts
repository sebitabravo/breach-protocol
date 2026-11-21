/**
 * HUD: lee el snapshot de la simulación y escribe el DOM solo cuando un valor
 * cambió. El minimapa es un canvas 2D aparte, redibujado cada dos frames.
 */
import type { Snapshot } from '../wasm/bridge';
import { ENEMY_STATE, MAX_NODES, PHASE, WEAPON } from '../wasm/protocol';
import type { MapData, Mutator } from '../world/map';
import { MUTATOR_LABEL } from '../world/map';
import type { Mode } from '../core/screens';
import type { FeedKind } from '../core/events';
import { damageBearing } from '../core/bearing';
import { FIXED_DT } from '../core/loop';
import { byId } from './dom';

export const WEAPON_SHORT: Record<number, string> = {
  [WEAPON.sidearm]: 'PB-01',
  [WEAPON.carbine]: 'AR-04',
  [WEAPON.shotgun]: 'SG-08',
};

/** Infinito en el modo Overflow (la simulación reporta `waveTotal` 0). */
const INFINITE = '∞';
const RESERVE_UNLIMITED = 999;
const HIT_FLASH_MS = 160;
const DAMAGE_DIR_TICKS = Math.round(0.9 / FIXED_DT);

export interface MatchView {
  mode: Mode;
  sectorCode: string;
  sectorName: string;
  dateKey: string;
  mutator: Mutator;
  unlockedWeapons: readonly number[];
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

function modeLabel(view: MatchView): string {
  switch (view.mode) {
    case 'run':
      return 'misión';
    case 'overflow':
      return 'overflow · ARGOS inunda el sector';
    case 'daily':
      return `protocolo diario · ${view.dateKey} · ${MUTATOR_LABEL[view.mutator]}`;
    case 'practice':
      return ''; // The sector kicker already identifies the simulator.
  }
}

interface FeedEntry {
  born: number;
  el: HTMLElement;
}

export class Hud {
  private wave = byId('hud-wave');
  private waveTotal = byId('hud-wave-total');
  private waveBar = byId('hud-wave-bar');
  private sectorCode = byId('hud-sector-code');
  private sectorName = byId('hud-sector-name');
  private mode = byId('hud-mode');
  private score = byId('hud-score');
  private objectiveLine = byId('hud-objective-line');
  private timeLabel = byId('hud-time-label');
  private time = byId('hud-time');
  private remaining = byId('hud-remaining');
  private nodes = Array.from(document.querySelectorAll<HTMLElement>('#hud-nodes .node'));
  private hp = byId('hud-hp');
  private hpBar = byId('hud-hp-bar');
  private hpTrack = this.hpBar.parentElement!;
  private ammo = byId('hud-ammo');
  private reserve = byId('hud-reserve');
  private weaponName = byId('hud-weapon');
  private slots = Array.from(document.querySelectorAll<HTMLElement>('#hud-slots .slot'));
  private reloadBar = byId('hud-reload-bar');
  private reloadHint = byId('hud-reload-hint');
  private ammoBlock = document.querySelector<HTMLElement>('.ammo');
  private crosshair = byId('crosshair');
  private hitMarker = byId('hit-marker');
  private damageFlash = byId('damage-flash');
  private damageDir = byId('hud-dmgdir');
  private damageArrow = this.damageDir.querySelector('span')!;
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
  private map: MapData | null = null;
  private view: MatchView | null = null;
  private hitTimer = 0;
  private hpTimer = 0;
  private damageSeen = -1;
  private damageUntilTick = -1;
  private readonly damageSource = { x: 0, z: 0 };
  private readonly playerPosition = { x: 0, z: 0 };

  private set(key: string, value: string | number | boolean, apply: () => void): void {
    if (this.cache.get(key) === value) return;
    this.cache.set(key, value);
    apply();
  }

  /** Configura etiquetas, sector y armas disponibles para la partida que empieza. */
  setMatch(view: MatchView): void {
    this.view = view;
    this.cache.clear();
    this.sectorCode.textContent = view.sectorCode;
    this.sectorName.textContent = view.sectorName;
    const mode = modeLabel(view);
    this.mode.textContent = mode;
    this.mode.hidden = mode === '';
    this.timeLabel.textContent = view.mode === 'run' || view.mode === 'daily' ? 'restante' : 'transcurrido';
    for (const slot of this.slots) {
      const weapon = Number(slot.dataset.weapon);
      slot.classList.toggle('is-locked', !view.unlockedWeapons.includes(weapon));
    }
  }

  setMap(map: MapData): void {
    this.map = map;
  }

  reset(): void {
    this.cache.clear();
    for (const entry of this.entries) entry.el.remove();
    this.entries = [];
    this.damageUntilTick = -1;
    this.damageDir.hidden = true;
    window.clearTimeout(this.hitTimer);
    window.clearTimeout(this.hpTimer);
    this.damageSeen = -1;
    delete this.hpTrack.dataset.flash;
    this.hitMarker.classList.remove('is-hot', 'is-kill');
  }

  update(state: Snapshot, usingTouch: boolean): void {
    this.frame += 1;
    const infinite = state.waveTotal === 0;
    const timed = this.view?.mode === 'run' || this.view?.mode === 'daily';

    this.set('wave', state.wave, () => {
      this.wave.textContent = String(state.wave);
    });
    this.set('waveTotal', infinite ? INFINITE : state.waveTotal, () => {
      this.waveTotal.textContent = infinite ? `/${INFINITE}` : `/${state.waveTotal}`;
    });
    this.set('waveBar', infinite ? 'inf' : state.wave / Math.max(1, state.waveTotal), () => {
      const ratio = infinite ? 1 : Math.min(1, state.wave / Math.max(1, state.waveTotal));
      this.waveBar.style.width = `${Math.round(ratio * 100)}%`;
    });
    this.set('score', Math.round(state.score), () => {
      this.score.textContent = thousands(state.score);
    });
    const shownTime = timed ? state.timeLeft : state.timeElapsed;
    this.set('time', clock(shownTime), () => {
      this.time.textContent = clock(shownTime);
    });
    this.set('remaining', state.enemiesRemaining, () => {
      this.remaining.textContent = String(state.enemiesRemaining);
    });

    const objectiveText =
      state.phase === PHASE.extraction
        ? 'sostené la posición hasta la extracción'
        : this.view?.mode === 'overflow' && state.nodesActive >= MAX_NODES
          ? 'terminales aseguradas · resistí'
          : `reactivá una terminal (${state.nodesActive}/${MAX_NODES})`;
    this.set('objLine', objectiveText, () => {
      this.objectiveLine.textContent = objectiveText;
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

    if (this.damageSeen >= 0 && state.damageTaken > this.damageSeen) {
      this.hpTrack.dataset.flash = this.hpTrack.dataset.flash === 'a' ? 'b' : 'a';
      window.clearTimeout(this.hpTimer);
      this.hpTimer = window.setTimeout(() => { delete this.hpTrack.dataset.flash; }, 235);
    }
    this.damageSeen = state.damageTaken;
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
    const reserve = Math.round(state.reserve);
    this.set('reserve', reserve, () => {
      this.reserve.textContent = reserve >= RESERVE_UNLIMITED ? INFINITE : String(reserve);
    });
    this.set('weapon', state.weapon, () => {
      this.weaponName.textContent = WEAPON_SHORT[state.weapon] ?? WEAPON_SHORT[WEAPON.sidearm];
      for (const slot of this.slots) {
        slot.classList.toggle('is-active', Number(slot.dataset.weapon) === state.weapon);
      }
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

    const damageAlpha = Math.max(0, 1 - state.damageAge / 0.6) * 0.9;
    this.set('damage', Math.round(damageAlpha * 20), () => {
      this.damageFlash.style.opacity = String(damageAlpha.toFixed(2));
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

    const regen = state.damageAge > 7 && state.hp < state.hpMax;
    this.set('regen', regen, () => {
      this.buffRegen.hidden = !regen;
    });
    const assist = state.aimAssist && usingTouch;
    this.set('assist', assist, () => {
      this.buffAssist.hidden = !assist;
    });

    const canInteract = state.interacting >= 0;
    this.set('interactAvailable', canInteract, () => {
      this.interactBtn?.classList.toggle('is-available', canInteract);
    });

    this.updateDamageDirection(state);
    this.tickFeed();
    if (this.frame % 2 === 0) this.drawMinimap(state);
  }

  pushFeed(text: string, kind: FeedKind = 'plain'): void {
    const el = document.createElement('div');
    el.className = `feedline${kind === 'plain' ? '' : ` feedline--${kind}`}`;
    el.textContent = text;
    this.feed.appendChild(el);
    this.entries.push({ born: performance.now(), el });
    while (this.entries.length > 4) {
      this.entries.shift()?.el.remove();
    }
  }

  /** Marca de impacto; `kill` cambia el color a peligro. Ligada a EVT.enemyHit / EVT.enemyDied. */
  flashHit(kill: boolean): void {
    this.hitMarker.classList.toggle('is-kill', kill);
    this.hitMarker.classList.toggle('is-repeat');
    this.hitMarker.classList.add('is-hot');
    window.clearTimeout(this.hitTimer);
    this.hitTimer = window.setTimeout(() => this.hitMarker.classList.remove('is-hot'), HIT_FLASH_MS);
  }

  /** Keep the world-space hit source; only simulation ticks age the cue. */
  showDamageFrom(x: number, z: number, tick: number): void {
    this.damageSource.x = x;
    this.damageSource.z = z;
    this.damageUntilTick = tick + DAMAGE_DIR_TICKS;
  }

  private updateDamageDirection(state: Snapshot): void {
    if (state.tick >= this.damageUntilTick) {
      if (!this.damageDir.hidden) this.damageDir.hidden = true;
      return;
    }
    this.playerPosition.x = state.px;
    this.playerPosition.z = state.pz;
    const degrees = Math.round(damageBearing(state.yaw, this.playerPosition, this.damageSource) * 1800 / Math.PI) / 10;
    this.set('damageBearing', degrees, () => { this.damageArrow.style.transform = `rotate(${degrees}deg)`; });
    if (this.damageDir.hidden) this.damageDir.hidden = false;
  }

  private tickFeed(): void {
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
