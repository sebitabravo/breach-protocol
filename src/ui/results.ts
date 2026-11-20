/** Pinta la pantalla de resultados a partir de una partida ya cerrada. */
import { grade, type RunResult } from '../core/scores';
import { byId } from './dom';

const MATCH_LIMIT_SECONDS = 180;

export function renderResult(run: RunResult, isRecord: boolean): void {
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
  byId('result-timebar').style.width = `${Math.min(100, (run.durationMs / 1000 / MATCH_LIMIT_SECONDS) * 100)}%`;
}
