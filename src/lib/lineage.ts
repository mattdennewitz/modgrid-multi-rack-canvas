import type { Canvas } from './types';

export interface LineageNode {
  canvas: Canvas;
  depth: number;
  /** Direct forks only, not the whole subtree. */
  forks: number;
}

interface Forest {
  /** Canvases with no usable parent, in array order. */
  roots: Canvas[];
  /** Parent id to its direct children, in array order. */
  kids: Map<string, Canvas[]>;
  byId: Map<string, Canvas>;
}

/**
 * Splits the forest into roots and a parent-to-children index in one pass, so the root rule lives in exactly one
 * place. A canvas is a root when it has no parent, when its parent is gone, or when it parents itself — keeping the
 * last two here means a hand-edited save shows up as a flat list rather than vanishing from the tree.
 */
function index(canvases: Canvas[]): Forest {
  const byId = new Map(canvases.map((c) => [c.id, c]));
  const roots: Canvas[] = [];
  const kids = new Map<string, Canvas[]>();
  for (const c of canvases) {
    if (c.parentId === undefined || c.parentId === c.id || !byId.has(c.parentId)) {
      roots.push(c);
      continue;
    }
    const siblings = kids.get(c.parentId);
    if (siblings) siblings.push(c);
    else kids.set(c.parentId, [c]);
  }
  return { roots, kids, byId };
}

/** Moves the primary to the front of one sibling group. Hoisting a single group is the whole of "sorts first". */
function hoist(siblings: Canvas[], primaryId: string): Canvas[] {
  const i = siblings.findIndex((c) => c.id === primaryId);
  return i <= 0 ? siblings : [siblings[i], ...siblings.slice(0, i), ...siblings.slice(i + 1)];
}

/** True when walking up from `c` arrives back at `c`: it sits on a `parentId` cycle. */
function onCycle(forest: Forest, c: Canvas): boolean {
  const seen = new Set<string>([c.id]);
  let at = c.parentId;
  while (at !== undefined) {
    if (at === c.id) return true;
    if (seen.has(at)) return false; // a cycle further up, which `c` is only downstream of
    seen.add(at);
    at = forest.byId.get(at)?.parentId;
  }
  return false;
}

/** Direct forks of `id`, or the roots when `id` is undefined. The primary comes first, then `canvases` order. */
export function childrenOf(canvases: Canvas[], id: string | undefined, primaryId: string): Canvas[] {
  const forest = index(canvases);
  return hoist(id === undefined ? forest.roots : (forest.kids.get(id) ?? []), primaryId);
}

/**
 * The forest in pre-order with depth, for rendering as an indented list. Every canvas appears exactly once, so a
 * cyclic `parentId` can neither hide a canvas nor hang the render, and the walk is iterative so a long fork chain
 * cannot overflow the call stack.
 */
export function flattenLineage(canvases: Canvas[], primaryId: string): LineageNode[] {
  const forest = index(canvases);
  const out: LineageNode[] = [];
  const seen = new Set<string>();

  const walk = (from: Canvas) => {
    const stack: { canvas: Canvas; depth: number }[] = [{ canvas: from, depth: 0 }];
    while (stack.length) {
      const { canvas, depth } = stack.pop()!;
      if (seen.has(canvas.id)) continue;
      seen.add(canvas.id);
      out.push({ canvas, depth, forks: forest.kids.get(canvas.id)?.length ?? 0 });
      const siblings = hoist(forest.kids.get(canvas.id) ?? [], primaryId);
      // Pushed in reverse, so the first child is popped first and the order stays pre-order.
      for (let i = siblings.length - 1; i >= 0; i--) stack.push({ canvas: siblings[i], depth: depth + 1 });
    }
  };

  for (const root of hoist(forest.roots, primaryId)) walk(root);
  // A cycle has no root, so nothing above reaches it. Seed from the cycle's own members, so a canvas that merely
  // hangs off a cycle is reached as their child and keeps a truthful depth whatever order the array happens to be in.
  for (const c of canvases) if (!seen.has(c.id) && onCycle(forest, c)) walk(c);
  for (const c of canvases) if (!seen.has(c.id)) walk(c);
  return out;
}

/** Ancestors nearest first. Stops on a cycle or a missing parent, so corrupt data can't loop forever. */
export function ancestorsOf(canvases: Canvas[], id: string): Canvas[] {
  const byId = new Map(canvases.map((c) => [c.id, c]));
  const out: Canvas[] = [];
  const seen = new Set<string>([id]);
  let current = byId.get(id);
  while (current?.parentId !== undefined) {
    const parent = byId.get(current.parentId);
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id);
    out.push(parent);
    current = parent;
  }
  return out;
}
