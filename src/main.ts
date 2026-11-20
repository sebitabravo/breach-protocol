import './styles/base.css';
import './styles/menus.css';
import './styles/hud.css';
import './styles/touch.css';
import './styles/eng.css';

import { GameApp } from './core/game';

const app = new GameApp();
void app.boot();

// Expose the shell for the e2e smoke test and for curious engineers; this is a
// read-only handle, not a public API.
declare global {
  interface Window {
    __BREACH__?: GameApp;
  }
}
window.__BREACH__ = app;
