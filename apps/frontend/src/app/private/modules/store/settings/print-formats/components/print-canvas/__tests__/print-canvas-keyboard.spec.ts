import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, ViewChild } from '@angular/core';
import { By } from '@angular/platform-browser';
import {
  CanvasRegion,
  PrintFormatDefinition,
} from '../../../../../../../../core/models/print-formats.model';
import { PrintCanvasComponent } from '../print-canvas.component';
import { PrintCanvasToolbarComponent } from '../print-canvas-toolbar.component';
import { PrintPropertiesPanelComponent } from '../../print-properties-panel/print-properties-panel.component';
import { PrintPaperPanelComponent } from '../../print-properties-panel/paper-panel.component';
import { PrintSectionPanelComponent } from '../../print-properties-panel/section-panel.component';
import { PrintColumnPanelComponent } from '../../print-properties-panel/column-panel.component';
import { PrintLogoPanelComponent } from '../../print-properties-panel/logo-panel.component';
import { PrintCompanyPanelComponent } from '../../print-properties-panel/company-panel.component';
import { PrintStylesPanelComponent } from '../../print-properties-panel/styles-panel.component';
import { PrintCustomTemplatePanelComponent } from '../../print-properties-panel/custom-template-panel.component';
import { PrintRegionHandleComponent } from '../print-region-handle.component';
import { PrintCanvasDragDirective } from '../print-canvas-drag.directive';
import { IconComponent } from '../../../../../../../../shared/components/icon/icon.component';

/**
 * [print-editor-dsk P9] — Keyboard handling contract for the canvas.
 *
 * The handler is the public `onKeyDown(event: KeyboardEvent)` method. We
 * assert:
 *   - Escape with a selected region → emits `regionSelected(null)`,
 *     no mutation of `definition`.
 *   - Backspace with a COLUMN selected → removes the column from
 *     `definition.columns`, pushes history, emits null selection.
 *   - Backspace with a SECTION selected → NO-OP (section removal is not
 *     a keyboard affordance in this editor).
 *   - Keyboard events fired on an `<input>` target → ignored (text-entry
 *     surfaces must not be hijacked by undo/redo or delete).
 *
 * The host wrapper mirrors the production imports so TestBed can resolve
 * every directive / child component referenced by the canvas template.
 */
@Component({
  standalone: true,
  imports: [
    PrintCanvasComponent,
    PrintCanvasToolbarComponent,
    PrintPropertiesPanelComponent,
    PrintPaperPanelComponent,
    PrintSectionPanelComponent,
    PrintColumnPanelComponent,
    PrintLogoPanelComponent,
    PrintCompanyPanelComponent,
    PrintStylesPanelComponent,
    PrintCustomTemplatePanelComponent,
    PrintRegionHandleComponent,
    PrintCanvasDragDirective,
    IconComponent,
  ],
  template: `
    <app-print-canvas
      [definition]="definition"
      [selectedRegion]="region"
      (regionSelected)="onRegionSelected($event)"
      (definitionChanged)="onDefinitionChanged($event)"
    ></app-print-canvas>
  `,
})
class HostComponent {
  definition: PrintFormatDefinition = {
    paper: { format: 'thermal_80', width_mm: 80, is_roll: true, copies: 1 },
    sections: [
      { id: 's1', type: 'header', title: 'Cabecera', enabled: true, order: 0 },
    ],
    columns: [
      { id: 'c1', key: 'name', label: 'Producto', enabled: true, width_percent: 60, align: 'left' },
      { id: 'c2', key: 'qty', label: 'Cant.', enabled: true, width_percent: 40, align: 'right' },
    ],
  };
  region: CanvasRegion | null = null;
  lastEmittedRegion: CanvasRegion | null | undefined = undefined;
  lastDefinition: PrintFormatDefinition | null = null;

  @ViewChild(PrintCanvasComponent) canvas!: PrintCanvasComponent;

  onRegionSelected(r: CanvasRegion | null): void {
    this.lastEmittedRegion = r;
    this.region = r;
  }
  onDefinitionChanged(d: PrintFormatDefinition): void {
    this.lastDefinition = d;
    this.definition = d;
  }
}

describe('PrintCanvasComponent — keyboard handlers [print-editor-dsk P9]', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let canvas: PrintCanvasComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
    canvas = host.canvas;
  });

  /** Helper: set the host's `region` and propagate to the canvas input. */
  function setRegion(r: CanvasRegion | null): void {
    host.region = r;
    fixture.detectChanges();
  }

  it('Escape with a selected region emits regionSelected(null) and does NOT mutate definition', () => {
    // Pre-select a column region so the handler has work to do.
    const columnRegion: CanvasRegion = {
      id: 'col-c1',
      kind: 'column',
      label: 'Producto',
      anchorId: 'c1',
      x_mm: 0,
      y_mm: 30,
      width_mm: 48,
      height_mm: 20,
      zIndex: 2,
    };
    setRegion(columnRegion);

    const beforeColumns = host.definition.columns?.length;
    canvas.onKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();

    expect(host.lastEmittedRegion).toBeNull();
    expect(host.lastDefinition).toBeNull(); // no (definitionChanged) emission
    expect(host.definition.columns?.length).toBe(beforeColumns);
  });

  it('Backspace on a selected COLUMN removes that column, pushes history, emits null', () => {
    const columnRegion: CanvasRegion = {
      id: 'col-c1',
      kind: 'column',
      label: 'Producto',
      anchorId: 'c1',
      x_mm: 0,
      y_mm: 30,
      width_mm: 48,
      height_mm: 20,
      zIndex: 2,
    };
    setRegion(columnRegion);

    canvas.onKeyDown(new KeyboardEvent('keydown', { key: 'Backspace' }));
    fixture.detectChanges();

    // The column is gone from `host.definition.columns`.
    const remaining = host.definition.columns ?? [];
    expect(remaining.find((c) => c.id === 'c1')).toBeUndefined();
    expect(remaining.length).toBe(1);
    expect(remaining[0].id).toBe('c2');
    // The shell deselected after deletion.
    expect(host.lastEmittedRegion).toBeNull();
  });

  it('Backspace on a selected SECTION is a NO-OP (no removal, no history push)', () => {
    // Section removal is intentionally NOT bound to Backspace — the
    // editor wants the user to use the panel "Eliminar sección" button.
    const sectionRegion: CanvasRegion = {
      id: 'sec-s1',
      kind: 'section',
      label: 'Cabecera',
      anchorId: 's1',
      x_mm: 0,
      y_mm: 0,
      width_mm: 80,
      height_mm: 30,
      zIndex: 1,
    };
    setRegion(sectionRegion);

    const beforeSections = (host.definition.sections ?? []).length;
    const beforeColumns = (host.definition.columns ?? []).length;

    canvas.onKeyDown(new KeyboardEvent('keydown', { key: 'Backspace' }));
    fixture.detectChanges();

    // Definition untouched.
    expect((host.definition.sections ?? []).length).toBe(beforeSections);
    expect((host.definition.columns ?? []).length).toBe(beforeColumns);
    expect(host.lastDefinition).toBeNull();
  });

  it('keyboard events on an <input> target are IGNORED (no undo, no delete, no escape)', () => {
    const columnRegion: CanvasRegion = {
      id: 'col-c2',
      kind: 'column',
      label: 'Cant.',
      anchorId: 'c2',
      x_mm: 48,
      y_mm: 30,
      width_mm: 32,
      height_mm: 20,
      zIndex: 2,
    };
    setRegion(columnRegion);

    const beforeColumns = host.definition.columns?.length;
    // The handler bails out when `event.target.tagName === 'INPUT'`,
    // so Backspace is a no-op even with a column selected.
    const input = document.createElement('input');
    const ev = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true });
    Object.defineProperty(ev, 'target', { value: input, configurable: true });
    canvas.onKeyDown(ev);
    fixture.detectChanges();

    expect(host.definition.columns?.length).toBe(beforeColumns);
    expect(host.lastDefinition).toBeNull();
  });
});
