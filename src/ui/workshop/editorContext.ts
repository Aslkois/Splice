import { createContext, useContext } from 'react';
import type { NodeTrace } from '../../mechanics/runtime';
import type { GraphNode, MechanicGraph, ParamValue } from '../../mechanics/schema';
import { getPrimitive } from '../../mechanics/registry';
import type { Issue, ValidateOptions } from '../../mechanics/validate';

export interface EditorApi {
  graph: MechanicGraph;
  nodeById: (id: string) => GraphNode | undefined;
  /** "nodeId:portId" for every connected input port. */
  connectedInputs: Set<string>;
  issuesByNode: Map<string, Issue[]>;
  trace: Map<string, NodeTrace> | undefined;
  setParam: (nodeId: string, key: string, value: ParamValue) => void;
  isLocked: (type: string) => boolean;
}

export const EditorContext = createContext<EditorApi | null>(null);

export function useEditor(): EditorApi {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error('EditorContext missing');
  return ctx;
}

export const TIER_SOURCE: Record<number, string> = {
  1: 'Cross the Gap',
  2: 'Return to Sender',
  3: 'Survive the Impossible',
};

/** Is a part unavailable under these rules (lab list, or campaign tier)? */
export function partLocked(type: string, rules: ValidateOptions): boolean {
  if (rules.allowedTypes) return !rules.allowedTypes.includes(type);
  const def = getPrimitive(type);
  return !!def && rules.maxTier != null && def.tier > rules.maxTier;
}
