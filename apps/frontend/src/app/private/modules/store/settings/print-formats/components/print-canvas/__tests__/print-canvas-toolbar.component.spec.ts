import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PrintCanvasToolbarComponent } from '../print-canvas-toolbar.component';
import { PrintCanvasHistoryService } from '../../../services/print-canvas-history.service';
import { PrintFormatDefinition } from '../../../../../../../../core/models/print-formats.model';

/**
 * [print-editor-dsk P4.7] — Toolbar wiring contract:
 *
 *  1. Zoom +/- buttons update the bound `zoom` model within [60, 160].
 *  2. Snap toggle flips the `snap` model.
 *  3. History service undo/redo round-trip restores state.
 */
describe('PrintCanvasToolbarComponent + PrintCanvasHistoryService [print-editor-dsk P4.7]', () => {
  describe('PrintCanvasHistoryService — undo/redo round-trip', () => {
    let history: PrintCanvasHistoryService;

    const baseDef = (label: string): PrintFormatDefinition => ({
      paper: { format: 'thermal_80', width_mm: 80, is_roll: true, copies: 1 },
      sections: [
        { id: 's1', type: 'header', title: label, enabled: true, order: 0 },
      ],
    });

    beforeEach(() => {
      TestBed.configureTestingModule({});
      history = TestBed.inject(PrintCanvasHistoryService);
    });

    it('push, push, undo, redo restores the most recent snapshot', () => {
      history.push(baseDef('v1'));
      history.push(baseDef('v2'));

      const undone = history.undo();
      expect(undone).not.toBeNull();
      expect(undone!.sections[0].title).toBe('v1');
      expect(history.canRedo()).toBe(true);

      const redone = history.redo();
      expect(redone).not.toBeNull();
      expect(redone!.sections[0].title).toBe('v2');
      expect(history.canRedo()).toBe(false);
      expect(history.canUndo()).toBe(true);
    });
  });

  describe('PrintCanvasToolbarComponent', () => {
    let fixture: ComponentFixture<PrintCanvasToolbarComponent>;
    let component: PrintCanvasToolbarComponent;

    beforeEach(async () => {
      await TestBed.configureTestingModule({
        imports: [PrintCanvasToolbarComponent],
      }).compileComponents();

      fixture = TestBed.createComponent(PrintCanvasToolbarComponent);
      component = fixture.componentInstance;
      fixture.detectChanges();
    });

    it('zoom in button increments zoom by 10 (capped at 160)', () => {
      component.zoom.set(100);
      component.zoomIn();
      expect(component.zoom()).toBe(110);
      component.zoom.set(160);
      component.zoomIn();
      expect(component.zoom()).toBe(160);
    });

    it('zoom out button decrements zoom by 10 (floor at 60)', () => {
      component.zoom.set(100);
      component.zoomOut();
      expect(component.zoom()).toBe(90);
      component.zoom.set(60);
      component.zoomOut();
      expect(component.zoom()).toBe(60);
    });

    it('snap toggle flips the snap model', () => {
      expect(component.snap()).toBe(true);
      component.toggleSnap();
      expect(component.snap()).toBe(false);
      component.toggleSnap();
      expect(component.snap()).toBe(true);
    });
  });
});
