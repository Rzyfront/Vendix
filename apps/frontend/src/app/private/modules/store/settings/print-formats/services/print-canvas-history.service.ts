import { Injectable, signal } from '@angular/core';
import { PrintFormatDefinition } from '../../../../../../core/models/print-formats.model';

/**
 * [print-editor-dsk P4.5] — Command-pattern undo/redo stack for the
 * WYSIWYG canvas. Snapshots the full `PrintFormatDefinition` on every
 * `push` call; capped at MAX_HISTORY entries; consecutive pushes within
 * COALESCE_MS collapse into one entry so a single drag-resize gesture
 * (which fires many intermediate snapshots) shows up as ONE undo step.
 *
 * The service is intentionally standalone (no providedIn) — the canvas
 * provides it per-instance so multiple editor mounts do not share state.
 */
const MAX_HISTORY = 50;
const COALESCE_MS = 250;

interface Snapshot {
  definition: PrintFormatDefinition;
  timestamp: number;
}

@Injectable()
export class PrintCanvasHistoryService {
  private readonly _past = signal<Snapshot[]>([]);
  private readonly _future = signal<Snapshot[]>([]);

  /** Read-only mirrors of the underlying stacks for template binding. */
  readonly past = this._past.asReadonly();
  readonly future = this._future.asReadonly();

  /** Convenience flags so templates don't have to call `.length`. */
  readonly canUndo = signal(false);
  readonly canRedo = signal(false);

  private lastSnapshotTime = 0;

  /**
   * Push a snapshot. Coalesces with the previous push if it happened
   * within COALESCE_MS — drag-resize gestures typically fire dozens of
   * snapshots per second, and we only want ONE undo step per gesture.
   *
   * Always clears the redo stack: a new mutation invalidates the
   * previously-undone timeline.
   */
  push(definition: PrintFormatDefinition): void {
    const now = Date.now();
    const past = [...this._past()];
    if (now - this.lastSnapshotTime < COALESCE_MS && past.length > 0) {
      past[past.length - 1] = { definition: deepClone(definition), timestamp: now };
    } else {
      past.push({ definition: deepClone(definition), timestamp: now });
      if (past.length > MAX_HISTORY) past.shift();
    }
    this._past.set(past);
    this._future.set([]);
    this.lastSnapshotTime = now;
    this.canUndo.set(true);
    this.canRedo.set(false);
  }

  /**
   * Restore the most recent snapshot. Returns the snapshot's definition
   * (deep-cloned — callers can mutate freely) or `null` if nothing to
   * undo. After undo, redo becomes available.
   */
  undo(): PrintFormatDefinition | null {
    const past = [...this._past()];
    if (past.length === 0) return null;
    const last = past.pop()!;
    const future = [
      ...this._future(),
      { definition: deepClone(last.definition), timestamp: Date.now() },
    ];
    this._past.set(past);
    this._future.set(future);
    this.canUndo.set(past.length > 0);
    this.canRedo.set(true);
    this.lastSnapshotTime = Date.now();
    return deepClone(last.definition);
  }

  /**
   * Re-apply the most recently undone snapshot. Returns its definition
   * (deep-cloned) or `null` if there is nothing to redo.
   */
  redo(): PrintFormatDefinition | null {
    const future = [...this._future()];
    if (future.length === 0) return null;
    const next = future.pop()!;
    const past = [...this._past(), next];
    this._past.set(past);
    this._future.set(future);
    this.canUndo.set(true);
    this.canRedo.set(future.length > 0);
    this.lastSnapshotTime = Date.now();
    return deepClone(next.definition);
  }

  /**
   * Reset both stacks — called when the editor switches to a different
   * format so the undo history of the previous format does not leak
   * into the new one.
   */
  reset(): void {
    this._past.set([]);
    this._future.set([]);
    this.lastSnapshotTime = 0;
    this.canUndo.set(false);
    this.canRedo.set(false);
  }
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}
