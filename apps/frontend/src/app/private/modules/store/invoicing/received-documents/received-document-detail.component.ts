import { Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { finalize, Subscription } from 'rxjs';
import { CardComponent, StickyHeaderComponent, ToastService } from '../../../../../shared/components/index';
import { CurrencyFormatService } from '../../../../../shared/pipes/currency';
import { formatDateOnlyUTC, formatStoreDateTime } from '../../../../../shared/utils/date.util';
import { StoreSettingsFacade } from '../../../../../core/store/store-settings/store-settings.facade';
import { describeApiFailure } from '../utils/invoicing-errors.util';
import type { ReceivedDocument, ReceivedDocumentFile, ReceivedDocumentTax, ReceivedDocumentsScope } from './received-documents.interface';
import { ReceivedDocumentsService } from './received-documents.service';

@Component({
  selector: 'app-received-document-detail',
  standalone: true,
  imports: [CardComponent, StickyHeaderComponent],
  template: `
    <div class="w-full space-y-4">
      <app-sticky-header title="Detalle del documento recibido" subtitle="Revisión de evidencia del proveedor" icon="file-text" [showBackButton]="true" backRoute="/admin/invoicing/received-documents" [backQueryParams]="backQueryParams()" />
      @if (loading()) { <div class="p-10 text-center text-sm text-text-secondary" role="status">Cargando documento…</div> }
      @if (error()) { <div role="alert" class="rounded-lg border border-error/30 bg-error-light p-4 text-error">{{ error() }} <button class="ml-3 underline" type="button" (click)="load()">Reintentar</button></div> }
      @if (document(); as doc) {
        <div class="flex flex-wrap gap-2" aria-label="Estados del documento">
          @for (state of states(doc); track state.label) {
            <span class="rounded-full border border-border bg-surface px-3 py-1 text-xs text-text-primary"><strong>{{ state.label }}:</strong> {{ label(state.value) }}</span>
          }
        </div>

        <app-card [responsive]="true">
          <section aria-labelledby="summary-title">
            <h2 id="summary-title" class="mb-4 text-lg font-semibold text-text-primary">Resumen fiscal recibido</h2>
            <dl class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div><dt class="text-xs text-text-secondary">Proveedor</dt><dd class="font-medium">{{ doc.issuer_name || 'No identificado' }}</dd><dd class="text-sm text-text-secondary">NIT {{ doc.issuer_tax_id || '—' }}</dd></div>
              <div><dt class="text-xs text-text-secondary">Número</dt><dd class="font-medium">{{ doc.invoice_number || 'Sin número' }}</dd></div>
              <div><dt class="text-xs text-text-secondary">Tipo</dt><dd class="font-medium">{{ label(doc.document_type) }}</dd></div>
              <div><dt class="text-xs text-text-secondary">Fecha de emisión</dt><dd class="font-medium">{{ dateOnly(doc.issue_date) }}</dd></div>
              <div><dt class="text-xs text-text-secondary">Vencimiento</dt><dd class="font-medium">{{ dateOnly(doc.due_date) }}</dd></div>
              <div><dt class="text-xs text-text-secondary">Identificador fiscal</dt><dd class="break-all font-mono text-sm">{{ doc.document_key || 'No informado' }}</dd></div>
              <div><dt class="text-xs text-text-secondary">Subtotal del encabezado</dt><dd class="font-medium">{{ money(doc.subtotal_amount, doc.currency) }}</dd></div>
              <div><dt class="text-xs text-text-secondary">Impuestos del encabezado</dt><dd class="font-medium">{{ money(doc.tax_amount, doc.currency) }}</dd></div>
              <div><dt class="text-xs text-text-secondary">Total del encabezado</dt><dd class="font-semibold">{{ money(doc.total_amount, doc.currency) }}</dd></div>
            </dl>
            @if (!doc.currency || !validCurrency(doc.currency)) { <p class="mt-3 text-sm text-warning" role="note">La moneda no está identificada correctamente; los importes se muestran sin conversión.</p> }
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
            <h2 id="validation-title" class="mb-3 text-lg font-semibold">Validación y revisión</h2>
            @if (doc.validation_summary?.errors?.length) { <div class="mb-3 rounded-lg border border-error/30 bg-error-light p-3" role="alert"><h3 class="font-medium text-error">Inconsistencias</h3><ul class="list-inside list-disc text-sm text-error">@for (issue of doc.validation_summary?.errors ?? []; track $index) { <li>{{ issue.message }}</li> }</ul></div> }
            @if (doc.validation_summary?.warnings?.length) { <div class="rounded-lg border border-warning/30 bg-warning-light p-3" role="note"><h3 class="font-medium">Advertencias</h3><ul class="list-inside list-disc text-sm">@for (issue of doc.validation_summary?.warnings ?? []; track $index) { <li>{{ issue.message }}</li> }</ul></div> }
            @if (!doc.validation_summary?.errors?.length && !doc.validation_summary?.warnings?.length) { <p class="text-sm text-text-secondary">Sin observaciones de validación registradas.</p> }
          </section>
        </app-card>

        <app-card [responsive]="true">
          <section aria-labelledby="evidence-title">
            <h2 id="evidence-title" class="mb-3 text-lg font-semibold">Archivos y evidencia</h2>
            @if (!doc.files?.length) { <p class="text-sm text-text-secondary">No hay archivos adjuntos.</p> }
            @for (file of doc.files ?? []; track file.id) {
              <div class="flex flex-wrap items-center justify-between gap-3 border-t border-border py-3 first:border-0">
                <div class="min-w-0"><p class="truncate font-medium">{{ file.file_name }}</p><p class="text-xs text-text-secondary">{{ file.role }} · {{ file.mime_type }} · {{ file.file_size }} bytes</p><p class="break-all font-mono text-xs text-text-secondary">SHA-256: {{ file.sha256 }}</p></div>
                <button type="button" class="rounded-lg border border-border px-3 py-2 text-sm hover:bg-surface" [disabled]="downloadingFileId() === file.id" (click)="download(doc, file)">{{ downloadingFileId() === file.id ? 'Descargando…' : 'Descargar original' }}</button>
              </div>
            }
          </section>
        </app-card>

        <app-card [responsive]="true">
          <section aria-labelledby="timeline-title">
            <h2 id="timeline-title" class="mb-3 text-lg font-semibold">Actividad y procedencia</h2>
            <p class="mb-3 text-sm text-text-secondary">Origen: {{ label(doc.source_channel) }} · Registrado: {{ dateTime(doc.created_at) }} · Versión {{ doc.version }}</p>
            @if (!doc.events?.length) { <p class="text-sm text-text-secondary">Sin eventos adicionales.</p> }
            <ol class="space-y-2">@for (event of doc.events ?? []; track event.id) { <li class="border-l-2 border-border pl-3"><p class="font-medium">{{ label(event.event_type) }} · {{ label(event.status) }}</p><time class="text-xs text-text-secondary">{{ dateTime(event.created_at) }}</time></li> }</ol>
            <details class="mt-4"><summary class="cursor-pointer text-sm font-medium">Ver metadatos de procedencia</summary><pre class="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-surface p-3 text-xs">{{ provenance(doc) }}</pre></details>
          </section>
        </app-card>
        <p class="rounded-lg border border-border bg-surface p-3 text-sm text-text-secondary">El estado validado no equivale a aceptación por la DIAN. Reconocimiento fiscal, coincidencia con recepción/compra y contabilización son procesos separados; aquí no se confirma ninguno.</p>
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
  readonly scope: ReceivedDocumentsScope = this.readScope(this.route.snapshot.data['receivedDocumentsScope']);
  private readonly routeQueryParams = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
  private readonly routeParams = toSignal(this.route.paramMap, { initialValue: this.route.snapshot.paramMap });
  readonly storeId = computed(() => this.scope === 'organization' ? this.readStoreId(this.routeQueryParams().get('store_id')) : undefined);
  readonly documentId = computed(() => this.readDocumentId(this.routeParams().get('id')));
  readonly backQueryParams = computed(() => this.scope === 'organization' && this.storeId() ? { store_id: this.storeId() } : undefined);
  readonly document = signal<ReceivedDocument | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly downloadingFileId = signal<number | null>(null);
  private activeRequest?: Subscription;

  constructor() {
    effect(() => {
      this.storeId();
      this.documentId();
      untracked(() => this.load());
    });
  }

  load(): void {
    this.activeRequest?.unsubscribe();
    const id = this.documentId();
    if (!id) { this.document.set(null); this.error.set('El identificador del documento no es válido.'); return; }
    this.document.set(null);
    this.loading.set(true); this.error.set(null);
    this.activeRequest = this.service.getById(this.scope, id, this.storeId()).pipe(takeUntilDestroyed(this.destroyRef), finalize(() => this.loading.set(false))).subscribe({
      next: (response) => this.document.set(response.data),
      error: (err: unknown) => { this.document.set(null); this.error.set(describeApiFailure(err).message || 'No se pudo cargar el documento.'); },
    });
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
    this.downloadingFileId.set(file.id);
    this.service.downloadFile(this.scope, doc.id, file.id, this.storeId()).pipe(takeUntilDestroyed(this.destroyRef), finalize(() => this.downloadingFileId.set(null))).subscribe({
      next: (response) => {
        if (!response.body) { this.toast.error('El archivo descargado está vacío.'); return; }
        const header = response.headers.get('content-disposition');
        const filename = this.safeFilename(this.filenameFromHeader(header) ?? file.file_name);
        const url = URL.createObjectURL(response.body);
        const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename;
        document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      },
      error: (err: unknown) => this.toast.error(describeApiFailure(err).message || 'No se pudo descargar el archivo original.'),
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
  label(value: unknown): string { return String(value ?? 'pendiente').replaceAll('_', ' '); }
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
  private readStoreId(value: string | null): number | undefined { const id = Number(value); return Number.isInteger(id) && id > 0 ? id : undefined; }
  private readDocumentId(value: string | null): number | null { const id = Number(value); return Number.isInteger(id) && id > 0 ? id : null; }
  private readScope(value: unknown): ReceivedDocumentsScope {
    if (value === 'store' || value === 'organization') return value;
    throw new Error('La ruta debe declarar data.receivedDocumentsScope como store u organization.');
  }
}
