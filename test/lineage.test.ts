import { describe, expect, it } from 'vitest';
import { ancestorsOf, childrenOf, flattenLineage } from '../src/lib/lineage';
import type { Canvas } from '../src/lib/types';

const c = (id: string, parentId?: string): Canvas => ({
  id,
  name: id,
  ...(parentId ? { parentId } : {}),
  cases: [],
  placed: [],
});

/** `id@depth` for every node, in render order. */
const shape = (canvases: Canvas[], primaryId: string) =>
  flattenLineage(canvases, primaryId).map((n) => `${n.canvas.id}@${n.depth}`);

describe('lineage', () => {
  it('flattens a forest in pre-order with depth', () => {
    const canvases = [c('a'), c('b', 'a'), c('c', 'b'), c('d', 'a'), c('e')];
    expect(shape(canvases, 'a')).toEqual(['a@0', 'b@1', 'c@2', 'd@1', 'e@0']);
  });

  it('counts direct forks only', () => {
    const canvases = [c('a'), c('b', 'a'), c('c', 'b'), c('d', 'a')];
    const forks = Object.fromEntries(flattenLineage(canvases, 'a').map((n) => [n.canvas.id, n.forks]));
    expect(forks).toEqual({ a: 2, b: 1, c: 0, d: 0 });
  });

  it('sorts the primary first among its own siblings only', () => {
    const canvases = [c('a'), c('b', 'a'), c('c', 'a')];
    // 'a' keeps its place and nothing is reparented: only b and c trade order.
    expect(shape(canvases, 'c')).toEqual(['a@0', 'c@1', 'b@1']);
    expect(shape(canvases, 'b')).toEqual(['a@0', 'b@1', 'c@1']);
  });

  it('sorts the primary first among the roots, keeping its own subtree under it', () => {
    expect(shape([c('a'), c('b'), c('x', 'b')], 'b')).toEqual(['b@0', 'x@1', 'a@0']);
  });

  it('reads a dangling parentId as a root', () => {
    const canvases = [c('a'), c('orphan', 'ghost')];
    expect(shape(canvases, 'a')).toEqual(['a@0', 'orphan@0']);
    expect(childrenOf(canvases, undefined, 'a').map((x) => x.id)).toEqual(['a', 'orphan']);
  });

  it('reads a self-parent as a root, and never as its own child', () => {
    const canvases = [c('a', 'a')];
    expect(shape(canvases, 'a')).toEqual(['a@0']);
    expect(childrenOf(canvases, 'a', 'a')).toEqual([]);
  });

  it('keeps every canvas visible exactly once when parentId is cyclic', () => {
    const flat = flattenLineage([c('a', 'b'), c('b', 'a'), c('r')], 'r');
    expect(flat.map((n) => n.canvas.id).sort()).toEqual(['a', 'b', 'r']);
  });

  it('lists ancestors nearest first', () => {
    const canvases = [c('a'), c('b', 'a'), c('c', 'b')];
    expect(ancestorsOf(canvases, 'c').map((x) => x.id)).toEqual(['b', 'a']);
    expect(ancestorsOf(canvases, 'a')).toEqual([]);
  });

  it('stops walking ancestors on a cycle', () => {
    expect(ancestorsOf([c('a', 'b'), c('b', 'a')], 'a').map((x) => x.id)).toEqual(['b']);
    expect(ancestorsOf([c('a', 'a')], 'a')).toEqual([]);
  });

  it('ignores a dangling parent when listing ancestors', () => {
    expect(ancestorsOf([c('a', 'ghost')], 'a')).toEqual([]);
  });
});

// Regression tests for bugs found by the bug hunt. Each one failed before the corresponding fix.
describe('lineage robustness', () => {
  it('handles a fork chain far deeper than the call stack allows', () => {
    const chain = Array.from({ length: 20000 }, (_, i) => c(`n${i}`, i === 0 ? undefined : `n${i - 1}`));
    const flat = flattenLineage(chain, 'n0');
    expect(flat).toHaveLength(20000);
    expect(flat[0].depth).toBe(0);
    expect(flat.at(-1)!.depth).toBe(19999);
    expect(flat.at(-1)!.canvas.id).toBe('n19999');
  });

  it('gives a canvas hanging off a cycle the same depth whatever the array order', () => {
    // x is a legitimate child of a; a and b form a cycle. x must nest under a either way.
    const edges = [['x', 'a'], ['a', 'b'], ['b', 'a']] as const;
    const build = (order: readonly string[]) =>
      order.map((id) => c(id, edges.find(([from]) => from === id)![1]));
    const depthOf = (order: readonly string[]) =>
      Object.fromEntries(flattenLineage(build(order), 'a').map((n) => [n.canvas.id, n.depth]));
    expect(depthOf(['x', 'a', 'b'])).toEqual({ a: 0, b: 1, x: 1 });
    expect(depthOf(['a', 'b', 'x'])).toEqual({ a: 0, b: 1, x: 1 });
  });

  it('reports the same fork count that the tree actually renders', () => {
    const canvases = [c('a'), c('b', 'a'), c('d', 'a')];
    const node = flattenLineage(canvases, 'a').find((n) => n.canvas.id === 'a')!;
    expect(node.forks).toBe(childrenOf(canvases, 'a', 'a').length);
    // A self-parented canvas is never its own fork.
    const selfish = [c('s', 's'), c('kid', 's')];
    expect(flattenLineage(selfish, 's').find((n) => n.canvas.id === 's')!.forks).toBe(1);
    expect(childrenOf(selfish, 's', 's')).toHaveLength(1);
  });
});
