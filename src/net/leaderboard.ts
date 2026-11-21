/**
 * Cliente del tablero, implementado según docs/api-contract.md. Nunca lanza hacia
 * el bucle de juego: cada llamada devuelve un resultado tipado, incluido el caso
 * sin red, y el juego sigue funcionando si el backend no existe (dev o preview).
 */

export const SUBMIT_TIMEOUT_MS = 8_000;
export const NAME_MAX_LENGTH = 16;
export const BOARD_LIMIT_MAX = 50;

const RUNS_PATH = '/api/runs';
const BOARD_PATH = '/api/leaderboard';
// Same Unicode Alphabetic property as Rust char::is_alphabetic in server/src/name.rs.
const DISALLOWED_IN_NAME = /[^\p{Alphabetic}0-9 _.-]/u;
const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/u;
const EDGE_WHITESPACE = /^\p{White_Space}+|\p{White_Space}+$/gu;
const CHUNK_BYTES = 0x8000;

export type SectorBoard = 'mission:s01' | 'mission:s02' | 'mission:s03';
export type BoardKey = SectorBoard | 'overflow' | `daily:${string}`;

export type RunMode = 'mission' | 'overflow' | 'daily' | 'practice';

export interface BoardEligibility {
  mode: RunMode;
  mapId: number;
  won: boolean;
  dateKey: string;
  logTruncated: boolean;
  shotgunEnabled: boolean;
}

export type SubmitResult =
  | { status: 'ranked'; board: BoardKey; score: number; won: boolean; rank: number; total: number }
  | { status: 'rate-limited' }
  | { status: 'rejected'; code: string }
  | { status: 'offline'; reason: 'network' | 'timeout' | 'server' | 'invalid-response' };

export interface BoardEntry {
  rank: number;
  name: string;
  score: number;
  at: number;
}

export type BoardResult =
  | { status: 'ok'; board: BoardKey; total: number; entries: BoardEntry[] }
  | { status: 'error'; reason: 'offline' | 'bad-request' | 'server' };

export interface ClientDeps {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

type Reply = { kind: 'reply'; status: number; json: unknown } | { kind: 'failed'; reason: 'network' | 'timeout' };

/** 1–16 escalares Unicode tras recortar, sin modificar los caracteres del nombre. */
export function sanitizeName(raw: string): string | null {
  if (CONTROL_OR_FORMAT.test(raw)) return null;
  const trimmed = raw.replace(EDGE_WHITESPACE, '');
  if (trimmed.length === 0 || DISALLOWED_IN_NAME.test(trimmed)) return null;
  return [...trimmed].length <= NAME_MAX_LENGTH ? trimmed : null;
}

/** Tablero al que cuenta una partida. `null` significa que no se envía nada. */
export function boardFor(run: BoardEligibility): BoardKey | null {
  // A capped prefix is still verifiable. The server decides whether it qualifies.
  // A replay cannot prove the campaign unlock, even if the weapon was never equipped.
  if (run.mode === 'practice' || run.shotgunEnabled) return null;
  if (run.mode === 'overflow') return 'overflow';
  if (run.mode === 'daily') return `daily:${run.dateKey}`;
  if (!run.won || run.mapId < 0 || run.mapId > 2) return null;
  return `mission:s0${run.mapId + 1}` as SectorBoard;
}

/** Base64 estándar del registro. Por chunks: `String.fromCharCode(...bytes)` revienta la pila en registros grandes. */
export function encodeLogBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
    const chunk = bytes.subarray(offset, offset + CHUNK_BYTES);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function send(url: string, init: RequestInit, deps: ClientDeps): Promise<Reply> {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? SUBMIT_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      json = undefined;
    }
    return { kind: 'reply', status: response.status, json };
  } catch {
    return { kind: 'failed', reason: controller.signal.aborted ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}

function field(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function isBoardKey(value: unknown): value is BoardKey {
  return typeof value === 'string' && /^(mission:s0[123]|overflow|daily:\d{4}-\d{2}-\d{2})$/.test(value);
}

function parseRanked(json: unknown): SubmitResult {
  const body = field(json);
  if (
    !body ||
    body.ok !== true ||
    !isBoardKey(body.board) ||
    typeof body.score !== 'number' ||
    typeof body.won !== 'boolean' ||
    typeof body.rank !== 'number' ||
    typeof body.total !== 'number'
  ) {
    return { status: 'offline', reason: 'invalid-response' };
  }
  return {
    status: 'ranked',
    board: body.board,
    score: body.score,
    won: body.won,
    rank: body.rank,
    total: body.total,
  };
}

function interpretSubmit(reply: Reply): SubmitResult {
  if (reply.kind === 'failed') return { status: 'offline', reason: reply.reason };
  const { status, json } = reply;
  if (status === 200) return parseRanked(json);
  if (status === 429) return { status: 'rate-limited' };
  if (status === 400 || status === 413 || status === 422) {
    const code = field(json)?.error;
    return { status: 'rejected', code: typeof code === 'string' ? code : `http_${status}` };
  }
  return { status: 'offline', reason: 'server' };
}

export interface SubmitInput {
  name: string;
  log: Uint8Array;
}

/** Envía un registro verificable. Un nombre inválido se rechaza sin tocar la red. */
export async function submitRun(input: SubmitInput, deps: ClientDeps = {}): Promise<SubmitResult> {
  const name = sanitizeName(input.name);
  if (name === null) return { status: 'rejected', code: 'bad_name' };
  let body: string;
  try {
    body = JSON.stringify({ name, log: encodeLogBase64(input.log) });
  } catch {
    return { status: 'rejected', code: 'encode_failed' };
  }
  const reply = await send(
    RUNS_PATH,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body },
    deps,
  );
  return interpretSubmit(reply);
}

function parseEntries(json: unknown): BoardEntry[] | null {
  const body = field(json);
  if (!body || !Array.isArray(body.entries)) return null;
  const entries: BoardEntry[] = [];
  for (const raw of body.entries) {
    const entry = field(raw);
    if (
      !entry ||
      typeof entry.rank !== 'number' ||
      typeof entry.name !== 'string' ||
      typeof entry.score !== 'number' ||
      typeof entry.at !== 'number'
    ) {
      return null;
    }
    entries.push({ rank: entry.rank, name: entry.name, score: entry.score, at: entry.at });
  }
  return entries;
}

/** Lee un tablero. `limit` se acota a 1..50 como pide el contrato. */
export async function fetchBoard(board: BoardKey, limit: number, deps: ClientDeps = {}): Promise<BoardResult> {
  const clamped = Math.min(BOARD_LIMIT_MAX, Math.max(1, Math.round(limit)));
  const url = `${BOARD_PATH}?board=${encodeURIComponent(board)}&limit=${clamped}`;
  const reply = await send(url, { method: 'GET', headers: { accept: 'application/json' } }, deps);
  if (reply.kind === 'failed') return { status: 'error', reason: 'offline' };
  if (reply.status === 400) return { status: 'error', reason: 'bad-request' };
  if (reply.status !== 200) return { status: 'error', reason: 'offline' };
  const entries = parseEntries(reply.json);
  const total = field(reply.json)?.total;
  if (entries === null || typeof total !== 'number') return { status: 'error', reason: 'server' };
  return { status: 'ok', board, total, entries };
}
