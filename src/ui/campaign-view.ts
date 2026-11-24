/** Pinta menú, selección de sector y briefing a partir del progreso. */
import {
  isSectorCleared,
  isSectorUnlocked,
  type ProgressState,
} from '../core/progress';
import { SECTOR_IDS, sectorInfo, type SectorId } from '../core/sectors';
import { t, formatNumber, formatDurationMs } from '../i18n/runtime';
import { byId } from './dom';

function clock(ms: number | null): string {
  return ms === null ? '—' : formatDurationMs(ms);
}

function points(value: number): string {
  return value > 0 ? formatNumber(value) : '—';
}

function sectorLabel(id: SectorId): string {
  return `SECTOR_0${id + 1}`;
}

/** Sector que el menú recomienda: el primero desbloqueado y sin limpiar. */
export function recommendedSector(state: ProgressState): SectorId {
  return SECTOR_IDS.find((id) => isSectorUnlocked(state, id) && !isSectorCleared(state, id)) ?? 2;
}

/** Pinta el menú a partir del progreso. Daily y Overflow están ocultos para el
 *  jugador (P4): sus rutas de código quedan intactas, pero el menú no las nombra. */
export function renderMenu(state: ProgressState): void {
  const sector = sectorInfo(recommendedSector(state));
  const code = sector.code.toLowerCase().replace('_', ' ');
  byId('menu-sector-code').textContent = `${code} · ${sector.title.toLowerCase()}`;
  byId('menu-play-meta').textContent = code;
  byId('menu-cleared').textContent = `${SECTOR_IDS.filter((id) => isSectorCleared(state, id)).length}/3`;
}

export function renderSectorCards(state: ProgressState): void {
  for (const id of SECTOR_IDS) {
    const card = document.querySelector<HTMLElement>(`[data-sector-card="${id}"]`);
    if (!card) continue;
    const record = state.sectors[id];
    const unlocked = isSectorUnlocked(state, id);
    const cleared = isSectorCleared(state, id);
    card.dataset.state = !unlocked ? 'locked' : cleared ? 'cleared' : 'open';
    const label = document.querySelector<HTMLElement>(`[data-state-label="${id}"]`);
    if (label) label.textContent = !unlocked ? t('sectors.stateLocked') : cleared ? t('sectors.stateCleared') : t('sectors.stateOpen');
    const title = card.querySelector<HTMLElement>('.sector__title');
    // El dueño del nombre del sector es sectors.ts; la tarjeta lo refleja.
    if (title) title.textContent = sectorInfo(id).title;
    const score = document.querySelector<HTMLElement>(`[data-sector-score="${id}"]`);
    if (score) score.textContent = points(record.bestScore);
    const time = document.querySelector<HTMLElement>(`[data-sector-time="${id}"]`);
    if (time) time.textContent = clock(record.bestTimeMs);
    const lock = document.querySelector<HTMLElement>(`[data-sector-lock="${id}"]`);
    if (lock) {
      lock.hidden = unlocked;
      lock.textContent = unlocked ? '' : t('sectors.lockFmt', { sector: sectorLabel((id - 1) as SectorId) });
    }
    const button = card.querySelector<HTMLButtonElement>('button[data-action="brief"]');
    if (button) button.disabled = !unlocked;
  }
}

export function renderBriefing(id: SectorId): void {
  const sector = sectorInfo(id);
  byId('brief-eyebrow').textContent = t('brief.eyebrowFmt', { n: `0${id + 1}` });
  byId('brief-title').textContent = t('brief.titleFmt', {
    sector: sector.code.toLowerCase().replace('_', ' '),
    title: sector.title,
  });
  byId('brief-narrative').textContent = sector.narrative;
  fillList(byId('brief-objectives'), sector.objectives);
  fillList(byId('brief-rewards'), sector.rewards);
  byId('brief-unlock').textContent = sector.unlocks;
}

function fillList(list: HTMLElement, items: readonly string[]): void {
  list.replaceChildren(
    ...items.map((text) => {
      const li = document.createElement('li');
      li.textContent = text;
      return li;
    }),
  );
}
