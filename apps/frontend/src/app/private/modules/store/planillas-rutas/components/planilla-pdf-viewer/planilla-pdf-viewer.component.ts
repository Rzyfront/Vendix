import {
  Component,
  DestroyRef,
  OnDestroy,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { PlanillasRutasService } from '../../services/planillas-rutas.service';

/**
 * Modal viewer for a planilla PDF. Uses signal-based inputs/outputs (zoneless
 * clean) and a `viewChild()` for the iframe (no `document.querySelector`).
 *
 * Replaces the legacy `@Input`/`@Output` decorators (which violated the
 * `vendix-zoneless-signals` CORE rule) with signal inputs and signal outputs.
 */
@Component({
  selector: 'app-planilla-pdf-viewer',
  standalone: true,
  template: `
    <div
      class="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-2 md:p-4"
      (click)="onBackdropClick()"
    >
      <div
        class="bg-background rounded-2xl w-full max-w-4xl h-[95vh] flex flex-col"
        (click)="$event.stopPropagation()"
      >
        <div class="p-3 border-b border-border flex justify-between items-center">
          <h2 class="text-lg font-semibold">Planilla PDF</h2>
          <div class="flex gap-2">
            @if (pdfUrl()) {
              <a
                [href]="pdfUrl()"
                [download]="'planilla-' + routeId() + '.pdf'"
                class="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm"
              >Descargar</a>
            }
            <button
              (click)="onClose()"
              class="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
            >Cerrar</button>
          </div>
        </div>
        <div class="flex-1 overflow-hidden">
          @if (loading()) {
            <div class="flex items-center justify-center h-full">Cargando PDF...</div>
          } @else if (pdfUrl()) {
            <iframe
              #pdfIframe
              [src]="pdfUrl()"
              class="w-full h-full"
              frameborder="0"
            ></iframe>
          } @else if (error()) {
            <div class="flex items-center justify-center h-full text-red-500">
              {{ error() }}
            </div>
          }
        </div>
      </div>
    </div>
  `,
})
export class PlanillaPdfViewerComponent implements OnDestroy {
  readonly routeId = input.required<number>();
  readonly close = output<void>();

  readonly pdfIframe = viewChild<ElementRef<HTMLIFrameElement>>('pdfIframe');

  private readonly service = inject(PlanillasRutasService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly destroyRef = inject(DestroyRef);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly pdfUrl = signal<SafeResourceUrl | null>(null);

  private blobUrl: string | null = null;

  constructor() {
    this.load();
  }

  private load() {
    this.loading.set(true);
    this.error.set(null);
    this.service
      .downloadPdf(this.routeId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blob) => {
          // Revoke the previous blob URL if any, to avoid memory leaks.
          if (this.blobUrl) {
            URL.revokeObjectURL(this.blobUrl);
          }
          this.blobUrl = URL.createObjectURL(blob);
          this.pdfUrl.set(
            this.sanitizer.bypassSecurityTrustResourceUrl(this.blobUrl),
          );
          this.loading.set(false);
        },
        error: (e) => {
          this.error.set(e?.message || 'No se pudo cargar el PDF');
          this.loading.set(false);
        },
      });
  }

  onBackdropClick(): void {
    this.close.emit();
  }

  onClose(): void {
    this.close.emit();
  }

  ngOnDestroy(): void {
    if (this.blobUrl) {
      URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = null;
    }
  }
}
