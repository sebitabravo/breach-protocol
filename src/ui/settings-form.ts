/**
 * Enlaza los controles de ajustes (pausa y calibración) con `Settings`. No guarda
 * nada: reporta cambios como parches y se resincroniza desde el estado real.
 */
import type { Quality, Settings } from '../core/settings';
import { byId } from './dom';

export interface SettingsFormHooks {
  onPatch(patch: Partial<Settings>): void;
  onTelemetry(visible: boolean): void;
  usingTouch(): boolean;
}

export interface SettingsView {
  settings: Settings;
  telemetry: boolean;
  usingTouch: boolean;
  gfxDetail: string;
}

type Field = HTMLInputElement | HTMLSelectElement;

function field(id: string): Field | null {
  return document.getElementById(id) as Field | null;
}

function isChecked(node: Field): boolean {
  return (node as HTMLInputElement).checked;
}

export class SettingsForm {
  constructor(
    private readonly root: HTMLElement,
    private readonly hooks: SettingsFormHooks,
  ) {}

  attach(signal: AbortSignal): void {
    for (const tab of this.root.querySelectorAll<HTMLButtonElement>('#screen-pause [data-tab]')) {
      const pane = this.root.querySelector<HTMLElement>(`[data-pane="${tab.dataset.tab}"]`);
      if (!pane || pane.querySelector('.section-title')) continue;
      const heading = document.createElement('h3');
      heading.className = 'section-title';
      heading.id = `pause-title-${tab.dataset.tab}`;
      heading.textContent = tab.textContent;
      pane.id = `pause-panel-${tab.dataset.tab}`;
      pane.setAttribute('role', 'tabpanel');
      pane.setAttribute('aria-labelledby', heading.id);
      tab.setAttribute('aria-controls', pane.id);
      pane.prepend(heading);
    }
    const bind = (id: string, handler: (node: Field) => void): void => {
      const node = field(id);
      if (!node) return;
      const eventName = node instanceof HTMLInputElement && node.type === 'range' ? 'input' : 'change';
      node.addEventListener(eventName, () => handler(node), { signal });
    };

    bind('set-quality', (node) => this.hooks.onPatch({ quality: node.value as Quality }));
    bind('set-motion', (node) => this.hooks.onPatch({ reduceMotion: isChecked(node) }));
    bind('set-telemetry', (node) => this.hooks.onTelemetry(isChecked(node)));
    bind('set-audio', (node) => this.hooks.onPatch({ audioEnabled: isChecked(node) }));
    bind('set-volume', (node) => this.hooks.onPatch({ volume: Number(node.value) }));
    bind('set-sens', (node) => {
      const value = Number(node.value);
      this.hooks.onPatch({ sensitivityMouse: value, sensitivityTouch: value });
    });
    bind('set-invert', (node) => this.hooks.onPatch({ invertY: isChecked(node) }));
    bind('set-hud', (node) => this.hooks.onPatch({ hudScale: Number(node.value) }));
    bind('set-handed', (node) => this.hooks.onPatch({ handedness: isChecked(node) ? 'left' : 'right' }));
    bind('set-autoreload', (node) => this.hooks.onPatch({ autoReload: isChecked(node) }));
    bind('set-aimassist', (node) => this.hooks.onPatch({ aimAssistTouch: isChecked(node) }));

    bind('calib-sens', (node) => {
      const value = Number(node.value);
      this.hooks.onPatch(this.hooks.usingTouch() ? { sensitivityTouch: value } : { sensitivityMouse: value });
    });
    bind('calib-invert', (node) => this.hooks.onPatch({ invertY: isChecked(node) }));
    bind('calib-autoreload', (node) => this.hooks.onPatch({ autoReload: isChecked(node) }));
    bind('calib-aimassist', (node) => this.hooks.onPatch({ aimAssistTouch: isChecked(node) }));

    this.root.addEventListener(
      'click',
      (event) => {
        const button = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-handedness]');
        if (!button) return;
        this.hooks.onPatch({ handedness: button.dataset.handedness === 'left' ? 'left' : 'right' });
      },
      { signal },
    );
  }

  sync(view: SettingsView): void {
    const { settings } = view;
    const set = (id: string, value: string | number | boolean): void => {
      const node = field(id);
      if (!node) return;
      if (node instanceof HTMLInputElement && node.type === 'checkbox') node.checked = Boolean(value);
      else node.value = String(value);
    };
    const calibSens = view.usingTouch ? settings.sensitivityTouch : settings.sensitivityMouse;

    set('set-quality', settings.quality);
    set('set-motion', settings.reduceMotion);
    set('set-telemetry', view.telemetry);
    set('set-audio', settings.audioEnabled);
    set('set-volume', settings.volume);
    set('set-sens', settings.sensitivityMouse);
    set('set-invert', settings.invertY);
    set('set-hud', settings.hudScale);
    set('set-handed', settings.handedness === 'left');
    set('set-autoreload', settings.autoReload);
    set('set-aimassist', settings.aimAssistTouch);
    set('calib-sens', calibSens);
    set('calib-invert', settings.invertY);
    set('calib-autoreload', settings.autoReload);
    set('calib-aimassist', settings.aimAssistTouch);

    byId('calib-sens-val').textContent = `${calibSens.toFixed(2)}×`;
    byId('set-sens-val').textContent = `${settings.sensitivityMouse.toFixed(2)}×`;
    byId('set-volume-val').textContent = `${Math.round(settings.volume * 100)}%`;
    byId('set-hud-val').textContent = `${Math.round(settings.hudScale * 100)}%`;
    byId('gfx-detail').textContent = view.gfxDetail;

    this.root.querySelectorAll<HTMLElement>('[data-handedness]').forEach((node) => {
      const active = node.dataset.handedness === settings.handedness;
      node.classList.toggle('is-active', active);
      node.setAttribute('aria-checked', active ? 'true' : 'false');
    });
  }
}
