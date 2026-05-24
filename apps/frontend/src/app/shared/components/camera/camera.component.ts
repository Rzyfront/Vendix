import {
  Component,
  ElementRef,
  EmbeddedViewRef,
  OnDestroy,
  Renderer2,
  TemplateRef,
  ViewContainerRef,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { IconComponent } from '../icon/icon.component';
import { ButtonComponent } from '../button/button.component';

/**
 * CameraComponent
 * Generic camera capture: mobile fullscreen (teleported to body to escape modal transform context)
 * and desktop inline. Zoneless + signals (Angular 20).
 *
 * Usage:
 *   <app-camera
 *     [isOpen]="open()"
 *     fileNamePrefix="receipt"
 *     (captured)="onCaptured($event)"
 *     (closed)="open.set(false)" />
 */
@Component({
  selector: 'app-camera',
  standalone: true,
  imports: [IconComponent, ButtonComponent],
  template: `
    <!--
      Mobile branch lives inside an <ng-template> so we can manually mount it
      into document.body. Required because <app-modal> wraps its content in a
      .transform element (Tailwind), which creates a containing block for
      position: fixed and breaks fullscreen overlays rendered inside the modal.
    -->
    <ng-template #mobileOverlayTpl>
      <div
        class="fixed inset-0 z-[10000] bg-black flex flex-col"
        style="touch-action: none; width: 100vw; height: 100vh; height: 100dvh; left: 0; top: 0;"
      >
        <video
          #videoEl
          autoplay
          playsinline
          muted
          style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; background: #000;"
        ></video>

        <!-- Top bar -->
        <div
          class="absolute top-0 left-0 right-0 flex items-center justify-between p-3 z-10"
          style="padding-top: max(0.75rem, env(safe-area-inset-top));"
        >
          <button
            type="button"
            (click)="close()"
            class="w-11 h-11 rounded-full bg-black/50 text-white flex items-center justify-center"
            style="backdrop-filter: blur(6px);"
          >
            <app-icon name="x" size="22"></app-icon>
          </button>
          @if (torchSupported()) {
            <button
              type="button"
              (click)="toggleTorch()"
              class="w-11 h-11 rounded-full bg-black/50 text-white flex items-center justify-center"
              style="backdrop-filter: blur(6px);"
            >
              <app-icon [name]="torchOn() ? 'zap' : 'zap-off'" size="22"></app-icon>
            </button>
          } @else {
            <div class="w-11 h-11"></div>
          }
        </div>

        @if (cameraError()) {
          <div class="absolute inset-0 flex items-center justify-center p-6 z-20 pointer-events-none">
            <div
              class="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700 max-w-sm flex items-start gap-2 pointer-events-auto"
            >
              <app-icon name="alert-triangle" size="16"></app-icon>
              <span>{{ cameraError() }}</span>
            </div>
          </div>
        }

        <!-- Framing brackets + thirds grid (centered overlay) -->
        <div class="absolute inset-0 pointer-events-none flex items-center justify-center">
          <div class="relative" style="width: 78%; max-width: 480px; aspect-ratio: 1;">
            <div class="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-white/90"></div>
            <div class="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-white/90"></div>
            <div class="absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 border-white/90"></div>
            <div class="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-white/90"></div>
            <div class="absolute inset-0">
              <div class="absolute top-1/3 left-0 right-0 border-t border-white/25"></div>
              <div class="absolute top-2/3 left-0 right-0 border-t border-white/25"></div>
              <div class="absolute left-1/3 top-0 bottom-0 border-l border-white/25"></div>
              <div class="absolute left-2/3 top-0 bottom-0 border-l border-white/25"></div>
            </div>
          </div>
        </div>

        <!-- Bottom bar: shutter + switch -->
        <div
          class="absolute bottom-0 left-0 right-0 pt-6 z-10"
          style="padding-bottom: max(1.75rem, env(safe-area-inset-bottom)); background: linear-gradient(to top, rgba(0,0,0,0.75), rgba(0,0,0,0));"
        >
          <div class="flex items-center justify-between px-10">
            <div class="w-12 h-12"></div>
            <button
              type="button"
              (click)="capture()"
              [disabled]="!cameraReady()"
              class="rounded-full border-4 border-white p-1.5 disabled:opacity-50 active:scale-95 transition-transform"
              style="width: 76px; height: 76px;"
              aria-label="Capturar"
            >
              <span class="block w-full h-full rounded-full bg-white"></span>
            </button>
            <button
              type="button"
              (click)="switchCamera()"
              [disabled]="!cameraReady()"
              class="w-12 h-12 rounded-full bg-black/50 text-white flex items-center justify-center disabled:opacity-50"
              style="backdrop-filter: blur(6px);"
              aria-label="Cambiar cámara"
            >
              <app-icon name="switch-camera" size="24"></app-icon>
            </button>
          </div>
        </div>
      </div>
    </ng-template>

    @if (!isMobile()) {
      <!-- Desktop: render inline inside the modal body -->
      <div class="space-y-4">
        @if (cameraError()) {
          <div
            class="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-start gap-2"
          >
            <app-icon name="alert-triangle" size="16"></app-icon>
            <span>{{ cameraError() }}</span>
          </div>
        }

        <div class="relative aspect-video w-full bg-black rounded-xl overflow-hidden">
          <video
            #videoEl
            class="w-full h-full object-contain"
            autoplay
            playsinline
            muted
          ></video>

          <!-- Small framing brackets -->
          <div class="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div class="relative" style="width: 55%; max-width: 320px; aspect-ratio: 1;">
              <div class="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 border-white/80"></div>
              <div class="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 border-white/80"></div>
              <div class="absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2 border-white/80"></div>
              <div class="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 border-white/80"></div>
            </div>
          </div>

          <!-- Top-right floating controls -->
          <div class="absolute top-2 right-2 flex gap-2">
            @if (torchSupported()) {
              <button
                type="button"
                (click)="toggleTorch()"
                class="w-9 h-9 rounded-full bg-black/50 text-white flex items-center justify-center"
              >
                <app-icon [name]="torchOn() ? 'zap' : 'zap-off'" size="18"></app-icon>
              </button>
            }
            <button
              type="button"
              (click)="switchCamera()"
              [disabled]="!cameraReady()"
              class="w-9 h-9 rounded-full bg-black/50 text-white flex items-center justify-center disabled:opacity-50"
            >
              <app-icon name="switch-camera" size="18"></app-icon>
            </button>
          </div>
        </div>

        <div class="flex justify-end gap-2">
          <app-button variant="outline" (clicked)="close()">
            <app-icon slot="icon" name="x" size="16"></app-icon>
            Cancelar
          </app-button>
          <app-button variant="primary" (clicked)="capture()" [disabled]="!cameraReady()">
            <app-icon slot="icon" name="camera" size="16"></app-icon>
            Capturar
          </app-button>
        </div>
      </div>
    }
  `,
})
export class CameraComponent implements OnDestroy {
  // Inputs
  readonly isOpen = input<boolean>(false);
  readonly fileNamePrefix = input<string>('foto');
  readonly imageQuality = input<number>(0.92);

  // Outputs
  readonly captured = output<{ dataUrl: string; fileName: string }>();
  readonly closed = output<void>();

  // State signals
  readonly cameraError = signal<string | null>(null);
  readonly cameraReady = signal(false);
  readonly facingMode = signal<'user' | 'environment'>('environment');
  readonly torchSupported = signal(false);
  readonly torchOn = signal(false);
  readonly isMobile = signal(
    typeof window !== 'undefined' ? window.innerWidth < 768 : false,
  );

  // View refs
  private readonly videoRef = viewChild<ElementRef<HTMLVideoElement>>('videoEl');
  private readonly mobileTpl = viewChild<TemplateRef<unknown>>('mobileOverlayTpl');

  // DI
  private readonly vcr = inject(ViewContainerRef);
  private readonly doc = inject(DOCUMENT);

  // Privado
  private stream: MediaStream | null = null;
  private videoTrack: MediaStreamTrack | null = null;
  private unlistenResize?: () => void;
  private mobileEmbedded?: EmbeddedViewRef<unknown>;
  private bodyOverflowPrev: string | null = null;

  constructor() {
    const renderer = inject(Renderer2);
    this.unlistenResize = renderer.listen('window', 'resize', () =>
      this.isMobile.set(window.innerWidth < 768),
    );

    // Mount/unmount mobile fullscreen overlay teleported to document.body
    effect(() => {
      const active = this.isMobile() && this.isOpen();
      if (active) this.mountMobileOverlay();
      else this.unmountMobileOverlay();
    });

    // Stream lifecycle tied to isOpen
    effect(() => {
      if (this.isOpen()) {
        queueMicrotask(() => this.startStream());
      } else {
        this.stopStream();
      }
    });

    // Restart stream when facingMode flips
    effect(() => {
      this.facingMode();
      if (this.isOpen() && this.stream) this.restartStream();
    });
  }

  ngOnDestroy(): void {
    this.unmountMobileOverlay();
    this.stopStream();
    this.unlistenResize?.();
  }

  private mountMobileOverlay(): void {
    if (this.mobileEmbedded) return;
    const tpl = this.mobileTpl();
    if (!tpl) {
      // Template not ready yet; try next microtask
      queueMicrotask(() => this.mountMobileOverlay());
      return;
    }
    this.mobileEmbedded = this.vcr.createEmbeddedView(tpl);
    this.mobileEmbedded.detectChanges();
    for (const node of this.mobileEmbedded.rootNodes) {
      if (node instanceof Node) this.doc.body.appendChild(node);
    }
    // Prevent body scroll while overlay is active
    this.bodyOverflowPrev = this.doc.body.style.overflow;
    this.doc.body.style.overflow = 'hidden';
  }

  private unmountMobileOverlay(): void {
    if (!this.mobileEmbedded) return;
    this.mobileEmbedded.destroy();
    this.mobileEmbedded = undefined;
    if (this.bodyOverflowPrev !== null) {
      this.doc.body.style.overflow = this.bodyOverflowPrev;
      this.bodyOverflowPrev = null;
    }
  }

  private async startStream(): Promise<void> {
    this.cameraError.set(null);
    this.cameraReady.set(false);
    if (!navigator.mediaDevices?.getUserMedia) {
      this.cameraError.set('Este navegador no soporta acceso a la cámara');
      return;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: this.facingMode() },
        audio: false,
      });
      this.videoTrack = this.stream.getVideoTracks()[0] ?? null;
      this.detectTorchSupport(this.videoTrack);
      const v = this.videoRef()?.nativeElement;
      if (v) {
        v.srcObject = this.stream;
        v.onloadedmetadata = () => this.cameraReady.set(true);
      }
    } catch (err: any) {
      this.cameraError.set(
        err?.name === 'NotAllowedError'
          ? 'Permiso de cámara denegado'
          : 'No pudimos acceder a la cámara',
      );
    }
  }

  private async restartStream(): Promise<void> {
    this.stopStream();
    await this.startStream();
  }

  private stopStream(): void {
    if (this.stream) {
      for (const t of this.stream.getTracks()) t.stop();
      this.stream = null;
    }
    this.videoTrack = null;
    const v = this.videoRef()?.nativeElement;
    if (v) v.srcObject = null;
    this.cameraReady.set(false);
    this.torchOn.set(false);
  }

  switchCamera(): void {
    this.torchOn.set(false);
    this.torchSupported.set(false);
    this.facingMode.update((v) => (v === 'user' ? 'environment' : 'user'));
  }

  async toggleTorch(): Promise<void> {
    if (!this.videoTrack || !this.torchSupported()) return;
    const next = !this.torchOn();
    try {
      await this.videoTrack.applyConstraints({ advanced: [{ torch: next } as any] });
      this.torchOn.set(next);
    } catch {
      this.torchSupported.set(false);
    }
  }

  private detectTorchSupport(track: MediaStreamTrack | null): void {
    const caps = (track?.getCapabilities?.() ?? {}) as any;
    this.torchSupported.set(!!caps.torch);
    this.torchOn.set(false);
  }

  capture(): void {
    const v = this.videoRef()?.nativeElement;
    if (!v || !v.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', this.imageQuality());
    const fileName = `${this.fileNamePrefix()}-${Date.now()}.jpg`;
    this.stopStream();
    this.captured.emit({ dataUrl, fileName });
  }

  close(): void {
    this.closed.emit();
  }
}
