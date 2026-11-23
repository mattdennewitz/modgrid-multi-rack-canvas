import { useRef, useState } from 'react';
import { GitFork, MoreHorizontal, Pencil, Star, Trash2 } from 'lucide-react';
import { childrenOf, flattenLineage } from '../lib/lineage';
import type { Action } from '../lib/store';
import type { AppState } from '../lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ConfirmDialog } from './ConfirmDialog';

interface Props {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  /** Forking belongs to App, which also raises the toast. */
  onFork: (id: string) => void;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The lineage forest as an indented list: click a row to switch to it, fork it with one click, and promote, rename or
 * delete it from the row menu. Rendered flat with a depth-based indent, so a cyclic `parentId` in a hand-edited save
 * still shows every canvas instead of hanging a recursive render.
 */
export function CanvasTree({ state, dispatch, onFork }: Props) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Escape has to beat the blur that follows unmounting a focused input, or cancelling would still commit.
  const renameCancelled = useRef(false);

  const nodes = flattenLineage(state.canvases, state.primaryId);
  const isLast = state.canvases.length < 2;
  const deleting = state.canvases.find((c) => c.id === deletingId) ?? null;
  // Derived through `childrenOf`, so this can never disagree with what the tree itself renders.
  const deletingForks = deleting ? childrenOf(state.canvases, deleting.id, state.primaryId) : [];
  const deletingParent = deleting?.parentId ? state.canvases.find((c) => c.id === deleting.parentId) : null;

  // Cleared when a rename opens, never on commit: a flag left standing would silently swallow the next rename.
  const startRename = (id: string) => {
    renameCancelled.current = false;
    setRenamingId(id);
  };

  const commitRename = (id: string, name: string) => {
    if (renameCancelled.current) return;
    dispatch({ type: 'renameCanvas', id, name });
    setRenamingId(null);
  };

  const cancelRename = () => {
    renameCancelled.current = true;
    setRenamingId(null);
  };

  /** What goes, where the forks land, and what survives — the three things the confirm has to disclose. */
  const deleteDescription = () => {
    if (!deleting) return '';
    const one = deletingForks.length === 1;
    const fate = deletingParent
      ? `${one ? 'moves' : 'move'} up to “${deletingParent.name}”`
      : one
        ? 'becomes a top-level canvas'
        : 'become top-level canvases';
    return (
      `“${deleting.name}” and its ${plural(deleting.cases.length, 'case')} are deleted.` +
      (deletingForks.length > 0 ? ` Its ${plural(deletingForks.length, 'fork')} ${fate}.` : '') +
      ' Your module inventory is unaffected. You can undo.'
    );
  };

  return (
    <div role="tree" className="-mx-1 flex flex-col gap-0.5">
      {nodes.map(({ canvas, depth, forks }) => {
        const isActive = canvas.id === state.activeId;
        const isPrimary = canvas.id === state.primaryId;
        return (
          <div
            key={canvas.id}
            role="treeitem"
            aria-level={depth + 1}
            aria-selected={isActive}
            aria-current={isActive || undefined}
            className={`flex items-center gap-0.5 rounded-md pr-1 transition-colors ${
              isActive ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
            }`}
            style={{ paddingLeft: 4 + depth * 14 }}
          >
            {renamingId === canvas.id ? (
              <Input
                autoFocus
                defaultValue={canvas.name}
                className="my-1 h-7 flex-1 text-xs"
                onBlur={(e) => commitRename(canvas.id, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename(canvas.id, e.currentTarget.value);
                  if (e.key === 'Escape') cancelRename();
                }}
              />
            ) : (
              <>
                <button
                  type="button"
                  className="flex min-w-0 flex-1 flex-col py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  onClick={() => dispatch({ type: 'setActiveCanvas', id: canvas.id })}
                >
                  <span className="flex min-w-0 items-center gap-1 text-xs font-medium">
                    {isPrimary && <Star className="size-3 shrink-0 fill-current text-amber-400" aria-label="Primary" />}
                    <span className="truncate">{canvas.name}</span>
                  </span>
                  <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    {plural(canvas.cases.length, 'case')} · {plural(canvas.placed.length, 'module')}
                    {forks > 0 && (
                      <>
                        <GitFork className="ml-0.5 size-3" />
                        {forks}
                      </>
                    )}
                  </span>
                </button>
                <Button size="icon-xs" variant="ghost" title="Fork this canvas" onClick={() => onFork(canvas.id)}>
                  <GitFork />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="icon-xs" variant="ghost" title={`More for “${canvas.name}”`}>
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {!isPrimary && (
                      <DropdownMenuItem onClick={() => dispatch({ type: 'setPrimaryCanvas', id: canvas.id })}>
                        <Star />
                        Make primary
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onClick={() => startRename(canvas.id)}>
                      <Pencil />
                      Rename
                    </DropdownMenuItem>
                    {!isLast && (
                      <DropdownMenuItem variant="destructive" onClick={() => setDeletingId(canvas.id)}>
                        <Trash2 />
                        Delete
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </div>
        );
      })}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeletingId(null)}
        title={`Delete “${deleting?.name ?? ''}”?`}
        description={deleteDescription()}
        confirmLabel="Delete"
        onConfirm={() => deleting && dispatch({ type: 'deleteCanvas', id: deleting.id })}
      />
    </div>
  );
}
