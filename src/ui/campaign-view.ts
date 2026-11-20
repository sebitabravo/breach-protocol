/** Pinta menú, selección de sector y briefing a partir del progreso. */
import {
  isSectorCleared,
  isSectorUnlocked,
  type ProgressState,
} from '../core/progress';
import { SECTOR_IDS, sectorInfo, type SectorId } from '../core/sectors';
import { byId } from './dom';

export function clock(ms: number | null): string {
  if (ms === null) return '—';
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function points(value: number): string {
  return value > 0 ? value.toLocaleString('es-CL') : '—';
}

function sectorLabel(id: SectorId): string {
  return `SECTOR_0${id + 1}`;
}

/** Sector que el menú recomienda: el primero desbloqueado y sin limpiar. */
export function recommendedSector(state: ProgressState): SectorId {
  return SECTOR_IDS.find((id) => isSectorUnlocked(state, id) && !isSectorCleared(state, id)) ?? 2;
}

export function renderMenu(state: ProgressState, todayKey: string): void {
  const sector = sectorInfo(recommendedSector(state));
  const code = sector.code.toLowerCase().replace('_', ' ');
  byId('menu-sector-code').textContent = `${code} · ${sector.title.toLowerCase()}`;
  byId('menu-play-meta').textContent = code;
  byId('menu-cleared').textContent = `${SECTOR_IDS.filter((id) => isSectorCleared(state, id)).length}/3`;
  byId('menu-streak').textContent = `${state.daily.streak} ${state.daily.streak === 1 ? 'día' : 'días'}`;
  byId('menu-overflow').textContent = points(state.overflow.bestScore);
  byId('menu-daily-meta').textContent = `hoy ${todayKey}`;
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
    if (label) label.textContent = !unlocked ? 'bloqueado' : cleared ? 'completado' : 'disponible';
    const score = document.querySelector<HTMLElement>(`[data-sector-score="${id}"]`);
    if (score) score.textContent = points(record.bestScore);
    const time = document.querySelector<HTMLElement>(`[data-sector-time="${id}"]`);
    if (time) time.textContent = clock(record.bestTimeMs);
    const lock = document.querySelector<HTMLElement>(`[data-sector-lock="${id}"]`);
    if (lock) {
      lock.hidden = unlocked;
      lock.textContent = unlocked ? '' : `Completá ${sectorLabel((id - 1) as SectorId)} para desbloquear.`;
    }
    const button = card.querySelector<HTMLButtonElement>('button[data-action="brief"]');
    if (button) button.disabled = !unlocked;
  }
}

export function renderBriefing(id: SectorId): void {
  const sector = sectorInfo(id);
  byId('brief-eyebrow').textContent = `misión 0${id + 1}`;
  byId('brief-title').textContent = `Reactivación del ${sector.code.toLowerCase().replace('_', ' ')} · ${sector.title}`;
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
