import {
  Component,
  EventEmitter,
  Input,
  OnDestroy,
  Output,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { PlanillasRutasService } from '../../services/planillas-rutas.service';
import { DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-planilla-pdf-viewer',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div
      class="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-2 md:p-4"
      (click)="close.emit()"
    >
      <div
        class="bg-background rounded-2xl w-full max-w-4xl h-[95vh] flex flex-col"
        (click)="$event.stopPropagation()"
      >
        <div class="p-3 border-b border-border flex justify-between items-center">
          <h2 class="text-lg font-semibold">Planilla PDF</h2>
          <div class="flex gap-2">
            <a
              *ngIf="pdfUrl()"
              [href]="pdfUrl()"
              [download]="'planilla-' + routeId + '.pdf'"
              class="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm"
            >Descargar</a>
            <button
              (click)="close.emit()"
              class="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
            >Cerrar</button>
          </div>
        </div>
        <div class="flex-1 overflow-hidden">
          @if (loading()) {
            <div class="flex items-center justify-center h-full">Cargando PDF...</div>
          } @else if (pdfUrl()) {
            <iframe
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
  @Input({ required: true }) routeId!: number;
  @Output() close = new EventEmitter<void>();

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

  load() {
    this.loading.set(true);
    this.service
      .getPdfBlob(this.routeId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blob) => {
          this.blobUrl = URL.createObjectURL(blob);
          this.pdfUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(this.blobUrl));
          this.loading.set(false);
        },
        error: (e) => {
          this.error.set(e.message);
          this.loading.set(false);
        },
      });
  }

  ngOnDestroy() {
    if (this.blobUrl) URL.revokeObjectURL(this.blobUrl);
  }
}
