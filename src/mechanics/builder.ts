import type { World } from '../sim/World';
import { compileGraph, type CompiledMechanic } from './compile';
import { defaultParams, getPrimitive } from './registry';
import { MechanicHost } from './runtime';
import { emptyGraph, type MechanicGraph, type ParamValue } from './schema';
import type { ValidateOptions } from './validate';

/**
 * Programmatic graph assembly — exactly the structure the Workshop produces when a player drags
 * blocks and wires. Used by tests and tooling; there are no special "ability" shortcuts here.
 */
export class GraphBuilder {
  readonly graph: MechanicGraph;
  private n = 0;
  private e = 0;

  constructor(name = 'Test Mechanic') {
    this.graph = emptyGraph(name);
  }

  node(type: string, params: Record<string, ParamValue> = {}, pos?: { x: number; y: number }): string {
    const def = getPrimitive(type);
    if (!def) throw new Error(`unknown primitive ${type}`);
    const id = `n${++this.n}`;
    this.graph.nodes.push({ id, type, x: pos?.x ?? (this.n % 4) * 260, y: pos?.y ?? this.n * 120, params: { ...defaultParams(def), ...params } });
    return id;
  }

  /** Flow wire. */
  flow(from: string, fromPort: string, to: string): this {
    this.graph.edges.push({ id: `e${++this.e}`, from, fromPort, to, toPort: 'in' });
    return this;
  }

  /** Value wire. */
  wire(from: string, fromPort: string, to: string, toPort: string): this {
    this.graph.edges.push({ id: `e${++this.e}`, from, fromPort, to, toPort });
    return this;
  }

  build(): MechanicGraph {
    return JSON.parse(JSON.stringify(this.graph)) as MechanicGraph;
  }
}

export interface AttachResult {
  host: MechanicHost;
  compiled: CompiledMechanic[];
  rejected: CompiledMechanic[];
}

/** Compiles graphs (slot order) and installs the runtime on a world. Graphs with errors are not run. */
export function attachMechanics(world: World, graphs: MechanicGraph[], opts: ValidateOptions = {}): AttachResult {
  const all = graphs.map((g) => compileGraph(g, opts));
  const compiled = all.filter((c) => c.ok);
  const rejected = all.filter((c) => !c.ok);
  const host = new MechanicHost(world, compiled);
  world.mechanics = host;
  return { host, compiled, rejected };
}
