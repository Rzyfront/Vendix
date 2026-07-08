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
      <div class="scanner-overlay">
        <!-- Camera preview (always present while open, even in the error state) -->
        <video
          #videoEl
          class="scanner-video"
          autoplay
          playsinline
          muted
        ></video>

        <!-- Top bar -->
        <div class="scanner-topbar">
          <button
            type="button"
            class="scanner-close"
            (click)="close()"
            aria-label="Cerrar escáner"
          >
            <app-icon name="x" [size]="22" />
          </button>
        </div>

        @if (errorMessage()) {
          <div class="scanner-error-wrap">
            <div class="scanner-error">
              <app-icon name="alert-triangle" [size]="22" />
              <p>{{ errorMessage() }}</p>
              <button type="button" class="scanner-error-btn" (click)="close()">
                Cerrar
              </button>
            </div>
          </div>
        } @else {
          <!-- Framing brackets + animated scanline -->
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
      </div>
    }
  `,
})
export class AforoQrScannerComponent implements OnDestroy {
  /** Drives the whole camera lifecycle: true opens + scans, false releases. */
  readonly isOpen = input<boolean>(false);

  /** Raw text of the first decoded QR code. */
  readonly scanned = output<string>();
  /** Fired when the overlay closes (auto-close after scan, X, or error). */
  readonly closed = output<void>();

  /** User-facing error shown inside the overlay (permission/hardware issues). */
  readonly errorMessage = signal<string | null>(null);

  private readonly videoRef = viewChild<ElementRef<HTMLVideoElement>>('videoEl');

  private reader: BrowserQRCodeReader | null = null;
  private controls: IScannerControls | null = null;
  private starting = false;
  private decoded = false;
  private startAttempts = 0;

  constructor() {
    // React to open/close transitions. On open, defer the start so the @if view
    // (and its <video>) has a chance to render; start() retries until it exists.
    effect(() => {
      if (this.isOpen()) {
        this.decoded = false;
        this.startAttempts = 0;
        this.errorMessage.set(null);
        queueMicrotask(() => this.start());
      } else {
        this.stop();
      }
    });
  }

  ngOnDestroy(): void {
    this.stop();
  }

  /** X button: release the camera and notify the host to flip `isOpen`. */
  close(): void {
    this.stop();
    this.closed.emit();
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
          // ignored. Act only on the first real decode.
          if (!result || this.decoded) return;
          this.decoded = true;
          try {
            ctrls.stop();
          } catch {
            /* already stopped */
          }
          this.controls = null;
          this.emitDecoded(result.getText());
        },
      );

      // If a decode fired or we were closed during setup, stop the freshly
      // created controls immediately; otherwise keep them for later cleanup.
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
