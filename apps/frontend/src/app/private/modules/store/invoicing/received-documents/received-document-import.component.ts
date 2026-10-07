import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EMPTY, Subscription, finalize, map, switchMap, takeUntil, takeWhile, timer } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { ModalComponent } from '../../../../../shared/components/modal/modal.component';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { SubscriptionAccessService } from '../../../../../core/services/subscription-access.service';
import { OrganizationStoresService } from '../../../organization/stores/services/organization-stores.service';
import type { StoreListItem } from '../../../organization/stores/interfaces/store.interface';
import { describeApiFailure } from '../utils/invoicing-errors.util';
import type { ReceivedDocumentScanStatus, ReceivedDocumentsScope } from './received-documents.interface';
import { ReceivedDocumentsService } from './received-documents.service';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_POLL_DURATION_MS = 10 * 60 * 1000;
const POLL_INTERVAL_MS = 2500;
const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

@Component({
  selector: 'app-received-document-import',
  standalone: true,
  imports: [ModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal
      [(isOpen)]="isOpen"
      title="Escanear documento de proveedor"
      subtitle="PDF o foto · hasta 10 MiB · la revisión sigue siendo manual"
      [size]="'lg'"
      [fullScreenOnMobile]="true"
      [dialog]="true"
      [canClose]="canClose"
      (closed)="onClosed()"
    >
      <div class="space-y-4">
        <p class="text-sm text-text-secondary">La lectura propone datos para revisión. No acepta documentos, confirma recepción ni contabiliza.</p>

        @if (scope() === 'organization' && selectedStoreId() == null) {
          <div class="space-y-2 rounded-lg border border-border bg-surface p-3">
            <label for="received-operational-store" class="block text-sm font-medium text-text-primary">Tienda operativa para cargar y facturar el uso de IA</label>
            <select
              id="received-operational-store"
              class="min-h-11 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary"
              [value]="operationalStoreId() ?? ''"
              [disabled]="storeLoading() || polling() || uploading()"
              (change)="onOperationalStoreChange($event)"
            >
              <option value="">Selecciona una tienda</option>
              @for (store of stores(); track store.id) { <option [value]="store.id">{{ store.name }}</option> }
            </select>
            @if (storeLoading()) { <p class="text-sm text-text-secondary" role="status">Cargando tiendas…</p> }
            @if (storeLoadError()) {
              <div class="flex items-center justify-between gap-2 text-sm text-error" role="alert">
                <span>{{ storeLoadError() }}</span><button class="min-h-11 rounded-lg border border-border px-3" type="button" (click)="loadStores()">Reintentar</button>
              </div>
            }
            @if (storesLoaded() && stores().length === 0 && !storeLoadError()) {
              <p class="text-sm text-warning" role="status">No hay tiendas activas disponibles para esta lectura.</p>
            }
          </div>
        }

        <div class="space-y-2">
          <label for="received-scan-file" class="block text-sm font-medium text-text-primary">Archivo original (PDF, PNG, JPEG o WebP)</label>
          <input
            id="received-scan-file"
            class="block min-h-11 w-full cursor-pointer rounded-lg border border-border bg-background text-sm text-text-primary file:mr-3 file:min-h-11 file:border-0 file:bg-surface file:px-4 file:font-medium"
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp"
            capture="environment"
            [disabled]="uploading() || polling()"
            (change)="onFileSelected($event)"
            aria-describedby="received-scan-file-help"
          />
          <p id="received-scan-file-help" class="text-xs text-text-secondary">El archivo se conserva sin modificar como evidencia. PDF de hasta 10 páginas; la imagen original nunca se reemplaza.</p>
          @if (selectedFile(); as selected) {
            <p class="break-all text-sm text-text-secondary">{{ selected.name }} · {{ formatBytes(selected.size) }}</p>
          }
        </div>

        @if (error()) { <div class="rounded-lg border border-error/30 bg-error-light p-3 text-sm text-error" role="alert">{{ error() }}</div> }
        @if (polling()) {
          <div class="flex items-center gap-3 rounded-lg border border-border bg-surface p-3 text-sm text-text-primary" role="status" aria-live="polite">
            <span class="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-hidden="true"></span>
            <span>Documento guardado. Leyendo páginas…</span>
          </div>
          <p class="text-xs text-text-secondary">Puedes cerrar esta ventana; el trabajo continúa en segundo plano.</p>
        }
        @if (timedOut()) {
          <div class="rounded-lg border border-warning/30 bg-warning-light p-3 text-sm text-text-primary" role="status">
            La lectura continúa en segundo plano. Consulta la bandeja en unos minutos; el documento original ya está guardado.
          </div>
        }

        <div slot="footer" class="flex flex-col-reverse justify-end gap-2 sm:flex-row">
          <button type="button" class="min-h-11 rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-primary hover:bg-surface" [disabled]="uploading()" (click)="requestClose()">Cerrar</button>
          @if (jobId() && !polling() && !scanFailed() && !timedOut()) {
            <button type="button" class="min-h-11 rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-primary hover:bg-surface" (click)="resumePolling()">Volver a consultar</button>
          }
          <button type="button" class="min-h-11 rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50" [disabled]="!canSubmit()" (click)="submit()">
            {{ uploading() ? 'Guardando…' : scanFailed() ? 'Reintentar lectura' : 'Guardar y escanear' }}
          </button>
        </div>
      </div>
    </app-modal>
  `,
})
export class ReceivedDocumentImportComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly documents = inject(ReceivedDocumentsService);
  private readonly organizationStores = inject(OrganizationStoresService);
  private readonly toast = inject(ToastService);
  private readonly subscriptionAccess = inject(SubscriptionAccessService);

  readonly scope = input.required<ReceivedDocumentsScope>();
  readonly selectedStoreId = input<number | null>(null);
  readonly isOpen = model(false);
  readonly completed = output<number>();

  readonly selectedFile = signal<File | null>(null);
  readonly error = signal<string | null>(null);
  readonly uploading = signal(false);
  readonly polling = signal(false);
  readonly jobPending = signal(false);
  readonly scanFailed = signal(false);
  readonly timedOut = signal(false);
  readonly documentId = signal<number | null>(null);
  readonly jobId = signal<string | null>(null);
  readonly operationalStoreId = signal<number | null>(null);
  readonly stores = signal<StoreListItem[]>([]);
  readonly storesLoaded = signal(false);
  readonly storeLoading = signal(false);
  readonly storeLoadError = signal<string | null>(null);
  readonly canClose = () => !this.uploading();
  readonly canSubmit = computed(() =>
    this.selectedFile() !== null &&
    !this.uploading() &&
    !this.polling() &&
    (!this.jobId() || this.scanFailed()) &&
    (!this.requiresOperationalStore() || this.hasOperationalStore()),
  );

  private uploadSubscription?: Subscription;
  private pollSubscription?: Subscription;
  private storeSubscription?: Subscription;
  private sessionSequence = 0;
  private pollSequence = 0;
  private capturedScope: ReceivedDocumentsScope | null = null;
  private capturedHostStoreId: number | null = null;
  private capturedRequestStoreId: number | undefined;

  private readonly requiresOperationalStore = computed(() => this.scope() === 'organization' && this.selectedStoreId() == null);
  private readonly hasOperationalStore = computed(() => {
    const id = this.operationalStoreId();
    return id !== null && this.stores().some((store) => store.id === id && store.is_active !== false);
  });

  constructor() {
    effect(() => {
      const open = this.isOpen();
      const scope = this.scope();
      const hostStoreId = this.selectedStoreId();
      untracked(() => {
        if (!open) {
          this.closeSession();
          return;
        }
        if (scope === 'organization' && hostStoreId == null && !this.storesLoaded() && !this.storeLoading()) {
          this.loadStores();
        }
      });
    });

    effect(() => {
      const scope = this.scope();
      const storeId = this.selectedStoreId() ?? null;
      untracked(() => {
        if (this.capturedScope === null || (scope === this.capturedScope && storeId === this.capturedHostStoreId)) return;
        if (this.jobPending()) this.toast.info('La tienda cambió. El trabajo puede continuar en segundo plano; consulta la bandeja anterior.');
        this.resetSession();
      });
    });

    this.destroyRef.onDestroy(() => this.resetSession());
  }

  loadStores(): void {
    if (this.storeLoading()) return;
    this.storeSubscription?.unsubscribe();
    this.storeLoading.set(true);
    this.storeLoadError.set(null);
    this.storeSubscription = this.organizationStores.getStores({ limit: 200 }).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.storeLoading.set(false)),
    ).subscribe({
      next: (response) => {
        const rows = (response?.data ?? []) as unknown as StoreListItem[];
        this.stores.set(rows.filter((store) => store?.is_active !== false && Number.isSafeInteger(store?.id) && store.id > 0));
        this.storesLoaded.set(true);
        if (this.operationalStoreId() !== null && !this.hasOperationalStore()) this.operationalStoreId.set(null);
      },
      error: (err: unknown) => {
        this.storeLoadError.set(describeApiFailure(err).message || 'No se pudieron cargar las tiendas activas.');
      },
    });
  }

  onOperationalStoreChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    const storeId = Number(value);
    const exists = this.stores().some((store) => store.id === storeId && store.is_active !== false);
    this.operationalStoreId.set(Number.isSafeInteger(storeId) && storeId > 0 && exists ? storeId : null);
    this.error.set(null);
  }

  onFileSelected(event: Event): void {
    const inputElement = event.target as HTMLInputElement;
    const file = inputElement.files?.[0] ?? null;
    inputElement.value = '';
    this.error.set(null);
    this.selectedFile.set(null);
    this.scanFailed.set(false);
    this.timedOut.set(false);
    if (!file) return;
    const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!MIME_BY_EXTENSION[extension] || MIME_BY_EXTENSION[extension] !== file.type.toLowerCase()) {
      this.error.set('Selecciona un archivo con extensión y tipo PDF, PNG, JPEG o WebP válidos.');
      return;
    }
    if (file.size <= 0 || file.size > MAX_FILE_BYTES) {
      this.error.set('El archivo debe pesar más de 0 y como máximo 10 MiB.');
      return;
    }
    this.selectedFile.set(file);
  }

  submit(): void {
    const selectedFile = this.selectedFile();
    if (!selectedFile || !this.canSubmit()) return;
    this.error.set(null);
    this.timedOut.set(false);
    this.scanFailed.set(false);
    this.jobPending.set(false);
    this.jobId.set(null);
    this.documentId.set(null);
    this.capturedScope = this.scope();
    this.capturedHostStoreId = this.selectedStoreId();
    this.capturedRequestStoreId = this.scope() === 'organization'
      ? this.selectedStoreId() ?? this.operationalStoreId() ?? undefined
      : undefined;
    const sequence = ++this.sessionSequence;
    this.uploading.set(true);
    this.uploadSubscription?.unsubscribe();
    this.uploadSubscription = this.documents.scan(this.scope(), selectedFile, this.capturedRequestStoreId).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => {
        if (sequence === this.sessionSequence) this.uploading.set(false);
      }),
    ).subscribe({
      next: (response) => {
        if (sequence !== this.sessionSequence) return;
        const result = response.data;
        this.documentId.set(result.document_id);
        if (result.already_processed) {
          this.finish(result.document_id);
          return;
        }
        if (!result.job_id) {
          this.error.set('El documento se guardó, pero no se recibió un identificador de lectura. Consulta la bandeja.');
          return;
        }
        this.jobId.set(result.job_id);
        this.jobPending.set(true);
        this.startPolling();
      },
      error: (err: unknown) => {
        if (sequence === this.sessionSequence) this.error.set(describeApiFailure(err).message || 'No se pudo iniciar la lectura del documento.');
      },
    });
  }

  resumePolling(): void {
    if (this.jobId() && !this.polling()) this.startPolling();
  }

  requestClose(): void {
    if (!this.uploading()) this.isOpen.set(false);
  }

  onClosed(): void {
    this.closeSession();
  }

  formatBytes(size: number): string {
    return `${(size / (1024 * 1024)).toFixed(2)} MiB`;
  }

  private startPolling(): void {
    const jobId = this.jobId();
    const documentId = this.documentId();
    if (!jobId || !documentId || this.polling()) return;
    const storeId = this.capturedRequestStoreId;
    const session = this.sessionSequence;
    const sequence = ++this.pollSequence;
    this.error.set(null);
    this.timedOut.set(false);
    this.polling.set(true);
    this.pollSubscription?.unsubscribe();
    this.pollSubscription = timer(0, POLL_INTERVAL_MS).pipe(
      switchMap(() => this.documents.getScanStatus(this.scope(), jobId, storeId).pipe(map((response) => response.data))),
      takeWhile((status) => !this.isTerminal(status), true),
      takeUntil(timer(MAX_POLL_DURATION_MS).pipe(map(() => {
        if (session === this.sessionSequence && sequence === this.pollSequence && this.polling()) {
          this.polling.set(false);
          this.timedOut.set(true);
        }
      }))),
      takeUntilDestroyed(this.destroyRef),
      catchError((err: unknown) => {
        if (session === this.sessionSequence && sequence === this.pollSequence) {
          this.polling.set(false);
          this.error.set(describeApiFailure(err).message || 'No se pudo consultar el estado de la lectura. El trabajo puede seguir en segundo plano.');
        }
        return EMPTY;
      }),
    ).subscribe({
      next: (status) => {
        if (session !== this.sessionSequence || sequence !== this.pollSequence) return;
        if (status.status === 'completed') {
          this.jobPending.set(false);
          this.polling.set(false);
          this.finish(status.result?.document_id ?? documentId);
          return;
        }
        if (status.status === 'failed') {
          this.jobPending.set(false);
          this.polling.set(false);
          this.scanFailed.set(true);
          this.error.set(status.error || 'No se pudo leer el documento. Puedes reintentar.');
          this.openPaywallForScanCode(status.error_code, status.error);
          return;
        }
      },
      complete: () => {
        if (session === this.sessionSequence && sequence === this.pollSequence && this.polling()) {
          this.polling.set(false);
          this.timedOut.set(true);
        }
      },
    });
  }

  private finish(documentId: number): void {
    this.polling.set(false);
    this.jobPending.set(false);
    this.completed.emit(documentId);
    this.isOpen.set(false);
  }

  private closeSession(): void {
    if (this.jobPending() && this.jobId()) {
      this.toast.info('La lectura puede continuar en segundo plano. Puedes consultar la bandeja en unos minutos.');
    } else if (this.uploading()) {
      this.toast.info('La solicitud de lectura estaba en curso. Verifica la bandeja antes de volver a cargar el archivo.');
    }
    if (this.capturedScope !== null || this.selectedFile() || this.uploading() || this.jobPending()) this.resetSession();
  }

  private openPaywallForScanCode(code: string | undefined, message: string | undefined): void {
    if (code && /^(SUBSCRIPTION_|PLAN_|TRIAL_)/.test(code)) this.subscriptionAccess.openPaywall(code, message);
  }

  private isTerminal(status: ReceivedDocumentScanStatus): boolean {
    return status.status === 'completed' || status.status === 'failed';
  }

  private resetSession(): void {
    this.sessionSequence += 1;
    this.pollSequence += 1;
    this.uploadSubscription?.unsubscribe();
    this.pollSubscription?.unsubscribe();
    this.uploadSubscription = undefined;
    this.pollSubscription = undefined;
    this.capturedScope = null;
    this.capturedHostStoreId = null;
    this.capturedRequestStoreId = undefined;
    this.selectedFile.set(null);
    this.error.set(null);
    this.uploading.set(false);
    this.polling.set(false);
    this.jobPending.set(false);
    this.scanFailed.set(false);
    this.timedOut.set(false);
    this.documentId.set(null);
    this.jobId.set(null);
    this.operationalStoreId.set(null);
  }
}
