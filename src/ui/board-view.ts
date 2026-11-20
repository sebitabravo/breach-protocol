/** Panel de envío al tablero en Resultados y filas de la pantalla de Clasificación. */
import type { BoardEntry, BoardKey, BoardResult } from '../net/leaderboard';
import { byId } from './dom';

export type BoardPanel =
  | { kind: 'idle'; where: string }
  | { kind: 'ineligible'; reason: string }
  | { kind: 'sending' }
  | { kind: 'ranked'; rank: number; total: number; where: string }
  | { kind: 'rate-limited' }
  | { kind: 'rejected'; code: string }
  | { kind: 'offline' };

const REJECT_TEXT: Record<string, string> = {
  empty_name: 'Escribí un nombre de 1 a 16 caracteres.',
  verify_failed: 'El servidor no pudo verificar este registro.',
  encode_failed: 'No pudimos preparar el registro de esta partida.',
};

export function boardLabel(board: BoardKey): string {
  if (board === 'overflow') return 'overflow';
  if (board.startsWith('daily:')) return `diario ${board.slice('daily:'.length)}`;
  return `${board.replace('mission:s0', 'sector 0')} · misión`;
}

export function renderBoardPanel(view: BoardPanel): void {
  const panel = byId('result-board');
  const text = byId('board-text');
  const rank = byId('board-rank');
  const form = byId('board-form');
  const send = byId<HTMLButtonElement>('board-send');
  panel.dataset.state = view.kind;
  form.hidden = view.kind === 'ineligible' || view.kind === 'ranked';
  rank.hidden = view.kind !== 'ranked';
  send.disabled = view.kind === 'sending';

  switch (view.kind) {
    case 'idle':
      byId('board-where').textContent = view.where;
      text.textContent = 'Enviá la partida para verificarla en el servidor.';
      send.textContent = 'Enviar al tablero';
      break;
    case 'ineligible':
      byId('board-where').textContent = 'sin tablero';
      text.textContent = view.reason;
      break;
    case 'sending':
      text.textContent = 'Enviando y verificando la partida…';
      send.textContent = 'Enviando…';
      break;
    case 'ranked':
      byId('board-where').textContent = view.where;
      rank.textContent = `#${view.rank}`;
      text.textContent = `Verificada por el servidor · ${view.rank} de ${view.total} en el tablero.`;
      break;
    case 'rate-limited':
      text.textContent = 'Demasiados envíos seguidos. Esperá un minuto y reintentá.';
      send.textContent = 'Reintentar';
      break;
    case 'rejected':
      text.textContent = REJECT_TEXT[view.code] ?? `El servidor rechazó el registro (${view.code}).`;
      send.textContent = 'Enviar de nuevo';
      break;
    case 'offline':
      text.textContent = 'Sin conexión con el tablero. La partida queda guardada en este equipo; reintentá cuando vuelva la red.';
      send.textContent = 'Reintentar';
      break;
  }
}

function formatDate(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleDateString('es-CL', { day: '2-digit', month: 'short' });
}

function row(entry: BoardEntry): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'board__row';
  const cells: [string, string][] = [
    ['rank', String(entry.rank)],
    ['name', entry.name],
    ['score', entry.score.toLocaleString('es-CL')],
    ['date', formatDate(entry.at)],
  ];
  for (const [kind, value] of cells) {
    const span = document.createElement('span');
    span.className = `board__cell board__cell--${kind}`;
    span.textContent = value;
    li.appendChild(span);
  }
  return li;
}

export function renderBoardLoading(): void {
  byId('board-rows').replaceChildren();
  byId('board-state').textContent = 'Cargando…';
}

export function renderBoardRows(result: BoardResult): void {
  const rows = byId('board-rows');
  const state = byId('board-state');
  if (result.status === 'error') {
    rows.replaceChildren();
    state.textContent =
      result.reason === 'offline'
        ? 'Sin conexión con el tablero. Probá de nuevo más tarde.'
        : 'El tablero no respondió como se esperaba.';
    return;
  }
  rows.replaceChildren(...result.entries.map(row));
  state.textContent =
    result.entries.length === 0
      ? 'Todavía no hay registros verificados en este tablero.'
      : `${result.total} registros verificados`;
}
