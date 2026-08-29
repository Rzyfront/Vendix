import {
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, debounceTime } from 'rxjs';
import {
  CanvasRegion,
  PrintColumnDefinition,
  PrintFormatDefinition,
  PrintPreviewMode,
  PrintSectionDefinition,
  PrintSelectedElement,
} from '../../../../../../../core/models/print-formats.model';
import { definitionToRegions, regionsToDelta } from './canvas-region';
import { PrintRegionHandleComponent } from './print-region-handle.component';
import { PrintCanvasDragDirective } from './print-canvas-drag.directive';
import { MmToPxService } from '../../../../../../../shared/services/print/mm-to-px.service';
import { PrintCanvasHistoryService } from '../../services/print-canvas-history.service';
import { PrintCanvasToolbarComponent } from './print-canvas-toolbar.component';
import { PrintPropertiesPanelComponent } from '../print-properties-panel/print-properties-panel.component';

/** MIME type used to shuttle the dropped token's path on drag-and-drop. */
const TOKEN_DND_MIME = 'application/x-vendix-token';

/**
 * [print-editor-dsk P4.1 + P4.3 + P4.4 + P4.5 + P4.6 + P4.7 + P5] — WYSIWYG
 * canvas container for the print-format editor.
 */
@Component({
  selector: 'app-print-canvas',
  standalone: true,
  imports: [
    PrintRegionHandleComponent,
    PrintCanvasDragDirective,
    PrintCanvasToolbarComponent,
    PrintPropertiesPanelComponent,
  ],
  providers: [PrintCanvasHistoryService],
  template: `
    <div class="vendix-canvas-frame">
      <app-print-canvas-toolbar
        [(mode)]="previewMode"
        [(zoom)]="zoomPct"
        [(snap)]="snapEnabled"
        [(ruler)]="rulerVisible"
        [canUndo]="history.canUndo()"
        [canRedo]="history.canRedo()"
        [definitionLabel]="paperLabel()"
        (undo)="onUndo()"
        (redo)="onRedo()"
        (fitToScreen)="onFitToScreen()"
      ></app-print-canvas-toolbar>

      <div class="vendix-canvas-split">
        <div class="vendix-canvas-viewport">
          <div
            #paper
            class="vendix-paper"
            [class.show-rulers]="rulerVisible()"
            [style.transform]="'scale(' + (zoomPct() / 100) + ')'"
            [style.width.mm]="paperWidthMm()"
            (click)="onCanvasClick($event)"
            (dragover)="onDragOver($event)"
            (drop)="onDrop($event)"
          >
            @if (previewHtml()) {
              <iframe
                #previewIframe
                id="vendix-canvas-iframe"
                [srcdoc]="previewHtml()"
                class="vendix-preview-iframe"
                sandbox="allow-same-origin allow-scripts"
              ></iframe>
            } @else {
              <div class="p-8 text-center text-xs text-text-tertiary">
                Generando vista previa interactiva...
              </div>
            }
          </div>
        </div>

        <!-- [print-editor-dsk P5] — Per-element property panel. -->
        <app-print-properties-panel
          class="vendix-canvas-properties"
          [definition]="definition()"
          [selectedRegion]="selectedRegion()"
          (unselectRequested)="onUnselect()"
          (definitionChanged)="onPropertiesPanelChanged($event)"
        ></app-print-properties-panel>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
        max-width: 100%;
        box-sizing: border-box;
      }
      .vendix-canvas-frame {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        width: 100%;
        max-width: 100%;
        box-sizing: border-box;
      }
      .vendix-canvas-split {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 340px;
        gap: 1rem;
        align-items: start;
        width: 100%;
        max-width: 100%;
        box-sizing: border-box;
      }
      @media (max-width: 1024px) {
        .vendix-canvas-split {
          grid-template-columns: minmax(0, 1fr);
        }
      }
      .vendix-canvas-viewport {
        overflow: auto;
        padding: 1.5rem;
        background: var(--color-surface-secondary, #f3f4f6);
        border: 1px solid var(--color-border, #e5e7eb);
        border-radius: 0.75rem;
        display: flex;
        justify-content: center;
        min-height: calc(100vh - 200px);
        max-height: calc(100vh - 200px);
        min-width: 0;
        box-sizing: border-box;
      }
      .vendix-canvas-properties {
        max-height: calc(100vh - 200px);
        min-height: 360px;
        overflow-y: auto;
        position: sticky;
        top: 4.5rem;
        min-width: 0;
        box-sizing: border-box;
      }
      .vendix-paper {
        position: relative;
        transform-origin: top center;
        background: #ffffff;
        border: 1px solid #d4d4d4;
        border-radius: 4px;
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
        min-height: 320px;
        overflow: hidden;
        height: fit-content;
        box-sizing: border-box;
      }
      .vendix-paper.show-rulers {
        border-color: #00bcd4;
        box-shadow: 0 0 0 1px rgba(0, 188, 212, 0.3) inset;
      }
      .vendix-preview-iframe {
        width: 100%;
        min-height: 520px;
        height: 100%;
        border: none;
        display: block;
        background: #ffffff;
      }
    `,
  ],
})
export class PrintCanvasComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly mm = inject(MmToPxService);
  protected readonly history = inject(PrintCanvasHistoryService);

  /** Paper-shaped DOM node used by fit-to-screen. */
  private readonly paperRef = viewChild<ElementRef<HTMLDivElement>>('paper');

  /** Current print format definition; drives the region layout. */
  readonly definition = input.required<PrintFormatDefinition>();

  /** Compiled preview HTML string rendered inside the paper iframe. */
  readonly previewHtml = input<string>('');

  /** Two-way bound preview mode: 'dummy' (data simulada) vs 'tokenized' (variables). */
  readonly previewMode = model<PrintPreviewMode>('dummy');

  /** Currently selected region id; matches `CanvasRegion.id`. `null` = none. */
  readonly selectedRegionId = input<string | null>(null);

  /** Emitted when a region is clicked, or `null` when empty space is clicked. */
  readonly regionSelected = output<string | null>();

  /** Emitted when an element or token inside the preview iframe is clicked. */
  readonly elementSelected = output<PrintSelectedElement>();

  /**
   * Emitted when a region mutation should be persisted to the composer.
   * Debounced 150ms — drag handlers (P4.3) call `notifyDefinitionChanged`
   * per intermediate frame; the parent receives a single consolidated emit
   * per gesture. Token drops bypass the debounce (single discrete event)
   * but still go through `history.push` so they are undoable.
   */
  readonly definitionChanged = output<PrintFormatDefinition>();

  /** P4.7 — Toolbar-driven UI state. */
  readonly zoomPct = signal<number>(100);
  readonly snapEnabled = signal<boolean>(true);
  readonly rulerVisible = signal<boolean>(false);

  private readonly _definitionSubject = new Subject<PrintFormatDefinition>();

  readonly regions = computed<CanvasRegion[]>(() =>
    definitionToRegions(this.definition()),
  );

  /**
   * [print-editor-dsk P5] — Translate the selected region id (input)
   * into the full `CanvasRegion` object so the property panel can
   * render the matching subpanel. Returns `null` for the empty
   * selection (which falls through to the global paper view).
   */
  readonly selectedRegion = computed<CanvasRegion | null>(() => {
    const id = this.selectedRegionId();
    if (!id) return null;
    return this.regions().find((r) => r.id === id) ?? null;
  });

  readonly paperWidthMm = computed<number>(() => {
    const d = this.definition();
    return d?.paper?.width_mm ?? 80;
  });

  readonly paperHeightMm = computed<number>(() => {
    const d = this.definition();
    if (!d?.paper) return 100;
    if (d.paper.is_roll) {
      return 100;
    }
    return d.paper.height_mm ?? 297;
  });

  readonly paperLabel = computed<string | null>(() => {
    const d = this.definition();
    if (!d?.paper) return null;
    const w = d.paper.width_mm;
    const h = d.paper.is_roll ? 'roll' : `${d.paper.height_mm ?? '?'}mm`;
    return `${d.paper.format} — ${w}×${h}`;
  });

  /**
   * [print-editor-dsk P4.3] Live override map keyed by `CanvasRegion.id`.
   * Stores the in-flight mm geometry while a drag/resize gesture is in
   * progress, so the template can render the moving box without waiting
   * for the debounced definition emit. Cleared on dragEnd.
   */
  private readonly _liveOverrides = signal<Record<string, CanvasRegion>>({});
  readonly liveRegions = computed(() => this._liveOverrides());

  /** [print-editor-dsk P4.3] Set of region ids currently being dragged. */
  private readonly _draggingIds = signal<Set<string>>(new Set<string>());
  readonly isDragging = (id: string): boolean => this._draggingIds().has(id);

  /**
   * [print-editor-dsk P4.3] When a handle press is routed, the canvas
   * needs to know which region + handle is being resized so the next
   * pointerdown on the host element re-enters drag-mode `resize`.
   */
  private readonly _activeResizeRegion = signal<string | null>(null);
  private readonly _activeResizeHandle = signal<
    'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | null
  >(null);
  readonly activeResizeRegion = (): string | null => this._activeResizeRegion();
  readonly activeResizeHandle = (): 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | null =>
    this._activeResizeHandle();

  /**
   * Compute the `handle` input for the drag directive on a given region.
   * - 'body' for normal drag/move.
   * - The active resize handle (nw/n/ne/...) when this region is being resized.
   * Falls back to 'body' when no active resize is in progress.
   */
  readonly getHandleFor = (
    regionId: string,
  ): 'body' | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' => {
    if (this._activeResizeRegion() !== regionId) return 'body';
    return this._activeResizeHandle() ?? 'body';
  };

  constructor() {
    this._definitionSubject
      .pipe(debounceTime(150), takeUntilDestroyed(this.destroyRef))
      .subscribe((def) => this.definitionChanged.emit(def));

    // [print-editor-dsk P4.4] — Selection keyboard: Esc deselects;
    // Delete/Backspace removes the currently selected column. Section
    // delete is intentionally disabled (Phase 5 will own CRUD UI).
    if (typeof document !== 'undefined') {
      const handler = (event: KeyboardEvent): void => this.onKeyDown(event);
      document.addEventListener('keydown', handler);
      this.destroyRef.onDestroy(() => {
        document.removeEventListener('keydown', handler);
      });
    }

    // Listen to click messages from inside the preview iframe
    if (typeof window !== 'undefined') {
      const messageHandler = (event: MessageEvent): void => {
        if (event.data?.type === 'VENDIX_PRINT_ELEMENT_CLICKED') {
          const { elementId, sectionId, token, columnId } = event.data;
          this.elementSelected.emit({ elementId, sectionId, token, columnId });
          if (columnId) {
            this.regionSelected.emit(`col-${columnId}`);
          } else if (elementId?.startsWith('comp_')) {
            this.regionSelected.emit(`comp-${elementId.replace('comp_', '')}`);
          } else if (elementId === 'f_logo') {
            this.regionSelected.emit('logo');
          } else if (elementId) {
            this.regionSelected.emit(`field-${elementId}`);
          } else if (sectionId) {
            this.regionSelected.emit(`sec-${sectionId}`);
          }
        }
      };
      window.addEventListener('message', messageHandler);
      this.destroyRef.onDestroy(() => {
        window.removeEventListener('message', messageHandler);
      });
    }

    // [print-editor-dsk P4.5] — Seed the history with the initial
    // definition so the merchant can undo back to "what was loaded"
    // if they make an unwanted change.
    effect(() => {
      const def = this.definition();
      if (def && this.history.past().length === 0) {
        this.history.push(def);
      }
    });
  }

  // ─── Mutation surface used by drag/resize (P4.3) ──────────────────────

  protected onUnselect(): void {
    this.regionSelected.emit(null);
  }

  protected notifyDefinitionChanged(def: PrintFormatDefinition): void {
    this._definitionSubject.next(def);
  }

  // ─── Undo / Redo (P4.5) ───────────────────────────────────────────────

  protected onUndo(): void {
    const restored = this.history.undo();
    if (restored) {
      this.definitionChanged.emit(restored);
    }
  }

  protected onRedo(): void {
    const restored = this.history.redo();
    if (restored) {
      this.definitionChanged.emit(restored);
    }
  }

  // ─── Fit-to-screen (P4.7) ─────────────────────────────────────────────

  protected onFitToScreen(): void {
    const paper = this.paperRef()?.nativeElement;
    if (!paper) return;
    const hostWidthPx = paper.parentElement?.clientWidth ?? 0;
    if (hostWidthPx <= 0) return;
    const currentScale = this.zoomPct() / 100;
    const intrinsicWidthPx = paper.getBoundingClientRect().width / currentScale;
    if (intrinsicWidthPx <= 0) return;
    const targetScale = (hostWidthPx / intrinsicWidthPx) * currentScale;
    const clamped = Math.max(0.6, Math.min(1.6, targetScale));
    this.zoomPct.set(Math.round(clamped * 100));
  }

  // ─── Drag from token catalog (P4.6) ───────────────────────────────────

  protected onDragOver(event: DragEvent): void {
    if (event.dataTransfer?.types.includes(TOKEN_DND_MIME)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    }
  }

  protected onDrop(event: DragEvent): void {
    // [print-editor-dsk P5.9] — Token catalog now publishes a JSON
    // envelope `{ token, path }` under our private MIME. Fall back to
    // the legacy plain-string payload (older callers) and to the
    // text/plain fallback so the loop remains backwards compatible.
    const raw = event.dataTransfer?.getData(TOKEN_DND_MIME) ?? '';
    let tokenPath = raw;
    if (raw && raw.startsWith('{')) {
      try {
        const parsed = JSON.parse(raw) as { token?: string; path?: string };
        if (parsed?.path) tokenPath = parsed.path;
      } catch {
        // Leave `tokenPath` as-is so callers still get something.
      }
    }
    if (!tokenPath) {
      tokenPath = event.dataTransfer?.getData('text/plain') ?? '';
    }
    if (!tokenPath) return;
    event.preventDefault();

    const dropXmm = this.clientXToMm(event.clientX);
    const dropYmm = this.clientYToMm(event.clientY);

    const def = this.definition();
    if (!def) return;

    const updated = this.appendDroppedSection(def, tokenPath, dropXmm, dropYmm);
    this.history.push(updated);
    this.definitionChanged.emit(updated);
  }

  /**
   * [print-editor-dsk P5] — Route a definition mutation coming from
   * the right-side property panel through the undo/redo history and
   * the debounced output. The history service coalesces bursts within
   * 250 ms so typing in a text field does not flood the stack.
   */
  protected onPropertiesPanelChanged(def: PrintFormatDefinition): void {
    this.history.push(def);
    this.notifyDefinitionChanged(def);
  }

  /**
   * Append a new section derived from the dropped token's path.
   * If the drop lands inside an existing region's bounds, the new
   * section's order is anchored just after that region's order;
   * otherwise the section is appended at the end.
   */
  private appendDroppedSection(
    def: PrintFormatDefinition,
    tokenPath: string,
    dropXmm: number,
    dropYmm: number,
  ): PrintFormatDefinition {
    const sections: PrintSectionDefinition[] = [...(def.sections ?? [])];
    const anchor = this.regions().find((r) => isInside(r, dropXmm, dropYmm));
    const newSection: PrintSectionDefinition = {
      id: `sec_dropped_${Date.now()}`,
      type: 'custom_text',
      title: deriveSectionTitle(tokenPath),
      enabled: true,
      order: anchor
        ? (sections.find((s) => s.id === anchor.anchorId)?.order ?? sections.length) + 0.5
        : sections.length,
      custom_content: `{{ ${tokenPath} }}`,
    };
    sections.push(newSection);
    sections.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    return { ...def, sections };
  }

  private clientXToMm(clientX: number): number {
    const paper = this.paperRef()?.nativeElement;
    if (!paper) return 0;
    const rect = paper.getBoundingClientRect();
    const scale = this.zoomPct() / 100;
    return ((clientX - rect.left) / scale) / this.mm.PX_PER_MM;
  }

  private clientYToMm(clientY: number): number {
    const paper = this.paperRef()?.nativeElement;
    if (!paper) return 0;
    const rect = paper.getBoundingClientRect();
    const scale = this.zoomPct() / 100;
    return ((clientY - rect.top) / scale) / this.mm.PX_PER_MM;
  }

  // ─── Click selection ──────────────────────────────────────────────────

  onCanvasClick(event: MouseEvent): void {
    // Only fire deselect when the click bubbled from the root, not from a
    // region (region clicks call onRegionClick and stopPropagation).
    if ((event.target as HTMLElement).classList.contains('vendix-paper')) {
      this.regionSelected.emit(null);
    }
  }

  onRegionClick(event: MouseEvent, regionId: string): void {
    event.stopPropagation();
    this.regionSelected.emit(regionId);
  }

  // ─── Drag / resize (P4.3) ─────────────────────────────────────────────

  onDragStart(
    event: { x_mm: number; y_mm: number; width_mm: number; height_mm: number },
    region: CanvasRegion,
  ): void {
    this._draggingIds.update((set) => {
      const next = new Set(set);
      next.add(region.id);
      return next;
    });
    this._liveOverrides.update((map) => ({
      ...map,
      [region.id]: { ...region },
    }));
  }

  onDragMove(
    event: { dx_mm: number; dy_mm: number; dw_mm: number; dh_mm: number },
    region: CanvasRegion,
  ): void {
    const current = this._liveOverrides()[region.id] ?? region;
    const next: CanvasRegion = {
      ...current,
      x_mm: current.x_mm + event.dx_mm,
      y_mm: current.y_mm + event.dy_mm,
      width_mm: Math.max(2, current.width_mm + event.dw_mm),
      height_mm: Math.max(2, current.height_mm + event.dh_mm),
    };
    this._liveOverrides.update((map) => ({ ...map, [region.id]: next }));
  }

  /**
   * Drag end. Commit the gesture to the composer via `regionsToDelta`
   * (only column resizes carry width_percent weight; section moves are
   * visual-only and emit no delta). The history service receives the
   * merged definition so the user can undo the resize.
   */
  onDragEnd(region: CanvasRegion): void {
    const live = this._liveOverrides()[region.id];
    this._draggingIds.update((set) => {
      const next = new Set(set);
      next.delete(region.id);
      return next;
    });
    if (!live) {
      this._activeResizeRegion.set(null);
      this._activeResizeHandle.set(null);
      return;
    }
    const allRegions = this.regions().map((r) => (r.id === region.id ? live : r));
    const delta = regionsToDelta(allRegions, this.definition());
    if (delta.columns && delta.columns.length > 0) {
      const merged: PrintFormatDefinition = {
        ...this.definition(),
        columns: delta.columns as PrintColumnDefinition[],
      };
      this.history.push(merged);
      this.notifyDefinitionChanged(merged);
    }
    this._liveOverrides.update((map) => {
      const { [region.id]: _removed, ...rest } = map;
      return rest;
    });
    this._activeResizeRegion.set(null);
    this._activeResizeHandle.set(null);
  }

  onHandlePressed(
    payload: {
      event: PointerEvent;
      handle: 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
    },
    region: CanvasRegion,
  ): void {
    this._activeResizeRegion.set(region.id);
    this._activeResizeHandle.set(payload.handle);
    const hostEl = (payload.event.currentTarget as HTMLElement | null)?.parentElement?.parentElement;
    if (hostEl) {
      const synthetic = new PointerEvent('pointerdown', {
        clientX: payload.event.clientX,
        clientY: payload.event.clientY,
        bubbles: true,
        cancelable: true,
        pointerId: payload.event.pointerId,
        pointerType: payload.event.pointerType,
        isPrimary: payload.event.isPrimary,
      });
      hostEl.dispatchEvent(synthetic);
    }
  }

  // ─── Keyboard (P4.4) ──────────────────────────────────────────────────

  onKeyDown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (target) {
      const tag = target.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || target.isContentEditable) {
        return;
      }
    }
    // Undo/redo shortcuts — Ctrl+Z / Ctrl+Shift+Z — fired globally so
    // the toolbar buttons stay in sync even when the canvas is not
    // the focused surface. We early-return for any text-entry target.
    if ((event.ctrlKey || event.metaKey) && !event.altKey) {
      if (event.key === 'z' || event.key === 'Z') {
        event.preventDefault();
        if (event.shiftKey) {
          this.onRedo();
        } else {
          this.onUndo();
        }
        return;
      }
      if (event.key === 'y' || event.key === 'Y') {
        event.preventDefault();
        this.onRedo();
        return;
      }
    }
    const selectedId = this.selectedRegionId();
    if (!selectedId) {
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      this.regionSelected.emit(null);
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      const region = this.regions().find((r) => r.id === selectedId);
      if (!region) return;
      if (region.kind !== 'column') {
        return;
      }
      event.preventDefault();
      const remaining = (this.definition().columns ?? []).filter(
        (c) => c.id !== region.anchorId,
      );
      const merged: PrintFormatDefinition = {
        ...this.definition(),
        columns: remaining,
      };
      this.history.push(merged);
      this.notifyDefinitionChanged(merged);
      this.regionSelected.emit(null);
    }
  }
}

// ─── Module-level helpers ─────────────────────────────────────────────────

function isInside(region: CanvasRegion, xmm: number, ymm: number): boolean {
  return (
    xmm >= region.x_mm &&
    xmm <= region.x_mm + region.width_mm &&
    ymm >= region.y_mm &&
    ymm <= region.y_mm + region.height_mm
  );
}

function deriveSectionTitle(tokenPath: string): string {
  const leaf = tokenPath.split('.').pop() ?? tokenPath;
  return `Campo: ${leaf}`;
}
