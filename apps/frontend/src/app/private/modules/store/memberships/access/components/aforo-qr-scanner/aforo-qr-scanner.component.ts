import {
  Component,
  ElementRef,
  OnDestroy,
  effect,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

import { IconComponent } from '../../../../../../../shared/components/index';

// Type-only imports: erased at compile time, so `@zxing/browser` is NOT bundled
// eagerly — the runtime class is pulled in via a dynamic import() when the
// scanner actually opens.
import type { BrowserQRCodeReader, IScannerControls } from '@zxing/browser';

/** How the scanner overlay is presented: full-viewport or a draggable window. */
export type ScannerViewMode = 'fullscreen' | 'floating';

/**
 * Fullscreen live QR scanner overlay for the gym/aforo check-in flow.
 *
 * Opens the REAR camera and decodes QR codes in real time with `@zxing/browser`
 * (loaded dynamically the first time the overlay opens). On the first decoded
 * code it stops the camera, emits `scanned` with the raw text, and auto-closes.
 *
 * Camera lifecycle is tied to `isOpen`: opening starts the stream, closing (or
 * destroying the component / hitting the X / a permission error) releases the
 * camera via `IScannerControls.stop()` so no track is ever left hanging.
 *
 * Zoneless + signals (Angular 20): `input`, `output`, `signal`, `effect`,
 * `viewChild`. No decorators, no zone.js, no manual change detection.
 */
@Component({
  selector: 'app-aforo-qr-scanner',
  standalone: true,
  imports: [IconComponent],
  styleUrl: './aforo-qr-scanner.component.css',
  template: `
    @if (isOpen()) {
      <div
        class="scanner-overlay"
        [class.is-floating]="displayMode() === 'floating'"
        [class.is-minimized]="displayMode() === 'floating' && minimized()"
        [style.left.px]="displayMode() === 'floating' ? pos().x : null"
        [style.top.px]="displayMode() === 'floating' ? pos().y : null"
        [style.width.px]="displayMode() === 'floating' ? (minimized() ? bubblePx : size().w) : null"
        [style.height.px]="displayMode() === 'floating' ? (minimized() ? bubblePx : size().h) : null"
        (pointerdown)="minimized() ? onPointerDownHeader($event) : null"
      >
        <!-- Camera preview: mounted in ALL modes; only its container restyles. -->
        <video #videoEl class="scanner-video" autoplay playsinline muted></video>

        <!-- Top bar: window controls + drag handle (hidden when minimized via CSS) -->
        <div class="scanner-topbar" (pointerdown)="onPointerDownHeader($event)">
          @if (displayMode() === 'floating') {
            <span class="scanner-grip" aria-hidden="true"><app-icon name="grip-vertical" [size]="18" /></span>
          }
          <div class="scanner-topbar-actions" (pointerdown)="$event.stopPropagation()">
            <button type="button" class="scanner-ctl" (click)="toggleMode()"
              [attr.aria-label]="displayMode() === 'floating' ? 'Pantalla completa' : 'Modo ventana flotante'">
              <app-icon [name]="displayMode() === 'floating' ? 'fullscreen-enter' : 'fullscreen-exit'" [size]="20" />
            </button>
            @if (displayMode() === 'floating') {
              <button type="button" class="scanner-ctl" (click)="minimize()" aria-label="Minimizar a burbuja">
                <app-icon name="minus-circle" [size]="20" />
              </button>
            }
            <button type="button" class="scanner-ctl scanner-close" (click)="close()" aria-label="Cerrar escáner">
              <app-icon name="x" [size]="20" />
            </button>
          </div>
        </div>

        @if (errorMessage()) {
          <div class="scanner-error-wrap">
            <div class="scanner-error">
              <app-icon name="alert-triangle" [size]="22" />
              <p>{{ errorMessage() }}</p>
              <button type="button" class="scanner-error-btn" (click)="close()">Cerrar</button>
            </div>
          </div>
        } @else if (!minimized()) {
          <div class="scanner-frame-wrap">
            <div class="scanner-frame">
              <span class="corner corner-tl"></span>
              <span class="corner corner-tr"></span>
              <span class="corner corner-bl"></span>
              <span class="corner corner-br"></span>
              <span class="scanline"></span>
            </div>
            <p class="scanner-help">Apunta la cámara al código QR</p>
          </div>
        }

        @if (displayMode() === 'floating' && !minimized()) {
          <span class="scanner-resize" (pointerdown)="onPointerDownResize($event)" aria-hidden="true"></span>
        }
      </div>
    }
  `,
})
export class AforoQrScannerComponent implements OnDestroy {
  /** Anti double-read window (ms) for kiosk mode: same code is ignored within it. */
  private static readonly CONTINUOUS_COOLDOWN_MS = 2500;

  /** Drives the whole camera lifecycle: true opens + scans, false releases. */
  readonly isOpen = input<boolean>(false);
  /**
   * Kiosk / continuous mode. When `true`, the overlay does NOT auto-close after
   * a decode: it emits `scanned` and keeps the decode loop alive so a reception
   * tablet can scan member after member. The same code is not re-emitted within
   * `CONTINUOUS_COOLDOWN_MS` (anti double-read). Default `false` keeps the
   * original single-shot behavior (decode once → close) fully intact.
   */
  readonly continuous = input<boolean>(false);

  /** Raw text of the first decoded QR code (each decode in continuous mode). */
  readonly scanned = output<string>();
  /** Fired when the overlay closes (auto-close after scan, X, or error). */
  readonly closed = output<void>();

  /** User-facing error shown inside the overlay (permission/hardware issues). */
  readonly errorMessage = signal<string | null>(null);

  // ── View mode (fullscreen ↔ floating window ↔ minimized bubble) ─────────
  /** Store default applied on first open when no per-device pref exists. */
  readonly defaultMode = input<ScannerViewMode>('fullscreen');
  readonly displayMode = signal<ScannerViewMode>('fullscreen');
  readonly minimized = signal(false);
  readonly pos = signal<{ x: number; y: number }>({ x: 24, y: 24 });
  readonly size = signal<{ w: number; h: number }>({ w: 340, h: 460 });

  protected readonly bubblePx = 104;
  private readonly minW = 260;
  private readonly minH = 320;
  private static readonly VIEW_STORAGE_KEY = 'vendix:aforo-qr-scanner:view';
  private viewInitialized = false;

  private readonly videoRef = viewChild<ElementRef<HTMLVideoElement>>('videoEl');

  private reader: BrowserQRCodeReader | null = null;
  private controls: IScannerControls | null = null;
  private starting = false;
  private decoded = false;
  private startAttempts = 0;
  /** Last code emitted + its timestamp — used to debounce repeats in kiosk mode. */
  private lastDecodedText: string | null = null;
  private lastDecodedAt = 0;

  /**
   * Page Visibility handler: release the camera while the tab is hidden (saves
   * battery) and resume the decode loop when it becomes visible again.
   */
  private readonly onVisibilityChange = (): void => {
    if (typeof document === 'undefined') return;
    if (document.hidden) {
      // Pause: drop the camera but keep `isOpen` so we can resume seamlessly.
      this.stop();
    } else if (this.isOpen()) {
      this.startAttempts = 0;
      queueMicrotask(() => this.start());
    }
  };

  constructor() {
    // React to open/close transitions. On open, defer the start so the @if view
    // (and its <video>) has a chance to render; start() retries until it exists.
    effect(() => {
      if (this.isOpen()) {
        this.decoded = false;
        this.startAttempts = 0;
        this.lastDecodedText = null;
        this.lastDecodedAt = 0;
        this.errorMessage.set(null);
        this.initView();
        queueMicrotask(() => this.start());
      } else {
        this.stop();
      }
    });

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibilityChange);
    }
  }

  ngOnDestroy(): void {
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
      // Defensive: the component may die mid-gesture (route change, host close).
      document.removeEventListener('pointermove', this.onDragMove);
      document.removeEventListener('pointerup', this.onDragEnd);
      document.removeEventListener('pointermove', this.onResizeMove);
      document.removeEventListener('pointerup', this.onResizeEnd);
    }
    this.stop();
  }

  /** X button: release the camera and notify the host to flip `isOpen`. */
  close(): void {
    this.stop();
    this.closed.emit();
  }

  // ── View mode: init / toggle / minimize / restore ───────────────────────
  private initView(): void {
    if (this.viewInitialized) return;
    this.viewInitialized = true;
    const saved = this.loadView();
    if (saved) {
      this.displayMode.set(saved.mode);
      this.minimized.set(!!saved.minimized);
      if (saved.pos) this.pos.set(saved.pos);
      if (saved.size) this.size.set(saved.size);
      // Re-clamp in case the viewport changed since last session.
      this.pos.set(this.clampPos(this.pos().x, this.pos().y));
    } else {
      this.displayMode.set(this.defaultMode());
    }
  }

  toggleMode(): void {
    const next: ScannerViewMode = this.displayMode() === 'fullscreen' ? 'floating' : 'fullscreen';
    this.displayMode.set(next);
    if (next === 'floating') {
      this.minimized.set(false);
      this.pos.set(this.clampPos(this.pos().x, this.pos().y));
    }
    this.persistView();
  }

  minimize(): void {
    this.minimized.set(true);
    this.pos.set(this.clampPos(this.pos().x, this.pos().y));
    this.persistView();
  }

  restore(): void {
    this.minimized.set(false);
    this.pos.set(this.clampPos(this.pos().x, this.pos().y));
    this.persistView();
  }

  private clampPos(x: number, y: number): { x: number; y: number } {
    if (typeof window === 'undefined') return { x, y };
    const w = this.minimized() ? this.bubblePx : this.size().w;
    const h = this.minimized() ? this.bubblePx : this.size().h;
    const maxX = Math.max(0, window.innerWidth - w);
    const maxY = Math.max(0, window.innerHeight - h);
    return { x: Math.min(Math.max(0, x), maxX), y: Math.min(Math.max(0, y), maxY) };
  }

  // ── Drag (window header + minimized bubble) ─────────────────────────────
  private drag: { px: number; py: number; ox: number; oy: number; moved: boolean } | null = null;

  onPointerDownHeader(ev: PointerEvent): void {
    if (this.displayMode() !== 'floating') return; // fullscreen never drags
    ev.preventDefault();
    const p = this.pos();
    this.drag = { px: ev.clientX, py: ev.clientY, ox: p.x, oy: p.y, moved: false };
    document.addEventListener('pointermove', this.onDragMove);
    document.addEventListener('pointerup', this.onDragEnd);
  }
  private onDragMove = (ev: PointerEvent): void => {
    if (!this.drag) return;
    const dx = ev.clientX - this.drag.px;
    const dy = ev.clientY - this.drag.py;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) this.drag.moved = true;
    this.pos.set(this.clampPos(this.drag.ox + dx, this.drag.oy + dy));
  };
  private onDragEnd = (): void => {
    const moved = this.drag?.moved ?? false;
    this.drag = null;
    document.removeEventListener('pointermove', this.onDragMove);
    document.removeEventListener('pointerup', this.onDragEnd);
    // A tap (no real movement) on the minimized bubble restores the window.
    if (!moved && this.minimized()) { this.restore(); return; }
    this.persistView();
  };

  // ── Resize (bottom-right corner of the floating window) ─────────────────
  private rez: { px: number; py: number; ow: number; oh: number } | null = null;

  onPointerDownResize(ev: PointerEvent): void {
    if (this.displayMode() !== 'floating' || this.minimized()) return;
    ev.preventDefault();
    ev.stopPropagation();
    const s = this.size();
    this.rez = { px: ev.clientX, py: ev.clientY, ow: s.w, oh: s.h };
    document.addEventListener('pointermove', this.onResizeMove);
    document.addEventListener('pointerup', this.onResizeEnd);
  }
  private onResizeMove = (ev: PointerEvent): void => {
    if (!this.rez) return;
    const rawW = this.rez.ow + (ev.clientX - this.rez.px);
    const rawH = this.rez.oh + (ev.clientY - this.rez.py);
    const maxW = typeof window !== 'undefined' ? window.innerWidth - this.pos().x : rawW;
    const maxH = typeof window !== 'undefined' ? window.innerHeight - this.pos().y : rawH;
    this.size.set({
      w: Math.min(Math.max(this.minW, rawW), maxW),
      h: Math.min(Math.max(this.minH, rawH), maxH),
    });
  };
  private onResizeEnd = (): void => {
    this.rez = null;
    document.removeEventListener('pointermove', this.onResizeMove);
    document.removeEventListener('pointerup', this.onResizeEnd);
    this.persistView();
  };

  // ── Persistence (per-device) ────────────────────────────────────────────
  private loadView(): { mode: ScannerViewMode; minimized: boolean; pos?: { x: number; y: number }; size?: { w: number; h: number } } | null {
    try {
      if (typeof localStorage === 'undefined') return null;
      const raw = localStorage.getItem(AforoQrScannerComponent.VIEW_STORAGE_KEY);
      if (!raw) return null;
      const p = JSON.parse(raw);
      if (p?.mode !== 'fullscreen' && p?.mode !== 'floating') return null;
      return p;
    } catch { return null; }
  }
  private persistView(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(
        AforoQrScannerComponent.VIEW_STORAGE_KEY,
        JSON.stringify({ mode: this.displayMode(), minimized: this.minimized(), pos: this.pos(), size: this.size() }),
      );
    } catch { /* private mode / quota — ignore */ }
  }

  private async start(): Promise<void> {
    if (this.controls || this.starting || this.decoded || !this.isOpen()) return;

    const video = this.videoRef()?.nativeElement;
    if (!video) {
      // View not painted yet; retry on the next microtask (bounded).
      if (this.startAttempts++ < 30) queueMicrotask(() => this.start());
      return;
    }

    this.starting = true;
    try {
      const zxing = await import('@zxing/browser');
      // The overlay may have been closed (or already decoded) while the chunk
      // was loading — bail out without touching the camera.
      if (!this.isOpen() || this.decoded) {
        this.starting = false;
        return;
      }

      const reader = new zxing.BrowserQRCodeReader();
      this.reader = reader;

      const controls = await reader.decodeFromConstraints(
        { video: { facingMode: 'environment' } },
        video,
        (result, _error, ctrls) => {
          // `_error` is a NotFoundException for frames without a QR — expected,
          // ignored. Act only on a real decode.
          if (!result) return;
          const text = result.getText();

          // Kiosk / continuous: emit and keep scanning (debounced), never close.
          if (this.continuous()) {
            this.handleContinuousDecode(text);
            return;
          }

          // Single-shot (original behavior): decode once → stop → close.
          if (this.decoded) return;
          this.decoded = true;
          try {
            ctrls.stop();
          } catch {
            /* already stopped */
          }
          this.controls = null;
          this.emitDecoded(text);
        },
      );

      // If a single-shot decode fired or we were closed during setup, stop the
      // freshly created controls immediately; otherwise keep them for cleanup.
      if (this.decoded || !this.isOpen()) {
        try {
          controls.stop();
        } catch {
          /* noop */
        }
        this.controls = null;
      } else {
        this.controls = controls;
      }
    } catch (err) {
      this.handleCameraError(err);
    } finally {
      this.starting = false;
    }
  }

  private emitDecoded(text: string): void {
    this.scanned.emit(text);
    this.closed.emit();
  }

  /**
   * Continuous (kiosk) decode: emit `scanned` for a fresh code, keep the camera
   * running, and debounce repeats of the SAME code within the cooldown window so
   * a QR held in frame is not read many times per second. A different code is
   * emitted immediately.
   */
  private handleContinuousDecode(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    const now = Date.now();
    if (
      trimmed === this.lastDecodedText &&
      now - this.lastDecodedAt < AforoQrScannerComponent.CONTINUOUS_COOLDOWN_MS
    ) {
      return;
    }
    this.lastDecodedText = trimmed;
    this.lastDecodedAt = now;
    // Do NOT emit `closed`: the overlay stays open and the loop keeps decoding.
    this.scanned.emit(trimmed);
  }

  private stop(): void {
    this.startAttempts = 0;
    if (this.controls) {
      try {
        this.controls.stop();
      } catch {
        /* already stopped */
      }
      this.controls = null;
    }
    this.reader = null;
  }

  private handleCameraError(err: unknown): void {
    this.stop();
    const name = (err as { name?: string } | null)?.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      this.errorMessage.set(
        'Permiso de cámara denegado. Habilítalo en el navegador para escanear.',
      );
    } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      this.errorMessage.set('No se encontró una cámara disponible en el dispositivo.');
    } else {
      this.errorMessage.set('No pudimos iniciar la cámara. Inténtalo de nuevo.');
    }
  }
}
