import {
  Component,
  computed,
  model,
  output,
  input,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';

/**
 * [print-editor-dsk P4.7] — Toolbar strip rendered above the canvas.
 *
 * Owns four pieces of editor state via signal `model()`s so the parent
 * canvas can two-way bind and react to changes:
 *
 *  - `zoom`     — 60..160, applied as a CSS scale transform.
 *  - `snap`     — when true, drag-resize quantizes position/size to mm.
 *  - `ruler`    — when true, the canvas paints mm rulers around the paper.
 *
 * Plus one output:
 *
 *  - `fitToScreen` — parent recomputes the zoom so the paper fits its
 *    container width.
 *
 * All icons use the shared `IconComponent` (Lucide) — `rotate-ccw` and
 * `rotate-cw` for undo/redo, `grid` for snap, `maximize` for fit, `minus`
 * / `plus` for zoom, and `scale` toggled on/off for ruler.
 */
@Component({
  selector: 'app-print-canvas-toolbar',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
    <div class="vendix-canvas-toolbar">
      <div class="toolbar-group">
        <button
          type="button"
          class="toolbar-btn"
          [disabled]="!canUndo()"
          title="Deshacer (Ctrl+Z)"
          aria-label="Deshacer"
          (click)="undo.emit()"
        >
          <app-icon name="rotate-ccw" [size]="14"></app-icon>
        </button>
        <button
          type="button"
          class="toolbar-btn"
          [disabled]="!canRedo()"
          title="Rehacer (Ctrl+Shift+Z)"
          aria-label="Rehacer"
          (click)="redo.emit()"
        >
          <app-icon name="rotate-cw" [size]="14"></app-icon>
        </button>
      </div>

      <div class="toolbar-divider"></div>

      <div class="toolbar-group">
        <button
          type="button"
          class="toolbar-btn"
          [disabled]="zoom() <= minZoom()"
          title="Reducir zoom"
          aria-label="Reducir zoom"
          (click)="zoomOut()"
        >
          <app-icon name="minus" [size]="14"></app-icon>
        </button>
        <span class="toolbar-zoom">{{ zoom() }}%</span>
        <button
          type="button"
          class="toolbar-btn"
          [disabled]="zoom() >= maxZoom()"
          title="Aumentar zoom"
          aria-label="Aumentar zoom"
          (click)="zoomIn()"
        >
          <app-icon name="plus" [size]="14"></app-icon>
        </button>
      </div>

      <div class="toolbar-divider"></div>

      <div class="toolbar-group">
        <button
          type="button"
          class="toolbar-btn"
          [class.toolbar-btn-active]="snap()"
          title="Ajustar a la cuadrícula"
          aria-label="Ajustar a la cuadrícula"
          [attr.aria-pressed]="snap()"
          (click)="toggleSnap()"
        >
          <app-icon name="grid" [size]="14"></app-icon>
        </button>
        <button
          type="button"
          class="toolbar-btn"
          [class.toolbar-btn-active]="ruler()"
          title="Mostrar reglas"
          aria-label="Mostrar reglas"
          [attr.aria-pressed]="ruler()"
          (click)="toggleRuler()"
        >
          <app-icon name="scale" [size]="14"></app-icon>
        </button>
        <button
          type="button"
          class="toolbar-btn"
          title="Ajustar al contenedor"
          aria-label="Ajustar al contenedor"
          (click)="fitToScreen.emit()"
        >
          <app-icon name="maximize" [size]="14"></app-icon>
        </button>
      </div>

      @if (definitionLabel(); as label) {
        <div class="toolbar-divider"></div>
        <span class="toolbar-label" [title]="label">{{ label }}</span>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .vendix-canvas-toolbar {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.375rem 0.625rem;
        background: var(--color-surface, #ffffff);
        border: 1px solid var(--color-border, #e5e7eb);
        border-radius: 0.5rem;
        flex-wrap: wrap;
      }
      .toolbar-group {
        display: flex;
        align-items: center;
        gap: 0.25rem;
      }
      .toolbar-divider {
        width: 1px;
        height: 1.25rem;
        background: var(--color-border, #e5e7eb);
      }
      .toolbar-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1.75rem;
        height: 1.75rem;
        border-radius: 0.375rem;
        background: transparent;
        border: 1px solid transparent;
        color: var(--color-text-secondary, #4b5563);
        cursor: pointer;
        transition: background-color 120ms, color 120ms, border-color 120ms;
      }
      .toolbar-btn:hover:not(:disabled) {
        background: var(--color-surface-hover, #f3f4f6);
        color: var(--color-text-primary, #111827);
      }
      .toolbar-btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }
      .toolbar-btn-active {
        background: rgba(0, 188, 212, 0.12);
        border-color: rgba(0, 188, 212, 0.4);
        color: #00bcd4;
      }
      .toolbar-zoom {
        font-size: 0.75rem;
        font-family: var(--font-mono, monospace);
        color: var(--color-text-secondary, #4b5563);
        min-width: 3rem;
        text-align: center;
      }
      .toolbar-label {
        font-size: 0.75rem;
        color: var(--color-text-tertiary, #6b7280);
        max-width: 18rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    `,
  ],
})
export class PrintCanvasToolbarComponent {
  /** Two-way bound zoom percentage (60..160). */
  readonly zoom = model<number>(100);

  /** Two-way bound snap-to-grid toggle. */
  readonly snap = model<boolean>(true);

  /** Two-way bound ruler visibility toggle. */
  readonly ruler = model<boolean>(false);

  /** Optional display label rendered on the right (e.g. paper format). */
  readonly definitionLabel = input<string | null>(null);

  /** Fired when the user clicks the undo button. */
  readonly undo = output<void>();

  /** Fired when the user clicks the redo button. */
  readonly redo = output<void>();

  /** Fired when the user clicks the fit-to-screen button. */
  readonly fitToScreen = output<void>();

  /** Forwarded from the parent's history service so we can disable the buttons. */
  readonly canUndo = input<boolean>(false);
  readonly canRedo = input<boolean>(false);

  readonly minZoom = computed(() => 60);
  readonly maxZoom = computed(() => 160);

  zoomIn(): void {
    const next = Math.min(this.zoom() + 10, this.maxZoom());
    this.zoom.set(next);
  }

  zoomOut(): void {
    const next = Math.max(this.zoom() - 10, this.minZoom());
    this.zoom.set(next);
  }

  toggleSnap(): void {
    this.snap.set(!this.snap());
  }

  toggleRuler(): void {
    this.ruler.set(!this.ruler());
  }
}
