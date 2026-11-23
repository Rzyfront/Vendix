import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, Subscription, finalize } from 'rxjs';
import { ModalComponent } from '../../../../../shared/components/modal/modal.component';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { SubscriptionAccessService } from '../../../../../core/services/subscription-access.service';
import { AiScanJobError } from '../../../../../core/utils/ai-job-error';
import { AiJobProgressComponent } from '../../../../../shared/components/ai-job-progress/ai-job-progress.component';
import { injectAiJobProgress } from '../../../../../shared/utils/ai-job-progress';
import { OrganizationStoresService } from '../../../organization/stores/services/organization-stores.service';
import type { StoreListItem } from '../../../organization/stores/interfaces/store.interface';
import { describeApiFailure } from '../utils/invoicing-errors.util';
import type { ReceivedDocumentScanJobResult, ReceivedDocumentsScope } from './received-documents.interface';
import { ReceivedDocumentsService } from './received-documents.service';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
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
  imports: [ModalComponent, AiJobProgressComponent],
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
              [disabled]="storeLoading() || scanning()"
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
            [disabled]="scanning()"
            (change)="onFileSelected($event)"
            aria-describedby="received-scan-file-help"
          />
          <p id="received-scan-file-help" class="text-xs text-text-secondary">El archivo se conserva sin modificar como evidencia. PDF de hasta 10 páginas; la imagen original nunca se reemplaza.</p>
          @if (selectedFile(); as selected) {
            <p class="break-all text-sm text-text-secondary">{{ selected.name }} · {{ formatBytes(selected.size) }}</p>
          }
        </div>

        @if (error()) { <div class="rounded-lg border border-error/30 bg-error-light p-3 text-sm text-error" role="alert">{{ error() }}</div> }
        <app-ai-job-progress
          [progress]="aiProgress"
          [showRetry]="selectedFile() !== null"
          (retry)="submit()"
        />
        @if (scanning()) {
          <p class="text-xs text-text-secondary">Puedes cerrar esta ventana; el trabajo continúa en segundo plano y al volver retomamos su estado real.</p>
        }

        <div slot="footer" class="flex flex-col-reverse justify-end gap-2 sm:flex-row">
          <button type="button" class="min-h-11 rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-primary hover:bg-surface" [disabled]="uploading()" (click)="requestClose()">Cerrar</button>
          <button type="button" class="min-h-11 rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50" [disabled]="!canSubmit()" (click)="submit()">
            {{ uploading() ? 'Guardando…' : aiProgress.error() ? 'Reintentar lectura' : 'Guardar y escanear' }}
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
  /** Shared AI progress bar (QUI-1020). */
  readonly aiProgress = injectAiJobProgress({ kind: 'received_document' });
  readonly uploading = computed(() => this.aiProgress.phase() === 'uploading');
  readonly scanning = computed(() => this.aiProgress.running());
  readonly jobPending = signal(false);
  readonly operationalStoreId = signal<number | null>(null);
  readonly stores = signal<StoreListItem[]>([]);
  readonly storesLoaded = signal(false);
  readonly storeLoading = signal(false);
  readonly storeLoadError = signal<string | null>(null);
  readonly canClose = () => !this.uploading();
  readonly canSubmit = computed(() =>
    this.selectedFile() !== null &&
    !this.scanning() &&
    (!this.requiresOperationalStore() || this.hasOperationalStore()),
  );

  private scanSubscription?: Subscription;
  private storeSubscription?: Subscription;
  private sessionSequence = 0;
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
        this.tryResume();
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
    this.tryResume();
  }

  onFileSelected(event: Event): void {
    const inputElement = event.target as HTMLInputElement;
    const file = inputElement.files?.[0] ?? null;
    inputElement.value = '';
    this.error.set(null);
    this.selectedFile.set(null);
    this.aiProgress.reset();
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
    this.jobPending.set(false);
    const sequence = this.captureRequest();
    // AiScanJobService uploads, waits with backoff, feeds the progress bar and
    // remembers the job so reopening the modal re-attaches. The picked file is
    // kept on failure: the panel retries without uploading it again.
    this.track(
      this.documents.scanAndWait(this.scope(), selectedFile, this.capturedRequestStoreId, {
        progress: this.aiProgress,
        onEnqueued: () => {
          if (sequence === this.sessionSequence) this.jobPending.set(true);
        },
      }),
      sequence,
    );
  }

  /** Captures the scope and operational store of this attempt; returns its session id. */
  private captureRequest(): number {
    this.capturedScope = this.scope();
    this.capturedHostStoreId = this.selectedStoreId();
    this.capturedRequestStoreId = this.scope() === 'organization'
      ? this.selectedStoreId() ?? this.operationalStoreId() ?? undefined
      : undefined;
    return ++this.sessionSequence;
  }

  /** Re-attaches to a scan that was running when the modal closed or the page reloaded. */
  private tryResume(): void {
    if (this.scanning() || this.selectedFile() || this.capturedScope !== null) return;
    if (this.requiresOperationalStore() && !this.hasOperationalStore()) return;
    const scope = this.scope();
    const storeId = scope === 'organization' ? this.selectedStoreId() ?? this.operationalStoreId() ?? undefined : undefined;
    const resumed = this.documents.resumeScan(scope, storeId, { progress: this.aiProgress });
    if (!resumed) return;
    const sequence = this.captureRequest();
    this.jobPending.set(true);
    this.track(resumed, sequence);
  }

  private track(scan$: Observable<ReceivedDocumentScanJobResult>, sequence: number): void {
    this.scanSubscription?.unsubscribe();
    this.scanSubscription = scan$.pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => {
        if (sequence === this.sessionSequence) this.jobPending.set(false);
      }),
    ).subscribe({
      next: (result) => {
        if (sequence === this.sessionSequence) this.finish(result.document_id);
      },
      error: (err: unknown) => {
        // The panel already explains the failure by category; only the paywall is left.
        if (sequence !== this.sessionSequence || !(err instanceof AiScanJobError)) return;
        this.openPaywallForScanCode(err.code ?? undefined, err.message);
      },
    });
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

  private finish(documentId: number): void {
    this.jobPending.set(false);
    this.completed.emit(documentId);
    this.isOpen.set(false);
  }

  private closeSession(): void {
    if (this.jobPending()) {
      this.toast.info('La lectura continúa en segundo plano. Al volver a abrir esta ventana retomamos su estado.');
    } else if (this.uploading()) {
      this.toast.info('La solicitud de lectura estaba en curso. Verifica la bandeja antes de volver a cargar el archivo.');
    }
    if (this.capturedScope !== null || this.selectedFile() || this.uploading() || this.jobPending()) this.resetSession();
  }

  private openPaywallForScanCode(code: string | undefined, message: string | undefined): void {
    if (code && /^(SUBSCRIPTION_|PLAN_|TRIAL_)/.test(code)) this.subscriptionAccess.openPaywall(code, message);
  }

  private resetSession(): void {
    this.sessionSequence += 1;
    // The job stays remembered in AiScanJobService: reopening re-attaches to it.
    this.scanSubscription?.unsubscribe();
    this.scanSubscription = undefined;
    this.aiProgress.reset();
    this.capturedScope = null;
    this.capturedHostStoreId = null;
    this.capturedRequestStoreId = undefined;
    this.selectedFile.set(null);
    this.error.set(null);
    this.jobPending.set(false);
    this.operationalStoreId.set(null);
  }
}
