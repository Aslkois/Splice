import { normalizeKeyCode, type InputFrame } from '../sim/input';
import type { Vec } from '../sim/math';

/**
 * Collects DOM input and hands the simulation one frame per fixed tick. Presses and releases are
 * latched, so a tap shorter than a tick is never lost.
 */
export class InputManager {
  private held = new Set<string>();
  private pressedLatch = new Set<string>();
  private releasedLatch = new Set<string>();
  aim: Vec | null = null;
  enabled = true;
  /** Keys the app layer handles itself (menus, workshop). */
  onSystemKey: ((key: string, e: KeyboardEvent) => void) | null = null;
  private target: HTMLElement | null = null;

  private isTyping(e: Event): boolean {
    const t = e.target as HTMLElement | null;
    if (!t) return false;
    const tag = t.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.isTyping(e)) return;
    const k = normalizeKeyCode(e.code);
    if (!k) return;
    if (k === 'Escape' || k === 'Tab') {
      e.preventDefault();
      if (!e.repeat) this.onSystemKey?.(k, e);
      return;
    }
    if (k === 'R' && e.ctrlKey) return;
    if (!this.enabled) return;
    if (['Space', 'Up', 'Down', 'Left', 'Right'].includes(k)) e.preventDefault();
    if (e.repeat) return;
    if (!this.held.has(k)) this.pressedLatch.add(k);
    this.held.add(k);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    const k = normalizeKeyCode(e.code);
    if (!k) return;
    if (this.held.delete(k)) this.releasedLatch.add(k);
  };

  private onMouseDown = (e: MouseEvent) => {
    if (!this.enabled) return;
    const k = e.button === 0 ? 'MouseLeft' : e.button === 2 ? 'MouseRight' : null;
    if (!k) return;
    if (!this.held.has(k)) this.pressedLatch.add(k);
    this.held.add(k);
  };

  private onMouseUp = (e: MouseEvent) => {
    const k = e.button === 0 ? 'MouseLeft' : e.button === 2 ? 'MouseRight' : null;
    if (k && this.held.delete(k)) this.releasedLatch.add(k);
  };

  private onBlur = () => this.releaseAll();
  private onContext = (e: Event) => e.preventDefault();

  attach(canvasParent: HTMLElement): void {
    this.target = canvasParent;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    canvasParent.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    canvasParent.addEventListener('contextmenu', this.onContext);
  }

  detach(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('mouseup', this.onMouseUp);
    this.target?.removeEventListener('mousedown', this.onMouseDown);
    this.target?.removeEventListener('contextmenu', this.onContext);
  }

  releaseAll(): void {
    for (const k of this.held) this.releasedLatch.add(k);
    this.held.clear();
  }

  /** Synthetic input for automation/testing hooks. */
  press(k: string): void {
    if (!this.held.has(k)) this.pressedLatch.add(k);
    this.held.add(k);
  }
  release(k: string): void {
    if (this.held.delete(k)) this.releasedLatch.add(k);
  }

  /** Consumes latched edges and returns the frame for one tick. */
  nextFrame(): InputFrame {
    const frame: InputFrame = {
      held: new Set(this.held),
      pressed: new Set(this.pressedLatch),
      released: new Set(this.releasedLatch),
      aim: this.aim ? { ...this.aim } : null,
    };
    this.pressedLatch.clear();
    this.releasedLatch.clear();
    return frame;
  }
}
