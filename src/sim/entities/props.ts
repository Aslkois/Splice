import Matter from 'matter-js';
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
