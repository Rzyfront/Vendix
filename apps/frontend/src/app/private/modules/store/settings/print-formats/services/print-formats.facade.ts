import { Injectable, inject, signal, computed } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  PrintFormatType,
  StorePrintFormatSummary,
  StorePrintFormatDetail,
  PrintFormatDefinition,
  PrintTemplate,
} from '../../../../../../core/models/print-formats.model';
import { PrintGatewayClientService } from '../../../../../../shared/services/print/print-gateway-client.service';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';

@Injectable({
  providedIn: 'root',
})
export class PrintFormatsFacade {
  private readonly client = inject(PrintGatewayClientService);
  private readonly toast = inject(ToastService);

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
  readonly libraryTemplates = signal<PrintTemplate[]>([]);
  readonly activeCategoryFilter = signal<string>('all');
  readonly searchQuery = signal<string>('');

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
      this.isLoading.set(false);
      this.refreshPreview();
    } catch (err: any) {
      this.toast.error(err?.error?.message || 'Error al cargar el detalle del formato.');
      this.isLoading.set(false);
    }
  }

  clearSelection(): void {
    this.selectedFormatDetail.set(null);
    this.draftDefinition.set(null);
    this.previewHtml.set('');
  }

  updateDraftDefinition(updater: (current: PrintFormatDefinition) => PrintFormatDefinition): void {
    const current = this.draftDefinition();
    if (!current) return;
    const updated = updater(JSON.parse(JSON.stringify(current)));
    this.draftDefinition.set(updated);
    this.refreshPreview();
  }

  async refreshPreview(sampleDocId?: number): Promise<void> {
    const detail = this.selectedFormatDetail();
    const draft = this.draftDefinition();
    if (!detail || !draft) return;

    this.isPreviewLoading.set(true);
    try {
      const preview = await firstValueFrom(
        this.client.previewFormat(detail.format_type, draft, sampleDocId),
      );
      this.previewHtml.set(preview.html);
      this.previewWidthMm.set(preview.width_mm);
      this.previewIsRoll.set(preview.is_roll);
    } catch (err: any) {
      // Ignorar debounce preview errors para no saturar al usuario
    } finally {
      this.isPreviewLoading.set(false);
    }
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
      this.toast.success('Plantilla aplicada correctamente a la tienda.');
      await this.loadFormats();
      await this.refreshPreview();
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
