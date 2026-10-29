import type { Vec } from './math';

/**
 * One fixed simulation tick worth of input. The simulation never reads the DOM:
 * the browser input layer (or a test script) produces these frames.
 */
export interface InputFrame {
  held: ReadonlySet<string>;
  pressed: ReadonlySet<string>;
  released: ReadonlySet<string>;
  /** Aim point in world coordinates (mouse), if known. */
  aim: Vec | null;
}

export const EMPTY_INPUT: InputFrame = {
  held: new Set(),
  pressed: new Set(),
  released: new Set(),
  aim: null,
};

/** Keys driving the built-in movement layer. Mechanics may still listen to them. */
export const BINDINGS = {
  left: ['A', 'Left'],
  right: ['D', 'Right'],
  jump: ['Space', 'W', 'Up'],
  down: ['S', 'Down'],
  dash: ['Shift'],
  interact: ['E', 'Enter'],
} as const;

/** Keys a mechanic can bind to (shown in the key picker). */
export const BINDABLE_KEYS = [
  'F', 'Q', 'E', 'R', 'G', 'Z', 'X', 'C', 'V', 'B', 'T',
  '1', '2', '3', '4',
  'Space', 'Shift', 'W', 'A', 'S', 'D',
  'Up', 'Down', 'Left', 'Right',
  'MouseLeft', 'MouseRight',
] as const;

export function anyHeld(frame: InputFrame, keys: readonly string[]): boolean {
  for (const k of keys) if (frame.held.has(k)) return true;
  return false;
}

export function anyPressed(frame: InputFrame, keys: readonly string[]): boolean {
  for (const k of keys) if (frame.pressed.has(k)) return true;
  return false;
}

/** Normalises a DOM KeyboardEvent.code into the short names used everywhere else. */
export function normalizeKeyCode(code: string): string | null {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  switch (code) {
    case 'Space':
      return 'Space';
    case 'ShiftLeft':
    case 'ShiftRight':
      return 'Shift';
    case 'ArrowUp':
      return 'Up';
    case 'ArrowDown':
      return 'Down';
    case 'ArrowLeft':
      return 'Left';
    case 'ArrowRight':
      return 'Right';
    case 'Enter':
    case 'NumpadEnter':
      return 'Enter';
    case 'Escape':
      return 'Escape';
    case 'Tab':
      return 'Tab';
    default:
      return null;
  }
}

/** Builds input frames from a script; handy for tests and replays. */
export class ScriptedInput {
  private prevHeld = new Set<string>();
  frame(held: Iterable<string>, aim: Vec | null = null): InputFrame {
    const now = new Set(held);
    const pressed = new Set<string>();
    const released = new Set<string>();
    for (const k of now) if (!this.prevHeld.has(k)) pressed.add(k);
    for (const k of this.prevHeld) if (!now.has(k)) released.add(k);
    this.prevHeld = now;
    return { held: now, pressed, released, aim };
  }
}
