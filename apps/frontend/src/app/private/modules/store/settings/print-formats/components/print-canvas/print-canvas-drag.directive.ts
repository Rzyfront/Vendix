import { Directive, ElementRef, HostListener, inject, input, output } from '@angular/core';

/**
 * [print-editor-dsk P4.3] — Pointer-driven drag/resize for canvas regions.
 *
 * Two roles:
 *  - `handle="body"` — moves the region in the X/Y plane.
 *  - `handle="nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w"` — resizes
 *    the region from one of the 8 corners/edges. Deltas are emitted in
 *    millimetres with origin at the press position; the parent is expected
 *    to translate them into new `CanvasRegion.x_mm/y_mm/width_mm/height_mm`
 *    values for the live preview and into a column `width_percent` delta on
 *    `dragEnd` for persistence.
 *
 * Snap: when `snap` is true (default) the emitted deltas are rounded to
 * whole millimetres so the underlying `width_percent` math stays integer.
 *
 * Implementation notes:
 *  - Uses raw `PointerEvent` listeners on `window` after `pointerdown` to
 *    survive the cursor leaving the host element mid-gesture. Removes the
 *    listeners on `pointerup`.
 *  - Hosts are responsible for calling `event.preventDefault()` upstream if
 *    they want to suppress text selection during drag.
 *  - Does NOT mutate the host DOM itself — the parent binds to the outputs
 *    and updates state. Keeps the directive a pure event translator.
 */
@Directive({
  selector: '[appCanvasDrag]',
  standalone: true,
})
export class PrintCanvasDragDirective {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Snap deltas to whole millimetres. Default `true`. */
  readonly snap = input<boolean>(true);

  /**
   * Which drag mode this instance implements. `body` = translate; the
   * other 8 values = resize from that corner/edge.
   */
  readonly handle = input<
    'body' | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
  >('body');

  /** Fired once when the gesture starts. Carries the current geometry. */
  readonly dragStart = output<{
    x_mm: number;
    y_mm: number;
    width_mm: number;
    height_mm: number;
  }>();

  /** Fired on every pointermove during the gesture. */
  readonly dragMove = output<{
    dx_mm: number;
    dy_mm: number;
    dw_mm: number;
    dh_mm: number;
  }>();

  /** Fired once when the gesture ends (pointerup anywhere on window). */
  readonly dragEnd = output<void>();

  private startX = 0;
  private startY = 0;
  private startW = 0;
  private startH = 0;
  private dragging = false;
  private startLeftMm = 0;
  private startTopMm = 0;
  /** Pixel-per-millimetre constant (96 CSS DPI / 25.4 mm per inch). */
  private static readonly PX_PER_MM = 96 / 25.4;

  /**
   * Host-level listener. The directive binds its own pointerdown because
   * Angular attribute events would race with the parent's `(pointerdown)`
   * used to deselect/restart gestures.
   */
  @HostListener('pointerdown', ['$event'])
  protected hostPointerDown(event: PointerEvent): void {
    this.onPointerDown(event);
  }

  onPointerDown(event: PointerEvent): void {
    // Body-drag ignores inner element hits: child handles emit
    // (handlePressed) and the parent cancels the body drag there.
    if (
      this.handle() === 'body' &&
      event.target !== this.host.nativeElement
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.dragging = true;
    this.startX = event.clientX;
    this.startY = event.clientY;
    const rect = this.host.nativeElement.getBoundingClientRect();
    this.startW = rect.width;
    this.startH = rect.height;
    // Capture initial mm position from inline styles. Falls back to 0
    // when the host is freshly mounted without inline placement.
    const inlineLeft = this.host.nativeElement.style.left;
    const inlineTop = this.host.nativeElement.style.top;
    this.startLeftMm = inlineLeft ? parseFloat(inlineLeft) || 0 : 0;
    this.startTopMm = inlineTop ? parseFloat(inlineTop) || 0 : 0;
    this.dragStart.emit({
      x_mm: this.startLeftMm,
      y_mm: this.startTopMm,
      width_mm: this.startW / PrintCanvasDragDirective.PX_PER_MM,
      height_mm: this.startH / PrintCanvasDragDirective.PX_PER_MM,
    });
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
  }

  /** Public entry point for the parent to start a resize gesture from a handle press. */
  startResizeFromHandle(event: PointerEvent): void {
    // Reuse the same bookkeeping as body-drag but skip the inner-target
    // guard because handles live on a child element.
    this.dragging = true;
    this.startX = event.clientX;
    this.startY = event.clientY;
    const rect = this.host.nativeElement.getBoundingClientRect();
    this.startW = rect.width;
    this.startH = rect.height;
    const inlineLeft = this.host.nativeElement.style.left;
    const inlineTop = this.host.nativeElement.style.top;
    this.startLeftMm = inlineLeft ? parseFloat(inlineLeft) || 0 : 0;
    this.startTopMm = inlineTop ? parseFloat(inlineTop) || 0 : 0;
    this.dragStart.emit({
      x_mm: this.startLeftMm,
      y_mm: this.startTopMm,
      width_mm: this.startW / PrintCanvasDragDirective.PX_PER_MM,
      height_mm: this.startH / PrintCanvasDragDirective.PX_PER_MM,
    });
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
  }

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.dragging) return;
    const dxPx = event.clientX - this.startX;
    const dyPx = event.clientY - this.startY;
    const PX_PER_MM = PrintCanvasDragDirective.PX_PER_MM;
    let dx_mm = dxPx / PX_PER_MM;
    let dy_mm = dyPx / PX_PER_MM;
    let dw_mm = 0;
    let dh_mm = 0;
    const h = this.handle();
    // Corner/edge handles: the dx/dy are consumed as resize deltas
    // rather than free movement. Corners also clamp movement on the
    // non-resized axis to 0 so the opposite edge does not drift.
    if (h === 'nw') {
      dw_mm = -dx_mm;
      dh_mm = -dy_mm;
      dx_mm = 0;
      dy_mm = 0;
    } else if (h === 'ne') {
      dw_mm = dx_mm;
      dh_mm = -dy_mm;
      dx_mm = 0;
      dy_mm = 0;
    } else if (h === 'sw') {
      dw_mm = -dx_mm;
      dh_mm = dy_mm;
      dx_mm = 0;
      dy_mm = 0;
    } else if (h === 'se') {
      dw_mm = dx_mm;
      dh_mm = dy_mm;
      dx_mm = 0;
      dy_mm = 0;
    } else if (h === 'n') {
      dh_mm = -dy_mm;
      dy_mm = 0;
    } else if (h === 's') {
      dh_mm = dy_mm;
      dy_mm = 0;
    } else if (h === 'w') {
      dw_mm = -dx_mm;
      dx_mm = 0;
    } else if (h === 'e') {
      dw_mm = dx_mm;
      dx_mm = 0;
    } else {
      dx_mm = 0;
      dy_mm = 0;
    }
    if (this.snap()) {
      dx_mm = Math.round(dx_mm);
      dy_mm = Math.round(dy_mm);
      dw_mm = Math.round(dw_mm);
      dh_mm = Math.round(dh_mm);
    }
    this.dragMove.emit({ dx_mm, dy_mm, dw_mm, dh_mm });
  };

  private onPointerUp = (): void => {
    this.dragging = false;
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    this.dragEnd.emit();
  };
}