import { TestBed } from '@angular/core/testing';

import { PrintCanvasHistoryService } from '../print-canvas-history.service';
import { PrintFormatDefinition } from '../../../../../../../core/models/print-formats.model';

/**
 * [print-editor-dsk P4.5] — Contract tests for the canvas undo/redo
 * service. Locks the 5 behaviors the parent composer relies on:
 *
 *  1. push enables undo, disables redo
 *  2. multi-push then undo restores the older snapshot + enables redo
 *  3. undo on empty stack is a no-op (returns null)
 *  4. consecutive pushes within 250ms coalesce into one entry
 *  5. stack is capped at 50 entries (oldest are dropped)
 */
describe('PrintCanvasHistoryService [print-editor-dsk P4.5]', () => {
  let service: PrintCanvasHistoryService;

  const baseDef = (label: string): PrintFormatDefinition => ({
    paper: { format: 'thermal_80', width_mm: 80, is_roll: true, copies: 1 },
    sections: [
      { id: 's1', type: 'header', title: label, enabled: true, order: 0 },
    ],
  });

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PrintCanvasHistoryService);
  });

  it('push enables undo and disables redo', () => {
    expect(service.canUndo()).toBe(false);
    expect(service.canRedo()).toBe(false);

    service.push(baseDef('v1'));

    expect(service.canUndo()).toBe(true);
    expect(service.canRedo()).toBe(false);
  });

  it('push/push/undo restores the older snapshot and enables redo', () => {
    service.push(baseDef('v1'));
    service.push(baseDef('v2'));

    const restored = service.undo();

    expect(restored).not.toBeNull();
    expect(restored!.sections[0].title).toBe('v1');
    expect(service.canRedo()).toBe(true);
    expect(service.canUndo()).toBe(false);
  });

  it('undo with empty past returns null and leaves flags false', () => {
    const result = service.undo();

    expect(result).toBeNull();
    expect(service.canUndo()).toBe(false);
    expect(service.canRedo()).toBe(false);
  });

  it('two pushes within 250ms coalesce into a single history entry', () => {
    // Spy on Date.now so the second push is guaranteed to fall inside
    // the 250ms coalesce window regardless of test runner speed.
    const realNow = Date.now;
    let mockTime = 1_000_000;
    Date.now = () => mockTime;

    try {
      service.push(baseDef('drag-1'));
      mockTime += 100; // 100ms later — still inside 250ms window
      service.push(baseDef('drag-2'));

      // One drag gesture should be one undo step.
      const restored = service.undo();
      expect(restored).not.toBeNull();
      // The coalesced snapshot is the most recent push (drag-2).
      expect(restored!.sections[0].title).toBe('drag-2');

      // No further undo — past stack is now empty.
      expect(service.undo()).toBeNull();
    } finally {
      Date.now = realNow;
    }
  });

  it('push more than 50 times caps the stack at 50 entries', () => {
    const realNow = Date.now;
    let mockTime = 1_000_000;
    Date.now = () => mockTime;

    try {
      for (let i = 0; i < 60; i++) {
        service.push(baseDef(`v${i}`));
        // Step the clock by 1000ms so each push falls outside the
        // 250ms coalesce window — every push becomes its own entry.
        mockTime += 1000;
      }

      // Stack length is capped at 50.
      expect(service.past().length).toBe(50);

      // 50 undos land back at v10 — entries v0..v9 were dropped.
      let lastTitle = '';
      for (let i = 0; i < 50; i++) {
        const r = service.undo();
        expect(r).not.toBeNull();
        lastTitle = r!.sections[0].title;
      }
      expect(lastTitle).toBe('v10');
      // 51st undo: stack is now empty.
      expect(service.undo()).toBeNull();
    } finally {
      Date.now = realNow;
    }
  });
});
