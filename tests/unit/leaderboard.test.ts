import { describe, expect, it, vi } from 'vitest';
import {
  boardFor,
  encodeLogBase64,
  fetchBoard,
  sanitizeName,
  submitRun,
  type ClientDeps,
} from '../../src/net/leaderboard';

const LOG = new Uint8Array([0x42, 0x50, 0x4c, 0x31, 1, 0, 2, 255]);

function reply(status: number, body?: unknown): Response {
  return new Response(body === undefined ? 'not json' : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function fakeFetch(response: Response | Error): ReturnType<typeof vi.fn> {
  return vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
}

function depsWith(fetchImpl: ReturnType<typeof vi.fn>): ClientDeps {
  return { fetch: fetchImpl as unknown as typeof fetch };
}

describe('sanitizeName', () => {
  it('trims and keeps the characters the contract allows', () => {
    expect(sanitizeName('  SEBITA_01.x-y  ')).toBe('SEBITA_01.x-y');
  });

  it('preserves José verbatim', () => {
    expect(sanitizeName('José')).toBe('José');
  });

  it('trims Ana without otherwise changing the name', () => {
    expect(sanitizeName('  Ana  ')).toBe('Ana');
    expect(sanitizeName('\u00a0Ana\u3000')).toBe('Ana');
  });

  it('rejects disallowed symbols, control characters and zero-width joiners', () => {
    for (const name of ['Ñandú <script>!', 'Jo\u200dsé', '\tAna', '\u0085Ana', 'Ana\ufeff', '¡¡¡']) {
      expect(sanitizeName(name), JSON.stringify(name)).toBeNull();
    }
  });

  it('rejects seventeen scalars instead of truncating', () => {
    expect(sanitizeName('a'.repeat(17))).toBeNull();
    expect(sanitizeName('𐐀'.repeat(17))).toBeNull();
  });

  it('counts astral letters as one character each', () => {
    expect(sanitizeName('𐐀'.repeat(16))).toBe('𐐀'.repeat(16));
  });

  it('rejects empty and all-space names', () => {
    expect(sanitizeName('')).toBeNull();
    expect(sanitizeName('   ')).toBeNull();
  });
});

describe('boardFor', () => {
  const base = { mode: 'mission' as const, mapId: 1, won: true, dateKey: '2026-11-20', logTruncated: false, shotgunEnabled: false };

  it('counts mission wins on the board of their sector', () => {
    expect(boardFor({ ...base, mapId: 0 })).toBe('mission:s01');
    expect(boardFor({ ...base, mapId: 2 })).toBe('mission:s03');
  });

  it('does not submit mission losses', () => {
    expect(boardFor({ ...base, won: false })).toBeNull();
  });

  it('offers overflow submissions for the server to qualify', () => {
    expect(boardFor({ ...base, mode: 'overflow', won: false })).toBe('overflow');
  });

  it('counts daily runs on the board of their UTC date, win or loss', () => {
    expect(boardFor({ ...base, mode: 'daily', won: false })).toBe('daily:2026-11-20');
  });

  it('submits truncated overflow to the overflow board', () => {
    expect(boardFor({ ...base, mode: 'overflow', won: false, logTruncated: true })).toBe('overflow');
  });

  it('refuses logs that claim the SG-08 unlock on every board', () => {
    for (const mode of ['mission', 'overflow', 'daily'] as const) {
      expect(boardFor({ ...base, mode, shotgunEnabled: true })).toBeNull();
    }
  });

  it('never submits practice or truncated mission losses', () => {
    expect(boardFor({ ...base, mode: 'practice' })).toBeNull();
    expect(boardFor({ ...base, won: false, logTruncated: true })).toBeNull();
  });

  it('refuses sector ids that the contract does not know', () => {
    expect(boardFor({ ...base, mapId: 5 })).toBeNull();
  });
});

function decodeBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
}

describe('encodeLogBase64', () => {
  it('is standard base64 of the raw bytes', () => {
    expect(encodeLogBase64(LOG)).toBe('QlBMMQEAAv8=');
    expect(decodeBase64(encodeLogBase64(LOG))).toEqual(LOG);
  });

  it('handles logs far larger than the call-stack argument limit', () => {
    const big = new Uint8Array(1_000_000).map((_, i) => i * 31);
    const decoded = decodeBase64(encodeLogBase64(big));
    expect(decoded.length).toBe(big.length);
    expect(decoded[999_999]).toBe(big[999_999]);
  });
});

describe('submitRun', () => {
  it('posts the sanitized name and the base64 log as JSON to /api/runs', async () => {
    const fetchImpl = fakeFetch(
      reply(200, { ok: true, board: 'overflow', score: 2310, scoreVersion: 1, won: false, rank: 4, total: 31 }),
    );
    await submitRun({ name: ' José ', log: LOG }, depsWith(fetchImpl));
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/runs');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ name: 'José', log: encodeLogBase64(LOG) });
  });

  it('returns the rank of a verified run', async () => {
    const fetchImpl = fakeFetch(
      reply(200, { ok: true, board: 'mission:s01', score: 2310, scoreVersion: 1, won: true, rank: 4, total: 31 }),
    );
    expect(await submitRun({ name: 'SEBITA', log: LOG }, depsWith(fetchImpl))).toEqual({
      status: 'ranked',
      board: 'mission:s01',
      score: 2310,
      won: true,
      rank: 4,
      total: 31,
    });
  });

  it('maps 429 to rate-limited', async () => {
    const result = await submitRun({ name: 'SEBITA', log: LOG }, depsWith(fakeFetch(reply(429, { ok: false, error: 'rate' }))));
    expect(result).toEqual({ status: 'rate-limited' });
  });

  it('maps 400, 413 and 422 to rejected with the stable error code', async () => {
    for (const status of [400, 413, 422]) {
      const result = await submitRun(
        { name: 'SEBITA', log: LOG },
        depsWith(fakeFetch(reply(status, { ok: false, error: 'verify_failed' }))),
      );
      expect(result).toEqual({ status: 'rejected', code: 'verify_failed' });
    }
  });

  it('falls back to an HTTP code when a rejection has no error code', async () => {
    const result = await submitRun({ name: 'SEBITA', log: LOG }, depsWith(fakeFetch(reply(413))));
    expect(result).toEqual({ status: 'rejected', code: 'http_413' });
  });

  it('treats 503 and other server errors as offline and retryable', async () => {
    const result = await submitRun({ name: 'SEBITA', log: LOG }, depsWith(fakeFetch(reply(503, { ok: false, error: 'store' }))));
    expect(result).toEqual({ status: 'offline', reason: 'server' });
  });

  it('treats a network failure as offline instead of throwing', async () => {
    const result = await submitRun({ name: 'SEBITA', log: LOG }, depsWith(fakeFetch(new TypeError('Failed to fetch'))));
    expect(result).toEqual({ status: 'offline', reason: 'network' });
  });

  it('aborts a request that hangs past the timeout and reports it as offline', async () => {
    const hanging = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const result = await submitRun(
      { name: 'SEBITA', log: LOG },
      { fetch: hanging as unknown as typeof fetch, timeoutMs: 15 },
    );
    expect(result).toEqual({ status: 'offline', reason: 'timeout' });
  });

  it('treats a non-JSON 200 (for example an SPA fallback page) as offline', async () => {
    const result = await submitRun({ name: 'SEBITA', log: LOG }, depsWith(fakeFetch(reply(200))));
    expect(result).toEqual({ status: 'offline', reason: 'invalid-response' });
  });

  it('treats a 200 with a malformed body as offline', async () => {
    const result = await submitRun({ name: 'SEBITA', log: LOG }, depsWith(fakeFetch(reply(200, { ok: true, rank: 'x' }))));
    expect(result).toEqual({ status: 'offline', reason: 'invalid-response' });
  });

  it('rejects invalid names without calling the network', async () => {
    const fetchImpl = fakeFetch(reply(200, {}));
    for (const name of ['', 'Jo\u200dsé', 'a'.repeat(17)]) {
      expect(await submitRun({ name, log: LOG }, depsWith(fetchImpl))).toEqual({
        status: 'rejected',
        code: 'bad_name',
      });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('fetchBoard', () => {
  it('reads entries from the board endpoint with a clamped limit', async () => {
    const fetchImpl = fakeFetch(
      reply(200, {
        board: 'overflow',
        total: 1,
        entries: [{ rank: 1, name: 'SEBITA', score: 9100, at: 1766000000 }],
      }),
    );
    const result = await fetchBoard('overflow', 999, depsWith(fetchImpl));
    expect(fetchImpl.mock.calls[0][0]).toBe('/api/leaderboard?board=overflow&limit=50');
    expect(result).toEqual({
      status: 'ok',
      board: 'overflow',
      total: 1,
      entries: [{ rank: 1, name: 'SEBITA', score: 9100, at: 1766000000 }],
    });
  });

  it('encodes daily board keys in the query string', async () => {
    const fetchImpl = fakeFetch(reply(200, { board: 'daily:2026-11-20', total: 0, entries: [] }));
    await fetchBoard('daily:2026-11-20', 0, depsWith(fetchImpl));
    expect(fetchImpl.mock.calls[0][0]).toBe('/api/leaderboard?board=daily%3A2026-11-20&limit=1');
  });

  it('reports unknown boards as bad-request', async () => {
    const result = await fetchBoard('nope' as never, 10, depsWith(fakeFetch(reply(400, { ok: false, error: 'board' }))));
    expect(result).toEqual({ status: 'error', reason: 'bad-request' });
  });

  it('reports a network failure as offline', async () => {
    const result = await fetchBoard('overflow', 10, depsWith(fakeFetch(new TypeError('offline'))));
    expect(result).toEqual({ status: 'error', reason: 'offline' });
  });

  it('reports a malformed entry list as a server error instead of rendering garbage', async () => {
    const result = await fetchBoard(
      'overflow',
      10,
      depsWith(fakeFetch(reply(200, { total: 1, entries: [{ rank: 1, name: 5, score: 1, at: 1 }] }))),
    );
    expect(result).toEqual({ status: 'error', reason: 'server' });
  });
});
