import './styles/base.css';
import './styles/menus.css';
import './styles/hud.css';
import './styles/touch.css';
import './styles/eng.css';

import { AudioManager } from './audio/audio';
import type { GameApp } from './core/game';
import { BootView } from './ui/boot-view';
import { byId } from './ui/dom';

// Debug handle; published before the renderer initializes, not before the shell paints.
declare global {
  interface Window {
    __BREACH__?: GameApp;
  }
}

const root = byId('app');
const view = new BootView();
const audio = new AudioManager();
const earlyInput = new AbortController();
let intent: HTMLElement | undefined;
let loading: Promise<void> | undefined;

function loadGame(): Promise<void> {
  return loading ??= import('./core/game').then(({ GameApp }) => {
    const game = new GameApp(audio);
    window.__BREACH__ = game;
    return game.boot(() => {
      earlyInput.abort();
      return intent;
    });
  }).catch((error: unknown) => {
    view.setFailure(error);
    root.dataset.screen = 'fallback';
    root.querySelector<HTMLElement>('#screen-fallback [data-action="retry"]')?.focus();
  });
}

function activate(control: HTMLElement): void {
  if (root.dataset.screen !== 'shell') return;
  intent = control;
  audio.unlock(); // Keep the user gesture even if the import takes seconds.
  view.setMeta('cargando módulos…');
  view.setProgress(4);
  root.dataset.screen = 'boot';
  void loadGame();
}

root.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (root.dataset.screen === 'fallback' && target.closest('[data-action="retry"]')) {
    window.location.reload();
    return;
  }
  const control = target.closest<HTMLElement>('#screen-menu [data-action], #screen-menu [data-goto]');
  if (control) activate(control);
}, { signal: earlyInput.signal });
window.addEventListener('keydown', (event) => {
  if (event.code !== 'F3' || event.repeat || root.dataset.screen !== 'shell') return;
  event.preventDefault();
  const control = root.querySelector<HTMLElement>('#screen-menu [data-action="engineering"]');
  if (control) activate(control);
}, { signal: earlyInput.signal });
root.dataset.shellReady = 'true';

// Give the shell a paint before executing the game or requesting Three.js.
// A menu action can take the fast path above without waiting for idle.
requestAnimationFrame(() => requestAnimationFrame(() => {
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(() => { void loadGame(); }, { timeout: 750 });
  } else {
    window.setTimeout(() => { void loadGame(); }, 0);
  }
}));
