import type Phaser from 'phaser';
import { INK } from './palette';

type Kind = 'spark' | 'shard' | 'puff' | 'ring' | 'dot';

interface P {
  kind: Kind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: number;
  rot: number;
  vr: number;
  drag: number;
  grav: number;
  /** Ring end radius. */
  grow: number;
  outline: boolean;
}

export interface BurstOpts {
  count: number;
  color: number;
  speed: [number, number];
  life: [number, number];
  size: [number, number];
  kind?: Kind;
  /** Direction (radians) and spread; omit for omnidirectional. */
  angle?: number;
  spread?: number;
  grav?: number;
  drag?: number;
  outline?: boolean;
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** A small, allocation-light particle system drawn with one Graphics object. Pure presentation. */
export class Particles {
  private list: P[] = [];
  max = 1600;
  scale = 1;

  burst(x: number, y: number, o: BurstOpts): void {
    const n = Math.round(o.count * this.scale);
    for (let i = 0; i < n; i++) {
      const a = o.angle != null ? o.angle + rnd(-(o.spread ?? Math.PI), o.spread ?? Math.PI) : rnd(0, Math.PI * 2);
      const s = rnd(o.speed[0], o.speed[1]);
      this.add({
        kind: o.kind ?? 'spark',
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: 0,
        max: rnd(o.life[0], o.life[1]),
        size: rnd(o.size[0], o.size[1]),
        color: o.color,
        rot: rnd(0, Math.PI * 2),
        vr: rnd(-14, 14),
        drag: o.drag ?? 3,
        grav: o.grav ?? 0,
        grow: 0,
        outline: o.outline ?? false,
      });
    }
  }

  ring(x: number, y: number, radius: number, color: number, life = 0.3, width = 3): void {
    this.add({ kind: 'ring', x, y, vx: 0, vy: 0, life: 0, max: life, size: width, color, rot: 0, vr: 0, drag: 0, grav: 0, grow: radius, outline: false });
  }

  puff(x: number, y: number, color: number, size: number, life = 0.45, vx = 0, vy = -20): void {
    this.add({ kind: 'puff', x, y, vx, vy, life: 0, max: life, size, color, rot: 0, vr: 0, drag: 2, grav: 0, grow: 0, outline: false });
  }

  private add(p: P): void {
    if (this.list.length >= this.max) this.list.shift();
    this.list.push(p);
  }

  update(dt: number): void {
    const keep: P[] = [];
    for (const p of this.list) {
      p.life += dt;
      if (p.life >= p.max) continue;
      const k = Math.exp(-p.drag * dt);
      p.vx *= k;
      p.vy = p.vy * k + p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      keep.push(p);
    }
    this.list = keep;
  }

  draw(g: Phaser.GameObjects.Graphics): void {
    for (const p of this.list) {
      const t = p.life / p.max;
      const a = 1 - t;
      switch (p.kind) {
        case 'spark': {
          g.lineStyle(p.size, p.color, a);
          g.lineBetween(p.x, p.y, p.x - p.vx * 0.028, p.y - p.vy * 0.028);
          break;
        }
        case 'dot':
          g.fillStyle(p.color, a);
          g.fillCircle(p.x, p.y, p.size * (1 - t * 0.6));
          break;
        case 'puff':
          g.fillStyle(p.color, a * 0.55);
          g.fillCircle(p.x, p.y, p.size * (0.6 + t * 0.9));
          break;
        case 'ring':
          g.lineStyle(p.size * (1 - t * 0.5), p.color, a);
          g.strokeCircle(p.x, p.y, 4 + p.grow * Math.sqrt(t));
          break;
        case 'shard': {
          const s = p.size * (1 - t * 0.4);
          const c = Math.cos(p.rot);
          const sn = Math.sin(p.rot);
          const pts = [
            { x: p.x + c * s, y: p.y + sn * s },
            { x: p.x - c * s * 0.6 - sn * s * 0.5, y: p.y - sn * s * 0.6 + c * s * 0.5 },
            { x: p.x - c * s * 0.5 + sn * s * 0.6, y: p.y - sn * s * 0.5 - c * s * 0.6 },
          ];
          g.fillStyle(p.color, a);
          g.fillTriangle(pts[0].x, pts[0].y, pts[1].x, pts[1].y, pts[2].x, pts[2].y);
          if (p.outline) {
            g.lineStyle(1.5, INK, a);
            g.strokeTriangle(pts[0].x, pts[0].y, pts[1].x, pts[1].y, pts[2].x, pts[2].y);
          }
          break;
        }
      }
    }
  }

  clear(): void {
    this.list = [];
  }
}
