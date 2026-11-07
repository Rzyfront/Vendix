import { ChangeDetectionStrategy, Component, ElementRef, output, signal, viewChild } from '@angular/core';

const MIN_STROKE_PX = 40;

/**
 * Canvas to draw a signature with a finger or the mouse (pointer events).
 * Emits the PNG data URL when a stroke ends, and `null` when cleared or empty.
 */
@Component({
  selector: 'app-signature-pad',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="rounded-xl border-2 border-dashed border-border bg-white">
      <canvas
        #pad
        width="600"
        height="220"
        class="block h-44 w-full cursor-crosshair rounded-xl"
        style="touch-action: none"
        role="img"
        aria-label="Espacio para dibujar tu firma"
        (pointerdown)="start($event)"
        (pointermove)="move($event)"
        (pointerup)="end($event)"
        (pointercancel)="end($event)"
        (pointerleave)="end($event)"
      ></canvas>
    </div>
    <div class="mt-2 flex items-center justify-between text-xs text-text-secondary">
      <span>Dibuja tu firma con el dedo o el mouse.</span>
      <button
        type="button"
        class="h-9 rounded-lg border border-border px-3 text-sm font-medium text-text-primary disabled:opacity-50"
        [disabled]="!hasInk()"
        (click)="clear()"
      >
        Limpiar
      </button>
    </div>
  `,
})
export class SignaturePadComponent {
  private readonly pad = viewChild.required<ElementRef<HTMLCanvasElement>>('pad');

  readonly signatureChange = output<string | null>();
  readonly hasInk = signal(false);

  private drawing = false;
  private length = 0;
  private last: { x: number; y: number } | null = null;

  start(event: PointerEvent): void {
    event.preventDefault();
    const canvas = this.pad().nativeElement;
    canvas.setPointerCapture?.(event.pointerId);
    this.drawing = true;
    this.last = this.point(event);
  }

  move(event: PointerEvent): void {
    if (!this.drawing || !this.last) return;
    event.preventDefault();
    const next = this.point(event);
    const ctx = this.pad().nativeElement.getContext('2d');
    if (!ctx) return;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111827';
    ctx.beginPath();
    ctx.moveTo(this.last.x, this.last.y);
    ctx.lineTo(next.x, next.y);
    ctx.stroke();
    this.length += Math.hypot(next.x - this.last.x, next.y - this.last.y);
    this.last = next;
  }

  end(event: PointerEvent): void {
    if (!this.drawing) return;
    event.preventDefault();
    this.drawing = false;
    this.last = null;
    if (this.length < MIN_STROKE_PX) {
      this.clear();
      return;
    }
    this.hasInk.set(true);
    this.signatureChange.emit(this.pad().nativeElement.toDataURL('image/png'));
  }

  clear(): void {
    const canvas = this.pad().nativeElement;
    canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    this.length = 0;
    this.drawing = false;
    this.last = null;
    this.hasInk.set(false);
    this.signatureChange.emit(null);
  }

  /** Canvas coordinates of a pointer event (the canvas is scaled by CSS). */
  private point(event: PointerEvent): { x: number; y: number } {
    const canvas = this.pad().nativeElement;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }
}
