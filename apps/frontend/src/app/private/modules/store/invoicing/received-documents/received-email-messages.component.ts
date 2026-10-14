import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, PLATFORM_ID, computed, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { Observable, Subscription, finalize, timeout } from 'rxjs';
import { ButtonComponent, IconComponent, InputComponent, ModalComponent, PaginationComponent } from '../../../../../shared/components/index';
import type { ReceivedEmailMessage, ReceivedEmailMessagePart, ReceivedEmailMessagesPage, ReceivedEmailReasonCopy, ReceivedEmailState } from './received-email-reception.interface';
import { RECEIVED_EMAIL_DIAN_BADGE, RECEIVED_EMAIL_WARNING_COPY, projectReceivedEmailMessage, receivedEmailReason } from './received-email-reception-projection.util';
import { receivedInboxCanPoll, receivedInboxRefreshDelay } from './received-documents-refresh.util';
import { ReceivedEmailReceptionService } from './received-email-reception.service';
import { formatStoreDateTime } from '../../../../../shared/utils/date.util';

const STATE_COPY: Record<ReceivedEmailState, string> = {
  received: 'Recibido', processing: 'Procesando', processed: 'Procesado', partial: 'Procesado parcialmente',
  not_processed: 'No procesado', failed: 'No se pudo procesar', ignored: 'Sin documentos nuevos',
};

/** Metadata-only history. Fiscal imports remain in the existing manual-import flow. */
@Component({
  selector: 'app-received-email-messages', standalone: true,
  imports: [ButtonComponent, IconComponent, InputComponent, ModalComponent, PaginationComponent, ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!contextReady() || !tenantKey()) {
      <p role="status" class="text-sm text-text-secondary">Esperando el contexto de tu tienda…</p>
    } @else if (!canRead()) {
      <p role="note" class="text-sm text-text-secondary">No tienes permiso para consultar estos correos.</p>
    } @else if (isActive()) {
      <section class="space-y-3" aria-label="Correos recibidos">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div><h3 class="font-semibold text-text-primary">{{ view() === 'not_processed' ? 'Correos no procesados' : 'Historial de correos' }}</h3>
            <p class="text-sm text-text-secondary">{{ total() }} correos · sólo metadatos, sin abrir adjuntos.</p></div>
          <div class="flex flex-wrap gap-2">
            @if (view() === 'history') {
              <app-button variant="outline" customClasses="min-h-11" [ariaPressed]="archived()" [disabled]="protectedState()" (clicked)="toggleArchived()">{{ archived() ? 'Ver no archivados' : 'Ver archivados' }}</app-button>
            }
            <app-button variant="outline" customClasses="min-h-11" [disabled]="loading() || busy() || !available()" (clicked)="refresh()"><app-icon name="refresh-cw" [size]="16" /> Actualizar</app-button>
          </div>
        </div>
        @if (!online()) { <p role="status" class="rounded-lg border border-border p-3 text-sm text-text-secondary">Sin conexión. Mostramos el último estado consultado; las acciones se reanudarán cuando vuelvas a conectarte.</p> }
        @if (error()) { <p role="alert" class="rounded-lg border border-error/30 bg-error-light p-3 text-sm text-error">{{ error() }}</p> }
        @if (notice()) { <p role="status" class="text-sm text-text-secondary">{{ notice() }}</p> }
        @if (buffered()) { <p role="status" class="text-sm text-text-secondary">Hay una actualización pendiente. Se aplicará al cerrar la revisión.</p> }
        @if (loading() && !rows().length) { <p role="status" class="text-sm text-text-secondary">Consultando correos…</p> }
        @else if (!rows().length && !error()) { <p class="rounded-xl border border-border bg-surface p-5 text-sm text-text-secondary">{{ archived() ? 'No hay correos archivados.' : 'No hay correos en esta vista.' }}</p> }
        <div class="grid gap-3 lg:grid-cols-2">
          @for (row of rows(); track row.id) {
            <article class="min-w-0 rounded-xl border border-border bg-surface p-4 space-y-3">
              <div class="flex items-start justify-between gap-2"><h4 class="break-words font-semibold text-text-primary">{{ row.subject || 'Sin asunto' }}</h4><span class="shrink-0 text-xs text-text-secondary">{{ stateLabel(row.status) }}</span></div>
              <p class="break-words text-sm text-text-secondary">{{ row.sender || 'Remitente no disponible' }}</p>
              <p class="text-xs text-text-secondary">Recibido {{ formatTimestamp(row.received_at) }} · {{ row.parts.length }} archivos{{ row.archived_at ? ' · Archivado' : '' }}</p>
              @if (reasonFor(row); as reason) { <div class="space-y-1"><p class="text-sm font-medium text-text-primary">{{ reason.title }}</p><p class="text-sm text-text-secondary">{{ reason.description }}</p></div> }
              <div class="flex flex-wrap gap-2">
                <app-button variant="outline" customClasses="min-h-11" [disabled]="busy() || !available()" (clicked)="openMetadata(row)">Ver correo</app-button>
                @if (mayImport(row)) { <app-button variant="outline" customClasses="min-h-11" [disabled]="busy() || !available()" (clicked)="manualImport(row)">Importar manualmente</app-button> }
                @if (mayDiscard(row)) { <app-button variant="outline-danger" customClasses="min-h-11" [disabled]="busy() || !available()" (clicked)="openDiscard(row)">Descartar</app-button> }
                @if (mayRetry(row)) { <app-button variant="outline" customClasses="min-h-11" [disabled]="busy() || !available()" (clicked)="openRetry(row)">Reintentar</app-button> }
              </div>
            </article>
          }
        </div>
        <app-pagination [currentPage]="page()" [totalPages]="totalPages()" [total]="total()" [limit]="limit" infoStyle="range" (pageChange)="changePage($event)" />
      </section>
    }
    <app-modal [(isOpen)]="metadataOpen" title="Metadatos del correo" size="lg" [dialog]="true" [fullScreenOnMobile]="true" (cancel)="closeMetadata()" (closed)="closeMetadata()">
      @if (detailLoading()) { <p role="status" class="text-sm text-text-secondary">Actualizando los metadatos…</p> }
      @if (detailError()) { <p role="alert" class="text-sm text-error">{{ detailError() }}</p> }
      @if (detail(); as row) {
        <div class="space-y-4">
          <div class="space-y-1"><h4 class="break-words font-semibold">{{ row.subject || 'Sin asunto' }}</h4><p class="break-words text-sm">{{ row.sender || 'Remitente no disponible' }}</p><p class="text-sm text-text-secondary">{{ stateLabel(row.status) }} · {{ formatTimestamp(row.received_at) }}</p></div>
          <p class="text-sm text-text-secondary">No se muestra el cuerpo del correo, códigos de confirmación ni enlaces o adjuntos descargables.</p>
          @if (reasonFor(row); as reason) {
            <div class="rounded-lg border border-border p-3 space-y-2"><h5 class="font-medium">{{ reason.title }}</h5><p class="text-sm text-text-secondary">{{ reason.description }}</p>
              @if (mayAct(reason, row)) { <app-button variant="outline" customClasses="min-h-11" [disabled]="detailLoading() || !available()" (clicked)="reasonAction(reason, row)">{{ reason.actionLabel }}</app-button> }
            </div>
          }
          @if (instruction()) { <p role="note" class="rounded-lg bg-background p-3 text-sm text-text-secondary">{{ instruction() }}</p> }
          @for (part of row.parts; track $index) {
            <div class="rounded-lg border border-border p-3 space-y-2">
              <p class="break-words text-sm font-medium">{{ part.filename }}</p><p class="text-xs text-text-secondary">{{ part.kind.toUpperCase() }} · {{ stateLabel(part.status) }} · {{ dianBadge }}</p>
              @if (part.reason_code) { <p class="text-sm font-medium">{{ partReason(part).title }}</p><p class="text-sm text-text-secondary">{{ partReason(part).description }}</p> }
              @for (warning of part.warnings || []; track warning) { <p class="text-sm text-text-secondary">{{ warningCopy[warning] }}</p> }
              @if (part.document_id) { <app-button variant="outline" customClasses="min-h-11" [disabled]="detailLoading() || !available()" (clicked)="openDocument(part.document_id)">Ver documento recibido</app-button> }
            </div>
          }
        </div>
      }
      <div slot="footer"><app-button variant="outline" customClasses="min-h-11" (clicked)="closeMetadata()">Cerrar</app-button></div>
    </app-modal>
    <app-modal [(isOpen)]="discardOpen" title="Descartar correo del historial activo" size="md" [dialog]="true" [fullScreenOnMobile]="true" [closeOnBackdrop]="false" [canClose]="canCloseMutation" (cancel)="closeMutation()" (closed)="closeMutation()">
      <div class="space-y-3"><p class="text-sm text-text-secondary">Se archivará este correo técnico. No se borrarán ni cambiarán las facturas o sus archivos fiscales.</p>
        <app-input label="Motivo (opcional)" [formControl]="discardReason" helperText="Máximo 255 caracteres. Evita incluir datos personales." />
        @if (discardReasonValue().length > 255) { <p role="alert" class="text-sm text-error">El motivo debe tener hasta 255 caracteres.</p> }
        @if (mutationError()) { <p role="alert" class="text-sm text-error">{{ mutationError() }}</p> }
      </div>
      <div slot="footer" class="flex flex-wrap justify-end gap-2"><app-button variant="outline" customClasses="min-h-11" [disabled]="busy()" (clicked)="closeMutation()">Cancelar</app-button><app-button variant="danger" customClasses="min-h-11" [loading]="busy()" [disabled]="!mayConfirmDiscard()" (clicked)="confirmDiscard()">Descartar</app-button></div>
    </app-modal>
    <app-modal [(isOpen)]="retryOpen" title="Solicitar un reintento" size="md" [dialog]="true" [fullScreenOnMobile]="true" [closeOnBackdrop]="false" [canClose]="canCloseMutation" (cancel)="closeMutation()" (closed)="closeMutation()">
      <p class="text-sm text-text-secondary">Solicitaremos volver a procesar este correo. Esto no confirma una recepción fiscal ni una validación ante la DIAN.</p>
      @if (mutationError()) { <p role="alert" class="text-sm text-error">{{ mutationError() }}</p> }
      <div slot="footer" class="flex flex-wrap justify-end gap-2"><app-button variant="outline" customClasses="min-h-11" [disabled]="busy()" (clicked)="closeMutation()">Cancelar</app-button><app-button customClasses="min-h-11" [loading]="busy()" [disabled]="!mayConfirmRetry()" (clicked)="confirmRetry()">Solicitar reintento</app-button></div>
    </app-modal>
  `,
})
export class ReceivedEmailMessagesComponent {
  private readonly api = inject(ReceivedEmailReceptionService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly window = this.document.defaultView;
  readonly tenantKey = input.required<string>();
  readonly contextReady = input(false);
  readonly canRead = input(false);
  readonly canImport = input(false);
  readonly canConfigure = input(false);
  readonly canSync = input(false);
  readonly isActive = input(true);
  readonly timezone = input('America/Bogota');
  readonly view = input<'history' | 'not_processed'>('history');
  readonly protectedChange = output<boolean>();
  readonly manualImportRequested = output<void>();
  readonly configureRequested = output<void>();
  readonly forwardingRequested = output<void>();
  readonly documentRequested = output<number>();
  readonly limit = 25;
  private readonly rowsData = signal<ReceivedEmailMessage[]>([]);
  private readonly snapshotKey = signal('');
  readonly rows = computed(() => this.snapshotKey() === this.contextKey() ? this.rowsData() : []);
  readonly page = signal(1);
  readonly total = signal(0);
  readonly totalPages = signal(0);
  readonly archived = signal(false);
  readonly loading = signal(false);
  readonly online = signal(!this.browser || this.window?.navigator.onLine !== false);
  private readonly visible = signal(!this.browser || this.document.visibilityState !== 'hidden');
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly metadataOpen = model(false);
  readonly discardOpen = model(false);
  readonly retryOpen = model(false);
  readonly busy = signal(false);
  private readonly detailData = signal<ReceivedEmailMessage | null>(null);
  private readonly detailKey = signal('');
  readonly detail = computed(() => this.detailKey() === this.contextKey() ? this.detailData() : null);
  readonly detailLoading = signal(false);
  readonly detailError = signal<string | null>(null);
  readonly mutationError = signal<string | null>(null);
  readonly instruction = signal<string | null>(null);
  readonly buffered = signal<ReceivedEmailMessagesPage | null>(null);
  readonly discardReason = new FormControl('', { nonNullable: true, validators: [Validators.maxLength(255)] });
  readonly discardReasonValue = toSignal(this.discardReason.valueChanges, { initialValue: '' });
  readonly protectedState = computed(() => this.metadataOpen() || this.discardOpen() || this.retryOpen() || this.busy());
  readonly available = computed(() => this.browser && receivedInboxCanPoll(this.visible(), this.online(), this.contextReady() && !!this.tenantKey() && this.canRead() && this.isActive()));
  readonly dianBadge = RECEIVED_EMAIL_DIAN_BADGE;
  readonly warningCopy = RECEIVED_EMAIL_WARNING_COPY;
  readonly canCloseMutation = (): boolean => !this.busy();
  private selection: ReceivedEmailMessage | null = null;
  private selectionKey = '';
  private bufferedKey = '';
  private request?: Subscription;
  private detailRequest?: Subscription;
  private mutationRequest?: Subscription;
  private timer?: ReturnType<typeof setTimeout>;
  private generation = 0;
  private inFlight = false;
  private failures = 0;
  private destroyed = false;

  constructor() {
    effect(() => {
      // Permission changes are also security boundaries, not merely a visual refresh.
      void this.tenantKey(); void this.contextReady(); void this.canRead(); void this.canImport();
      void this.canConfigure(); void this.canSync(); void this.isActive(); void this.view();
      untracked(() => {
        this.invalidate(); this.rowsData.set([]); this.total.set(0); this.totalPages.set(0); this.page.set(1);
        this.archived.set(false); this.failures = 0; this.error.set(null); this.notice.set(null);
        if (this.available()) this.refresh();
      });
    });
    effect(() => {
      const protectedState = this.protectedState();
      this.protectedChange.emit(protectedState);
      untracked(() => {
        if (!protectedState && this.buffered()) { if (this.bufferedKey === this.contextKey()) this.applyPage(this.buffered()!); this.buffered.set(null); }
      });
    });
    const availability = () => {
      this.online.set(this.window?.navigator.onLine !== false);
      this.visible.set(this.document.visibilityState !== 'hidden');
      this.clearTimer();
      if (!this.available()) { this.request?.unsubscribe(); this.detailRequest?.unsubscribe(); this.inFlight = false; this.loading.set(false); this.detailLoading.set(false); }
      else this.refresh();
    };
    if (this.browser) {
      this.document.addEventListener('visibilitychange', availability);
      this.window?.addEventListener('online', availability); this.window?.addEventListener('offline', availability);
    }
    this.destroyRef.onDestroy(() => {
      this.destroyed = true; this.invalidate(); this.protectedChange.emit(false);
      this.document.removeEventListener('visibilitychange', availability);
      this.window?.removeEventListener('online', availability); this.window?.removeEventListener('offline', availability);
    });
  }

  formatTimestamp(value: unknown): string { return value ? formatStoreDateTime(String(value), this.timezone()) || 'Fecha inválida' : 'Sin registro'; }
  stateLabel(state: ReceivedEmailState): string { return STATE_COPY[state] ?? 'Estado no disponible'; }
  reasonFor(row: ReceivedEmailMessage): ReceivedEmailReasonCopy | null {
    const part = row.parts.find((item) => item.reason_code === row.reason_code) ?? row.parts.find((item) => item.reason_code);
    const code = row.reason_code ?? part?.reason_code;
    return code ? receivedEmailReason(code, part?.reason_details) : null;
  }
  partReason(part: ReceivedEmailMessagePart): ReceivedEmailReasonCopy { return receivedEmailReason(part.reason_code, part.reason_details); }
  mayImport(row: ReceivedEmailMessage): boolean {
    const unsafe = ['VIRUS_BLOCKED', 'SECURITY_SCAN_UNAVAILABLE', 'TEST_DOCUMENT'];
    return this.canImport() && !unsafe.includes(row.reason_code ?? '') && !row.parts.some((part) => unsafe.includes(part.reason_code ?? ''));
  }
  mayDiscard(row: ReceivedEmailMessage): boolean { return this.canConfigure() && !row.archived_at && !['received', 'processing'].includes(row.status); }
  mayRetry(row: ReceivedEmailMessage): boolean { return this.canSync() && row.can_retry && row.reason_code === 'TECHNICAL_PROCESSING_ERROR'; }
  mayConfirmDiscard(): boolean { return !!this.selection && this.selectionKey === this.contextKey() && this.discardOpen() && this.mayDiscard(this.selection) && this.available() && !this.busy() && this.discardReasonValue().length <= 255; }
  mayConfirmRetry(): boolean { return !!this.selection && this.selectionKey === this.contextKey() && this.retryOpen() && this.mayRetry(this.selection) && this.available() && !this.busy(); }

  refresh(): void {
    if (!this.available() || this.inFlight || this.busy() || this.destroyed) return;
    this.clearTimer(); this.inFlight = true; this.loading.set(true);
    const generation = this.generation; const key = this.contextKey();
    this.request = this.api.messages({ page: this.page(), limit: this.limit, view: this.view(), archived: this.view() === 'history' && this.archived() }).pipe(
      timeout(20_000), takeUntilDestroyed(this.destroyRef), finalize(() => {
        if (generation !== this.generation || key !== this.contextKey() || this.destroyed) return;
        this.inFlight = false; this.loading.set(false); this.schedule();
      }),
    ).subscribe({
      next: (result) => {
        if (!this.current(generation, key)) return;
        const safe = { data: result.data.slice(0, this.limit).map(projectReceivedEmailMessage), meta: result.meta };
        this.error.set(null); this.failures = 0;
        if (this.protectedState()) { this.bufferedKey = key; this.buffered.set(safe); } else this.applyPage(safe);
      },
      error: () => { if (this.current(generation, key)) { this.failures++; this.error.set('No pudimos actualizar los correos. Volveremos a intentarlo; las facturas guardadas siguen disponibles.'); } },
    });
  }
  changePage(page: number): void {
    if (this.protectedState() || !Number.isSafeInteger(page) || page < 1 || page > this.totalPages()) return;
    this.cancelList(); this.page.set(page); this.rowsData.set([]); this.refresh();
  }
  toggleArchived(): void {
    if (this.protectedState() || this.view() !== 'history') return;
    this.cancelList(); this.archived.update((value) => !value); this.page.set(1); this.rowsData.set([]); this.refresh();
  }
  openMetadata(row: ReceivedEmailMessage): void {
    if (!this.available() || this.busy() || this.protectedState() || !this.rows().some((item) => item.id === row.id)) return;
    this.detailKey.set(this.contextKey()); this.detailData.set(projectReceivedEmailMessage(row)); this.detailError.set(null); this.instruction.set(null); this.metadataOpen.set(true); this.detailLoading.set(true);
    const generation = this.generation; const key = this.contextKey();
    this.detailRequest = this.api.message(row.id).pipe(timeout(20_000), takeUntilDestroyed(this.destroyRef), finalize(() => {
      if (generation === this.generation && key === this.contextKey()) this.detailLoading.set(false);
    })).subscribe({
      next: (message) => { if (this.current(generation, key) && this.metadataOpen()) this.detailData.set(projectReceivedEmailMessage(message)); },
      error: () => { if (this.current(generation, key) && this.metadataOpen()) this.detailError.set('No pudimos actualizar este correo. Se muestran los últimos metadatos consultados.'); },
    });
  }
  closeMetadata(): void { this.metadataOpen.set(false); this.detailRequest?.unsubscribe(); this.detailData.set(null); this.detailLoading.set(false); this.detailError.set(null); this.instruction.set(null); }
  manualImport(row: ReceivedEmailMessage): void { if (this.available() && !this.busy() && this.isCurrentRow(row) && this.mayImport(row)) { this.closeMetadata(); this.manualImportRequested.emit(); } }
  openDiscard(row: ReceivedEmailMessage): void {
    if (!this.available() || this.busy() || this.protectedState() || !this.isCurrentRow(row) || !this.mayDiscard(row)) return;
    this.selectionKey = this.contextKey(); this.selection = projectReceivedEmailMessage(row); this.discardReason.reset(''); this.mutationError.set(null); this.discardOpen.set(true);
  }
  openRetry(row: ReceivedEmailMessage): void {
    if (!this.available() || this.busy() || this.protectedState() || !this.isCurrentRow(row) || !this.mayRetry(row)) return;
    this.selectionKey = this.contextKey(); this.selection = projectReceivedEmailMessage(row); this.mutationError.set(null); this.retryOpen.set(true);
  }
  closeMutation(): void { if (!this.busy()) { this.discardOpen.set(false); this.retryOpen.set(false); this.selection = null; this.discardReason.reset(''); this.mutationError.set(null); } }
  confirmDiscard(): void {
    if (!this.mayConfirmDiscard()) return;
    const row = this.selection!; const reason = this.discardReason.value.trim();
    this.mutate(this.api.discard(row.id, { expected_version: row.version, ...(reason ? { reason } : {}) }), 'Correo archivado. Las facturas no cambiaron.');
  }
  confirmRetry(): void {
    if (!this.mayConfirmRetry()) return;
    const row = this.selection!;
    this.mutate(this.api.retry(row.id, row.version), 'Reintento solicitado. Consulta el estado cuando termine el procesamiento.');
  }
  openDocument(id: number): void {
    if (this.available() && !this.detailLoading() && Number.isSafeInteger(id) && id > 0 && this.detail()?.parts.some((part) => part.document_id === id)) { this.closeMetadata(); this.documentRequested.emit(id); }
  }
  mayAct(reason: ReceivedEmailReasonCopy, row: ReceivedEmailMessage): boolean {
    switch (reason.action) {
      case 'manual': return this.mayImport(row);
      case 'configure': return this.canConfigure();
      case 'retry': return this.mayRetry(row);
      case 'document': return row.parts.some((part) => !!part.document_id);
      case 'history': return false;
      default: return true;
    }
  }
  reasonAction(reason: ReceivedEmailReasonCopy, row: ReceivedEmailMessage): void {
    if (!this.available() || this.detailLoading() || !this.isCurrentRow(row) || !this.mayAct(reason, row)) return;
    switch (reason.action) {
      case 'manual': this.manualImport(row); break;
      case 'configure': this.closeMetadata(); this.configureRequested.emit(); break;
      case 'forwarding': this.closeMetadata(); this.forwardingRequested.emit(); break;
      case 'retry': this.selectionKey = this.contextKey(); this.selection = projectReceivedEmailMessage(row); this.closeMetadata(); this.mutationError.set(null); this.retryOpen.set(true); break;
      case 'document': { const id = row.parts.find((part) => part.document_id)?.document_id; if (id) this.openDocument(id); break; }
      case 'supplier': this.instruction.set('Contacta a tu proveedor por un canal conocido y pídele el ZIP o XML original corregido. No enviamos mensajes por ti.'); break;
      case 'support': this.instruction.set('Contacta al soporte de Vendix por tu canal habitual e indica el motivo mostrado, sin compartir códigos ni adjuntos sospechosos.'); break;
      case 'administrator': this.instruction.set('Pide al administrador de tu empresa que revise la tienda correspondiente. Aquí no se muestran documentos de otras tiendas.'); break;
      case 'subscription': this.instruction.set('Pide a quien administra la suscripción que revise el plan de tu tienda. Tus facturas guardadas siguen disponibles.'); break;
      case 'limits': this.instruction.set('Divide el envío: máximo 20 MB de correo, 20 mensajes adjuntos, 20 documentos y 40 archivos; XML/PDF/ZIP individuales hasta 10 MB.'); break;
      case 'history': break;
    }
  }

  private mutate<T>(request: Observable<T>, success: string): void {
    this.cancelList(); this.buffered.set(null); this.busy.set(true); this.mutationError.set(null);
    const generation = this.generation; const key = this.contextKey();
    this.mutationRequest = request.pipe(timeout(30_000), takeUntilDestroyed(this.destroyRef), finalize(() => {
      if (generation !== this.generation || key !== this.contextKey() || this.destroyed) return;
      this.busy.set(false); this.refresh();
    })).subscribe({
      next: () => { if (this.current(generation, key)) { this.notice.set(success); this.discardOpen.set(false); this.retryOpen.set(false); this.selection = null; this.discardReason.reset(''); } },
      error: () => { if (generation === this.generation && key === this.contextKey() && !this.destroyed) this.mutationError.set('No pudimos aplicar el cambio. El correo pudo actualizarse en otra sesión. Cierra esta ventana y actualiza antes de volver a intentarlo.'); },
    });
  }
  private applyPage(result: ReceivedEmailMessagesPage): void {
    this.snapshotKey.set(this.contextKey()); this.rowsData.set(result.data); this.total.set(result.meta.total); this.totalPages.set(result.meta.totalPages ?? Math.ceil(result.meta.total / this.limit));
  }
  private isCurrentRow(row: ReceivedEmailMessage): boolean { return this.rows().some((item) => item.id === row.id) || this.detail()?.id === row.id; }
  private contextKey(): string { return JSON.stringify([this.tenantKey(), this.contextReady(), this.canRead(), this.canImport(), this.canConfigure(), this.canSync(), this.isActive(), this.view()]); }
  private current(generation: number, key: string): boolean { return generation === this.generation && key === this.contextKey() && !this.destroyed && this.available(); }
  private schedule(): void { this.clearTimer(); if (this.available() && !this.busy() && !this.destroyed) this.timer = setTimeout(() => this.refresh(), receivedInboxRefreshDelay(this.failures)); }
  private clearTimer(): void { if (this.timer) clearTimeout(this.timer); this.timer = undefined; }
  private cancelList(): void { this.clearTimer(); this.request?.unsubscribe(); this.inFlight = false; this.loading.set(false); this.clearTimer(); }
  private invalidate(): void {
    this.generation++; this.cancelList(); this.detailRequest?.unsubscribe(); this.mutationRequest?.unsubscribe();
    this.busy.set(false); this.buffered.set(null); this.closeMetadata(); this.closeMutation();
  }
}
