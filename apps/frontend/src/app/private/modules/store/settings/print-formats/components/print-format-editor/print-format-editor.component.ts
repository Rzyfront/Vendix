import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { ButtonComponent } from '../../../../../../../shared/components/button/button.component';
import { PrintFormatsFacade } from '../../services/print-formats.facade';
import { PrintSectionsEditorComponent } from '../print-sections-editor/print-sections-editor.component';
import { PrintColumnsEditorComponent } from '../print-columns-editor/print-columns-editor.component';
import { PrintStylesEditorComponent } from '../print-styles-editor/print-styles-editor.component';
import { PrintCustomTemplateEditorComponent } from '../print-custom-template-editor/print-custom-template-editor.component';
import { PrintLivePreviewComponent } from '../print-live-preview/print-live-preview.component';
import { PrintLibraryModalComponent } from '../print-library-modal/print-library-modal.component';
import { PrintSamplePickerComponent } from '../print-sample-picker/print-sample-picker.component';

export type EditorTab = 'sections' | 'columns' | 'styles' | 'custom';

@Component({
  selector: 'app-print-format-editor',
  standalone: true,
  imports: [
    CommonModule,
    IconComponent,
    ButtonComponent,
    PrintSectionsEditorComponent,
    PrintColumnsEditorComponent,
    PrintStylesEditorComponent,
    PrintCustomTemplateEditorComponent,
    PrintLivePreviewComponent,
    PrintLibraryModalComponent,
    PrintSamplePickerComponent,
  ],
  template: `
    <div class="space-y-6">
      <!-- Sticky Header -->
      <div class="sticky top-0 z-20 bg-surface/95 backdrop-blur border-b border-border -mx-6 px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm">
        <div class="flex items-center gap-3">
          <button
            type="button"
            (click)="goBack()"
            class="p-2 rounded-lg bg-surface-secondary border border-border text-text-secondary hover:text-text-primary hover:bg-surface-hover transition"
            title="Volver a lista de formatos"
          >
            <app-icon name="arrow-left" [size]="16"></app-icon>
          </button>

          <div>
            <div class="flex items-center gap-2">
              <h2 class="text-base font-bold text-text-primary">{{ detail()?.name }}</h2>
              @if (detail()?.is_customized) {
                <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-500 border border-amber-500/20">
                  Personalizado
                </span>
              } @else {
                <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  Default Sistema
                </span>
              }
            </div>
            <p class="text-xs text-text-secondary font-mono">{{ detail()?.format_type }}</p>
          </div>
        </div>

        <!-- Action buttons -->
        <div class="flex items-center gap-2">
          <!-- [print-editor-dsk P3.3] Sample picker — let the merchant swap
               the preview between fabricated sample data and a real document. -->
          @if (detail()) {
            <app-print-sample-picker
              [formatType]="detail()!.format_type"
              [selectedDocumentId]="facade.previewDocumentId()"
              (documentSelected)="onDocumentPicked($event.id)"
            ></app-print-sample-picker>
          }

          <!-- Library Template Explorer -->
          <app-button
            variant="outline"
            size="sm"
            (clicked)="openLibrary()"
          >
            <app-icon name="book-open" [size]="14" class="mr-1.5"></app-icon>
            Biblioteca de Plantillas
          </app-button>

          <app-button
            variant="outline"
            size="sm"
            [disabled]="facade.isSaving()"
            (clicked)="resetToDefault()"
          >
            <app-icon name="rotate-ccw" [size]="14" class="mr-1.5"></app-icon>
            Restablecer
          </app-button>

          <app-button
            variant="primary"
            size="sm"
            [loading]="facade.isSaving()"
            (clicked)="save()"
          >
            <app-icon name="save" [size]="14" class="mr-1.5"></app-icon>
            {{ facade.isSaving() ? 'Guardando...' : 'Guardar Cambios' }}
          </app-button>
        </div>
      </div>

      <!-- Split Layout: Editor (Left) & Live Preview (Right) -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <!-- Editor Controls (7 Cols) -->
        <div class="lg:col-span-7 space-y-4">
          <!-- Tabs Navigation -->
          <div class="flex items-center gap-1 border-b border-border pb-1 overflow-x-auto">
            <button
              type="button"
              (click)="activeTab.set('sections')"
              [class.border-primary-500]="activeTab() === 'sections'"
              [class.text-primary-500]="activeTab() === 'sections'"
              [class.border-transparent]="activeTab() !== 'sections'"
              [class.text-text-secondary]="activeTab() !== 'sections'"
              class="px-3.5 py-2 text-xs font-semibold border-b-2 hover:text-text-primary transition flex items-center gap-2"
            >
              <app-icon name="layout-list" [size]="14"></app-icon>
              Secciones
            </button>

            @if (hasColumns()) {
              <button
                type="button"
                (click)="activeTab.set('columns')"
                [class.border-primary-500]="activeTab() === 'columns'"
                [class.text-primary-500]="activeTab() === 'columns'"
                [class.border-transparent]="activeTab() !== 'columns'"
                [class.text-text-secondary]="activeTab() !== 'columns'"
                class="px-3.5 py-2 text-xs font-semibold border-b-2 hover:text-text-primary transition flex items-center gap-2"
              >
                <app-icon name="columns" [size]="14"></app-icon>
                Columnas
              </button>
            }

            <button
              type="button"
              (click)="activeTab.set('styles')"
              [class.border-primary-500]="activeTab() === 'styles'"
              [class.text-primary-500]="activeTab() === 'styles'"
              [class.border-transparent]="activeTab() !== 'styles'"
              [class.text-text-secondary]="activeTab() !== 'styles'"
              class="px-3.5 py-2 text-xs font-semibold border-b-2 hover:text-text-primary transition flex items-center gap-2"
            >
              <app-icon name="palette" [size]="14"></app-icon>
              Estilos y Papel
            </button>

            <button
              type="button"
              (click)="activeTab.set('custom')"
              [class.border-primary-500]="activeTab() === 'custom'"
              [class.text-primary-500]="activeTab() === 'custom'"
              [class.border-transparent]="activeTab() !== 'custom'"
              [class.text-text-secondary]="activeTab() !== 'custom'"
              class="px-3.5 py-2 text-xs font-semibold border-b-2 hover:text-text-primary transition flex items-center gap-2"
            >
              <app-icon name="code" [size]="14"></app-icon>
              Plantilla Custom
            </button>
          </div>

          <!-- Tab Content Panels -->
          <div class="bg-surface border border-border rounded-xl p-5 shadow-sm">
            @switch (activeTab()) {
              @case ('sections') {
                <app-print-sections-editor></app-print-sections-editor>
              }
              @case ('columns') {
                <app-print-columns-editor></app-print-columns-editor>
              }
              @case ('styles') {
                <app-print-styles-editor></app-print-styles-editor>
              }
              @case ('custom') {
                <app-print-custom-template-editor></app-print-custom-template-editor>
              }
            }
          </div>
        </div>

        <!-- Live Preview Panel (5 Cols) -->
        <div class="lg:col-span-5 h-[calc(100vh-140px)] sticky top-24">
          <app-print-live-preview></app-print-live-preview>
        </div>
      </div>

      <!-- Library Modal -->
      <app-print-library-modal [(isOpen)]="isLibraryOpen"></app-print-library-modal>
    </div>
  `,
})
export class PrintFormatEditorComponent {
  readonly facade = inject(PrintFormatsFacade);

  readonly activeTab = signal<EditorTab>('sections');
  readonly isLibraryOpen = signal<boolean>(false);

  readonly detail = computed(() => this.facade.selectedFormatDetail());

  readonly hasColumns = computed(() => {
    const draft = this.facade.draftDefinition();
    return Boolean(draft?.columns && draft.columns.length > 0);
  });

  goBack(): void {
    this.facade.clearSelection();
  }

  openLibrary(): void {
    const d = this.detail();
    if (d) {
      this.facade.loadLibraryTemplates(d.format_type);
    }
    this.isLibraryOpen.set(true);
  }

  async resetToDefault(): Promise<void> {
    if (confirm('¿Estás seguro de restablecer este formato a la plantilla original del sistema?')) {
      await this.facade.resetCurrentFormat();
    }
  }

  async save(): Promise<void> {
    await this.facade.saveCurrentFormat();
  }

  /**
   * [print-editor-dsk P3.3] — Forwards the picker's choice to the facade.
   * The facade delegates to `previewFormat(_, _, id)` with `immediate=true`
   * so the new sample lands on the iframe without going through the
   * 300ms debounce (which exists for draft edits, not for picker swaps).
   */
  async onDocumentPicked(documentId: number | null): Promise<void> {
    await this.facade.pickPreviewDocument(documentId);
  }
}
