import {
  Component,
  inject,
  input,
  output,
  signal,
  computed,
  HostListener,
  ElementRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { PrintGatewayClientService } from '../../../../../../../shared/services/print/print-gateway-client.service';
import { PrintRecentDocument } from '../../../../../../../core/models/print-formats.model';

/**
 * [print-editor-dsk P3.3] — Sample picker (split button).
 *
 * Lets the merchant swap the preview's sample data between the fabricated
 * `getSampleData()` payload (default) and one of up to 20 recent real
 * documents returned by `GET /store/print-formats/:formatType/documents`.
 *
 * Visual: a primary "Sample data" button (click = clear, label flips to
 * "Sample data" again) paired with a chevron that opens a dropdown listing
 * the recent documents. Picking a row emits `(documentSelected)` with the
 * `id` so the facade can call `previewFormat(_, _, id)`.
 *
 * Documents are lazy-loaded on first open (and cached per-format) so the
 * editor does not pay the HTTP cost upfront when the merchant never opens
 * the dropdown.
 */
@Component({
  selector: 'app-print-sample-picker',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
    <div class="relative inline-block">
      <!-- Split button -->
      <div class="flex items-stretch rounded-lg overflow-hidden border border-border bg-surface-secondary">
        <button
          type="button"
          class="px-3 py-1.5 text-xs font-medium text-text-primary hover:bg-surface-hover transition flex items-center gap-2"
          (click)="clearSelection()"
          [title]="selectedDocumentId() === null ? 'Usando datos de muestra fabricados' : 'Volver a los datos de muestra fabricados'"
        >
          <app-icon name="file-text" [size]="13" class="text-text-secondary"></app-icon>
          {{ selectedDocumentId() === null ? 'Sample data' : 'Doc #' + selectedDocumentId() }}
        </button>
        <button
          type="button"
          class="px-2 py-1.5 text-xs text-text-secondary hover:bg-surface-hover transition border-l border-border"
          (click)="toggle()"
          [attr.aria-expanded]="isOpen()"
          aria-haspopup="listbox"
          title="Elegir un documento real"
        >
          <app-icon name="chevron-down" [size]="13"></app-icon>
        </button>
      </div>

      <!-- Dropdown -->
      @if (isOpen()) {
        <div
          class="absolute right-0 mt-2 w-80 bg-surface border border-border rounded-xl shadow-2xl z-30 overflow-hidden"
          role="listbox"
        >
          <div class="px-3 py-2 border-b border-border bg-surface-secondary">
            <span class="text-[10px] font-bold uppercase tracking-wider text-text-secondary">
              Documentos recientes ({{ documents().length }})
            </span>
          </div>

          @if (isLoading()) {
            <div class="px-3 py-4 text-xs text-text-tertiary animate-pulse">
              Cargando documentos...
            </div>
          } @else if (documents().length === 0) {
            <div class="px-3 py-4 text-xs text-text-tertiary text-center border-t border-dashed border-border">
              Aún no hay documentos para este formato.
            </div>
          } @else {
            <div class="max-h-72 overflow-y-auto">
              @for (doc of documents(); track doc.id) {
                <button
                  type="button"
                  class="w-full text-left px-3 py-2 hover:bg-surface-hover transition flex items-center justify-between gap-2 border-b border-border/40 last:border-0"
                  [class.bg-primary-500/10]="doc.id === selectedDocumentId()"
                  (click)="pick(doc)"
                  role="option"
                  [attr.aria-selected]="doc.id === selectedDocumentId()"
                >
                  <div class="min-w-0 flex-1">
                    <div class="text-xs font-medium text-text-primary truncate">
                      #{{ doc.number || doc.id }} {{ doc.customer_name ? '— ' + doc.customer_name : '' }}
                    </div>
                    <div class="text-[10px] text-text-tertiary mt-0.5">
                      {{ doc.date || '—' }} · {{ formatTotal(doc.total) }}
                    </div>
                  </div>
                  @if (doc.id === selectedDocumentId()) {
                    <app-icon name="check-circle" [size]="13" class="text-primary-500 flex-shrink-0"></app-icon>
                  }
                </button>
              }
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    :host {
      display: inline-block;
    }
  `],
})
export class PrintSamplePickerComponent {
  private readonly gatewayClient = inject(PrintGatewayClientService);
  private readonly elementRef = inject(ElementRef<HTMLElement>);

  readonly formatType = input.required<string>();
  readonly selectedDocumentId = input<number | null>(null);

  /**
   * Emitted when the merchant picks a real document. `null` means "revert to
   * fabricated sample data" — the facade's `refreshPreview` will then call
   * `previewFormat` without a `sample_document_id`.
   */
  readonly documentSelected = output<{ id: number | null }>();

  private readonly _isOpen = signal<boolean>(false);
  private readonly _isLoading = signal<boolean>(false);
  private readonly _documents = signal<PrintRecentDocument[]>([]);
  private readonly _loadedFormatType = signal<string | null>(null);

  readonly isOpen = this._isOpen.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();
  readonly documents = this._documents.asReadonly();

  readonly hasDocuments = computed(() => this._documents().length > 0);

  constructor() {
    // No automatic load — documents fetch on first `toggle()` so we never
    // pay the HTTP cost when the merchant never opens the dropdown.
  }

  toggle(): void {
    const willOpen = !this._isOpen();
    this._isOpen.set(willOpen);
    if (willOpen) {
      void this.fetchIfNeeded();
    }
  }

  clearSelection(): void {
    this.documentSelected.emit({ id: null });
    this._isOpen.set(false);
  }

  pick(doc: PrintRecentDocument): void {
    this.documentSelected.emit({ id: doc.id });
    this._isOpen.set(false);
  }

  formatTotal(value?: number | null): string {
    if (value === null || value === undefined) return '—';
    try {
      return new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: 'COP',
        maximumFractionDigits: 0,
      }).format(value);
    } catch {
      return String(value);
    }
  }

  private async fetchIfNeeded(): Promise<void> {
    const ft = this.formatType();
    if (!ft || this._loadedFormatType() === ft) return;
    this._isLoading.set(true);
    try {
      const docs = await firstValueFrom(this.gatewayClient.getRecentDocuments(ft as any, 20));
      this._documents.set(docs ?? []);
      this._loadedFormatType.set(ft);
    } catch {
      this._documents.set([]);
    } finally {
      this._isLoading.set(false);
    }
  }

  /** Close the dropdown when clicking outside. */
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this._isOpen()) return;
    const target = event.target as Node;
    if (this.elementRef.nativeElement.contains(target)) return;
    this._isOpen.set(false);
  }
}