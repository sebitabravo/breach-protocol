/** Pinta la pantalla de resultados a partir de una partida ya cerrada. */
import { grade, type RunResult } from '../core/scores';
import { byId } from './dom';

const MATCH_LIMIT_SECONDS = 180;

function sectionTitle(text: string): HTMLHeadingElement {
  const title = document.createElement('h3');
  title.className = 'section-title';
  title.textContent = text;
  return title;
}

function prepareSections(): void {
  const result = byId('screen-result');
  if (result.querySelector('.section-title')) return;
  const score = result.querySelector('.result__score .hud__kicker');
  score?.replaceWith(sectionTitle(score.textContent ?? 'Puntuación total'));
  const stats = result.querySelector('.result__stats');
  if (stats) {
    const section = document.createElement('section');
    section.className = 'panel result__detail';
    const title = sectionTitle('Registro de partida');
    title.id = 'result-detail-title';
    section.setAttribute('aria-labelledby', title.id);
    stats.replaceWith(section);
    section.append(title, stats);
  }
  const board = result.querySelector('.board-submit__head .panel__label');
  board?.replaceWith(sectionTitle(board.textContent ?? 'Tablero'));
}

export function renderResult(run: RunResult, isRecord: boolean, truncated: boolean): void {
  prepareSections();
  byId('result-eyebrow').textContent = run.won ? 'protocolo completado' : 'protocolo fallido';
  byId('result-title').textContent = run.won ? 'PARTIDA COMPLETADA' : 'CONEXIÓN PERDIDA';
  byId('result-grade').textContent = grade(run);
  byId('result-score').textContent = run.score.toLocaleString('es-CL');
  byId('result-kills').textContent = String(run.kills);
  byId('result-accuracy').textContent = `${Math.round(run.accuracy * 100)}%`;
  byId('result-nodes').textContent = `${run.nodes}/3`;
  byId('result-time').textContent = `${Math.floor(run.durationMs / 60000)}:${Math.floor((run.durationMs % 60000) / 1000)
    .toString()
    .padStart(2, '0')}`;
  byId('result-damage').textContent = String(run.damage);
  byId('result-input').textContent = run.input === 'touch' ? 'táctil' : 'mouse';
  byId('result-record').hidden = !isRecord;
  byId('result-prefix').hidden = !truncated;
  byId('result-timebar').style.width = `${Math.min(100, (run.durationMs / 1000 / MATCH_LIMIT_SECONDS) * 100)}%`;
}
