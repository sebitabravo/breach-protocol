/**
 * Construcción de datos de partida: opciones para el núcleo y resumen al terminar.
 * Pura, para que el mapeo de modo, flags y puntaje se pruebe sin WASM ni DOM.
 */
import type { StartOptions, Snapshot } from '../wasm/bridge';
import { MODE } from '../wasm/protocol';
import type { RunResult } from './scores';
import type { Mode } from './screens';

export interface StartRequest {
  mode: Mode;
  mapId: number;
  seed: number;
  aimAssist: boolean;
  autoReload: boolean;
  shotgun: boolean;
}

const ENGINE_MODE: Record<Mode, number> = {
  run: MODE.mission,
  overflow: MODE.overflow,
  daily: MODE.daily,
  practice: MODE.practice,
};

export function buildStartOptions(request: StartRequest): StartOptions {
  return {
    mode: ENGINE_MODE[request.mode],
    map: request.mapId,
    seed: request.seed,
    aimAssist: request.aimAssist,
    autoReload: request.autoReload,
    shotgun: request.shotgun,
  };
}

export interface RunContext {
  mode: Mode;
  input: RunResult['input'];
  won: boolean;
  at: number;
}

type RunFacts = Pick<Snapshot, 'score' | 'kills' | 'shots' | 'hits' | 'nodesActive' | 'timeLeft' | 'timeElapsed' | 'damageTaken'>;

export function buildRunResult(facts: RunFacts, context: RunContext): RunResult {
  return {
    score: Math.round(facts.score),
    kills: facts.kills,
    accuracy: facts.shots > 0 ? facts.hits / facts.shots : 0,
    nodes: facts.nodesActive,
    timeLeft: facts.timeLeft,
    damage: Math.round(facts.damageTaken),
    durationMs: Math.max(0, facts.timeElapsed * 1000),
    mode: context.mode,
    input: context.input,
    difficulty: 'operator',
    won: context.won,
    at: context.at,
  };
}
