import type { LevelTheme, SolidStyle } from '../sim/levels/types';

/** One visual language for the world: ink outlines, flat fills, signal colours that mean something. */
export const INK = 0x15161c;
export const WHITE = 0xf7f7f2;

export const SIGNAL = {
  orange: 0xff8a1f,
  cobalt: 0x2f6bff,
  teal: 0x18c29c,
  yellow: 0xffd23f,
  red: 0xe8455c,
  pink: 0xff5c8a,
  violet: 0xb45cff,
};

export const RESOURCE = {
  energy: SIGNAL.yellow,
  stamina: SIGNAL.teal,
  health: 0xff5c6c,
};

export interface Theme {
  sky: number;
  far: number;
  mid: number;
  near: number;
  accent: number;
  solids: Record<SolidStyle, { body: number; top: number; detail: number }>;
}

const baseSolids = {
  ground: { body: 0x5d7480, top: 0xb9cdd4, detail: 0x4c616c },
  platform: { body: 0x2e3b42, top: SIGNAL.yellow, detail: 0x222c31 },
  wall: { body: 0x3e4f58, top: 0x5d7480, detail: 0x34434b },
  metal: { body: 0x6b7a86, top: 0xa9b7c2, detail: 0x56636e },
  glass: { body: 0x7fd6e0, top: 0xd5f6fa, detail: 0x5fb5c0 },
};

export const THEMES: Record<LevelTheme, Theme> = {
  lab: {
    sky: 0x1b2a31,
    far: 0x22353d,
    mid: 0x2a414b,
    near: 0x31505b,
    accent: SIGNAL.teal,
    solids: baseSolids,
  },
  foundry: {
    sky: 0x2a1c22,
    far: 0x35232a,
    mid: 0x412a31,
    near: 0x4d3038,
    accent: SIGNAL.orange,
    solids: {
      ...baseSolids,
      ground: { body: 0x6e5a5f, top: 0xc7a99c, detail: 0x5a484d },
      metal: { body: 0x7a6a70, top: 0xb8a3a6, detail: 0x63555a },
      wall: { body: 0x4a383e, top: 0x6e5a5f, detail: 0x3e2f34 },
    },
  },
  workshop: {
    sky: 0x2b2a35,
    far: 0x34333f,
    mid: 0x3c3b48,
    near: 0x464454,
    accent: SIGNAL.orange,
    solids: {
      ...baseSolids,
      ground: { body: 0x8a5d3b, top: 0xc58b5a, detail: 0x74492c },
      wall: { body: 0x3c3b48, top: 0x55536a, detail: 0x32313d },
    },
  },
};

export function hexToCss(n: number): string {
  return '#' + n.toString(16).padStart(6, '0');
}

export function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
}
