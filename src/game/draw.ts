import type Phaser from 'phaser';
import type { Cannon, Turret, Walker } from '../sim/entities/enemies';
import type { Entity } from '../sim/entities/Entity';
import type { Player } from '../sim/entities/Player';
import type { Projectile } from '../sim/entities/Projectile';
import type { Cell, Crate, Door, Gate, Goal, Spikes, Target } from '../sim/entities/props';
import type { LevelDef } from '../sim/levels/types';
import type { Vec } from '../sim/math';
import { INK, mix, SIGNAL, WHITE, type Theme } from './palette';

type G = Phaser.GameObjects.Graphics;

const OUT = 3;

function local(e: Entity, lx: number, ly: number): Vec {
  const p = e.pos;
  const c = Math.cos(e.angle);
  const s = Math.sin(e.angle);
  return { x: p.x + lx * c - ly * s, y: p.y + lx * s + ly * c };
}

function poly(g: G, pts: Vec[], fill: number, alpha = 1, outline = true, width = OUT): void {
  // Graphics accepts any {x, y}; the typings ask for Vector2.
  const v = pts as unknown as Phaser.Math.Vector2[];
  g.fillStyle(fill, alpha);
  g.fillPoints(v, true, true);
  if (outline) {
    g.lineStyle(width, INK, alpha);
    g.strokePoints(v, true, true);
  }
}

function rrect(g: G, x: number, y: number, w: number, h: number, r: number, fill: number, outline = true, alpha = 1): void {
  g.fillStyle(fill, alpha);
  g.fillRoundedRect(x, y, w, h, r);
  if (outline) {
    g.lineStyle(OUT, INK, alpha);
    g.strokeRoundedRect(x, y, w, h, r);
  }
}

function hpPips(g: G, e: Entity, now: number, yOff: number): void {
  if (e.hp >= e.maxHp || !e.alive) return;
  if (now - e.lastHurtTime > 3) return;
  const w = Math.max(30, Math.min(70, e.w));
  const x = e.pos.x - w / 2;
  const y = e.pos.y + yOff;
  g.fillStyle(INK, 0.85);
  g.fillRoundedRect(x - 2, y - 2, w + 4, 8, 3);
  g.fillStyle(SIGNAL.red, 1);
  g.fillRect(x, y, w * Math.max(0, e.hp / e.maxHp), 4);
}

// ---------------------------------------------------------------- backdrop

/** Parallax silhouettes painted once per level. Returns the layers so the scene can set scroll factors. */
export function paintBackdrop(layers: { far: G; mid: G; near: G }, level: LevelDef, theme: Theme): void {
  const W = level.width;
  const H = level.height;
  const seed = level.id.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  let r = seed * 9301;
  const rand = () => ((r = (r * 9301 + 49297) % 233280) / 233280);

  const far = layers.far;
  far.fillStyle(theme.far, 1);
  for (let x = -400; x < W * 0.4 + 1600; x += 140 + rand() * 120) {
    const h = 260 + rand() * 360;
    const w = 90 + rand() * 120;
    far.fillRect(x, H * 0.55 - h, w, h + 900);
    if (rand() > 0.5) far.fillRect(x + w * 0.3, H * 0.55 - h - 60, 16, 60);
  }

  const mid = layers.mid;
  mid.fillStyle(theme.mid, 1);
  mid.lineStyle(10, theme.mid, 1);
  for (let x = -300; x < W * 0.6 + 1400; x += 220 + rand() * 180) {
    if (level.theme === 'foundry') {
      const h = 300 + rand() * 300;
      mid.fillRect(x, H * 0.62 - h, 46, h + 900);
      mid.fillCircle(x + 23, H * 0.62 - h, 30);
    } else if (level.theme === 'workshop') {
      mid.fillRoundedRect(x, H * 0.18 + rand() * 120, 160 + rand() * 80, 22, 6);
    } else {
      const y = H * 0.25 + rand() * H * 0.3;
      mid.lineBetween(x, y, x + 260, y);
      mid.fillCircle(x, y, 18);
      mid.fillRect(x + 120, y, 10, 900);
    }
  }
  // Big gear silhouettes for the lab/workshop.
  if (level.theme !== 'foundry') {
    for (let i = 0; i < 4; i++) {
      const cx = rand() * (W * 0.6 + 800);
      const cy = H * (0.2 + rand() * 0.35);
      const rad = 50 + rand() * 70;
      mid.fillCircle(cx, cy, rad);
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2;
        mid.fillCircle(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad, rad * 0.18);
      }
      mid.fillStyle(theme.far, 1);
      mid.fillCircle(cx, cy, rad * 0.35);
      mid.fillStyle(theme.mid, 1);
    }
  }

  const near = layers.near;
  near.fillStyle(theme.near, 1);
  near.lineStyle(4, theme.near, 1);
  if (level.theme === 'workshop') {
    // Pegboard.
    near.fillStyle(theme.near, 1);
    for (let x = 0; x < W * 0.85 + 400; x += 36) for (let y = 60; y < H * 0.8; y += 36) near.fillCircle(x, y, 3);
  } else {
    for (let x = -200; x < W * 0.8 + 600; x += 300 + rand() * 200) {
      near.lineBetween(x, -200, x, H + 400);
      near.lineBetween(x + 14, -200, x + 14, H + 400);
      for (let y = 0; y < H; y += 90) near.lineBetween(x, y, x + 14, y + 45);
    }
  }
}

// ---------------------------------------------------------------- level geometry

export function paintSolids(g: G, level: LevelDef, theme: Theme): void {
  for (const s of level.solids) {
    const style = s.style ?? 'ground';
    const c = theme.solids[style];
    g.fillStyle(c.body, 1);
    g.fillRect(s.x, s.y, s.w, s.h);
    // detail pass
    g.lineStyle(2, c.detail, 1);
    if (style === 'ground') {
      for (let x = s.x + 24; x < s.x + s.w; x += 48) g.lineBetween(x, s.y + 16, x - 18, s.y + Math.min(s.h, 70));
    } else if (style === 'metal') {
      g.fillStyle(c.detail, 1);
      for (let x = s.x + 12; x < s.x + s.w - 6; x += 40) {
        g.fillCircle(x, s.y + 14, 3);
        if (s.h > 40) g.fillCircle(x, s.y + s.h - 10, 3);
      }
    } else if (style === 'wall') {
      for (let y = s.y + 30; y < s.y + s.h; y += 30) g.lineBetween(s.x, y, s.x + s.w, y);
    } else if (style === 'platform') {
      for (let x = s.x + 6; x < s.x + s.w - 4; x += 16) g.lineBetween(x, s.y + s.h - 2, x + 8, s.y + 8);
    }
    const topH = style === 'platform' ? 7 : 10;
    g.fillStyle(c.top, 1);
    g.fillRect(s.x, s.y, s.w, Math.min(topH, s.h));
    g.lineStyle(OUT, INK, 1);
    g.strokeRect(s.x, s.y, s.w, s.h);
    g.lineStyle(2, INK, 0.6);
    g.lineBetween(s.x, s.y + Math.min(topH, s.h), s.x + s.w, s.y + Math.min(topH, s.h));
  }
}

// ---------------------------------------------------------------- player

export interface PlayerView {
  scarf: Vec[];
  squash: number;
  runPhase: number;
  ghosts: { x: number; y: number; f: number; t: number }[];
  guardFlash: number;
}

export function newPlayerView(): PlayerView {
  return { scarf: [], squash: 0, runPhase: 0, ghosts: [], guardFlash: 0 };
}

export function updatePlayerView(v: PlayerView, p: Player, dt: number): void {
  const vel = p.vel;
  if (p.grounded) v.runPhase += (Math.abs(vel.x) / 330) * dt * 14;
  v.squash *= Math.exp(-10 * dt);
  v.guardFlash = Math.max(0, v.guardFlash - dt * 4);
  const anchor = { x: p.pos.x - p.facing * 9, y: p.pos.y - 8 };
  if (v.scarf.length === 0) for (let i = 0; i < 6; i++) v.scarf.push({ x: anchor.x, y: anchor.y });
  v.scarf[0] = anchor;
  for (let i = 1; i < v.scarf.length; i++) {
    const prev = v.scarf[i - 1];
    const cur = v.scarf[i];
    cur.y += 60 * dt;
    cur.x -= vel.x * 0.0009 + p.facing * 0.35;
    const dx = cur.x - prev.x;
    const dy = cur.y - prev.y;
    const d = Math.hypot(dx, dy) || 1;
    const seg = 5;
    cur.x = prev.x + (dx / d) * seg;
    cur.y = prev.y + (dy / d) * seg;
  }
  for (const gh of v.ghosts) gh.t -= dt;
  v.ghosts = v.ghosts.filter((g) => g.t > 0);
  if (p.isDashing && Math.random() < 0.7) v.ghosts.push({ x: p.pos.x, y: p.pos.y, f: p.facing, t: 0.18 });
}

export function drawPlayer(g: G, p: Player, v: PlayerView, now: number): void {
  if (!p.alive) return;
  for (const gh of v.ghosts) {
    g.fillStyle(SIGNAL.orange, (gh.t / 0.18) * 0.35);
    g.fillRoundedRect(gh.x - p.w / 2, gh.y - p.h / 2, p.w, p.h, 8);
  }
  const pos = p.pos;
  const f = p.facing;
  const sq = v.squash;
  const w = p.w * (1 + sq * 0.25);
  const h = p.h * (1 - sq * 0.22);
  const footY = pos.y + p.h / 2;
  const x0 = pos.x - w / 2;
  const y0 = footY - h;

  // scarf
  for (let i = 0; i < v.scarf.length - 1; i++) {
    const a = v.scarf[i];
    const b = v.scarf[i + 1];
    g.lineStyle(OUT + (6 - i), INK, 1);
    g.lineBetween(a.x, a.y, b.x, b.y);
  }
  for (let i = 0; i < v.scarf.length - 1; i++) {
    const a = v.scarf[i];
    const b = v.scarf[i + 1];
    g.lineStyle(6 - i, SIGNAL.orange, 1);
    g.lineBetween(a.x, a.y, b.x, b.y);
  }

  // feet
  const run = p.grounded && Math.abs(p.vel.x) > 30;
  const k = run ? Math.sin(v.runPhase) * 4 : 0;
  g.fillStyle(INK, 1);
  g.fillEllipse(pos.x - 6 + k, footY - 1, 12, 7);
  g.fillEllipse(pos.x + 6 - k, footY - 1, 12, 7);

  const hurt = now - p.lastHurtTime < 0.12;
  const body = hurt ? 0xffb3b8 : WHITE;
  rrect(g, x0, y0, w, h - 3, 9, body);

  // visor band + eye
  const vy = y0 + 9;
  g.fillStyle(SIGNAL.orange, 1);
  g.fillRoundedRect(x0 + 3, vy, w - 6, 12, 5);
  g.lineStyle(2, INK, 1);
  g.strokeRoundedRect(x0 + 3, vy, w - 6, 12, 5);
  const ex = pos.x + f * 6;
  const blink = Math.sin(now * 2.3) > 0.985;
  g.fillStyle(INK, 1);
  g.fillRoundedRect(ex - 3, vy + (blink ? 5 : 2), 6, blink ? 2 : 8, 2);
  // belt
  g.lineStyle(2, INK, 0.5);
  g.lineBetween(x0 + 5, footY - h * 0.38, x0 + w - 5, footY - h * 0.38);
  // antenna
  g.lineStyle(2, INK, 1);
  const tip = { x: pos.x - f * 5, y: y0 - 9 };
  g.lineBetween(pos.x - f * 2, y0, tip.x, tip.y);
  g.fillStyle(SIGNAL.orange, 1);
  g.fillCircle(tip.x, tip.y, 3.5);
  g.lineStyle(1.5, INK, 1);
  g.strokeCircle(tip.x, tip.y, 3.5);

  // guard
  if (p.guard.active) {
    const age = now - p.guard.raisedAt;
    const fresh = Math.max(0, 1 - age / 0.35);
    const cx = pos.x + f * 6;
    const cy = pos.y - 2;
    const base = f > 0 ? 0 : Math.PI;
    g.lineStyle(9, INK, 0.9);
    g.beginPath();
    g.arc(cx, cy, 30, base - 1.1, base + 1.1, false);
    g.strokePath();
    g.lineStyle(5, mix(SIGNAL.teal, WHITE, fresh * 0.8 + v.guardFlash), 1);
    g.beginPath();
    g.arc(cx, cy, 30, base - 1.05, base + 1.05, false);
    g.strokePath();
  }

  // channelling: energy spiralling in
  if (p.isChanneling) {
    for (let i = 0; i < 6; i++) {
      const a = now * 5 + (i / 6) * Math.PI * 2;
      const rr = 26 + Math.sin(now * 9 + i) * 6;
      g.fillStyle(SIGNAL.yellow, 0.9);
      g.fillCircle(pos.x + Math.cos(a) * rr, pos.y + Math.sin(a) * rr * 0.8, 2.5);
    }
  }

  if (p.stun > 0) {
    for (let i = 0; i < 3; i++) {
      const a = now * 8 + (i / 3) * Math.PI * 2;
      g.fillStyle(SIGNAL.yellow, 1);
      g.fillCircle(pos.x + Math.cos(a) * 14, y0 - 12 + Math.sin(a) * 4, 2.5);
    }
  }
}

// ---------------------------------------------------------------- enemies

export function drawTurret(g: G, t: Turret, now: number): void {
  const p = t.pos;
  const stunned = t.stun > 0;
  // mount
  poly(g, [
    { x: p.x - 24, y: p.y + 20 },
    { x: p.x + 24, y: p.y + 20 },
    { x: p.x + 16, y: p.y + 4 },
    { x: p.x - 16, y: p.y + 4 },
  ], 0x2d3a5a);
  // barrel
  const len = 36;
  const dir = { x: Math.cos(t.aim), y: Math.sin(t.aim) };
  const nrm = { x: -dir.y, y: dir.x };
  const bx = p.x;
  const by = p.y - 4;
  const kick = t.cooldown > t.interval - 0.12 ? -6 : 0;
  const b0 = { x: bx + dir.x * kick, y: by + dir.y * kick };
  const b1 = { x: b0.x + dir.x * len, y: b0.y + dir.y * len };
  poly(g, [
    { x: b0.x + nrm.x * 6, y: b0.y + nrm.y * 6 },
    { x: b1.x + nrm.x * 6, y: b1.y + nrm.y * 6 },
    { x: b1.x - nrm.x * 6, y: b1.y - nrm.y * 6 },
    { x: b0.x - nrm.x * 6, y: b0.y - nrm.y * 6 },
  ], 0x3d4d75);
  g.fillStyle(SIGNAL.red, 1);
  g.fillCircle(b1.x, b1.y, 4);
  // dome
  g.fillStyle(0x2d3a5a, 1);
  g.fillCircle(bx, by, 17);
  g.lineStyle(OUT, INK, 1);
  g.strokeCircle(bx, by, 17);
  const wind = t.windup > 0 ? 1 - t.windup / 0.38 : 0;
  const lensR = 6 + wind * 4;
  if (wind > 0) {
    g.fillStyle(SIGNAL.red, 0.25 + wind * 0.3);
    g.fillCircle(bx + dir.x * 6, by + dir.y * 6, lensR + 8);
  }
  g.fillStyle(stunned ? 0x777777 : SIGNAL.red, 1);
  g.fillCircle(bx + dir.x * 6, by + dir.y * 6, lensR);
  g.fillStyle(WHITE, 0.9);
  g.fillCircle(bx + dir.x * 6 - 2, by + dir.y * 6 - 2, 2);
  if (now - t.lastHurtTime < 0.1) {
    g.fillStyle(WHITE, 0.6);
    g.fillCircle(bx, by, 18);
  }
  hpPips(g, t, now, -40);
}

export function drawWalker(g: G, wk: Walker, now: number): void {
  const p = wk.pos;
  const f = wk.facing;
  const crouch = wk.state === 'windup' ? Math.min(1, wk.stateTime / 0.5) : 0;
  const stretch = wk.state === 'lunge' ? 1 : 0;
  const w = wk.w * (1 + crouch * 0.15 + stretch * 0.15);
  const h = wk.h * (1 - crouch * 0.2 - stretch * 0.1);
  const footY = p.y + wk.h / 2;
  // legs
  const ph = now * 12 * (wk.state === 'patrol' ? 1 : 0);
  g.lineStyle(4, INK, 1);
  for (let i = 0; i < 2; i++) {
    const lx = p.x + (i === 0 ? -10 : 10);
    const swing = Math.sin(ph + i * Math.PI) * 5;
    g.lineBetween(lx, footY - 8, lx + swing, footY);
  }
  rrect(g, p.x - w / 2, footY - 6 - h, w, h, 11, now - wk.lastHurtTime < 0.1 ? WHITE : 0x2d3a5a);
  // eye
  const ex = p.x + f * 7;
  const ey = footY - 6 - h * 0.6;
  const glow = wk.state === 'windup' ? 0.5 + 0.5 * Math.sin(now * 40) : 0;
  if (glow > 0) {
    g.fillStyle(SIGNAL.red, 0.35 * glow);
    g.fillCircle(ex, ey, 15);
  }
  g.fillStyle(WHITE, 1);
  g.fillCircle(ex, ey, 8);
  g.fillStyle(wk.stun > 0 ? 0x888888 : SIGNAL.red, 1);
  g.fillCircle(ex + f * 2, ey, 5);
  g.lineStyle(2, INK, 1);
  g.strokeCircle(ex, ey, 8);
  // antenna
  g.lineStyle(2, INK, 1);
  g.lineBetween(p.x - f * 8, footY - 6 - h, p.x - f * 12, footY - 16 - h);
  g.fillStyle(SIGNAL.red, 1);
  g.fillCircle(p.x - f * 12, footY - 16 - h, 3);
  hpPips(g, wk, now, -wk.h / 2 - 26);
}

export function drawCannon(g: G, c: Cannon, now: number, sight: Vec | null): void {
  const p = c.pos;
  const prog = c.chargeProgress;
  const dir = { x: Math.cos(c.aim), y: Math.sin(c.aim) };
  const nrm = { x: -dir.y, y: dir.x };
  const m = c.muzzle();
  if (prog > 0 && sight) {
    const locked = c.locked;
    g.lineStyle(locked ? 3 : 2, SIGNAL.red, locked ? 0.9 : 0.25 + prog * 0.45);
    const segs = 40;
    for (let i = 0; i < segs; i += 2) {
      const a = i / segs;
      const b = (i + 1) / segs;
      g.lineBetween(m.x + (sight.x - m.x) * a, m.y + (sight.y - m.y) * a, m.x + (sight.x - m.x) * b, m.y + (sight.y - m.y) * b);
    }
  }
  // base
  poly(g, [
    { x: p.x - 50, y: p.y + 37 },
    { x: p.x + 50, y: p.y + 37 },
    { x: p.x + 36, y: p.y + 6 },
    { x: p.x - 36, y: p.y + 6 },
  ], 0x2d3a5a);
  // barrel
  const recoil = c.phase === 'reload' ? Math.max(0, 1 - c.phaseTime / 0.4) * -14 : 0;
  const b0 = { x: p.x + dir.x * recoil, y: p.y - 6 + dir.y * recoil };
  const b1 = { x: b0.x + dir.x * 66, y: b0.y + dir.y * 66 };
  poly(g, [
    { x: b0.x + nrm.x * 15, y: b0.y + nrm.y * 15 },
    { x: b1.x + nrm.x * 13, y: b1.y + nrm.y * 13 },
    { x: b1.x - nrm.x * 13, y: b1.y - nrm.y * 13 },
    { x: b0.x - nrm.x * 15, y: b0.y - nrm.y * 15 },
  ], 0x3d4d75);
  for (let i = 1; i <= 3; i++) {
    const q = { x: b0.x + dir.x * i * 16, y: b0.y + dir.y * i * 16 };
    g.lineStyle(2, INK, 0.7);
    g.lineBetween(q.x + nrm.x * 14, q.y + nrm.y * 14, q.x - nrm.x * 14, q.y - nrm.y * 14);
  }
  // housing
  g.fillStyle(0x24304d, 1);
  g.fillCircle(p.x, p.y - 6, 32);
  g.lineStyle(OUT, INK, 1);
  g.strokeCircle(p.x, p.y - 6, 32);
  // core: glows with charge
  const core = mix(0x552233, SIGNAL.red, prog);
  g.fillStyle(core, 1);
  g.fillCircle(p.x, p.y - 6, 13 + prog * 5);
  g.lineStyle(2, INK, 1);
  g.strokeCircle(p.x, p.y - 6, 13 + prog * 5);
  if (prog > 0) {
    const pulse = 0.5 + 0.5 * Math.sin(now * (8 + prog * 30));
    g.lineStyle(4, mix(SIGNAL.yellow, SIGNAL.red, prog), 0.4 + pulse * 0.5);
    g.strokeCircle(m.x, m.y, 8 + (1 - prog) * 30);
    g.fillStyle(mix(SIGNAL.yellow, SIGNAL.red, prog), prog);
    g.fillCircle(m.x, m.y, 4 + prog * 7);
  }
  if (now - c.lastHurtTime < 0.1) {
    g.fillStyle(WHITE, 0.5);
    g.fillCircle(p.x, p.y - 6, 34);
  }
  hpPips(g, c, now, -60);
}

// ---------------------------------------------------------------- props

export function drawCrate(g: G, c: Crate, now: number): void {
  const verts = c.body!.vertices.map((v) => ({ x: v.x, y: v.y }));
  const hurt = now - c.lastHurtTime < 0.08;
  poly(g, verts, hurt ? WHITE : c.heavy ? 0x6c7894 : 0xc98a4b);
  const s = c.w / 2 - 5;
  const a = local(c, -s, -s);
  const b = local(c, s, s);
  const cc = local(c, s, -s);
  const d = local(c, -s, s);
  g.lineStyle(c.heavy ? 4 : 3, c.heavy ? 0x4e5870 : 0x9c6431, 1);
  g.lineBetween(a.x, a.y, b.x, b.y);
  if (c.heavy) g.lineBetween(cc.x, cc.y, d.x, d.y);
  else {
    const t1 = local(c, -s - 2, -s / 3);
    const t2 = local(c, s + 2, -s / 3);
    const t3 = local(c, -s - 2, s / 3);
    const t4 = local(c, s + 2, s / 3);
    g.lineStyle(2, 0x9c6431, 1);
    g.lineBetween(t1.x, t1.y, t2.x, t2.y);
    g.lineBetween(t3.x, t3.y, t4.x, t4.y);
  }
  const frac = c.hp / c.maxHp;
  if (frac < 0.6) {
    const k1 = local(c, -s * 0.2, -s);
    const k2 = local(c, s * 0.1, -s * 0.2);
    const k3 = local(c, -s * 0.4, s * 0.3);
    g.lineStyle(2, INK, 1);
    g.lineBetween(k1.x, k1.y, k2.x, k2.y);
    g.lineBetween(k2.x, k2.y, k3.x, k3.y);
  }
  if (c.heavy) {
    g.fillStyle(INK, 1);
    for (const [lx, ly] of [
      [-s, -s],
      [s, -s],
      [-s, s],
      [s, s],
    ]) {
      const q = local(c, lx, ly);
      g.fillCircle(q.x, q.y, 2.5);
    }
  }
}

export function drawTarget(g: G, t: Target, now: number): void {
  const p = t.pos;
  const bob = Math.sin(now * 2 + t.id) * 2;
  g.lineStyle(4, INK, 1);
  g.lineBetween(p.x, p.y + 6, p.x, p.y + 16);
  poly(g, [
    { x: p.x - 10, y: p.y + 16 },
    { x: p.x + 10, y: p.y + 16 },
    { x: p.x + 6, y: p.y + 12 },
    { x: p.x - 6, y: p.y + 12 },
  ], 0x2e3b42, 1, true, 2);
  const hurt = now - t.lastHurtTime < 0.1;
  const fill = hurt ? WHITE : 0x7fe0ff;
  const top = p.y - 14 + bob;
  poly(g, [
    { x: p.x, y: top },
    { x: p.x + 13, y: p.y - 1 + bob },
    { x: p.x, y: p.y + 10 + bob },
    { x: p.x - 13, y: p.y - 1 + bob },
  ], fill);
  g.fillStyle(WHITE, 0.8);
  g.fillTriangle(p.x, top + 4, p.x + 7, p.y - 1 + bob, p.x, p.y - 1 + bob);
  hpPips(g, t, now, -30);
}

export function drawCell(g: G, c: Cell, now: number): void {
  const p = c.pos;
  const bob = Math.sin(now * 3 + c.id) * 3;
  const y = p.y + bob;
  g.fillStyle(SIGNAL.yellow, 0.18 + 0.1 * Math.sin(now * 5));
  g.fillCircle(p.x, y, 22);
  rrect(g, p.x - 9, y - 12, 18, 26, 5, SIGNAL.yellow);
  g.fillStyle(INK, 1);
  g.fillRect(p.x - 4, y - 16, 8, 4);
  poly(g, [
    { x: p.x + 2, y: y - 8 },
    { x: p.x - 4, y: y + 2 },
    { x: p.x, y: y + 2 },
    { x: p.x - 2, y: y + 9 },
    { x: p.x + 4, y: y - 1 },
    { x: p.x, y: y - 1 },
  ], INK, 1, false);
}

export function drawSpikes(g: G, s: Spikes): void {
  const b = s.bounds();
  g.fillStyle(0x2e3b42, 1);
  g.fillRect(b.minX, b.maxY - 6, b.maxX - b.minX, 6);
  const n = Math.max(1, Math.floor((b.maxX - b.minX) / 14));
  const w = (b.maxX - b.minX) / n;
  for (let i = 0; i < n; i++) {
    const x = b.minX + i * w;
    poly(g, [
      { x, y: b.maxY - 4 },
      { x: x + w / 2, y: b.minY - 4 },
      { x: x + w, y: b.maxY - 4 },
    ], 0xe9e6dc, 1, true, 2);
  }
}

export function drawGoal(g: G, goal: Goal, now: number, active: boolean): void {
  const b = goal.bounds();
  const floor = b.maxY;
  if (goal.tag === 'exit') {
    const x = (b.minX + b.maxX) / 2;
    rrect(g, x - 30, floor - 96, 60, 96, 6, active ? 0x1a3a2f : 0x222a2e);
    g.fillStyle(active ? SIGNAL.teal : 0x445055, active ? 0.4 + 0.2 * Math.sin(now * 4) : 1);
    g.fillRect(x - 22, floor - 88, 44, 88);
    return;
  }
  const x = b.minX + 30;
  g.fillStyle(SIGNAL.teal, 0.12 + 0.06 * Math.sin(now * 3));
  g.fillRect(b.minX, floor - 8, b.maxX - b.minX, 8);
  g.lineStyle(4, INK, 1);
  g.lineBetween(x, floor, x, floor - 110);
  const wave = Math.sin(now * 6) * 4;
  const flag = [
    { x, y: floor - 110 },
    { x: x + 46, y: floor - 100 + wave },
    { x, y: floor - 84 },
  ];
  poly(g, flag, SIGNAL.orange, 1, true, 2);
}

export function drawGate(g: G, gate: Gate, now: number): void {
  const b = gate.bounds();
  if (gate.open) {
    const t = Math.min(1, (now - gate.openedAt) / 0.6);
    if (t >= 1) return;
    g.fillStyle(SIGNAL.yellow, 1 - t);
    g.fillRect(b.minX, b.minY, b.maxX - b.minX, (b.maxY - b.minY) * (1 - t));
    return;
  }
  g.fillStyle(SIGNAL.yellow, 1);
  g.fillRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
  g.lineStyle(10, INK, 1);
  const w = b.maxX - b.minX;
  for (let y = b.minY - w; y < b.maxY; y += 28) g.lineBetween(b.minX, y + w, b.maxX, y);
  g.lineStyle(OUT, INK, 1);
  g.strokeRect(b.minX, b.minY, w, b.maxY - b.minY);
}

export function drawDoor(g: G, d: Door, near: boolean): void {
  const b = d.bounds();
  const x = b.minX;
  const y = b.minY;
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  rrect(g, x - 6, y - 6, w + 12, h + 6, 6, 0x2e3b42);
  g.fillStyle(d.locked ? 0x3a3f48 : near ? 0x3d6b5c : 0x2f5146, 1);
  g.fillRect(x, y, w, h);
  g.lineStyle(2, INK, 1);
  g.strokeRect(x, y, w, h);
  if (d.locked) {
    rrect(g, x + w / 2 - 9, y + h / 2 - 4, 18, 14, 3, 0x8a8f99);
    g.lineStyle(3, INK, 1);
    g.beginPath();
    g.arc(x + w / 2, y + h / 2 - 4, 6, Math.PI, 0, false);
    g.strokePath();
  } else {
    g.fillStyle(SIGNAL.yellow, 1);
    g.fillCircle(x + w - 10, y + h / 2, 3.5);
  }
}

export function drawBench(g: G, e: Entity, near: boolean, now: number): void {
  const p = e.pos;
  const x = p.x - 60;
  const top = p.y - 14;
  g.lineStyle(6, INK, 1);
  g.lineBetween(x + 10, top, x + 10, p.y + 28);
  g.lineBetween(x + 110, top, x + 110, p.y + 28);
  rrect(g, x, top - 4, 120, 14, 3, 0xc58b5a);
  // monitor with a tiny graph on it
  rrect(g, x + 54, top - 50, 56, 40, 5, 0x2c4636);
  g.lineStyle(2, SIGNAL.orange, 1);
  g.lineBetween(x + 64, top - 38, x + 80, top - 24);
  g.lineStyle(2, SIGNAL.cobalt, 1);
  g.lineBetween(x + 80, top - 24, x + 98, top - 34);
  g.fillStyle(SIGNAL.orange, 1);
  g.fillRect(x + 60, top - 42, 8, 7);
  g.fillStyle(SIGNAL.cobalt, 1);
  g.fillRect(x + 76, top - 28, 8, 7);
  g.fillStyle(SIGNAL.teal, 1);
  g.fillRect(x + 94, top - 38, 8, 7);
  // vise
  rrect(g, x + 8, top - 22, 30, 18, 3, 0x6b7a86);
  if (near) {
    g.lineStyle(3, SIGNAL.yellow, 0.5 + 0.4 * Math.sin(now * 6));
    g.strokeRoundedRect(x - 8, top - 60, 136, 96, 10);
  }
}

export function drawProjectile(g: G, p: Projectile): void {
  const pos = p.pos;
  const friendly = p.team === 'player';
  const core = p.style === 'slug' ? (friendly ? SIGNAL.yellow : SIGNAL.orange) : friendly ? SIGNAL.yellow : SIGNAL.red;
  for (let i = 0; i < p.trail.length; i++) {
    const t = p.trail[i];
    const a = (i + 1) / (p.trail.length + 1);
    g.fillStyle(core, a * 0.45);
    g.fillCircle(t.x, t.y, p.radius * (0.4 + a * 0.5));
  }
  if (p.style === 'slug') {
    g.fillStyle(INK, 1);
    g.fillCircle(pos.x, pos.y, p.radius + 2);
    g.fillStyle(0x3a2a2a, 1);
    g.fillCircle(pos.x, pos.y, p.radius);
    g.lineStyle(3, core, 1);
    g.strokeCircle(pos.x, pos.y, p.radius - 2);
    g.fillStyle(core, 1);
    g.fillCircle(pos.x - p.radius * 0.3, pos.y - p.radius * 0.3, p.radius * 0.35);
  } else {
    g.fillStyle(INK, 1);
    g.fillCircle(pos.x, pos.y, p.radius + 2);
    g.fillStyle(core, 1);
    g.fillCircle(pos.x, pos.y, p.radius);
    g.fillStyle(WHITE, 1);
    g.fillCircle(pos.x, pos.y, p.radius * 0.45);
  }
  if (p.reflections > 0) {
    g.lineStyle(2, WHITE, 0.9);
    g.strokeCircle(pos.x, pos.y, p.radius + 5);
  }
}
