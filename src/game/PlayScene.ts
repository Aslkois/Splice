import Phaser from 'phaser';
import { synth } from '../audio/Synth';
import { Cannon, Turret, Walker } from '../sim/entities/enemies';
import { Projectile } from '../sim/entities/Projectile';
import { Cell, Crate, Door, Gate, Goal, Mover, Sign, Spikes, Target } from '../sim/entities/props';
import type { FxEvent } from '../sim/fx';
import type { Vec } from '../sim/math';
import { presentation, runner } from './bridge';
import {
  drawBench,
  drawCannon,
  drawCell,
  drawCrate,
  drawDoor,
  drawGate,
  drawGoal,
  drawMover,
  drawPlayer,
  drawProjectile,
  drawSpikes,
  drawTarget,
  drawTurret,
  drawWalker,
  newPlayerView,
  paintBackdrop,
  paintSolids,
  updatePlayerView,
  type PlayerView,
} from './draw';
import { hexToCss, INK, SIGNAL, THEMES, WHITE } from './palette';
import { Particles } from './Particles';
import { telemetry, type HudSnapshot } from './telemetry';

const FONT = '"Bricolage Grotesque", system-ui, sans-serif';

export class PlayScene extends Phaser.Scene {
  private builtVersion = -1;
  private sky!: Phaser.GameObjects.Graphics;
  private layers!: { far: Phaser.GameObjects.Graphics; mid: Phaser.GameObjects.Graphics; near: Phaser.GameObjects.Graphics };
  private solids!: Phaser.GameObjects.Graphics;
  private gfx!: Phaser.GameObjects.Graphics;
  private fxGfx!: Phaser.GameObjects.Graphics;
  private flash!: Phaser.GameObjects.Graphics;
  private texts: Phaser.GameObjects.Text[] = [];
  private prompt!: Phaser.GameObjects.Text;
  private particles = new Particles();
  private pview: PlayerView = newPlayerView();
  private follow = { x: 0, y: 0 };
  private zoomPunch = 0;
  private flashAlpha = 0;
  private frame = 0;
  private telegraphs = new Set<number>();

  constructor() {
    super('play');
  }

  create(): void {
    this.sky = this.add.graphics().setScrollFactor(0).setDepth(-100);
    this.layers = {
      far: this.add.graphics().setScrollFactor(0.15, 0.3).setDepth(-90),
      mid: this.add.graphics().setScrollFactor(0.4, 0.55).setDepth(-80),
      near: this.add.graphics().setScrollFactor(0.7, 0.8).setDepth(-70),
    };
    this.solids = this.add.graphics().setDepth(0);
    this.gfx = this.add.graphics().setDepth(10);
    this.fxGfx = this.add.graphics().setDepth(20);
    this.flash = this.add.graphics().setScrollFactor(0).setDepth(100);
    this.prompt = this.add
      .text(0, 0, 'E', { fontFamily: FONT, fontSize: '15px', fontStyle: '700', color: hexToCss(INK), backgroundColor: hexToCss(SIGNAL.yellow), padding: { x: 7, y: 3 } })
      .setOrigin(0.5)
      .setDepth(30)
      .setVisible(false);
    this.cameras.main.startFollow(this.follow, false, 0.12, 0.12);
    this.scale.on('resize', () => this.fitCamera());
  }

  private fitCamera(): void {
    const cam = this.cameras.main;
    const h = this.scale.height;
    const w = this.scale.width;
    const z = Phaser.Math.Clamp(Math.min(h / 760, w / 1100), 0.55, 1.6);
    cam.setZoom(z * (1 + this.zoomPunch));
    const world = runner.world;
    if (world) cam.setBounds(-200, -400, world.level.width + 400, world.level.height + 500);
    this.paintSky();
  }

  private paintSky(): void {
    const world = runner.world;
    if (!world) return;
    const theme = THEMES[world.level.theme];
    this.sky.clear();
    this.sky.fillStyle(theme.sky, 1);
    this.sky.fillRect(0, 0, this.scale.width, this.scale.height);
  }

  private rebuild(): void {
    const world = runner.world;
    this.builtVersion = runner.version;
    const theme = THEMES[world.level.theme];
    for (const l of Object.values(this.layers)) l.clear();
    paintBackdrop(this.layers, world.level, theme);
    this.solids.clear();
    paintSolids(this.solids, world.level, theme);
    for (const t of this.texts) t.destroy();
    this.texts = [];
    for (const e of world.entities) {
      if (e instanceof Sign) {
        const t = this.add
          .text(e.pos.x, e.pos.y, e.text, {
            fontFamily: FONT,
            fontSize: '17px',
            fontStyle: '600',
            color: hexToCss(INK),
            backgroundColor: '#efe1b8',
            padding: { x: 12, y: 6 },
            wordWrap: { width: e.w },
            align: 'center',
          })
          .setOrigin(0.5)
          .setAngle(((e.id * 37) % 5) - 2)
          .setDepth(5);
        this.texts.push(t);
      } else if (e instanceof Door) {
        const t = this.add
          .text(e.pos.x, e.pos.y - e.h / 2 - 22, e.label, {
            fontFamily: FONT,
            fontSize: '15px',
            fontStyle: '700',
            color: hexToCss(WHITE),
            backgroundColor: hexToCss(INK),
            padding: { x: 8, y: 4 },
          })
          .setOrigin(0.5)
          .setDepth(5);
        this.texts.push(t);
      }
    }
    this.particles.clear();
    this.pview = newPlayerView();
    const p = world.player!;
    this.follow.x = p.pos.x;
    this.follow.y = p.pos.y;
    this.cameras.main.centerOn(p.pos.x, p.pos.y);
    for (const id of this.telegraphs) synth.stopTelegraph(id);
    this.telegraphs.clear();
    this.fitCamera();
    this.cameras.main.fadeIn(280, 21, 22, 28);
  }

  override update(_time: number, delta: number): void {
    if (!runner.world) return;
    if (runner.version !== this.builtVersion) this.rebuild();
    const cam = this.cameras.main;
    const ptr = this.input.activePointer;
    const wp = cam.getWorldPoint(ptr.x, ptr.y);
    runner.input.aim = { x: wp.x, y: wp.y };
    runner.advance(delta);
    const world = runner.world;
    const dt = Math.min(delta / 1000, 0.05);
    const now = world.time;

    for (const f of runner.drainFx()) this.route(f);
    this.particles.update(runner.paused ? 0 : dt);
    const p = world.player!;
    updatePlayerView(this.pview, p, runner.paused || runner.hitstop > 0 ? 0 : dt);

    // camera: lead in the facing direction, settle on the ground
    if (p.alive) {
      const o = runner.lerpOffset(p.id, p.pos);
      this.follow.x = p.pos.x + o.x + p.facing * 70 + p.vel.x * 0.12;
      this.follow.y = p.pos.y + o.y - 90;
    }
    if (this.zoomPunch > 0.0005) {
      this.zoomPunch *= Math.exp(-dt * 9);
      this.fitCamera();
    }

    // stop sounds of telegraphing enemies that died
    for (const id of this.telegraphs) {
      const e = world.get(id);
      if (!e || !e.alive || (e instanceof Cannon && e.phase !== 'charge')) {
        synth.stopTelegraph(id);
        this.telegraphs.delete(id);
      }
    }

    const g = this.gfx;
    g.clear();
    const near = world.nearInteractable;
    for (const e of world.entities) {
      if (!e.alive && !(e instanceof Gate)) continue;
      if (e instanceof Spikes) drawSpikes(g, e);
      else if (e instanceof Goal) {
        const obj = world.level.objective;
        const active = obj?.kind === 'destroyThenReach' ? world.objective.destroyedTags : true;
        drawGoal(g, e, now, active);
      } else if (e instanceof Door) drawDoor(g, e, near === e);
      else if (e.kind === 'bench') drawBench(g, e, near === e, now);
      else if (e instanceof Gate) drawGate(g, e, now);
    }
    // Moving things are drawn between their last two simulated positions (smooth on any refresh rate).
    const lerped = (e: { id: number; pos: Vec }, draw: () => void) => {
      const o = runner.lerpOffset(e.id, e.pos);
      if (o.x === 0 && o.y === 0) return draw();
      g.save();
      g.translateCanvas(o.x, o.y);
      draw();
      g.restore();
    };
    for (const e of world.entities) {
      if (!e.alive) continue;
      if (e instanceof Crate) lerped(e, () => drawCrate(g, e, now));
      else if (e instanceof Mover) lerped(e, () => drawMover(g, e, now));
      else if (e instanceof Target) drawTarget(g, e, now);
      else if (e instanceof Cell) drawCell(g, e, now);
      else if (e instanceof Turret) drawTurret(g, e, now);
      else if (e instanceof Walker) lerped(e, () => drawWalker(g, e, now));
      else if (e instanceof Cannon) drawCannon(g, e, now, e.chargeProgress > 0 ? this.sightEnd(e) : null);
    }
    lerped(p, () => drawPlayer(g, p, this.pview, now));
    for (const e of world.entities) if (e.alive && e instanceof Projectile) lerped(e, () => drawProjectile(g, e));

    this.fxGfx.clear();
    this.particles.draw(this.fxGfx);

    if (near && p.alive) {
      this.prompt.setVisible(true).setPosition(near.pos.x, near.pos.y - near.h / 2 - (near instanceof Door ? 52 : 74));
    } else this.prompt.setVisible(false);

    this.flash.clear();
    if (this.flashAlpha > 0.01) {
      this.flash.fillStyle(WHITE, this.flashAlpha);
      this.flash.fillRect(0, 0, this.scale.width, this.scale.height);
      this.flashAlpha *= Math.exp(-dt * 22);
    }

    if (++this.frame % 4 === 0) this.publish();
  }

  private sightEnd(c: Cannon): Vec {
    const m = c.muzzle();
    const dir = { x: Math.cos(c.aim), y: Math.sin(c.aim) };
    const world = runner.world;
    for (let d = 30; d < 1500; d += 16) {
      const q = { x: m.x + dir.x * d, y: m.y + dir.y * d };
      if (world.solidAt(q, c.id)) return q;
    }
    return { x: m.x + dir.x * 1500, y: m.y + dir.y * 1500 };
  }

  private shake(intensity: number, duration: number): void {
    if (!presentation.shake) return;
    this.cameras.main.shake(duration * 1000, Math.min(0.02, intensity * 0.0012));
  }

  /** Every gameplay event is told through sound, particles and camera — never through banners. */
  private route(f: FxEvent): void {
    const P = this.particles;
    switch (f.type) {
      case 'jump':
        synth.jump();
        P.burst(f.pos.x, f.pos.y + 22, { count: 6, color: 0xd9d4c7, speed: [40, 120], life: [0.2, 0.35], size: [3, 5], kind: 'dot', angle: Math.PI / 2, spread: 1.2 });
        this.pview.squash = -0.6;
        break;
      case 'land': {
        const k = Math.min(1, f.speed / 1100);
        synth.land(f.speed);
        P.burst(f.pos.x, f.pos.y, { count: 4 + k * 10, color: 0xd9d4c7, speed: [60, 160 + k * 200], life: [0.2, 0.4], size: [3, 6], kind: 'dot', angle: -Math.PI / 2, spread: 1.4, grav: 300 });
        this.pview.squash = 0.4 + k * 0.6;
        if (k > 0.6) this.shake(3 * k, 0.12);
        break;
      }
      case 'dash':
        synth.dash();
        P.burst(f.pos.x - f.dir * 14, f.pos.y, { count: 10, color: SIGNAL.orange, speed: [80, 220], life: [0.15, 0.3], size: [2, 3], angle: f.dir > 0 ? Math.PI : 0, spread: 0.5 });
        break;
      case 'thrust':
        synth.thrust(f.amount);
        P.burst(f.pos.x - f.dir.x * 18, f.pos.y + 18 - f.dir.y * 10, {
          count: 3 + Math.min(10, f.amount),
          color: SIGNAL.yellow,
          speed: [80, 260],
          life: [0.12, 0.3],
          size: [2, 4],
          angle: Math.atan2(-f.dir.y, -f.dir.x),
          spread: 0.5,
        });
        break;
      case 'shot':
        synth.shot(f.mass, f.team);
        P.ring(f.pos.x, f.pos.y, 10 + Math.sqrt(f.mass) * 8, f.team === 'enemy' ? SIGNAL.red : SIGNAL.yellow, 0.15, 3);
        P.burst(f.pos.x, f.pos.y, { count: 5, color: WHITE, speed: [100, 260], life: [0.08, 0.16], size: [2, 3], angle: Math.atan2(f.dir.y, f.dir.x), spread: 0.4 });
        break;
      case 'impact': {
        synth.impact(f.energy, f.material);
        const col = f.material === 'wood' ? 0xc98a4b : f.material === 'glass' ? 0x7fe0ff : f.material === 'flesh' ? 0xff8a8a : 0xffe6a0;
        const n = Math.min(26, 4 + Math.sqrt(f.energy) * 1.6);
        P.burst(f.pos.x, f.pos.y, { count: n, color: col, speed: [80, 300], life: [0.12, 0.35], size: [2, 3], angle: Math.atan2(f.normal.y, f.normal.x), spread: 1.1 });
        if (f.energy > 40) this.shake(Math.min(8, Math.sqrt(f.energy) * 0.4), 0.15);
        break;
      }
      case 'hurt':
        synth.hurt(f.amount);
        P.burst(f.pos.x, f.pos.y, { count: Math.min(18, 4 + f.amount * 0.3), color: SIGNAL.red, speed: [60, 220], life: [0.2, 0.4], size: [4, 7], kind: 'shard', outline: true, grav: 500 });
        break;
      case 'guard':
        synth.guard(f.energy);
        this.pview.guardFlash = 1;
        P.burst(f.pos.x, f.pos.y, { count: 10, color: SIGNAL.teal, speed: [100, 300], life: [0.15, 0.3], size: [2, 3], angle: Math.atan2(-f.dir.y, -f.dir.x), spread: 1.0 });
        P.ring(f.pos.x, f.pos.y, 26, SIGNAL.teal, 0.2, 3);
        this.shake(2 + Math.min(6, Math.sqrt(f.energy) * 0.3), 0.1);
        break;
      case 'parry': {
        synth.parry(f.energy, f.amplify);
        this.pview.guardFlash = 1;
        const a = Math.atan2(f.dir.y, f.dir.x);
        const k = Math.min(1, Math.sqrt(f.energy) / 20);
        P.ring(f.pos.x, f.pos.y, 60 + k * 70, WHITE, 0.28, 5);
        P.ring(f.pos.x, f.pos.y, 36 + k * 40, SIGNAL.orange, 0.22, 4);
        P.burst(f.pos.x, f.pos.y, { count: 14 + k * 16, color: WHITE, speed: [300, 900], life: [0.14, 0.3], size: [2, 4], angle: a, spread: 0.55, drag: 5 });
        P.burst(f.pos.x, f.pos.y, { count: 8 + k * 10, color: SIGNAL.yellow, speed: [150, 500], life: [0.25, 0.5], size: [5, 9], kind: 'shard', outline: true, angle: a, spread: 1.1, grav: 400 });
        if (presentation.flashes) this.flashAlpha = 0.18 + k * 0.17;
        this.zoomPunch = 0.04 + k * 0.05;
        this.fitCamera();
        break;
      }
      case 'absorb':
        synth.absorb(f.energy);
        P.burst(f.pos.x, f.pos.y, { count: 12 + Math.min(20, f.energy * 0.2), color: SIGNAL.yellow, speed: [40, 160], life: [0.3, 0.6], size: [2, 4], kind: 'dot' });
        P.ring(f.pos.x, f.pos.y, 30, SIGNAL.yellow, 0.35, 3);
        break;
      case 'negate':
        synth.negate();
        P.ring(f.pos.x, f.pos.y, 44, WHITE, 0.4, 4);
        P.puff(f.pos.x, f.pos.y, WHITE, 26, 0.4, 0, 0);
        break;
      case 'guardBreak':
        synth.guardBreak();
        P.burst(f.pos.x, f.pos.y, { count: 14, color: 0x9aa7ae, speed: [100, 320], life: [0.3, 0.6], size: [5, 8], kind: 'shard', outline: true, grav: 700 });
        this.shake(5, 0.2);
        break;
      case 'break': {
        synth.breakage(f.size);
        const col = f.kind === 'crate' ? 0xc98a4b : f.kind === 'target' ? 0x7fe0ff : 0x3d4d75;
        P.burst(f.pos.x, f.pos.y, { count: 14 + f.size * 0.2, color: col, speed: [120, 420], life: [0.4, 0.9], size: [5, 10], kind: 'shard', outline: true, grav: 900, drag: 1.5 });
        P.puff(f.pos.x, f.pos.y, 0x777777, f.size * 0.6, 0.6);
        this.shake(Math.min(10, 3 + f.size * 0.06), 0.25);
        break;
      }
      case 'death':
        synth.death();
        P.burst(f.pos.x, f.pos.y, { count: 26, color: WHITE, speed: [120, 480], life: [0.4, 0.9], size: [5, 9], kind: 'shard', outline: true, grav: 900 });
        P.burst(f.pos.x, f.pos.y, { count: 10, color: SIGNAL.orange, speed: [80, 300], life: [0.4, 0.9], size: [5, 8], kind: 'shard', outline: true, grav: 900 });
        P.ring(f.pos.x, f.pos.y, 80, WHITE, 0.4, 4);
        break;
      case 'spawn':
        synth.spawn();
        P.ring(f.pos.x, f.pos.y, 50, SIGNAL.orange, 0.4, 4);
        break;
      case 'pickup':
        synth.pickup();
        P.ring(f.pos.x, f.pos.y, 34, SIGNAL.yellow, 0.3, 4);
        P.burst(f.pos.x, f.pos.y, { count: 12, color: SIGNAL.yellow, speed: [80, 260], life: [0.2, 0.45], size: [2, 3] });
        break;
      case 'spend':
        synth.spend(f.energy);
        if (f.energy > 0.5) P.burst(f.pos.x, f.pos.y - 10, { count: Math.min(12, 2 + Math.sqrt(f.energy)), color: SIGNAL.yellow, speed: [30, 120], life: [0.2, 0.4], size: [1.5, 2.5], kind: 'dot' });
        break;
      case 'fizzle':
        synth.fizzle();
        P.puff(f.pos.x, f.pos.y - 26, 0x8a8a8a, 10, 0.35, 0, -40);
        P.burst(f.pos.x, f.pos.y - 26, { count: 5, color: 0x8a8a8a, speed: [40, 120], life: [0.15, 0.3], size: [1.5, 2] });
        break;
      case 'telegraph':
        synth.telegraph(f.entityId, f.duration);
        if (f.duration >= 1) this.telegraphs.add(f.entityId);
        break;
      case 'chargeTick':
        synth.chargeTick(f.amount);
        break;
      case 'interrupt':
        synth.interrupt();
        P.burst(f.pos.x, f.pos.y, { count: 16, color: SIGNAL.yellow, speed: [120, 360], life: [0.2, 0.45], size: [3, 6], kind: 'shard', outline: true, grav: 600 });
        break;
      case 'shake':
        this.shake(f.intensity, f.duration);
        break;
      case 'gateOpen':
        synth.gateOpen();
        P.burst(f.pos.x, f.pos.y, { count: 30, color: SIGNAL.yellow, speed: [60, 260], life: [0.4, 0.9], size: [4, 8], kind: 'shard', outline: true, grav: 500 });
        this.shake(4, 0.5);
        break;
      case 'objective': {
        synth.objective();
        const p = runner.world.player;
        if (p) {
          for (const col of [SIGNAL.orange, SIGNAL.teal, SIGNAL.yellow, SIGNAL.cobalt])
            P.burst(p.pos.x, p.pos.y - 30, { count: 8, color: col, speed: [150, 380], life: [0.6, 1.1], size: [4, 7], kind: 'shard', outline: true, angle: -Math.PI / 2, spread: 0.9, grav: 700 });
        }
        break;
      }
      case 'cosmetic':
        synth.cosmetic(f.sound, f.pitch);
        P.ring(f.pos.x, f.pos.y, 24, SIGNAL.pink, 0.25, 2);
        break;
      case 'hitstop':
        break;
    }
  }

  private publish(): void {
    const w = runner.world;
    const p = w.player!;
    const host = runner.attach?.host;
    const mechanics = [...(runner.attach?.compiled ?? []), ...(runner.attach?.rejected ?? [])].map((m) => {
      const a = host?.activity.get(m.id);
      return { id: m.id, name: m.name, color: m.color, ok: m.ok, lastRun: a?.lastRun ?? -1, lastFail: a?.lastFail ?? -1, failReason: a?.lastFailReason };
    });
    const obj = w.level.objective;
    let prompt: string | null = null;
    const near = w.nearInteractable;
    if (near instanceof Door) prompt = near.locked ? `Locked until you finish the previous challenge` : `Enter: ${near.label}`;
    else if (near?.kind === 'bench') prompt = 'Open the workbench';
    const snap: HudSnapshot = {
      ready: true,
      time: w.time,
      levelId: w.level.id,
      levelName: w.level.name,
      mode: w.mode,
      law: w.lawEnabled,
      hp: Math.max(0, p.hp),
      maxHp: p.maxHp,
      energy: p.account.energy,
      capacity: p.account.capacity,
      stamina: p.account.stamina,
      staminaMax: p.account.staminaMax,
      guard: p.guard.active,
      dead: !p.alive,
      charges: [...p.account.charges.entries()].map(([name, c]) => ({ name, amount: c.amount, channeling: c.channeling })),
      receipt: w.exchange.log.slice(-7).map((t) => ({ ...t, age: w.time - t.time })),
      diagnostics: w.diagnostics.slice(-3).map((d) => ({ message: d.message, age: w.time - d.time })),
      mechanics,
      objective: obj?.text ?? null,
      objectiveDone: w.objective.done,
      prompt,
      certified: w.certified,
    };
    telemetry.publish(snap);
  }
}
