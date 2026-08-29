import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * [print-editor-dsk P4.3] — Pure UI overlay for the 8 resize handles of a
 * selected canvas region. This component is intentionally dumb: it renders
 * eight `<span>` handles positioned at the corners and edges of its parent
 * (the region div), and emits a `(handlePressed)` event when the user
 * pointerdowns one of them. The parent (`PrintCanvasComponent`) owns the
 * pointer move/up logic and translates the picked handle into a drag-mode
 * for `PrintCanvasDragDirective`.
 *
 * No business logic, no direct subscription to facade/services. Styling is
 * scoped via the component-scoped styles block; the parent can override
 * `.resize-handle` from above if a different palette is needed.
 */
@Component({
  selector: 'app-print-region-handle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible()) {
      <!-- NW corner -->
      <span
        class="resize-handle handle-nw"
        data-handle="nw"
        (pointerdown)="onPointerDown($event, 'nw')"
      ></span>
      <!-- N edge -->
      <span
        class="resize-handle handle-n"
        data-handle="n"
        (pointerdown)="onPointerDown($event, 'n')"
      ></span>
      <!-- NE corner -->
      <span
        class="resize-handle handle-ne"
        data-handle="ne"
        (pointerdown)="onPointerDown($event, 'ne')"
      ></span>
      <!-- E edge -->
      <span
        class="resize-handle handle-e"
        data-handle="e"
        (pointerdown)="onPointerDown($event, 'e')"
      ></span>
      <!-- SE corner -->
      <span
        class="resize-handle handle-se"
        data-handle="se"
        (pointerdown)="onPointerDown($event, 'se')"
      ></span>
      <!-- S edge -->
      <span
        class="resize-handle handle-s"
        data-handle="s"
        (pointerdown)="onPointerDown($event, 's')"
      ></span>
      <!-- SW corner -->
      <span
        class="resize-handle handle-sw"
        data-handle="sw"
        (pointerdown)="onPointerDown($event, 'sw')"
      ></span>
      <!-- W edge -->
      <span
        class="resize-handle handle-w"
        data-handle="w"
        (pointerdown)="onPointerDown($event, 'w')"
      ></span>
    }
  `,
  styles: [
    `
      :host {
        position: absolute;
        inset: 0;
        pointer-events: none;
      }
      .resize-handle {
        position: absolute;
        width: var(--handle-size, 8px);
        height: var(--handle-size, 8px);
        background: #fff;
        border: 1px solid #00bcd4;
        box-sizing: border-box;
        pointer-events: auto;
        z-index: 3;
        touch-action: none;
      }
      .handle-nw { top: -4px;    left: -4px;    cursor: nwse-resize; }
      .handle-n  { top: -4px;    left: 50%;     transform: translateX(-50%);  cursor: ns-resize;  }
      .handle-ne { top: -4px;    right: -4px;   cursor: nesw-resize; }
      .handle-e  { top: 50%;     right: -4px;   transform: translateY(-50%);  cursor: ew-resize;  }
      .handle-se { bottom: -4px; right: -4px;   cursor: nwse-resize; }
      .handle-s  { bottom: -4px; left: 50%;     transform: translateX(-50%);  cursor: ns-resize;  }
      .handle-sw { bottom: -4px; left: -4px;    cursor: nesw-resize; }
      .handle-w  { top: 50%;     left: -4px;    transform: translateY(-50%);  cursor: ew-resize;  }
    `,
  ],
})
export class PrintRegionHandleComponent {
  /** Edge size in px. Default 8. Must match the parent selection outline weight. */
  readonly handleSize = input<number>(8);

  /** When false the component renders nothing (used by parent to hide handles). */
  readonly visible = input<boolean>(false);

  /**
   * Emitted when the user pointerdowns one of the 8 handles.
   * The parent listens and routes the event to the matching drag directive.
   */
  readonly handlePressed = output<{
    event: PointerEvent;
    handle: 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
  }>();

  onPointerDown(
    event: PointerEvent,
    handle: 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w',
  ): void {
    // Stop propagation so the parent canvas does not also receive the
    // pointerdown as a "body drag" start. The drag directive on the host
    // region will re-issue a synthetic pointerdown from the parent.
    event.stopPropagation();
    this.handlePressed.emit({ event, handle });
  }
}