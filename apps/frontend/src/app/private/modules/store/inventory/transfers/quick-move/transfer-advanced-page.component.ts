import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { from as fromArray, of } from 'rxjs';
import { catchError, map, mergeMap, toArray } from 'rxjs/operators';

import {
  ButtonComponent,
  CardComponent,
  IconComponent,
  SelectorComponent,
  SelectorOption,
  StickyHeaderComponent,
  type StickyHeaderActionButton,
} from '../../../../../../shared/components/index';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import {
  TransferDraftHandoffService,
  TransferPickerRow,
  TransferProductSearchFn,
  lineHasValidQuantity,
  totalUnits,
} from './transfer-draft';
import { TransferProductPickerComponent } from './transfer-product-picker.component';
import {
  AdvancedLine,
  AdvancedMovementMode,
  AdvancedOrderForm,
  AdvancedTransportMethod,
  EMPTY_ADVANCED_OPTIONS,
  PastedInvalid,
  SUPPORT_DOCUMENT_OPTIONS,
  TRANSPORT_METHOD_OPTIONS,
  TransferAdvancedOptions,
  TransferBatchOption,
  VEHICLE_TYPE_OPTIONS,
  addRowsToLines,
  applyDefaultBatches,
  applyPastedEntry,
  applyScan,
  batchesForLine,
  buildAdvancedPayload,
  effectiveMode,
  emptyAdvancedForm,
  findRowForCode,
  lineProjection,
  needsSupportAlert,
  parseAdvancedDraft,
  parsePastedList,
  serializeAdvancedDraft,
  toAdvancedLine,
  validateAdvancedOrder,
} from '../advanced/transfer-advanced';
import { TRANSFER_ADVANCED_API } from '../advanced/transfer-advanced-api';

/**
 * Vista avanzada (página completa) de la orden de transferencia, común a
 * tienda y organización (P3, plan §4 D3–D8).
 *
 * - Cabecera: origen y destino propios (según el scope de la superficie) o
 *   destino externo con documento soporte / motivo (aviso de alerta si faltan).
 * - Modo: solo movimiento masivo o con remisiones de salida y entrada.
 * - Productos: buscador persistente con multiselección y variantes, lote por
 *   fila (por defecto el más antiguo), escáner (+1 por lectura), pegar lista
 *   `SKU;cantidad` y "agregar todo el stock de la bodega" por categoría.
 * - Transporte (opcional) y fecha límite de entrega.
 * - Guardar borrador (en este navegador) o enviar a aprobación (crea la orden).
 *
 * Cada superficie aporta sus endpoints con `TRANSFER_ADVANCED_API`.
 */
@Component({
  selector: 'app-transfer-advanced-page',
  standalone: true,
  imports: [
    FormsModule,
    ButtonComponent,
    CardComponent,
    IconComponent,
    SelectorComponent,
    StickyHeaderComponent,
    TransferProductPickerComponent,
  ],
  templateUrl: './transfer-advanced-page.component.html',
})
export class TransferAdvancedPageComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly handoff = inject(TransferDraftHandoffService);
  readonly api = inject(TRANSFER_ADVANCED_API);

  readonly supportDocumentOptions = SUPPORT_DOCUMENT_OPTIONS;
  readonly transportMethodOptions = TRANSPORT_METHOD_OPTIONS;
  readonly vehicleTypeOptions = VEHICLE_TYPE_OPTIONS;
  readonly today = new Date().toISOString().slice(0, 10);

  readonly form = signal<AdvancedOrderForm>(emptyAdvancedForm());
  readonly locations = signal<SelectorOption[]>([]);
  readonly options = signal<TransferAdvancedOptions>(EMPTY_ADVANCED_OPTIONS);
  readonly batches = signal<TransferBatchOption[]>([]);
  private batchProductIds = new Set<number>();

  readonly submitting = signal(false);
  readonly showErrors = signal(false);
  /** Borrador guardado encontrado al entrar (se ofrece retomarlo). */
  readonly savedDraft = signal<{
    form: AdvancedOrderForm;
    saved_at: string;
  } | null>(null);

  readonly scanCode = signal('');
  readonly scanMessage = signal<{ kind: 'ok' | 'error'; text: string } | null>(
    null,
  );
  readonly scanning = signal(false);

  readonly pasteOpen = signal(false);
  readonly pasteText = signal('');
  readonly pasteProcessing = signal(false);
  readonly pasteReport = signal<{
    added: number;
    invalid: PastedInvalid[];
  } | null>(null);

  readonly stockCategoryId = signal<number | null>(null);
  readonly loadingAllStock = signal(false);

  // --- derivados ----------------------------------------------------------

  readonly mode = computed(() => effectiveMode(this.form()));
  readonly lines = computed(() => this.form().lines);
  readonly units = computed(() => totalUnits(this.lines()));
  readonly addedKeys = computed(() => this.lines().map((l) => l.key));
  readonly errors = computed(() => validateAdvancedOrder(this.form()));
  readonly supportAlert = computed(() => needsSupportAlert(this.form()));
  readonly invalidLineKeys = computed(
    () =>
      new Set(
        this.lines()
          .filter((l) => !lineHasValidQuantity(l))
          .map((l) => l.key),
      ),
  );

  readonly destinationOptions = computed(() =>
    this.locations().filter((o) => o.value !== this.form().from_location_id),
  );
  readonly categoryOptions = computed<SelectorOption[]>(() => [
    { value: 0, label: 'Todas las categorías' },
    ...this.options().categories.map((c) => ({ value: c.id, label: c.name })),
  ]);
  readonly driverOptions = computed<SelectorOption[]>(() =>
    this.options().drivers.map((d) => ({ value: d.id, label: d.name })),
  );
  readonly vehicleOptions = computed<SelectorOption[]>(() =>
    this.options().vehicles.map((v) => ({
      value: v.id,
      label: [v.plate, v.brand, v.model_name].filter(Boolean).join(' · '),
    })),
  );
  readonly internalShippingOptions = computed<SelectorOption[]>(() =>
    this.options()
      .shipping_methods.filter((m) => m.scope === 'internal')
      .map((m) => ({ value: m.id, label: m.name })),
  );
  readonly externalShippingOptions = computed<SelectorOption[]>(() =>
    this.options()
      .shipping_methods.filter((m) => m.scope === 'external')
      .map((m) => ({ value: m.id, label: m.name })),
  );

  readonly headerActions = computed<StickyHeaderActionButton[]>(() => [
    { id: 'back', label: 'Volver', variant: 'outline', icon: 'arrow-left' },
    {
      id: 'draft',
      label: 'Guardar borrador',
      variant: 'secondary',
      icon: 'save',
      disabled: this.submitting(),
      title: 'Guarda el formulario en este navegador para retomarlo después',
    },
    {
      id: 'submit',
      label: 'Enviar a aprobación',
      variant: 'primary',
      icon: 'send',
      loading: this.submitting(),
      disabled: this.submitting(),
    },
  ]);
  readonly headerMetadata = computed(
    () => `${this.lines().length} producto(s) · ${this.units()} unidad(es)`,
  );

  /** Búsqueda del picker; en salida externa se consulta solo con el origen. */
  readonly searchFn: TransferProductSearchFn = (term, from, to) =>
    this.api.searchProducts(term, from, to || from);

  constructor() {
    this.api
      .getLocations()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => this.locations.set(rows),
        error: () => this.toast.error('No se pudieron cargar las bodegas'),
      });

    const inherited = this.handoff.consume();
    if (inherited) {
      // Lo que ya se llenó en el modal rápido.
      this.form.set({
        ...emptyAdvancedForm(),
        from_location_id: inherited.from_location_id,
        to_location_id: inherited.to_location_id,
        notes: inherited.notes ?? '',
        lines: inherited.lines.map(toAdvancedLine),
      });
      this.onOriginReady();
    } else {
      this.savedDraft.set(parseAdvancedDraft(this.readStorage()));
    }
  }

  // --- helpers de formulario ----------------------------------------------

  patch(changes: Partial<AdvancedOrderForm>): void {
    this.form.update((f) => ({ ...f, ...changes }));
  }

  patchExternal(changes: Partial<AdvancedOrderForm['external']>): void {
    this.form.update((f) => ({
      ...f,
      external: { ...f.external, ...changes },
    }));
  }

  patchTransport(changes: Partial<AdvancedOrderForm['transport']>): void {
    this.form.update((f) => ({
      ...f,
      transport: { ...f.transport, ...changes },
    }));
  }

  setMode(mode: AdvancedMovementMode): void {
    if (this.form().is_external && mode === 'mass_only') return;
    this.patch({ mode });
  }

  setExternal(isExternal: boolean): void {
    this.patch({
      is_external: isExternal,
      to_location_id: isExternal ? null : this.form().to_location_id,
      ...(isExternal ? { mode: 'with_dispatch_notes' as const } : {}),
    });
  }

  setTransportMethod(method: AdvancedTransportMethod): void {
    this.patchTransport({
      method,
      vehicle_id: null,
      shipping_method_id: null,
      new_vehicle_plate: '',
    });
  }

  onFromChange(value: number | null): void {
    const fromId = value ? Number(value) : null;
    const hadLines = this.lines().length > 0;
    this.patch({
      from_location_id: fromId,
      to_location_id:
        this.form().to_location_id === fromId
          ? null
          : this.form().to_location_id,
      lines: [],
    });
    this.batches.set([]);
    this.batchProductIds = new Set();
    this.options.set(EMPTY_ADVANCED_OPTIONS);
    if (hadLines) {
      this.toast.info(
        'Cambiaste la bodega de origen: vuelve a cargar los productos, el disponible es otro.',
      );
    }
    this.onOriginReady();
  }

  onToChange(value: number | null): void {
    this.patch({ to_location_id: value ? Number(value) : null });
  }

  /** Carga las opciones de transporte y los lotes del origen. */
  private onOriginReady(): void {
    const fromId = this.form().from_location_id;
    if (!fromId) return;
    this.api
      .getOptions(fromId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (opts) =>
          this.options.set({ ...EMPTY_ADVANCED_OPTIONS, ...opts }),
        error: () =>
          this.toast.warning(
            'No se pudieron cargar vehículos y formas de envío. Puedes seguir sin transporte.',
          ),
      });
    this.ensureBatches();
  }

  /** Pide los lotes de los productos nuevos y asigna el más antiguo (D5). */
  private ensureBatches(): void {
    const fromId = this.form().from_location_id;
    if (!fromId) return;
    const missing = [...new Set(this.lines().map((l) => l.product_id))].filter(
      (id) => !this.batchProductIds.has(id),
    );
    if (missing.length === 0) {
      this.form.update((f) => ({
        ...f,
        lines: applyDefaultBatches(f.lines, this.batches()),
      }));
      return;
    }
    missing.forEach((id) => this.batchProductIds.add(id));
    this.api
      .getBatches(fromId, missing)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => {
          if (this.form().from_location_id !== fromId) return;
          this.batches.update((current) => [...current, ...rows]);
          this.form.update((f) => ({
            ...f,
            lines: applyDefaultBatches(f.lines, this.batches()),
          }));
        },
        error: () => missing.forEach((id) => this.batchProductIds.delete(id)),
      });
  }

  // --- líneas -------------------------------------------------------------

  lineBatches(line: AdvancedLine): TransferBatchOption[] {
    return batchesForLine(this.batches(), line);
  }

  projection(line: AdvancedLine) {
    return lineProjection(line);
  }

  onAddRows(rows: TransferPickerRow[]): void {
    const result = addRowsToLines(this.lines(), rows);
    this.patch({ lines: result.lines });
    if (result.skipped > 0) {
      this.toast.info(
        `${result.skipped} producto(s) ya estaban en la orden o sin disponible.`,
      );
    }
    this.ensureBatches();
  }

  updateQuantity(key: string, raw: string): void {
    const quantity = raw === '' ? 0 : Math.floor(Number(raw));
    this.form.update((f) => ({
      ...f,
      lines: f.lines.map((l) =>
        l.key === key
          ? { ...l, quantity: Number.isFinite(quantity) ? quantity : 0 }
          : l,
      ),
    }));
  }

  updateBatch(key: string, raw: string): void {
    const batchId = raw ? Number(raw) : null;
    this.form.update((f) => ({
      ...f,
      lines: f.lines.map((l) =>
        l.key === key ? { ...l, batch_id: batchId } : l,
      ),
    }));
  }

  removeLine(key: string): void {
    this.patch({ lines: this.lines().filter((l) => l.key !== key) });
  }

  clearLines(): void {
    this.patch({ lines: [] });
  }

  // --- escáner ------------------------------------------------------------

  onScan(): void {
    const code = this.scanCode().trim();
    const fromId = this.form().from_location_id;
    if (!code) return;
    if (!fromId) {
      this.scanMessage.set({
        kind: 'error',
        text: 'Elige primero la bodega de origen.',
      });
      return;
    }
    this.scanning.set(true);
    this.api
      .searchProducts(code, fromId, this.form().to_location_id || fromId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => {
          this.scanning.set(false);
          this.scanCode.set('');
          const row = findRowForCode(rows, code);
          if (!row) {
            this.scanMessage.set({
              kind: 'error',
              text:
                rows.length > 1
                  ? `"${code}" coincide con varios productos: búscalo por nombre.`
                  : `No encontramos "${code}" con disponible en la bodega de origen.`,
            });
            return;
          }
          const result = applyScan(this.lines(), row);
          this.patch({ lines: result.lines });
          const name = row.variant_name
            ? `${row.name} · ${row.variant_name}`
            : row.name;
          const messages: Record<
            string,
            { kind: 'ok' | 'error'; text: string }
          > = {
            added: { kind: 'ok', text: `Agregado: ${name}` },
            incremented: { kind: 'ok', text: `+1 ${name}` },
            no_stock: {
              kind: 'error',
              text: `${name} no tiene disponible en origen.`,
            },
            max_reached: {
              kind: 'error',
              text: `${name}: ya llegaste al disponible en origen.`,
            },
          };
          this.scanMessage.set(messages[result.outcome]);
          if (result.outcome === 'added') this.ensureBatches();
        },
        error: () => {
          this.scanning.set(false);
          this.scanMessage.set({
            kind: 'error',
            text: 'No se pudo buscar el código. Intenta de nuevo.',
          });
        },
      });
  }

  // --- pegar lista --------------------------------------------------------

  processPaste(): void {
    const fromId = this.form().from_location_id;
    if (!fromId) {
      this.toast.warning('Elige primero la bodega de origen.');
      return;
    }
    const { entries, invalid } = parsePastedList(this.pasteText());
    if (entries.length === 0) {
      this.pasteReport.set({ added: 0, invalid });
      return;
    }
    const toId = this.form().to_location_id || fromId;
    this.pasteProcessing.set(true);
    fromArray(entries)
      .pipe(
        mergeMap(
          (entry) =>
            this.api.searchProducts(entry.sku, fromId, toId).pipe(
              map((rows) => ({ entry, rows })),
              catchError(() => of({ entry, rows: [] as TransferPickerRow[] })),
            ),
          4,
        ),
        toArray(),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((results) => {
        let lines = this.lines();
        let added = 0;
        const problems = [...invalid];
        results
          .sort((a, b) => a.entry.line - b.entry.line)
          .forEach(({ entry, rows }) => {
            const wanted = entry.sku.toLowerCase();
            const exact = rows.filter(
              (r) => (r.sku ?? '').trim().toLowerCase() === wanted,
            );
            if (exact.length !== 1) {
              problems.push({
                line: entry.line,
                raw: `${entry.sku};${entry.quantity}`,
                reason:
                  exact.length > 1
                    ? 'El SKU corresponde a varios productos'
                    : 'SKU no encontrado en la bodega de origen',
              });
              return;
            }
            const applied = applyPastedEntry(lines, exact[0], entry.quantity);
            if (applied.error) {
              problems.push({
                line: entry.line,
                raw: `${entry.sku};${entry.quantity}`,
                reason: applied.error,
              });
              return;
            }
            lines = applied.lines;
            added++;
          });
        problems.sort((a, b) => a.line - b.line);
        this.patch({ lines });
        this.pasteProcessing.set(false);
        this.pasteReport.set({ added, invalid: problems });
        if (added > 0) {
          this.ensureBatches();
          if (problems.length === 0) this.pasteText.set('');
        }
      });
  }

  // --- agregar todo el stock ---------------------------------------------

  addAllStock(): void {
    const fromId = this.form().from_location_id;
    if (!fromId) {
      this.toast.warning('Elige primero la bodega de origen.');
      return;
    }
    this.loadingAllStock.set(true);
    this.api
      .getLocationStock(
        fromId,
        this.form().to_location_id,
        this.stockCategoryId() || null,
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => {
          this.loadingAllStock.set(false);
          const result = addRowsToLines(this.lines(), rows, {
            fullStock: true,
          });
          this.patch({ lines: result.lines });
          this.toast.success(
            result.added > 0
              ? `Se agregaron ${result.added} producto(s) con todo su disponible.`
              : 'No hay productos nuevos con disponible para agregar.',
          );
          this.ensureBatches();
        },
        error: (e: Error) => {
          this.loadingAllStock.set(false);
          this.toast.error(
            e.message || 'No se pudo cargar el stock de la bodega',
          );
        },
      });
  }

  // --- borrador y envío ---------------------------------------------------

  onHeaderAction(id: string): void {
    if (id === 'back') void this.router.navigate([this.api.listRoute]);
    if (id === 'draft') this.saveDraft();
    if (id === 'submit') this.submit();
  }

  saveDraft(): void {
    try {
      localStorage.setItem(
        this.api.draftStorageKey,
        serializeAdvancedDraft(this.form()),
      );
      this.toast.success(
        'Borrador guardado en este navegador. Puedes retomarlo cuando vuelvas.',
      );
    } catch {
      this.toast.error('No se pudo guardar el borrador en este navegador.');
    }
  }

  resumeDraft(): void {
    const saved = this.savedDraft();
    if (!saved) return;
    this.form.set(saved.form);
    this.savedDraft.set(null);
    this.batchProductIds = new Set();
    this.batches.set([]);
    this.onOriginReady();
  }

  discardDraft(): void {
    this.clearStorage();
    this.savedDraft.set(null);
  }

  submit(): void {
    if (this.submitting()) return;
    this.showErrors.set(true);
    const payload = buildAdvancedPayload(this.form());
    if (!payload) {
      this.toast.warning('Revisa los datos marcados antes de enviar.');
      return;
    }
    this.submitting.set(true);
    this.api
      .create(payload)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (created) => {
          this.submitting.set(false);
          this.clearStorage();
          this.toast.success(
            `Transferencia ${created?.transfer_number ?? ''} creada: queda pendiente de aprobación.`.replace(
              '  ',
              ' ',
            ),
          );
          void this.router.navigate([this.api.listRoute]);
        },
        error: (e: Error) => {
          this.submitting.set(false);
          this.toast.error(e.message || 'No se pudo crear la transferencia');
        },
      });
  }

  private readStorage(): string | null {
    try {
      return localStorage.getItem(this.api.draftStorageKey);
    } catch {
      return null;
    }
  }

  private clearStorage(): void {
    try {
      localStorage.removeItem(this.api.draftStorageKey);
    } catch {
      /* sin almacenamiento disponible */
    }
  }
}
