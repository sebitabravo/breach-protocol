/** Panel de envío al tablero en Resultados y filas de la pantalla de Clasificación. */
import type { BoardEntry, BoardKey, BoardResult } from '../net/leaderboard';
import { t, formatNumber, formatDate } from '../i18n/runtime';
import { byId } from './dom';

export type BoardPanel =
  | { kind: 'idle'; where: string }
  | { kind: 'ineligible'; reason: string }
  | { kind: 'sending' }
  | { kind: 'ranked'; rank: number; total: number; where: string }
  | { kind: 'rate-limited' }
  | { kind: 'rejected'; code: string }
  | { kind: 'offline' };

export function boardLabel(board: BoardKey): string {
  if (board === 'overflow') return t('board.overflowLabel');
  if (board.startsWith('daily:')) return t('board.dailyFmt', { date: board.slice('daily:'.length) });
  return t('board.sectorFmt', { code: board.replace('mission:s0', 'sector 0') });
}

export function renderBoardPanel(view: BoardPanel): void {
  const panel = byId('result-board');
  const text = byId('board-text');
  const rank = byId('board-rank');
  const form = byId('board-form');
  const send = byId<HTMLButtonElement>('board-send');
  panel.dataset.state = view.kind;
  const focusWasInForm = form.contains(document.activeElement);
  form.hidden = view.kind === 'ineligible' || view.kind === 'ranked';
  // Si el formulario se oculta con el foco dentro, el foco caería al <body>: pasa al primer botón de la pantalla.
  if (form.hidden && focusWasInForm) {
    document.querySelector<HTMLElement>('#screen-result .page__foot [data-action]')?.focus({ preventScroll: true });
  }
  rank.hidden = view.kind !== 'ranked';
  send.disabled = view.kind === 'sending';

  switch (view.kind) {
    case 'idle':
      byId('board-where').textContent = view.where;
      text.textContent = t('results.idleText');
      send.textContent = t('results.send');
      break;
    case 'ineligible':
      byId('board-where').textContent = t('board.whereNone');
      text.textContent = view.reason;
      break;
    case 'sending':
      text.textContent = t('board.sendingText');
      send.textContent = t('board.sending');
      break;
    case 'ranked':
      byId('board-where').textContent = view.where;
      rank.textContent = `#${view.rank}`;
      text.textContent = t('board.rankedFmt', { rank: view.rank, total: view.total });
      break;
    case 'rate-limited':
      text.textContent = t('board.rateLimited');
      send.textContent = t('board.retry');
      break;
    case 'rejected':
      text.textContent = view.code === 'empty_name' ? t('board.rejectEmptyName')
        : view.code === 'verify_failed' ? t('board.rejectVerify')
        : view.code === 'encode_failed' ? t('board.rejectEncode')
        : t('board.rejectedFmt', { code: view.code });
      send.textContent = t('board.sendAgain');
      break;
    case 'offline':
      text.textContent = t('board.offline');
      send.textContent = t('board.retry');
      break;
  }
}

function row(entry: BoardEntry): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'board__row';
  const cells: [string, string][] = [
    ['rank', String(entry.rank)],
    ['name', entry.name],
    ['score', formatNumber(entry.score)],
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
  byId('board-state').textContent = t('leaderboard.loading');
}

export function renderBoardRows(result: BoardResult): void {
  const rows = byId('board-rows');
  const state = byId('board-state');
  if (result.status === 'error') {
    rows.replaceChildren();
    state.textContent = result.reason === 'offline' ? t('leaderboard.errOffline') : t('leaderboard.errUnexpected');
    return;
  }
  rows.replaceChildren(...result.entries.map(row));
  state.textContent = result.entries.length === 0
    ? t('leaderboard.empty')
    : t('leaderboard.totalFmt', { total: result.total });
}
