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
import { rgbOf, STATE_COLORS } from '../render/palette';
import { t, formatClock, formatNumber } from '../i18n/runtime';
import { byId } from './dom';

/** Colores de estado derivados del dueño único (src/render/palette.ts, espejo de
 * tokens.css). El RGB desglosado compone los `rgba()` del minimapa sin repetir
 * el hex; los literales se calculan una vez, fuera del camino caliente. */
const [OK_R, OK_G, OK_B] = rgbOf(STATE_COLORS.ok);
const MINT_FADE = `rgba(${OK_R},${OK_G},${OK_B},0.16)`;

/** Siluetas de arma para el bloque de munición (viewBox 64×24), leídas de las mismas proporciones del viewmodel. */
export const WEAPON_ICON: Record<number, string> = {
  [WEAPON.sidearm]: 'M18 6h30l2 2v4H38l-2 2h-6l-3 8h-7l3-9-6-1V8z',
  [WEAPON.carbine]: 'M2 9h8V7h22l2-3h8l1 3h14v3h5v3H44l-3 2h-7l-2 7h-7l2-7h-6l-4 4H8l4-5H2z',
  [WEAPON.shotgun]: 'M1 8h40l2-2h10l1 2h9v4H44l-4 2H29l-3 8h-7l3-8h-8l-6 5H2l6-6H1z',
};

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

/** Rótulo del modo para el kicker del HUD; el catálogo arma la frase. */
function modeLabel(view: MatchView): string {
  switch (view.mode) {
    case 'run':
      return t('hud.modeRun');
    case 'overflow':
      return t('hud.modeOverflow');
    case 'daily':
      return t('hud.modeDailyFmt', { date: view.dateKey, mutator: MUTATOR_LABEL[view.mutator] });
    case 'practice':
      return ''; // The sector kicker already identifies the simulator.
  }
}

interface FeedEntry {
  born: number;
  el: HTMLElement;
}

/** Forma del marcador del minimapa por tipo: scout círculo, centinela cuadrado, interceptor triángulo. */
export function traceEnemyMarker(
  ctx: Pick<CanvasRenderingContext2D, 'arc' | 'rect' | 'moveTo' | 'lineTo' | 'closePath'>,
  kind: number,
  x: number,
  y: number,
): void {
  const r = 2.4;
  if (kind === 1) {
    ctx.rect(x - r, y - r, r * 2, r * 2);
  } else if (kind === 2) {
    ctx.moveTo(x, y - r - 0.6);
    ctx.lineTo(x + r + 0.4, y + r);
    ctx.lineTo(x - r - 0.4, y + r);
    ctx.closePath();
  } else {
    ctx.arc(x, y, 1.9, 0, Math.PI * 2);
  }
}

/** Opacidad del destello de daño. Reducido: pico bajo y sin cambios bruscos (WCAG 2.3.1/2.3.3). */
export function damageFlashAlpha(damageAge: number, reduced: boolean): number {
  const fade = Math.max(0, 1 - damageAge / 0.6);
  return fade * (reduced ? 0.25 : 0.9);
}

export class Hud {
  private wave = byId('hud-wave');
  private waveTotal = byId('hud-wave-total');
  private waveBar = byId('hud-wave-bar');
  private sectorCode = byId('hud-sector-code');
  private sectorName = byId('hud-sector-name');
  private mode = byId('hud-mode');
  private score = byId('hud-score');
  private nodesTrack = byId('hud-nodes');
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
  private weaponIcon = byId('hud-weapon-icon');
  private slots = Array.from(document.querySelectorAll<HTMLElement>('#hud-slots .slot'));
  private reloadBar = byId('hud-reload-bar');
  private reloadHint = byId('hud-reload-hint');
  private reduceFlashes = false;
  private vitals = document.querySelector<HTMLElement>('.vitals');
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
    this.timeLabel.textContent = view.mode === 'run' || view.mode === 'daily' ? t('hud.timeLeft') : t('hud.timeElapsed');
    for (const slot of this.slots) {
      const weapon = Number(slot.dataset.weapon);
      slot.classList.toggle('is-locked', !view.unlockedWeapons.includes(weapon));
    }
  }

  setMap(map: MapData): void {
    this.map = map;
  }

  /** Re-aplica los rótulos del idioma activo a la partida en curso; el resto
   *  de valores dinámicos se reescribe en el primer frame siguiente. */
  relocalize(): void {
    if (!this.view) return;
    this.setMatch(this.view);
  }

  setReduceFlashes(reduced: boolean): void {
    this.reduceFlashes = reduced;
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
      this.score.textContent = formatNumber(state.score);
    });
    const shownTime = timed ? state.timeLeft : state.timeElapsed;
    this.set('time', formatClock(shownTime), () => {
      this.time.textContent = formatClock(shownTime);
    });
    this.set('remaining', state.enemiesRemaining, () => {
      this.remaining.textContent = String(state.enemiesRemaining);
    });

    const objectiveText =
      state.phase === PHASE.extraction
        ? t('hud.objectiveExtract')
        : this.view?.mode === 'overflow' && state.nodesActive >= MAX_NODES
          ? t('hud.objectiveOverflow')
          : t('hud.objectiveNodes');
    this.set('objLine', objectiveText, () => {
      this.objectiveLine.textContent = objectiveText;
    });
    // Una sola representación visual del progreso (la fila de barras); el conteo
    // exacto vive en el nombre accesible de esa fila, no repetido en pantalla.
    this.set(
      'nodesLabel',
      `${state.nodesActive}/${MAX_NODES}`,
      () => {
        this.nodesTrack.setAttribute('aria-label', t('hud.nodesAriaFmt', { active: state.nodesActive, total: MAX_NODES }));
      },
    );

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
      this.vitals?.classList.toggle('is-low', low);
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
      this.weaponIcon.setAttribute('d', WEAPON_ICON[state.weapon] ?? WEAPON_ICON[WEAPON.sidearm]);
      for (const slot of this.slots) {
        slot.classList.toggle('is-active', Number(slot.dataset.weapon) === state.weapon);
      }
    });
    this.set('reload', Math.round(state.reloadProgress * 100), () => {
      this.reloadBar.style.width = `${Math.round(state.reloadProgress * 100)}%`;
    });
    const hint = state.reloading
      ? t('hud.reloading')
      : ammo === 0
        ? usingTouch
          ? t('hud.reloadTouch')
          : t('hud.reloadKey')
        : '';
    this.set('hint', hint, () => {
      this.reloadHint.textContent = hint;
    });

    const gap = Math.round(4 + Math.min(28, state.spread * 520));
    this.set('gap', gap, () => {
      this.crosshair.style.setProperty('--gap', `${gap}px`);
    });

    const damageAlpha = damageFlashAlpha(state.damageAge, this.reduceFlashes);
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
      // Forma además de color: activo = cuadrado lleno, pendiente = cuadrado hueco.
      if (live.active) {
        ctx.fillStyle = STATE_COLORS.ok;
        ctx.fillRect(node.x * scale - 2, node.z * scale - 2, 4, 4);
      } else {
        ctx.strokeStyle = 'rgba(150,170,186,0.9)';
        ctx.lineWidth = 1;
        ctx.strokeRect(node.x * scale - 2, node.z * scale - 2, 4, 4);
      }
    }

    for (let i = 0; i < 32; i += 1) {
      const enemy = state.enemy(i);
      if (enemy.state === ENEMY_STATE.dead) continue;
      ctx.fillStyle = enemy.kind === 1 ? STATE_COLORS.warning : STATE_COLORS.danger;
      ctx.beginPath();
      traceEnemyMarker(ctx, enemy.kind, enemy.x * scale, enemy.z * scale);
      ctx.fill();
    }
    ctx.restore();

    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.fillStyle = MINT_FADE;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, size * 0.42, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = STATE_COLORS.ok;
    ctx.beginPath();
    ctx.moveTo(0, -5);
    ctx.lineTo(3.4, 4);
    ctx.lineTo(-3.4, 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
