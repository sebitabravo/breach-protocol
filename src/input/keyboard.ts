/**
 * Estado de teclado sin DOM. Separado de `InputManager` para testear el
 * manejo de auto-repeat y el criterio de `preventDefault`.
 */
const SCROLL_KEYS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export class KeyboardState {
  private keys = new Set<string>();
  private jump = false;
  private reload = false;
  private switchTo = 0;

  /** Una tecla ya presionada que llega como `repeat` igual debe quedar registrada (pausa, blur). */
  keyDown(code: string, repeat: boolean): void {
    this.keys.add(code);
    if (repeat) return;
    if (code === 'Space') this.jump = true;
    if (code === 'KeyR') this.reload = true;
    if (code === 'Digit1') this.switchTo = 1;
    if (code === 'Digit2') this.switchTo = 2;
  }

  keyUp(code: string): void {
    this.keys.delete(code);
  }

  has(code: string): boolean {
    return this.keys.has(code);
  }

  consumeJump(): boolean {
    const value = this.jump;
    this.jump = false;
    return value;
  }

  consumeReload(): boolean {
    const value = this.reload;
    this.reload = false;
    return value;
  }

  consumeSwitch(): number {
    const value = this.switchTo;
    this.switchTo = 0;
    return value;
  }

  clear(): void {
    this.keys.clear();
    this.jump = false;
    this.reload = false;
    this.switchTo = 0;
  }
}

export interface KeyContext {
  playing: boolean;
  formTarget: boolean;
}

/** Bloquear scroll con Espacio/flechas solo en juego y nunca sobre controles de formulario. */
export function shouldPreventDefault(code: string, context: KeyContext): boolean {
  return context.playing && !context.formTarget && SCROLL_KEYS.has(code);
}
