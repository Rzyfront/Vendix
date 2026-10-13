import { Component, DestroyRef, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { finalize, Subscription } from 'rxjs';
import { ButtonComponent, CardComponent, StickyHeaderComponent, ToastService } from '../../../../../shared/components/index';
import { CurrencyFormatService } from '../../../../../shared/pipes/currency';
import { formatDateOnlyUTC, formatStoreDateTime } from '../../../../../shared/utils/date.util';
import { StoreSettingsFacade } from '../../../../../core/store/store-settings/store-settings.facade';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import { describeApiFailure } from '../utils/invoicing-errors.util';
import type { ReceivedDocument, ReceivedDocumentFile, ReceivedDocumentTax, ReceivedDocumentsScope } from './received-documents.interface';
import { ReceivedDocumentsService } from './received-documents.service';
import { ReceivedDocumentFormComponent } from './received-document-form.component';
import { ReceivedDocumentMatchingComponent } from './received-document-matching.component';
import { ReceivedDocumentAccountingEvidenceComponent } from './received-document-accounting-evidence.component';
import { ReceivedBuyerEventCommandComponent } from './received-buyer-event-command.component';
import { receivedInboxLabel, receivedLegalLabel, receivedTypeLabel, receivedChannelLabel } from './received-documents-inbox-projection.util';

@Component({
  selector: 'app-received-document-detail',
  standalone: true,
  imports: [ButtonComponent, CardComponent, StickyHeaderComponent, ReceivedDocumentFormComponent, ReceivedDocumentMatchingComponent, ReceivedDocumentAccountingEvidenceComponent, ReceivedBuyerEventCommandComponent],
  template: `
    <div class="w-full space-y-4">
      <app-sticky-header title="Detalle del documento recibido" subtitle="Revisa la factura, sus vínculos y la evidencia legal" icon="file-text" [showBackButton]="true" backRoute="/admin/invoicing/received-documents" [backQueryParams]="backQueryParams()" />
      @if (loading()) { <div class="p-10 text-center text-sm text-text-secondary" role="status">Cargando documento…</div> }
      @if (error()) { <div role="alert" class="rounded-lg border border-error/30 bg-error-light p-4 text-error">{{ error() }} <button class="ml-3 underline" type="button" (click)="load()">Reintentar</button></div> }
      @if (document(); as doc) {

        <app-card [responsive]="true">
          <section aria-labelledby="summary-title">
            <h2 id="summary-title" class="mb-4 text-lg font-semibold text-text-primary">Resumen de la factura recibida</h2>
            <dl class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div><dt class="text-xs text-text-secondary">Proveedor</dt><dd class="font-medium">{{ doc.issuer_name || 'No identificado' }}</dd><dd class="text-sm text-text-secondary">NIT {{ doc.issuer_tax_id || '—' }}</dd></div>
              <div><dt class="text-xs text-text-secondary">Número</dt><dd class="font-medium">{{ doc.invoice_number || 'Sin número' }}</dd></div>
              <div><dt class="text-xs text-text-secondary">Tipo</dt><dd class="font-medium">{{ typeLabel(doc.document_type) }}</dd></div>
              <div><dt class="text-xs text-text-secondary">Llegada al buzón</dt><dd class="font-medium">{{ dateTime(doc.arrived_at || doc.created_at) }}</dd></div>
              <div><dt class="text-xs text-text-secondary">Fecha de emisión</dt><dd class="font-medium">{{ dateOnly(doc.issue_date) }}</dd></div>
              <div><dt class="text-xs text-text-secondary">Vencimiento</dt><dd class="font-medium">{{ dateOnly(doc.due_date) }}</dd></div>
              <div><dt class="text-xs text-text-secondary">Condición de pago</dt><dd class="font-medium">{{ paymentConditionLabel(doc.payment_condition) }}</dd></div>
              <div><dt class="text-xs text-text-secondary">Identificador fiscal</dt><dd class="break-all font-mono text-sm">{{ doc.document_key || 'No informado' }}</dd></div>
              <div><dt class="text-xs text-text-secondary">Subtotal del encabezado</dt><dd class="font-medium">{{ money(doc.subtotal_amount, doc.currency) }}</dd></div>
              <div><dt class="text-xs text-text-secondary">Impuestos del encabezado</dt><dd class="font-medium">{{ money(doc.tax_amount, doc.currency) }}</dd></div>
              <div><dt class="text-xs text-text-secondary">Total del encabezado</dt><dd class="font-semibold">{{ money(doc.total_amount, doc.currency) }}</dd></div>
            </dl>
            @if (doc.confirmed_goods_at || doc.accepted_at) {
              <dl class="mt-4 grid grid-cols-1 gap-3 border-t border-border pt-3 sm:grid-cols-2">
                @if (doc.confirmed_goods_at) { <div><dt class="text-xs text-text-secondary">Recibo de bienes/servicios (032)</dt><dd class="font-medium">{{ dateTime(doc.confirmed_goods_at) }}</dd></div> }
                @if (doc.accepted_at) { <div><dt class="text-xs text-text-secondary">Aceptación legal registrada</dt><dd class="font-medium">{{ dateTime(doc.accepted_at) }}</dd></div> }
              </dl>
            }
            @if (!doc.currency || !validCurrency(doc.currency)) { <p class="mt-3 text-sm text-warning" role="note">La moneda no está identificada correctamente; los importes se muestran sin conversión.</p> }
          </section>
        </app-card>

        <app-card [responsive]="true">
          <section aria-labelledby="next-action-title" class="space-y-3">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 id="next-action-title" class="text-lg font-semibold text-text-primary">Siguiente acción</h2>
                <p class="mt-1 text-sm text-text-secondary">{{ nextAction(doc) }}</p>
              </div>
              @if (canReview()) {
                <app-button variant="outline" size="md" [disabled]="draftOpen() || loading()" (clicked)="reviewFormOpen.set(true)">Revisar datos</app-button>
              }
            </div>
            <div class="flex flex-wrap gap-2" aria-label="Estados del documento">
              <span class="rounded-full border border-border px-3 py-1 text-xs">Buzón: {{ inboxLabel(doc.inbox_state) }}</span>
              <span class="rounded-full border border-border px-3 py-1 text-xs">Estado legal: {{ legalLabel(doc.legal_status) }}</span>
              <span class="rounded-full border border-border px-3 py-1 text-xs">Envío de eventos: {{ deliveryLabel(doc.event_delivery_status) }}</span>
            </div>
            @if (hasUnresolvedDelivery(doc)) {
              <p role="alert" class="rounded-lg border border-warning/40 bg-warning-light p-3 text-sm">Hay un evento en preparación, envío o con resultado desconocido. Consulta su actividad antes de iniciar otra acción legal; cualquier reintento permitido conserva la misma clave existente.</p>
            }
            @if (doc.blocking_reasons?.length) {
              <div role="note"><h3 class="text-sm font-medium">Qué requiere atención</h3><ul class="mt-1 list-inside list-disc text-sm text-text-secondary">@for (reason of doc.blocking_reasons ?? []; track reason) { <li>{{ blockingReasonLabel(reason) }}</li> }</ul></div>
            }
            @if (deferredDocument()) { <p role="status" class="text-sm text-text-secondary">Hay una versión actualizada. Se mostrará al cerrar la revisión o confirmación abierta, sin reemplazar tu borrador.</p> }
            <details><summary class="cursor-pointer text-sm text-text-secondary">Ver etapas de revisión y contabilización</summary><dl class="mt-2 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">@for (state of states(doc); track state.label) { <div><dt class="text-text-secondary">{{ state.label }}</dt><dd>{{ label(state.value) }}</dd></div> }</dl></details>
            <p class="text-xs text-text-secondary">Marcar revisada registra una revisión interna: no acredita autenticidad ni significa aceptación ante la DIAN. Las acciones legales y la conciliación conservan sus validaciones y permisos propios.</p>
          </section>
        </app-card>

        <app-card [responsive]="true">
          <section aria-labelledby="evidence-title">
            <h2 id="evidence-title" class="mb-3 text-lg font-semibold">Originales del proveedor</h2>
            @if (!doc.files?.length) { <p class="text-sm text-text-secondary">No hay archivos adjuntos.</p> }
            @for (file of doc.files ?? []; track file.id) {
              <div class="flex flex-wrap items-center justify-between gap-3 border-t border-border py-3 first:border-0">
                <div class="min-w-0"><p class="truncate font-medium">{{ file.file_name }}</p><p class="text-xs text-text-secondary">{{ fileRoleLabel(file.role) }} · {{ file.mime_type }} · {{ file.file_size }} bytes</p><p class="break-all font-mono text-xs text-text-secondary">SHA-256: {{ file.sha256 }}</p></div>
                <button type="button" class="rounded-lg border border-border px-3 py-2 text-sm hover:bg-surface" [disabled]="downloadingFileId() === file.id" (click)="download(doc, file)">{{ downloadingFileId() === file.id ? 'Descargando…' : 'Descargar original' }}</button>
              </div>
            }
          </section>
        </app-card>

        <app-card [responsive]="true">
          <section aria-labelledby="items-title">
            <h2 id="items-title" class="mb-3 text-lg font-semibold">Líneas del documento ({{ doc.items?.length ?? 0 }})</h2>
            @if (!doc.items?.length) { <p class="text-sm text-text-secondary">No hay líneas extraídas.</p> }
            @for (item of doc.items ?? []; track item.id ?? item.line_number) {
              <article class="border-t border-border py-3 first:border-0">
                <div class="flex flex-wrap justify-between gap-2"><div><p class="font-medium">{{ item.description }}</p><p class="text-xs text-text-secondary">Línea {{ item.line_number }} · {{ item.quantity }} {{ item.unit_code || '' }} × {{ money(item.unit_price, doc.currency) }}</p></div><p class="font-semibold">{{ money(item.total_amount, doc.currency) }}</p></div>
                <p class="mt-1 text-xs text-text-secondary">Base neta de línea: {{ money(item.net_amount, doc.currency) }} · Descuento: {{ money(item.discount_amount, doc.currency) }}</p>
                @if (item.taxes?.length) { <ul class="mt-2 space-y-1 text-sm">@for (tax of item.taxes ?? []; track tax.id ?? tax.tax_name) { <li>{{ taxName(tax) }} ({{ taxRate(tax) }}): @if (unitBasis(tax); as basis) { impuesto nominal {{ basis.perUnitAmount || 'no informado' }} {{ doc.currency || 'moneda desconocida' }} / {{ basis.unitCode || 'unidad sin especificar' }}, base {{ basis.quantity || 'no informada' }} {{ basis.unitCode || 'unidad sin especificar' }} } @else { base {{ money(tax.base_amount, doc.currency) }}, impuesto {{ money(tax.amount, doc.currency) }} }</li> }</ul> }
              </article>
            }
          </section>
        </app-card>

        <app-card [responsive]="true">
          <section aria-labelledby="taxes-title">
            <h2 id="taxes-title" class="mb-3 text-lg font-semibold">Impuestos informados en el encabezado</h2>
            @if (!doc.taxes?.length) { <p class="text-sm text-text-secondary">No hay impuestos de encabezado registrados.</p> }
            @for (tax of headerTaxes(doc); track tax.id ?? tax.tax_name) {
              <div class="flex flex-wrap justify-between gap-2 border-t border-border py-2 first:border-0"><span>{{ taxName(tax) }} · {{ taxRate(tax) }}</span><span>@if (unitBasis(tax); as basis) { Nominal {{ basis.perUnitAmount || 'no informado' }} {{ doc.currency || 'moneda desconocida' }} / {{ basis.unitCode || 'unidad sin especificar' }} · Base {{ basis.quantity || 'no informada' }} {{ basis.unitCode || 'unidad sin especificar' }} } @else { {{ money(tax.amount, doc.currency) }} <small class="text-text-secondary">sobre {{ money(tax.base_amount, doc.currency) }}</small> } </span></div>
            }
            <p class="mt-3 text-xs text-text-secondary">Los impuestos por línea y de encabezado se muestran separados; no se suman para evitar duplicar valores.</p>
          </section>
        </app-card>

        <app-card [responsive]="true">
          <section aria-labelledby="validation-title">
            <h2 id="validation-title" class="mb-3 text-lg font-semibold">Discrepancias y validación</h2>
            <dl class="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div class="rounded-lg border border-border p-3"><dt class="text-xs text-text-secondary">Estructura</dt><dd class="mt-1 font-medium">{{ structuralStatusLabel(doc) }}</dd></div>
              <div class="rounded-lg border border-border p-3"><dt class="text-xs text-text-secondary">Firma</dt><dd class="mt-1 font-medium">{{ signatureStatusLabel(doc) }}</dd></div>
              <div class="rounded-lg border border-border p-3"><dt class="text-xs text-text-secondary">Verificación DIAN</dt><dd class="mt-1 font-medium">{{ dianStatusLabel(doc) }}</dd></div>
            </dl>
            <p class="mb-3 text-xs text-text-secondary">La firma criptográfica no se autentica y la DIAN no se consulta desde esta revisión. La validación estructural no acredita autenticidad ni aceptación.</p>
            @if (doc.validation_summary?.errors?.length) { <div class="mb-3 rounded-lg border border-error/30 bg-error-light p-3" role="alert"><h3 class="font-medium text-error">Inconsistencias</h3><ul class="list-inside list-disc text-sm text-error">@for (issue of doc.validation_summary?.errors ?? []; track $index) { <li>{{ issue.message }}</li> }</ul></div> }
            @if (doc.validation_summary?.warnings?.length) { <div class="rounded-lg border border-warning/30 bg-warning-light p-3" role="note"><h3 class="font-medium">Advertencias</h3><ul class="list-inside list-disc text-sm">@for (issue of doc.validation_summary?.warnings ?? []; track $index) { <li>{{ issue.message }}</li> }</ul></div> }
            @if (!doc.validation_summary?.errors?.length && !doc.validation_summary?.warnings?.length) { <p class="text-sm text-text-secondary">Sin observaciones de validación registradas.</p> }
          </section>
        </app-card>

        <section aria-labelledby="matching-section-title" class="space-y-3">
          <h2 id="matching-section-title" class="text-lg font-semibold">Compras y gastos vinculados</h2>
          <p class="text-sm text-text-secondary">Vincular una compra o gasto existente concilia evidencia. No crea una compra, no recibe inventario y no genera cuentas por pagar.</p>
          <app-received-document-matching [document]="doc" [scope]="scope" [storeId]="storeId() ?? null" (changed)="load()" />
        </section>
        <section aria-labelledby="accounting-section-title" class="space-y-3">
          <h2 id="accounting-section-title" class="text-lg font-semibold">Evidencia contable y cuentas por pagar</h2>
          <p class="text-sm text-text-secondary">Esta consulta muestra registros ya existentes; una coincidencia no sustituye una contabilización confirmada.</p>
          <app-received-document-accounting-evidence [scope]="scope" [documentId]="doc.id" [storeId]="storeId() ?? null" />
        </section>

        <app-card [responsive]="true">
          <section aria-labelledby="timeline-title">
            <h2 id="timeline-title" class="mb-3 text-lg font-semibold">Actividad y procedencia</h2>
            <p class="mb-3 text-sm text-text-secondary">Origen: {{ channelLabel(doc.source_channel) }} · Registrado: {{ dateTime(doc.created_at) }} · Versión {{ doc.version }}</p>
            @if (!doc.events?.length) { <p class="text-sm text-text-secondary">Sin eventos adicionales.</p> }
            <ol class="space-y-2">@for (event of doc.events ?? []; track event.id) { <li class="border-l-2 border-border pl-3"><p class="font-medium">{{ label(event.event_type) }} · {{ label(event.status) }}</p>@if (event.event_type === 'BUYER_DIAN_EVENT') { <p class="break-all text-xs text-text-secondary">Código {{ event.event_code || '—' }} · Número {{ event.event_number || '—' }} · CUDE {{ event.cude || '—' }}</p> }@if (event.event_type === 'BUYER_DIAN_EVENT' && event.event_code === '034' && event.status === 'accepted') { <p class="text-xs text-text-secondary" role="note">Consulta 034 aceptada y registrada; esta evidencia solo se consulta y no se ofrece para emisión desde esta pantalla.</p> }<time class="text-xs text-text-secondary">{{ dateTime(event.confirmed_at || event.event_date || event.created_at) }}</time></li> }</ol>
            <details class="mt-4"><summary class="cursor-pointer text-sm font-medium">Ver metadatos de procedencia</summary><pre class="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-surface p-3 text-xs">{{ provenance(doc) }}</pre></details>
          </section>
        </app-card>
        <p class="rounded-lg border border-border bg-surface p-3 text-sm text-text-secondary">El estado validado no equivale a aceptación por la DIAN. Los eventos del adquirente requieren una acción expresa y una respuesta de la DIAN; reconocimiento fiscal, coincidencia con recepción/compra y contabilización son procesos separados.</p>
        <app-received-buyer-event-command [document]="doc" [scope]="scope" [storeId]="storeId() ?? null" (changed)="load()" />
        <app-received-document-form [isOpen]="reviewFormOpen()" (isOpenChange)="reviewFormOpen.set($event)" [scope]="scope" [selectedStoreId]="storeId() ?? null" [document]="doc" (saved)="onReviewSaved()" (reloadRequested)="load()" />
      }
    </div>
  `,
})
export class ReceivedDocumentDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly service = inject(ReceivedDocumentsService);
  private readonly toast = inject(ToastService);
  private readonly currency = inject(CurrencyFormatService);
  private readonly storeSettings = inject(StoreSettingsFacade);
  private readonly auth = inject(AuthFacade);
  readonly scope: ReceivedDocumentsScope = this.readScope(this.route.snapshot.data['receivedDocumentsScope']);
  private readonly routeQueryParams = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
  private readonly routeParams = toSignal(this.route.paramMap, { initialValue: this.route.snapshot.paramMap });
  readonly storeId = computed(() => this.scope === 'organization' ? this.readStoreId(this.routeQueryParams().get('store_id')) : undefined);
  readonly documentId = computed(() => this.readDocumentId(this.routeParams().get('id')));
  readonly backQueryParams = computed(() => {
    const params = this.routeQueryParams();
    const query: Record<string, string | string[] | number> = {};
    for (const key of params.keys) {
      if (key === 'store_id') continue;
      const values = params.getAll(key);
      query[key] = values.length === 1 ? values[0] : values;
    }
    if (this.scope === 'organization' && this.storeId()) query['store_id'] = this.storeId()!;
    return query;
  });
  readonly document = signal<ReceivedDocument | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly downloadingFileId = signal<number | null>(null);
  readonly reviewFormOpen = signal(false);
  readonly canReview = computed(() => {
    const doc = this.document();
    if (!doc || !this.auth.hasPermission(`${this.scope === 'store' ? 'invoicing' : 'organization:invoicing'}:received:review`)) return false;
    const meta = this.metadataObject(doc.metadata); const raw = this.metadataObject(doc.raw_payload);
    const source = meta['source_format'] ?? raw['source_format'];
    const extraction = this.metadataObject(meta['extraction_snapshot']);
    const editable = source === 'manual_entry' || (source === 'pending_file' && doc.processing_status === 'ready' && Object.keys(extraction).length > 0);
    const xmlNoteOnly = source === 'ubl_xml' || source === 'xml' || doc.source_channel === 'xml';
    const terminal = ['recognized', 'accepted', 'posted'].includes(doc.fiscal_status) || ['recognized', 'accepted', 'posted'].includes(doc.posting_status) || !!doc.accepted_at;
    return !terminal && (editable || xmlNoteOnly);
  });
  readonly deferredDocument = signal<ReceivedDocument | null>(null);
  private readonly reviewForm = viewChild(ReceivedDocumentFormComponent);
  private readonly matching = viewChild(ReceivedDocumentMatchingComponent);
  private readonly eventCommand = viewChild(ReceivedBuyerEventCommandComponent);
  readonly draftOpen = computed(() => this.reviewFormOpen() || !!this.reviewForm()?.busy()
    || !!this.matching()?.matchConfirmOpen() || !!this.matching()?.expenseMatchOpen()
    || !!this.eventCommand()?.open() || !!this.eventCommand()?.pending());
  private activeRequest?: Subscription;
  private downloadRequest?: Subscription;
  private generation = 0;
  private contextKey = '';
  readonly inboxLabel = receivedInboxLabel;
  readonly legalLabel = receivedLegalLabel;
  readonly typeLabel = receivedTypeLabel;
  readonly channelLabel = receivedChannelLabel;

  constructor() {
    effect(() => {
      const key = `${this.scope}:${this.storeId() ?? ''}:${this.documentId()}:${this.auth.userId()}:${this.auth.userOrganization()?.id}:${this.auth.userStore()?.id}`;
      if (key === this.contextKey) return;
      this.contextKey = key;
      untracked(() => {
        this.generation++;
        this.activeRequest?.unsubscribe();
        this.downloadRequest?.unsubscribe();
        this.document.set(null);
        this.deferredDocument.set(null);
        this.reviewFormOpen.set(false);
        this.downloadingFileId.set(null);
        this.load();
      });
    });
    effect(() => {
      const deferred = this.deferredDocument();
      if (!deferred || this.draftOpen()) return;
      untracked(() => { this.document.set(deferred); this.deferredDocument.set(null); });
    });
    this.destroyRef.onDestroy(() => { this.generation++; this.activeRequest?.unsubscribe(); this.downloadRequest?.unsubscribe(); });
  }

  load(): void {
    this.generation++;
    this.activeRequest?.unsubscribe();
    const generation = this.generation;
    const id = this.documentId();
    if (!id) { this.document.set(null); this.loading.set(false); this.error.set('El identificador del documento no es válido.'); return; }
    this.loading.set(true); this.error.set(null);
    this.activeRequest = this.service.getById(this.scope, id, this.storeId())
      .pipe(takeUntilDestroyed(this.destroyRef), finalize(() => { if (generation === this.generation) this.loading.set(false); }))
      .subscribe({
        next: (response) => {
          if (generation !== this.generation) return;
          if (!response.data || response.data.id !== id) {
            this.error.set('La respuesta del documento no tiene un formato válido. Reintenta la consulta.');
            return;
          }
          if (this.draftOpen()) this.deferredDocument.set(response.data);
          else { this.document.set(response.data); this.deferredDocument.set(null); }
        },
        error: (err: unknown) => {
          if (generation !== this.generation) return;
          this.error.set(describeApiFailure(err).message || 'No se pudo cargar el documento.');
        },
      });
  }

  onReviewSaved(): void {
    this.toast.success('Revisión guardada. El documento no fue aceptado ni contabilizado.');
    this.load();
  }

  states(doc: ReceivedDocument): Array<{ label: string; value: string }> {
    return [
      { label: 'Procesamiento', value: doc.processing_status },
      { label: 'Validación', value: doc.validation_status },
      { label: 'Revisión', value: doc.review_status },
      { label: 'Coincidencia', value: doc.matching_status },
      { label: 'Fiscal', value: doc.fiscal_status },
      { label: 'Contabilización', value: doc.posting_status },
    ];
  }

  download(doc: ReceivedDocument, file: ReceivedDocumentFile): void {
    this.downloadRequest?.unsubscribe();
    const contextKey = this.contextKey;
    this.downloadingFileId.set(file.id);
    this.downloadRequest = this.service.downloadFile(this.scope, doc.id, file.id, this.storeId()).pipe(takeUntilDestroyed(this.destroyRef), finalize(() => { if (contextKey === this.contextKey) this.downloadingFileId.set(null); })).subscribe({
      next: (response) => {
        if (contextKey !== this.contextKey) return;
        if (!response.body) { this.toast.error('El archivo descargado está vacío.'); return; }
        const header = response.headers.get('content-disposition');
        const filename = this.safeFilename(this.filenameFromHeader(header) ?? file.file_name);
        const url = URL.createObjectURL(response.body);
        const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename;
        document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      },
      error: (err: unknown) => { if (contextKey === this.contextKey) this.toast.error(describeApiFailure(err).message || 'No se pudo descargar el archivo original.'); },
    });
  }

  dateOnly(value: string | null | undefined): string {
    if (!value) return 'No informada';
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? formatDateOnlyUTC(date) : 'Fecha inválida';
  }
  money(value: string | null | undefined, currency: string | null | undefined): string {
    if (value == null || value === '') return '—';
    if (!this.validCurrency(currency)) return `${value} (moneda no identificada)`;
    if (this.currency.currencyCode().toUpperCase() === currency!.toUpperCase()) return this.currency.format(value);
    return `${value} ${currency}`;
  }
  validCurrency(currency: string | null | undefined): boolean { return !!currency && /^[A-Z]{3}$/.test(currency.toUpperCase()); }
  label(value: unknown): string {
    const labels: Record<string, string> = {
      pending: 'Pendiente', pending_ocr: 'Lectura pendiente', processing: 'En lectura', ready: 'Disponible',
      completed: 'Completada', active: 'Activa', revoked: 'Revocada', cancelled: 'Cancelada',
      not_required: 'No requerida', unreconciled: 'Sin conciliación',
      error: 'Error', failed: 'Fallido', valid: 'Estructura válida', invalid: 'Estructura inválida',
      needs_review: 'Requiere revisión', unreviewed: 'Sin revisar', reviewed: 'Revisada',
      unlinked: 'Sin vínculos', partially_linked: 'Vinculada parcialmente', linked: 'Vinculada',
      none: 'Sin registro', not_recognized: 'Sin reconocimiento fiscal', recognized: 'Reconocimiento registrado',
      not_posted: 'Sin contabilizar', posted: 'Contabilizada', accepted: 'Aceptado por la DIAN',
      rejected: 'Rechazado por la DIAN', unknown: 'Resultado desconocido',
      preparing: 'En preparación', prepared: 'Preparado', sending: 'Enviando', preparation_failed: 'Preparación fallida',
      imported: 'Importación', created: 'Documento registrado', manual_created: 'Captura manual',
      MANUAL_CREATED: 'Captura manual', XML_IMPORTED: 'XML importado', DOCUMENT_REVIEWED: 'Revisión interna',
      reviewed_document: 'Revisión interna', BUYER_DIAN_EVENT: 'Evento electrónico del comprador',
      MATCH_CONFIRMED: 'Vínculo confirmado', MATCH_REVOKED: 'Vínculo revocado',
      IMPORTED: 'Documento importado', UPDATED: 'Datos revisados', EXTRACTED: 'Datos extraídos',
      ORIGINAL_FILE_ATTACHED: 'Original adjuntado', MERGED_DUPLICATE: 'Duplicado vinculado',
      PENDING_FILE_RECEIVED: 'Archivo pendiente de lectura', PROCESSING_FAILED: 'Lectura fallida',
      SCAN_FAILED: 'Lectura fallida', SCAN_QUEUE_FAILED: 'No se pudo programar la lectura',
      AI_EXTRACTION: 'Extracción de datos de archivo',
    };
    return labels[String(value)] || 'Estado no disponible';
  }
  deliveryLabel(value: unknown): string {
    const labels: Record<string, string> = {
      none: 'Sin envío', in_progress: 'En preparación o envío', unknown: 'Resultado desconocido',
      rejected: 'Evento rechazado por la DIAN', failed: 'Preparación fallida', accepted: 'Evento aceptado por la DIAN',
    };
    return labels[String(value)] || 'Estado de envío no disponible';
  }
  hasUnresolvedDelivery(doc: ReceivedDocument): boolean {
    return doc.event_delivery_status === 'unknown' || doc.event_delivery_status === 'in_progress'
      || !!doc.blocking_reasons?.includes('event_delivery_uncertain');
  }
  nextAction(doc: ReceivedDocument): string {
    if (this.hasUnresolvedDelivery(doc)) return 'Consulta la actividad y resuelve el resultado del evento existente antes de una nueva acción legal.';
    if (doc.legal_status === 'conflict') return 'Revisa la evidencia legal en conflicto antes de continuar.';
    if (doc.inbox_state === 'requires_review') return 'Revisa las discrepancias y los datos recibidos; cada acción conserva su validación independiente.';
    if (doc.legal_status === 'accepted' || doc.legal_status === 'reclaimed') return 'Consulta la evidencia legal registrada y los vínculos contables; no repitas una aceptación ni un reclamo incompatible.';
    if (!doc.inbox_state || !doc.legal_status) return 'Consulta el documento y su actividad. El estado legal no está disponible en esta respuesta.';
    return 'Revisa el original y los datos; después concilia compras o gastos existentes y consulta las acciones legales disponibles.';
  }
  blockingReasonLabel(reason: string): string {
    const labels: Record<string, string> = {
      legal_evidence_conflict: 'La evidencia registra aceptación y reclamo incompatibles.',
      event_delivery_uncertain: 'Hay un evento en preparación, envío o con resultado incierto.',
      event_delivery_rejected: 'La DIAN rechazó un evento; eso no confirma un reclamo ni una aceptación.',
      event_preparation_failed: 'Un evento no pudo prepararse para transmisión.',
      processing_error: 'No se pudo leer el documento.', document_reading_pending: 'La lectura del documento está pendiente.',
      validation_pending: 'La validación estructural está pendiente.',
      document_validation_requires_review: 'La estructura o los datos requieren revisión.',
    };
    return labels[reason] || 'Hay un requisito pendiente de revisar.';
  }
  fileRoleLabel(value: string): string {
    const labels: Record<string, string> = {
      original: 'Original', source: 'Archivo de origen', source_xml: 'XML original', xml: 'XML',
      attachment: 'Adjunto', supporting: 'Respaldo', application_response: 'Respuesta electrónica',
      pdf: 'PDF', image: 'Imagen',
    };
    return labels[value] || 'Archivo adjunto';
  }
  paymentConditionLabel(value: unknown): string {
    return value === 'cash' ? 'Contado' : value === 'credit' ? 'Crédito' : 'No determinada';
  }
  structuralStatusLabel(doc: ReceivedDocument): string {
    const value = doc.structural_validation_status ?? doc.validation_summary?.structural?.status ?? 'pending';
    return ({ pending: 'Pendiente de evaluar', valid: 'Estructura válida', needs_review: 'Requiere revisión', invalid: 'Estructura inválida' } as Record<string, string>)[value] ?? 'Pendiente de evaluar';
  }
  signatureStatusLabel(doc: ReceivedDocument): string {
    const summary = doc.validation_summary?.signature;
    const value = doc.signature_validation_status ?? summary?.status ?? (typeof summary?.has_signature === 'boolean' ? summary.has_signature ? 'not_verified' : 'unsigned' : 'not_verified');
    return value === 'unsigned' ? 'No se detectó firma' : 'Firma no verificada';
  }
  dianStatusLabel(doc: ReceivedDocument): string {
    const value = doc.dian_validation_status ?? doc.validation_summary?.dian?.status ?? 'not_checked';
    return value === 'not_checked' ? 'No consultada' : 'Estado DIAN no reconocido';
  }
  dateTime(value: string): string {
    return formatStoreDateTime(value, this.storeSettings.timezone(), { dateStyle: 'medium', timeStyle: 'short' });
  }
  taxName(tax: ReceivedDocumentTax): string {
    return tax.tax_type ? tax.tax_name : `${tax.tax_name} (sin clasificar)`;
  }
  taxRate(tax: ReceivedDocumentTax): string {
    if (this.unitBasis(tax)) return 'Impuesto nominal por unidad';
    return tax.rate == null ? 'Tasa no informada' : `${tax.rate}%`;
  }
  unitBasis(tax: ReceivedDocumentTax): { quantity: string | null; unitCode: string | null; perUnitAmount: string | null } | null {
    const metadata = this.metadataObject(tax.metadata);
    if (metadata['tax_basis_type'] !== 'unit') return null;
    const quantity = metadata['base_quantity'];
    const unitCode = metadata['base_unit_code'];
    const perUnitAmount = metadata['per_unit_amount'];
    const amountString = (value: unknown): string | null => typeof value === 'string' || typeof value === 'number' ? String(value) : null;
    return { quantity: amountString(quantity), unitCode: typeof unitCode === 'string' ? unitCode : null, perUnitAmount: amountString(perUnitAmount) };
  }
  headerTaxes(doc: ReceivedDocument): NonNullable<ReceivedDocument['taxes']> {
    return (doc.taxes ?? []).filter((tax) => tax.item_id == null);
  }
  private metadataObject(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  }
  provenance(doc: ReceivedDocument): string {
    const payload = { source_channel: doc.source_channel, created_at: doc.created_at, metadata: doc.metadata ?? null, raw_payload: doc.raw_payload ?? null };
    try { return JSON.stringify(payload, null, 2); } catch { return 'No fue posible representar los metadatos.'; }
  }
  private filenameFromHeader(value: string | null): string | null {
    if (!value) return null;
    const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(value);
    if (utf8?.[1]) { try { return decodeURIComponent(utf8[1].replace(/^"|"$/g, '')); } catch { return null; } }
    return /filename="?([^";]+)"?/i.exec(value)?.[1] ?? null;
  }
  private safeFilename(value: string): string {
    const basename = value.split(/[\\/]/).pop()?.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\.\./g, '').trim();
    return basename && basename.length <= 150 ? basename : 'documento-recibido';
  }
  private readStoreId(value: string | null): number | undefined { const id = Number(value); return Number.isSafeInteger(id) && id > 0 ? id : undefined; }
  private readDocumentId(value: string | null): number | null { const id = Number(value); return Number.isSafeInteger(id) && id > 0 ? id : null; }
  private readScope(value: unknown): ReceivedDocumentsScope {
    if (value === 'store' || value === 'organization') return value;
    throw new Error('La ruta debe declarar data.receivedDocumentsScope como store u organization.');
  }
}
