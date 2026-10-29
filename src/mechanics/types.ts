import type { SimEventKind } from '../sim/driver';
import type { ParamValue, PortType, VecValue } from './schema';
import type { ExecContext } from './runtime';

/** Runtime values. Entities travel as numeric ids (0 = nobody). */
export type Value = number | boolean | VecValue;

export type Category = 'event' | 'control' | 'condition' | 'data' | 'variable' | 'action';

export interface PortDef {
  id: string;
  label: string;
  type: PortType;
  /** Literal used when the port is unconnected. Entity ports accept 'self' | 'none'. */
  default?: ParamValue;
  min?: number;
  max?: number;
  step?: number;
}

export interface ParamOption {
  value: string;
  label: string;
}

export interface ParamDef {
  id: string;
  label: string;
  kind: 'key' | 'enum' | 'text' | 'number';
  options?: ParamOption[];
  default: ParamValue;
}

export interface EventSpec {
  kind: SimEventKind;
  /** Runs synchronously while a hit is open (interception). */
  sync?: boolean;
  match?: (params: Record<string, ParamValue>, payload: Record<string, unknown>, mechanicId: string) => boolean;
  /** Reads an event data output from the payload. */
  data?: (ctx: ExecContext, port: string) => Value;
}

export interface CompiledNode {
  id: string;
  type: string;
  def: PrimitiveDef;
  params: Record<string, ParamValue>;
  /** Position in the model's node list. Orders handlers of the same event. */
  order: number;
  execOut: Map<string, string>;
  dataIn: Map<string, { node: string; port: string }>;
}

export interface PrimitiveDef {
  type: string;
  label: string;
  category: Category;
  /** Campaign unlock tier: 0 from the start, 1 after Cross the Gap, 2 after Return to Sender. */
  tier: number;
  description: string;
  params?: ParamDef[];
  /** Exec input is always the port id 'in'. */
  execIn?: boolean;
  execOut?: { id: string; label: string }[];
  inputs?: PortDef[];
  outputs?: PortDef[];
  event?: EventSpec;
  /** Executes the node; returns the exec output to follow, or null to stop. */
  exec?: (ctx: ExecContext, node: CompiledNode) => string | null;
  /** Evaluates a pure data output. */
  evaluate?: (ctx: ExecContext, node: CompiledNode, port: string) => Value;
  /** Only meaningful while a hit is being intercepted. */
  needsOpenHit?: boolean;
  /** Flow outputs taken when a condition or gate said "no" (the debugger files them as conditions). */
  closedPorts?: string[];
  /** Short exchange note shown on the node in the Workshop. */
  cost?: string;
  /** Dynamic title, e.g. "On F Pressed". */
  title?: (params: Record<string, ParamValue>) => string;
}
