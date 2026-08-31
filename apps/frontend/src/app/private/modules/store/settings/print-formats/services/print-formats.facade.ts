import { Injectable, inject, signal, computed } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  PrintFormatType,
  StorePrintFormatSummary,
  StorePrintFormatDetail,
  PrintFormatDefinition,
  PrintFieldDefinition,
  PrintTemplate,
  PrintRecentDocument,
  PrintPreviewMode,
  PrintSelectedElement,
  PrintAnnexValidationSummary,
} from '../../../../../../core/models/print-formats.model';
import { PrintGatewayClientService } from '../../../../../../shared/services/print/print-gateway-client.service';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { PrintAnnexValidatorService } from './print-annex-validator.service';

@Injectable({
  providedIn: 'root',
})
export class PrintFormatsFacade {
  private readonly client = inject(PrintGatewayClientService);
  private readonly toast = inject(ToastService);
  private readonly annexValidator = inject(PrintAnnexValidatorService);

  // State Signals
  readonly formats = signal<StorePrintFormatSummary[]>([]);
  readonly selectedFormatDetail = signal<StorePrintFormatDetail | null>(null);
  readonly draftDefinition = signal<PrintFormatDefinition | null>(null);
  readonly previewHtml = signal<string>('');
  readonly previewWidthMm = signal<number>(80);
  readonly previewIsRoll = signal<boolean>(true);
  readonly isLoading = signal<boolean>(false);
  readonly isSaving = signal<boolean>(false);
  readonly isPreviewLoading = signal<boolean>(false);
  readonly previewMode = signal<PrintPreviewMode>('dummy');
  readonly selectedElement = signal<PrintSelectedElement | null>(null);
  readonly selectedRegionId = signal<string | null>(null);
  readonly libraryTemplates = signal<PrintTemplate[]>([]);
  readonly activeCategoryFilter = signal<string>('all');
  /**
   * Texto libre del buscador del hub. Es writable a proposito: el hub lo
   * escribe con `searchQuery.set($event)` desde `(ngModelChange)`, y
   * `filteredFormats` lo lee para cruzarlo con `activeCategoryFilter`.
   */
  readonly searchQuery = signal<string>('');
  readonly isLeftSidebarCollapsed = signal<boolean>(false);
  readonly isRightSidebarCollapsed = signal<boolean>(false);
  readonly activeLeftTab = signal<'sections' | 'columns' | 'tokens'>('sections');
  readonly zoomLevel = signal<number>(100);
  /** [print-editor-dsk P3.3] — Most-recent sample documents for the active format. */
  readonly recentDocuments = signal<PrintRecentDocument[]>([]);
  /** [print-editor-dsk P3.3] — Document id currently feeding the preview, or null for fabricated sample data. */
  readonly previewDocumentId = signal<number | null>(null);
  /** [print-editor-dsk P3.3] — Loading flag for the sample picker. */
  readonly isLoadingRecentDocuments = signal<boolean>(false);

  /**
   * [print-editor-dsk P3.4] — Debounce handle for `refreshPreview`. Cancellable
   * by clearing the timeout (see `refreshPreview`).
   */
  private previewDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * [print-editor-dsk P3.4] — Generation counter to discard stale preview
   * responses when the user keeps typing/changing draft before the debounce
   * settles. The latest `refreshPreviewNow` always wins.
   */
  private previewGeneration = 0;

  // Computed
  readonly filteredFormats = computed(() => {
    const list = this.formats();
    const cat = this.activeCategoryFilter();
    const query = this.searchQuery().toLowerCase().trim();

    return list.filter((f) => {
      const matchCat = cat === 'all' || f.category === cat;
      const matchQuery =
        !query ||
        f.name.toLowerCase().includes(query) ||
        f.category.toLowerCase().includes(query) ||
        f.format_type.toLowerCase().includes(query);
      return matchCat && matchQuery;
    });
  });

  readonly categories = computed(() => {
    const list = this.formats();
    const set = new Set<string>();
    for (const f of list) {
      if (f.category) set.add(f.category);
    }
    return ['all', ...Array.from(set)];
  });

  /**
   * [print-editor-dsk P6] — Formats grouped by category for the redesigned
   * Hub. Iterates `formats()` and partitions by `category`, preserving the
   * canonical category order (Logística, Ventas POS, Ventas, Comercial,
   * Compras, Inventario, Facturación, Restaurante) when known so the Hub
   * renders top-down in the same order as the dashboard.
   */
  readonly formatsByCategory = computed(() => {
    const list = this.formats();
    const groups = new Map<string, StorePrintFormatSummary[]>();
    for (const fmt of list) {
      const cat = fmt.category || 'Otros';
      const bucket = groups.get(cat) ?? [];
      bucket.push(fmt);
      groups.set(cat, bucket);
    }
    return Array.from(groups.entries()).map(([category, formats]) => ({
      category,
      formats,
    }));
  });

  /**
   * [print-editor-dsk P6] — Formats that have a non-default template
   * assigned (i.e. the merchant cloned a library template or wrote custom
   * overrides). Used by the Hub's header stats banner.
   */
  readonly customizedFormatCount = computed(() => {
    return this.formats().filter(
      (f) => f.template_name && f.template_name !== 'Por defecto del sistema',
    ).length;
  });

  /**
   * Evaluates the current draft definition against DIAN Anexo Técnico 1.9
   * and Colombian fiscal requirements.
   */
  readonly annexValidation = computed<PrintAnnexValidationSummary | null>(() => {
    const detail = this.selectedFormatDetail();
    const draft = this.draftDefinition();
    if (!detail || !draft) return null;
    return this.annexValidator.validate(draft, detail.format_type);
  });

  async loadFormats(): Promise<void> {
    this.isLoading.set(true);
    try {
      const data = await firstValueFrom(this.client.listFormats());
      this.formats.set(data);
    } catch (err: any) {
      this.toast.error(err?.error?.message || 'Error al cargar los formatos de impresión.');
    } finally {
      this.isLoading.set(false);
    }
  }

  async selectFormat(formatType: PrintFormatType): Promise<void> {
    this.isLoading.set(true);
    try {
      const detail = await firstValueFrom(this.client.getFormatDetail(formatType));
      this.selectedFormatDetail.set(detail);
      // Clonar profundamente la definición para edición
      this.draftDefinition.set(JSON.parse(JSON.stringify(detail.definition)));
      // Reset sample picker state on every format switch.
      this.previewDocumentId.set(null);
      this.recentDocuments.set([]);
      this.isLoading.set(false);
      // Immediate preview on format selection — no debounce.
      await this.refreshPreview(undefined, true);
    } catch (err: any) {
      this.toast.error(err?.error?.message || 'Error al cargar el detalle del formato.');
      this.isLoading.set(false);
    }
  }

  clearSelection(): void {
    this.selectedFormatDetail.set(null);
    this.draftDefinition.set(null);
    this.previewHtml.set('');
    this.previewDocumentId.set(null);
    this.recentDocuments.set([]);
    if (this.previewDebounceTimer) {
      clearTimeout(this.previewDebounceTimer);
      this.previewDebounceTimer = null;
    }
  }

  updateDraftDefinition(updater: (current: PrintFormatDefinition) => PrintFormatDefinition): void {
    const current = this.draftDefinition();
    if (!current) return;
    const updated = updater(JSON.parse(JSON.stringify(current)));
    this.draftDefinition.set(updated);
    // Debounced preview — keeps the editor responsive while the user drags
    // margins / toggles sections / edits columns.
    void this.refreshPreview();
  }

  /**
   * [print-editor-dsk P3.4] — Debounced preview entry point.
   *
   * - `immediate = true` → fire now (used by format selection, template clone,
   *   and the sample picker when the merchant picks a real doc).
   * - Default → 300ms debounce so back-to-back changes coalesce into one
   *   backend roundtrip. A generation counter inside `refreshPreviewNow`
   *   guarantees the latest call wins even if a stale request is in flight.
   */
  async refreshPreview(sampleDocId?: number, immediate = false): Promise<void> {
    if (this.previewDebounceTimer) {
      clearTimeout(this.previewDebounceTimer);
      this.previewDebounceTimer = null;
    }

    const trigger = () => this.refreshPreviewNow(sampleDocId);
    if (immediate) {
      await trigger();
      return;
    }
    this.previewDebounceTimer = setTimeout(() => {
      this.previewDebounceTimer = null;
      void trigger();
    }, 300);
  }

  private async refreshPreviewNow(sampleDocId?: number): Promise<void> {
    const detail = this.selectedFormatDetail();
    const draft = this.draftDefinition();
    if (!detail || !draft) return;

    const docId = sampleDocId ?? this.previewDocumentId() ?? undefined;
    this.previewDocumentId.set(docId ?? null);

    const generation = ++this.previewGeneration;
    this.isPreviewLoading.set(true);
    try {
      const preview = await firstValueFrom(
        this.client.previewFormat(detail.format_type, draft, docId, this.previewMode()),
      );
      // Drop the response if a newer call has started.
      if (generation !== this.previewGeneration) return;
      this.previewHtml.set(preview.html);
      this.previewWidthMm.set(preview.width_mm);
      this.previewIsRoll.set(preview.is_roll);
    } catch (err: any) {
      // Ignorar debounce preview errors para no saturar al usuario
    } finally {
      if (generation === this.previewGeneration) {
        this.isPreviewLoading.set(false);
      }
    }
  }

  setPreviewMode(mode: PrintPreviewMode): void {
    this.previewMode.set(mode);
    void this.refreshPreview(undefined, true);
  }

  toggleLeftSidebar(): void {
    this.isLeftSidebarCollapsed.update((v) => !v);
  }

  toggleRightSidebar(): void {
    this.isRightSidebarCollapsed.update((v) => !v);
  }

  setZoom(level: number): void {
    this.zoomLevel.set(Math.max(40, Math.min(200, Math.round(level))));
  }

  selectElement(el: PrintSelectedElement | null): void {
    this.selectedElement.set(el);
    if (el?.columnId) {
      this.selectedRegionId.set(`col-${el.columnId}`);
      this.isRightSidebarCollapsed.set(false);
    } else if (el?.elementId?.startsWith('comp_')) {
      this.selectedRegionId.set(`comp-${el.elementId.replace('comp_', '')}`);
      this.isRightSidebarCollapsed.set(false);
    } else if (el?.elementId === 'f_logo') {
      this.selectedRegionId.set('logo');
      this.isRightSidebarCollapsed.set(false);
    } else if (el?.elementId) {
      this.selectedRegionId.set(`field-${el.elementId}`);
      this.isRightSidebarCollapsed.set(false);
    } else if (el?.sectionId) {
      this.selectedRegionId.set(`sec-${el.sectionId}`);
      this.isRightSidebarCollapsed.set(false);
    } else {
      this.selectedRegionId.set(null);
    }
  }

  updateField(sectionId: string, fieldId: string, updates: Partial<PrintFieldDefinition>): void {
    const draft = this.draftDefinition();
    if (!draft) return;
    const cloned: PrintFormatDefinition = JSON.parse(JSON.stringify(draft));
    const sec = cloned.sections?.find((s) => s.id === sectionId || s.type === sectionId);
    if (!sec || !sec.fields) return;
    const fieldIndex = sec.fields.findIndex((f) => f.id === fieldId || f.key === fieldId);
    if (fieldIndex >= 0) {
      sec.fields[fieldIndex] = { ...sec.fields[fieldIndex], ...updates };
      this.draftDefinition.set(cloned);
      void this.refreshPreview();
    }
  }

  /**
   * [print-editor-dsk P3.3] — Loads recent real documents for the picker.
   * Cached per `formatType` so opening the dropdown twice does not refetch.
   */
  async loadRecentDocuments(formatType: PrintFormatType, limit = 20): Promise<void> {
    if (this.isLoadingRecentDocuments()) return;
    this.isLoadingRecentDocuments.set(true);
    try {
      const docs = await firstValueFrom(this.client.getRecentDocuments(formatType, limit));
      this.recentDocuments.set(docs ?? []);
    } catch {
      this.recentDocuments.set([]);
    } finally {
      this.isLoadingRecentDocuments.set(false);
    }
  }

  /**
   * [print-editor-dsk P3.3] — Picks the document feeding the live preview.
   * `null` reverts to fabricated sample data.
   */
  async pickPreviewDocument(documentId: number | null): Promise<void> {
    this.previewDocumentId.set(documentId);
    await this.refreshPreview(documentId ?? undefined, true);
  }

  async saveCurrentFormat(): Promise<boolean> {
    const detail = this.selectedFormatDetail();
    const draft = this.draftDefinition();
    if (!detail || !draft) return false;

    this.isSaving.set(true);
    try {
      const updated = await firstValueFrom(
        this.client.updateFormat(detail.format_type, {
          is_active: detail.is_active,
          gateway_enabled: detail.gateway_enabled,
          template_id: detail.template_id,
          overrides: draft,
        }),
      );
      this.selectedFormatDetail.set(updated);
      this.toast.success('Formato de impresión guardado exitosamente.');
      await this.loadFormats();
      return true;
    } catch (err: any) {
      this.toast.error(err?.error?.message || 'Error al guardar el formato.');
      return false;
    } finally {
      this.isSaving.set(false);
    }
  }

  async toggleGateway(formatType: PrintFormatType, currentStatus: boolean): Promise<void> {
    try {
      if (currentStatus) {
        await firstValueFrom(this.client.deactivateGateway(formatType));
        this.toast.info('Print Gateway desactivado. Modo estándar activo.');
      } else {
        await firstValueFrom(this.client.activateGateway(formatType));
        this.toast.success('Print Gateway activado para este formato.');
      }
      await this.loadFormats();
      if (this.selectedFormatDetail()?.format_type === formatType) {
        await this.selectFormat(formatType);
      }
    } catch (err: any) {
      this.toast.error(err?.error?.message || 'Error al cambiar estado del Print Gateway.');
    }
  }

  /**
   * [print-editor-dsk P6] — Bulk activate/deactivate for every format in a
   * category. Used by the Hub's per-category "Activar todos" / "Desactivar
   * todos" buttons. Processes the calls sequentially so the backend is not
   * flooded with parallel POSTs and so the toast surfaces a single
   * completion message.
   */
  async bulkToggleCategoryGateway(
    category: string,
    targetStatus: boolean,
  ): Promise<void> {
    const targets = this.formats().filter(
      (f) => f.category === category && f.gateway_enabled !== targetStatus,
    );
    if (targets.length === 0) {
      this.toast.info(
        targetStatus
          ? `Todos los formatos de "${category}" ya tienen el gateway activo.`
          : `Todos los formatos de "${category}" ya tienen el gateway inactivo.`,
      );
      return;
    }

    let succeeded = 0;
    for (const fmt of targets) {
      try {
        if (targetStatus) {
          await firstValueFrom(this.client.activateGateway(fmt.format_type));
        } else {
          await firstValueFrom(this.client.deactivateGateway(fmt.format_type));
        }
        succeeded += 1;
      } catch (err: any) {
        this.toast.error(
          err?.error?.message ||
            `Error al cambiar estado del gateway para ${fmt.format_type}.`,
        );
      }
    }
    if (succeeded > 0) {
      this.toast.success(
        targetStatus
          ? `${succeeded} formato(s) activados en "${category}".`
          : `${succeeded} formato(s) desactivados en "${category}".`,
      );
    }
    await this.loadFormats();
  }

  async resetCurrentFormat(): Promise<void> {
    const detail = this.selectedFormatDetail();
    if (!detail) return;

    this.isSaving.set(true);
    try {
      await firstValueFrom(this.client.resetFormat(detail.format_type));
      this.toast.info('Formato restablecido a los valores por defecto del sistema.');
      await this.selectFormat(detail.format_type);
      await this.loadFormats();
    } catch (err: any) {
      this.toast.error(err?.error?.message || 'Error al restablecer el formato.');
    } finally {
      this.isSaving.set(false);
    }
  }

  // Library
  async loadLibraryTemplates(formatType?: PrintFormatType): Promise<void> {
    this.isLoading.set(true);
    try {
      const templates = await firstValueFrom(this.client.listLibraryTemplates(formatType));
      this.libraryTemplates.set(templates);
    } catch (err: any) {
      this.toast.error(err?.error?.message || 'Error al cargar plantillas de la biblioteca.');
    } finally {
      this.isLoading.set(false);
    }
  }

  async cloneTemplate(templateId: number): Promise<void> {
    this.isSaving.set(true);
    try {
      const updated = await firstValueFrom(this.client.cloneLibraryTemplate(templateId));
      this.selectedFormatDetail.set(updated);
      this.draftDefinition.set(JSON.parse(JSON.stringify(updated.definition)));
      this.previewDocumentId.set(null);
      this.toast.success('Plantilla aplicada correctamente a la tienda.');
      await this.loadFormats();
      await this.refreshPreview(undefined, true);
    } catch (err: any) {
      this.toast.error(err?.error?.message || 'Error al aplicar la plantilla.');
    } finally {
      this.isSaving.set(false);
    }
  }

  async createLibraryTemplate(dto: {
    format_type: PrintFormatType;
    name: string;
    description?: string;
    definition: Record<string, any>;
    is_shared?: boolean;
  }): Promise<void> {
    this.isSaving.set(true);
    try {
      await firstValueFrom(this.client.createLibraryTemplate(dto));
      this.toast.success('Plantilla guardada en la biblioteca de la organización.');
      await this.loadLibraryTemplates(dto.format_type);
    } catch (err: any) {
      this.toast.error(err?.error?.message || 'Error al crear plantilla en la biblioteca.');
    } finally {
      this.isSaving.set(false);
    }
  }
}
