import { describe, expect, it } from 'vitest';
import { Driver, makeWorld } from './helpers';

describe('player movement', () => {
  it('settles on the ground and becomes grounded', () => {
    const w = makeWorld();
    const d = new Driver(w);
    d.run(1);
    const p = w.player!;
    expect(p.grounded).toBe(true);
    expect(p.pos.y + p.h / 2).toBeGreaterThan(595);
    expect(p.pos.y + p.h / 2).toBeLessThan(605);
  });

  it('accelerates to run speed and decelerates', () => {
    const w = makeWorld();
    const d = new Driver(w);
    d.run(0.5);
    d.run(0.5, ['D']);
    const p = w.player!;
    expect(p.vel.x).toBeGreaterThan(300);
    expect(p.facing).toBe(1);
    d.run(0.3);
    expect(Math.abs(p.vel.x)).toBeLessThan(5);
  });

  it('jumps to a sensible apex and lands again', () => {
    const w = makeWorld();
    const d = new Driver(w);
    d.run(0.5);
    const p = w.player!;
    const y0 = p.pos.y;
    let minY = y0;
    d.tap('Space', 1, ['Space']);
    for (let i = 0; i < 60; i++) {
      w.step(d.input.frame(['Space']));
      minY = Math.min(minY, p.pos.y);
    }
    const height = y0 - minY;
    expect(height).toBeGreaterThan(110);
    expect(height).toBeLessThan(170);
    d.run(0.6);
    expect(p.grounded).toBe(true);
  });

  it('short hop when jump is released early', () => {
    const w = makeWorld();
    const d = new Driver(w);
    d.run(0.5);
    const p = w.player!;
    const y0 = p.pos.y;
    let minY = y0;
    d.tap('Space', 2);
    for (let i = 0; i < 50; i++) {
      w.step(d.input.frame([]));
      minY = Math.min(minY, p.pos.y);
    }
    expect(y0 - minY).toBeLessThan(80);
  });

  it('buffers a jump pressed just before landing', () => {
    const w = makeWorld();
    const d = new Driver(w);
    d.run(0.5);
    const p = w.player!;
    d.tap('Space', 1, ['Space']);
    // wait until falling close to the ground
    let guard = 0;
    while (!(p.vel.y > 0 && p.pos.y > 540) && guard++ < 200) w.step(d.input.frame(['Space']));
    w.step(d.input.frame([]));
    d.tap('Space', 1); // pressed while still airborne
    let jumpedAgain = false;
    for (let i = 0; i < 20; i++) {
      w.step(d.input.frame([]));
      if (p.vel.y < -200) jumpedAgain = true;
    }
    expect(jumpedAgain).toBe(true);
  });

  it('dashes using stamina, not energy', () => {
    const w = makeWorld();
    const d = new Driver(w);
    d.run(0.5);
    const p = w.player!;
    const x0 = p.pos.x;
    const e0 = p.account.energy;
    const s0 = p.account.stamina;
    d.tap('Shift', 1);
    d.run(0.15);
    expect(p.pos.x - x0).toBeGreaterThan(90);
    expect(p.account.energy).toBe(e0);
    expect(p.account.stamina).toBeLessThan(s0);
  });
});
