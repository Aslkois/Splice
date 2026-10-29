import Matter from 'matter-js';
import { DT } from '../config';
import type { Vec } from '../math';
import type { World } from '../World';
import { CAT, Entity } from './Entity';

export class Crate extends Entity {
  readonly kind = 'crate' as const;
  heavy: boolean;
  constructor(x: number, y: number, heavy = false, tag?: string) {
    super();
    this.heavy = heavy;
    this.damageable = true;
    this.material = heavy ? 'metal' : 'wood';
    this.maxHp = this.hp = heavy ? 400 : 70;
    this.tag = tag;
    this.w = this.h = heavy ? 50 : 44;
    this.body = Matter.Bodies.rectangle(x, y, this.w, this.h, {
      chamfer: { radius: 3 },
      friction: 0.22,
      frictionStatic: 0.3,
      frictionAir: 0.004,
      restitution: 0.05,
      collisionFilter: { category: CAT.PROP, mask: CAT.SOLID | CAT.PLAYER | CAT.ENEMY | CAT.PROP | CAT.GATE },
      label: 'crate',
    });
    Matter.Body.setMass(this.body, heavy ? 12 : 2);
  }
}

/** Practice target: a sturdy post with a breakable crystal head. */
export class Target extends Entity {
  readonly kind = 'target' as const;
  constructor(x: number, y: number, hp = 30, tag?: string) {
    super();
    this.damageable = true;
    this.material = 'glass';
    this.maxHp = this.hp = hp;
    this.tag = tag;
    this.w = 30;
    this.h = 30;
    this.body = Matter.Bodies.rectangle(x, y, this.w, this.h, {
      isStatic: true,
      chamfer: { radius: 8 },
      // Targets stand on posts you can walk past; shots, strikes and thrown crates still hit them.
      collisionFilter: { category: CAT.PROP, mask: CAT.ENEMY | CAT.PROP },
      label: 'target',
    });
  }
}

/** Stored energy lying in the world: a material source for the battery. */
export class Cell extends Entity {
  readonly kind = 'cell' as const;
  amount: number;
  constructor(x: number, y: number, amount: number) {
    super();
    this._pos = { x, y };
    this.amount = amount;
    this.w = 22;
    this.h = 28;
  }
}

export class Spikes extends Entity {
  readonly kind = 'spikes' as const;
  damage = 25;
  constructor(x: number, y: number, w: number, h = 18) {
    super();
    this.w = w;
    this.h = h;
    this.body = Matter.Bodies.rectangle(x + w / 2, y + h / 2, w, h, {
      isStatic: true,
      friction: 0.5,
      collisionFilter: { category: CAT.SOLID, mask: 0xffff },
      label: 'spikes',
    });
  }
}

/** Invisible-ish zone used by objectives. */
export class Goal extends Entity {
  readonly kind = 'goal' as const;
  reached = false;
  constructor(x: number, y: number, w: number, h: number, tag?: string) {
    super();
    this._pos = { x: x + w / 2, y: y + h / 2 };
    this.w = w;
    this.h = h;
    this.tag = tag;
  }
}

export class Door extends Entity {
  readonly kind = 'door' as const;
  target: string;
  label: string;
  requires?: string;
  locked = false;
  constructor(x: number, y: number, target: string, label: string, requires?: string) {
    super();
    this._pos = { x, y };
    this.w = 56;
    this.h = 84;
    this.target = target;
    this.label = label;
    this.requires = requires;
  }
}

export class Bench extends Entity {
  readonly kind = 'bench' as const;
  constructor(x: number, y: number) {
    super();
    this._pos = { x, y };
    this.w = 120;
    this.h = 56;
  }
}

export class Sign extends Entity {
  readonly kind = 'sign' as const;
  text: string;
  constructor(x: number, y: number, text: string, w = 220) {
    super();
    this._pos = { x, y };
    this.text = text;
    this.w = w;
    this.h = 40;
  }
}

/** Barrier that dissolves once every entity tagged `opensWhen` is gone. */
export class Gate extends Entity {
  readonly kind = 'gate' as const;
  opensWhen: string;
  open = false;
  openedAt = -1;
  constructor(x: number, y: number, w: number, h: number, opensWhen: string) {
    super();
    this.w = w;
    this.h = h;
    this.opensWhen = opensWhen;
    this.body = Matter.Bodies.rectangle(x + w / 2, y + h / 2, w, h, {
      isStatic: true,
      collisionFilter: { category: CAT.GATE, mask: 0xffff },
      label: 'gate',
    });
  }
}

/** A platform that shuttles between two points and carries whatever stands on it. */
export class Mover extends Entity {
  readonly kind = 'mover' as const;
  from: Vec;
  to: Vec;
  speed: number;
  private t = 0;
  private dir = 1;
  delta: Vec = { x: 0, y: 0 };

  constructor(x: number, y: number, w: number, h: number, to: Vec, speed: number) {
    super();
    this.w = w;
    this.h = h;
    this.from = { x: x + w / 2, y: y + h / 2 };
    this.to = { x: to.x + w / 2, y: to.y + h / 2 };
    this.speed = speed;
    this.body = Matter.Bodies.rectangle(this.from.x, this.from.y, w, h, {
      isStatic: true,
      friction: 0.8,
      collisionFilter: { category: CAT.SOLID, mask: 0xffff },
      label: 'mover',
    });
  }

  override update(world: World): void {
    if (!this.body) return;
    const len = Math.hypot(this.to.x - this.from.x, this.to.y - this.from.y) || 1;
    this.t += (this.dir * this.speed * DT) / len;
    if (this.t >= 1 || this.t <= 0) {
      this.t = Math.max(0, Math.min(1, this.t));
      this.dir = -this.dir;
    }
    // Ease at the ends so riders aren't jolted.
    const e = 0.5 - 0.5 * Math.cos(this.t * Math.PI);
    const next = { x: this.from.x + (this.to.x - this.from.x) * e, y: this.from.y + (this.to.y - this.from.y) * e };
    const cur = this.body.position;
    this.delta = { x: next.x - cur.x, y: next.y - cur.y };
    // Carry riders: anything resting on the top surface moves with the platform.
    const b = this.body.bounds;
    const strip = { min: { x: b.min.x + 2, y: b.min.y - 6 }, max: { x: b.max.x - 2, y: b.min.y + 2 } };
    for (const body of Matter.Query.region(world.allBodies(), strip)) {
      if (body === this.body || body.isStatic) continue;
      Matter.Body.translate(body, this.delta);
    }
    Matter.Body.setPosition(this.body, next);
  }
}
