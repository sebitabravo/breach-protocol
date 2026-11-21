export const DISPLAY_WIDTH = 384;
export const DISPLAY_HEIGHT = 224;
export const STENCIL_HEIGHT = 48;
export const DISPLAY_ROW = DISPLAY_HEIGHT + STENCIL_HEIGHT;

export const TERMINAL_MODE = { idle: 0, channeling: 1, active: 2 } as const;
export type TerminalMode = (typeof TERMINAL_MODE)[keyof typeof TERMINAL_MODE];

const LOG = ['> CHECKING CARRIER', '> SYNCING CLOCK', '> VERIFYING ROUTE', '> REPLAY WINDOW OK', '> NEGOTIATING LINK', '> HANDSHAKE ACCEPTED', '> SEALING SESSION'];
const MONO = 'ui-monospace, Menlo, monospace';

export function paintStencil(ctx: CanvasRenderingContext2D, index: number): void {
  const top = index * DISPLAY_ROW + DISPLAY_HEIGHT;
  ctx.font = `bold 31px ${MONO}`;
  ctx.fillStyle = '#d9d0b5';
  ctx.fillText(`NODE 0${index + 1}`, 31, top + 35);
  ctx.fillStyle = '#ac8350';
  for (let i = 0; i < 7; i += 1) ctx.fillRect(289 + i * 8, top + 12, i % 2 ? 2 : 4, 25);
  // Breaks in the paint follow the stencil mask; they're not text glyphs.
  for (const x of [56, 91, 145, 169, 181]) ctx.clearRect(x, top + 11, 2, 28);
}

export function paintTerminalScreen(ctx: CanvasRenderingContext2D, index: number, state: TerminalMode, progress: number, still: boolean): void {
  const channeling = state === TERMINAL_MODE.channeling;
  const active = state === TERMINAL_MODE.active;
  const top = index * DISPLAY_ROW;
  const bright = state === TERMINAL_MODE.idle ? '#ddbc84' : '#b5ffce';
  ctx.save();
  ctx.translate(0, top);
  ctx.fillStyle = '#08161b';
  ctx.fillRect(0, 0, DISPLAY_WIDTH, DISPLAY_HEIGHT);
  ctx.fillStyle = '#172828';
  ctx.fillRect(0, 0, DISPLAY_WIDTH, 39);
  ctx.fillRect(0, 183, DISPLAY_WIDTH, 41);
  ctx.fillStyle = '#25383a';
  ctx.fillRect(127, 47, 1, 128);
  for (let y = 44; y < 178; y += 8) ctx.fillRect(134, y, 239, 1);
  ctx.font = `bold 16px ${MONO}`;
  ctx.fillStyle = '#adbdba';
  ctx.fillText('RELAY / NETWORK CONSOLE', 15, 26);

  // ◇ / ◈ / ◆: draw the contours so the distinction does not depend on a font or hue.
  const diamond = (r: number, solid: boolean) => {
    ctx.beginPath();
    ctx.moveTo(65, 110 - r);
    ctx.lineTo(65 + r, 110);
    ctx.lineTo(65, 110 + r);
    ctx.lineTo(65 - r, 110);
    ctx.closePath();
    if (solid) ctx.fill(); else ctx.stroke();
  };
  ctx.strokeStyle = ctx.fillStyle = bright;
  ctx.lineWidth = 5;
  diamond(29, active);
  if (channeling) diamond(12, true);
  if (channeling) {
    ctx.strokeStyle = '#3b5955';
    ctx.beginPath();
    ctx.arc(65, 110, 46, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = bright;
    ctx.beginPath();
    ctx.arc(65, 110, 46, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
    ctx.stroke();
  }
  if (active) {
    ctx.fillStyle = '#142622';
    ctx.fillRect(54, 111, 22, 15);
    ctx.strokeStyle = '#142622';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(65, 109, 7, Math.PI, 0);
    ctx.lineTo(72, 114);
    ctx.moveTo(58, 114);
    ctx.lineTo(58, 109);
    ctx.stroke();
    ctx.fillStyle = bright;
    ctx.fillRect(64, 115, 2, 5);
  }

  ctx.fillStyle = bright;
  ctx.font = `bold 24px ${MONO}`;
  ctx.fillText(active ? 'LINK LOCKED' : channeling ? 'SYNCING LINK' : 'STANDBY', 142, 75);
  ctx.font = `15px ${MONO}`;
  ctx.fillStyle = '#a2bcb6';
  if (channeling) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(142, 88, 233, 67);
    ctx.clip();
    const offset = still ? 0 : progress * 4;
    const row = Math.floor(offset);
    for (let i = 0; i < 4; i += 1) ctx.fillText(LOG[row + i], 142, 108 + i * 21 - (offset - row) * 21);
    ctx.restore();
  } else {
    ctx.fillText(active ? '> ROUTE VERIFIED' : '> CARRIER OFFLINE', 142, 106);
    ctx.fillText(active ? '> SESSION SEALED' : '> AWAITING INPUT', 142, 128);
  }
  ctx.font = `bold 16px ${MONO}`;
  ctx.fillStyle = bright;
  ctx.fillText(active ? 'UPLINK COMPLETE' : channeling ? 'KEEP HOLDING' : 'LOCAL ACCESS', 142, 165);
  ctx.fillStyle = '#405554';
  ctx.fillRect(15, 195, 274, 15);
  ctx.fillStyle = '#0d191c';
  ctx.fillRect(17, 197, 270, 11);
  ctx.fillStyle = bright;
  ctx.fillRect(17, 197, 270 * progress, 11);
  ctx.fillText(`${Math.round(progress * 100)}%`, 310, 210);
  ctx.restore();
}
