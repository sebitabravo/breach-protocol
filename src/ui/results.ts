/** Pinta la pantalla de resultados a partir de una partida ya cerrada. */
import { MATCH_SECONDS } from '../core/constants';
import { grade, type RunResult } from '../core/scores';
import { t, formatNumber, formatDurationMs } from '../i18n/runtime';
import { byId } from './dom';

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
  score?.replaceWith(sectionTitle(score.textContent ?? t('results.scoreTotal')));
  const stats = result.querySelector('.result__stats');
  if (stats) {
    const section = document.createElement('section');
    section.className = 'panel result__detail';
    const title = sectionTitle(t('results.detailTitle'));
    title.id = 'result-detail-title';
    section.setAttribute('aria-labelledby', title.id);
    stats.replaceWith(section);
    section.append(title, stats);
  }
  const board = result.querySelector('.board-submit__head .panel__label');
  board?.replaceWith(sectionTitle(board.textContent ?? t('results.board')));
}

export function renderResult(run: RunResult, isRecord: boolean, truncated: boolean): void {
  prepareSections();
  byId('result-eyebrow').textContent = run.won ? t('results.eyebrowWon') : t('results.eyebrowLost');
  byId('result-title').textContent = run.won ? t('results.titleWon') : t('results.titleLost');
  byId('result-grade').textContent = grade(run);
  byId('result-score').textContent = formatNumber(run.score);
  byId('result-kills').textContent = String(run.kills);
  byId('result-accuracy').textContent = `${Math.round(run.accuracy * 100)}%`;
  byId('result-nodes').textContent = `${run.nodes}/3`;
  byId('result-time').textContent = formatDurationMs(run.durationMs);
  byId('result-damage').textContent = String(run.damage);
  byId('result-input').textContent = run.input === 'touch' ? t('results.inputTouch') : t('results.inputMouse');
  byId('result-record').hidden = !isRecord;
  byId('result-prefix').hidden = !truncated;
  byId('result-timebar').style.width = `${Math.min(100, (run.durationMs / 1000 / MATCH_SECONDS) * 100)}%`;
}
