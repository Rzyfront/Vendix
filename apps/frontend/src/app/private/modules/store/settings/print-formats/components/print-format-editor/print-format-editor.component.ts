import { Component, inject, signal, computed, ElementRef, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { ButtonComponent } from '../../../../../../../shared/components/button/button.component';
import { PrintFormatsFacade } from '../../services/print-formats.facade';
import { PrintSectionsEditorComponent } from '../print-sections-editor/print-sections-editor.component';
import { PrintColumnsEditorComponent } from '../print-columns-editor/print-columns-editor.component';
import { PrintTokenCatalogComponent } from '../print-token-catalog/print-token-catalog.component';
import { PrintLibraryModalComponent } from '../print-library-modal/print-library-modal.component';
import { PrintSamplePickerComponent } from '../print-sample-picker/print-sample-picker.component';
import { PrintAnnexModalComponent } from '../print-annex-modal/print-annex-modal.component';
import { PrintPropertiesPanelComponent } from '../print-properties-panel/print-properties-panel.component';
import {
  CanvasRegion,
  PrintAnnexValidationRule,
  PrintFormatDefinition,
  PrintPreviewMode,
} from '../../../../../../../core/models/print-formats.model';
import { definitionToRegions } from '../print-canvas/canvas-region';

export type WorkbenchTab = 'sections' | 'columns' | 'tokens';

@Component({
  selector: 'app-print-format-editor',
  standalone: true,
  imports: [
    CommonModule,
    IconComponent,
    ButtonComponent,
    PrintSectionsEditorComponent,
    PrintColumnsEditorComponent,
    PrintTokenCatalogComponent,
    PrintLibraryModalComponent,
    PrintSamplePickerComponent,
    PrintAnnexModalComponent,
    PrintPropertiesPanelComponent,
  ],
  template: `
    <div class="vendix-editor-container space-y-4">
      <!-- Clean Top Bar with Perfectly Aligned Button Slots -->
      <header class="sticky top-0 z-20 bg-surface/95 backdrop-blur border border-border rounded-xl px-4 py-3 flex flex-col lg:flex-row lg:items-center justify-between gap-3 shadow-xs">
        <div class="flex items-center gap-3 min-w-0">
          <button
            type="button"
            (click)="goBack()"
            class="p-2 rounded-lg bg-surface-secondary border border-border text-text-secondary hover:text-text-primary hover:bg-surface-hover transition cursor-pointer shrink-0"
            title="Volver a lista de formatos"
          >
            <app-icon name="arrow-left" [size]="16"></app-icon>
          </button>

          <div class="min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <h2 class="text-sm font-bold text-text-primary truncate">{{ detail()?.name }}</h2>
              @if (detail()?.is_customized) {
                <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-500 border border-amber-500/20">
                  Personalizado
                </span>
              } @else {
                <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  Default Sistema
                </span>
              }

              <!-- Anexo Técnico DIAN Badge -->
              @if (annexSummary(); as annex) {
                <button
                  type="button"
                  (click)="isAnnexModalOpen.set(true)"
                  class="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium border transition cursor-pointer"
                  [class.bg-emerald-500/10]="annex.isCompliant"
                  [class.text-emerald-500]="annex.isCompliant"
                  [class.border-emerald-500/30]="annex.isCompliant"
                  [class.bg-amber-500/10]="!annex.isCompliant"
                  [class.text-amber-500]="!annex.isCompliant"
                  [class.border-amber-500/30]="!annex.isCompliant"
                  title="Verificar cumplimiento del Anexo Técnico DIAN"
                >
                  <app-icon [name]="annex.isCompliant ? 'shield-check' : 'shield-alert'" [size]="13"></app-icon>
                  <span>Anexo Técnico {{ annex.score }}%</span>
                  @if (!annex.isCompliant && annex.errorCount > 0) {
                    <span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                  }
                </button>
              }
            </div>
            <p class="text-[11px] text-text-secondary font-mono truncate">{{ detail()?.format_type }}</p>
          </div>
        </div>

        <!-- Actions Toolbar -->
        <div class="flex items-center gap-2 flex-wrap shrink-0">
          <!-- Sample picker -->
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
            <app-icon slot="icon" name="book-open" [size]="14"></app-icon>
            Biblioteca
          </app-button>

          <app-button
            variant="outline"
            size="sm"
            [disabled]="facade.isSaving()"
            (clicked)="resetToDefault()"
          >
            <app-icon slot="icon" name="rotate-ccw" [size]="14"></app-icon>
            Restablecer
          </app-button>

          <app-button
            variant="primary"
            size="sm"
            [loading]="facade.isSaving()"
            (clicked)="save()"
          >
            <app-icon slot="icon" name="save" [size]="14"></app-icon>
            {{ facade.isSaving() ? 'Guardando...' : 'Guardar Cambios' }}
          </app-button>
        </div>
      </header>

      <!-- Main Editor Workspace (3-Panel Adaptive Grid) -->
      @if (facade.draftDefinition(); as draft) {
        <div
          class="vendix-editor-split"
          [class.left-collapsed]="facade.isLeftSidebarCollapsed()"
          [class.right-collapsed]="facade.isRightSidebarCollapsed()"
        >
          <!-- LEFT SIDEBAR: Estructura, Datos, Columnas & Tokens -->
          @if (!facade.isLeftSidebarCollapsed()) {
            <aside class="vendix-workbench-card vendix-sidebar-left">
              <!-- Left Sidebar Header -->
              <div class="p-3 border-b border-border bg-surface-secondary flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <app-icon name="layers" [size]="14" class="text-primary-500"></app-icon>
                  <span class="text-xs font-bold text-text-primary uppercase tracking-wider">Estructura & Datos</span>
                </div>
                <button
                  type="button"
                  (click)="facade.toggleLeftSidebar()"
                  class="p-1 rounded hover:bg-surface-hover text-text-secondary hover:text-text-primary transition cursor-pointer"
                  title="Contraer barra lateral izquierda"
                >
                  <app-icon name="panel-left-close" [size]="14"></app-icon>
                </button>
              </div>

              <!-- Tabs Navigation -->
              <nav class="vendix-tabs-bar">
                <button
                  type="button"
                  (click)="activeTab.set('sections')"
                  class="vendix-tab-btn"
                  [class.active]="activeTab() === 'sections'"
                >
                  <app-icon name="layout-list" [size]="14"></app-icon>
                  <span>Secciones</span>
                </button>

                <button
                  type="button"
                  (click)="activeTab.set('columns')"
                  class="vendix-tab-btn"
                  [class.active]="activeTab() === 'columns'"
                >
                  <app-icon name="columns" [size]="14"></app-icon>
                  <span>Columnas</span>
                </button>

                <button
                  type="button"
                  (click)="activeTab.set('tokens')"
                  class="vendix-tab-btn"
                  [class.active]="activeTab() === 'tokens'"
                >
                  <app-icon name="tags" [size]="14"></app-icon>
                  <span>Tokens</span>
                </button>
              </nav>

              <!-- Left Sidebar Body -->
              <div class="vendix-workbench-content">
                @switch (activeTab()) {
                  @case ('sections') {
                    <app-print-sections-editor></app-print-sections-editor>
                  }
                  @case ('columns') {
                    <app-print-columns-editor></app-print-columns-editor>
                  }
                  @case ('tokens') {
                    <app-print-token-catalog [formatType]="detail()?.format_type || 'pos_sale_ticket'"></app-print-token-catalog>
                  }
                }
              </div>
            </aside>
          } @else {
            <!-- Left Collapsed Compact Rail -->
            <aside class="vendix-collapsed-rail vendix-rail-left">
              <button
                type="button"
                (click)="facade.toggleLeftSidebar()"
                class="p-2.5 rounded-lg bg-surface border border-border text-text-secondary hover:text-primary-500 hover:bg-surface-hover shadow-xs transition cursor-pointer"
                title="Expandir barra de Estructura y Datos"
              >
                <app-icon name="panel-left-open" [size]="16"></app-icon>
              </button>
              <div class="flex flex-col gap-2 mt-2">
                <button
                  type="button"
                  (click)="openLeftTab('sections')"
                  class="p-2 rounded-lg text-text-secondary hover:text-primary-500 hover:bg-surface-hover transition cursor-pointer"
                  title="Secciones"
                >
                  <app-icon name="layout-list" [size]="15"></app-icon>
                </button>
                <button
                  type="button"
                  (click)="openLeftTab('columns')"
                  class="p-2 rounded-lg text-text-secondary hover:text-primary-500 hover:bg-surface-hover transition cursor-pointer"
                  title="Columnas de Productos"
                >
                  <app-icon name="columns" [size]="15"></app-icon>
                </button>
                <button
                  type="button"
                  (click)="openLeftTab('tokens')"
                  class="p-2 rounded-lg text-text-secondary hover:text-primary-500 hover:bg-surface-hover transition cursor-pointer"
                  title="Variables y Tokens"
                >
                  <app-icon name="tags" [size]="15"></app-icon>
                </button>
              </div>
            </aside>
          }

          <!-- CENTER CANVAS: Lienzo Interactivo y Previsualización en Tiempo Real -->
          <main class="vendix-canvas-card">
            <!-- Canvas Toolbar -->
            <div class="vendix-canvas-toolbar">
              <!-- Mode Switch (Real Data vs Tokens) -->
              <div class="flex items-center bg-surface border border-border rounded-lg p-0.5 shadow-2xs">
                <button
                  type="button"
                  (click)="setPreviewMode('dummy')"
                  class="px-2.5 py-1 rounded text-xs font-medium transition flex items-center gap-1.5 cursor-pointer"
                  [class.bg-primary-500]="facade.previewMode() === 'dummy'"
                  [class.text-white]="facade.previewMode() === 'dummy'"
                  [class.text-text-secondary]="facade.previewMode() !== 'dummy'"
                  title="Ver documento tal como saldrá de la impresora"
                >
                  <app-icon name="eye" [size]="13"></app-icon>
                  <span>Vista Impresión</span>
                </button>
                <button
                  type="button"
                  (click)="setPreviewMode('tokenized')"
                  class="px-2.5 py-1 rounded text-xs font-medium transition flex items-center gap-1.5 cursor-pointer"
                  [class.bg-primary-500]="facade.previewMode() === 'tokenized'"
                  [class.text-white]="facade.previewMode() === 'tokenized'"
                  [class.text-text-secondary]="facade.previewMode() !== 'tokenized'"
                  [title]="'Ver nombres de variables {{token}}'"
                >
                  <app-icon name="code" [size]="13"></app-icon>
                  <span>Vista Tokens</span>
                </button>
              </div>

              <!-- Center Zoom & Actions -->
              <div class="flex items-center gap-2 flex-wrap">
                <div class="flex items-center bg-surface border border-border rounded-lg p-0.5 text-xs shadow-2xs">
                  <button
                    type="button"
                    (click)="zoomOut()"
                    class="px-2 py-1 text-text-secondary hover:text-text-primary hover:bg-surface-hover rounded transition cursor-pointer"
                    title="Reducir zoom"
                  >
                    -
                  </button>
                  <span class="px-1.5 font-mono text-[11px] font-semibold text-text-primary">
                    {{ zoomLevel() }}%
                  </span>
                  <button
                    type="button"
                    (click)="zoomIn()"
                    class="px-2 py-1 text-text-secondary hover:text-text-primary hover:bg-surface-hover rounded transition cursor-pointer"
                    title="Aumentar zoom"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    (click)="resetZoom()"
                    class="px-2 py-1 text-[11px] text-text-secondary hover:text-text-primary hover:bg-surface-hover rounded transition border-l border-border cursor-pointer"
                    title="Restablecer zoom al 100%"
                  >
                    100%
                  </button>
                </div>

                <!-- Test Print Button -->
                <app-button
                  variant="outline"
                  size="sm"
                  (clicked)="printTest()"
                >
                  <app-icon slot="icon" name="printer" [size]="14"></app-icon>
                  Imprimir Prueba
                </app-button>
              </div>
            </div>

            <!-- Paper Simulation Viewport -->
            <div class="vendix-viewport-scroll" (click)="onCanvasContainerClick($event)">
              <div
                class="vendix-physical-paper-container"
                [style.transform]="'scale(' + (zoomLevel() / 100) + ')'"
                [style.width.mm]="paperWidthMm()"
              >
                <!-- Physical Roll or Sheet Paper Wrapper -->
                <div
                  class="vendix-physical-sheet"
                  [class.is-roll]="draft.paper?.is_roll !== false"
                  [class.is-sheet]="draft.paper?.is_roll === false"
                >
                  @if (facade.previewHtml()) {
                    <iframe
                      #previewIframe
                      id="vendix-preview-iframe"
                      [srcdoc]="facade.previewHtml()"
                      class="vendix-preview-iframe"
                      (load)="onIframeLoad($event)"
                      sandbox="allow-same-origin allow-scripts"
                    ></iframe>
                  } @else {
                    <div class="p-8 text-center text-xs text-text-tertiary">
                      Generando vista previa del documento...
                    </div>
                  }
                </div>
              </div>
            </div>

            <!-- Footer Specs Bar -->
            <div class="px-4 py-2 bg-surface-secondary border-t border-border flex items-center justify-between text-[11px] text-text-tertiary font-mono">
              <div class="flex items-center gap-3">
                <span>Papel: {{ draft.paper?.format || 'thermal_80' }} ({{ paperWidthMm() }}mm)</span>
                @if (selectedRegion(); as r) {
                  <span class="text-primary-500 font-sans font-medium">
                    Seleccionado: {{ r.label || r.kind }}
                  </span>
                }
              </div>
              @if (facade.isPreviewLoading()) {
                <span class="text-primary-500 font-sans font-medium animate-pulse">Actualizando vista...</span>
              } @else {
                <span>Renderizado en alta fidelidad</span>
              }
            </div>
          </main>

          <!-- RIGHT SIDEBAR: Inspector de Propiedades, Posición & Estilos -->
          @if (!facade.isRightSidebarCollapsed()) {
            <aside class="vendix-workbench-card vendix-sidebar-right">
              <div class="p-3 border-b border-border bg-surface-secondary flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <app-icon name="sliders" [size]="14" class="text-primary-500"></app-icon>
                  <span class="text-xs font-bold text-text-primary uppercase tracking-wider">Propiedades & Posición</span>
                </div>
                <button
                  type="button"
                  (click)="facade.toggleRightSidebar()"
                  class="p-1 rounded hover:bg-surface-hover text-text-secondary hover:text-text-primary transition cursor-pointer"
                  title="Contraer barra lateral derecha"
                >
                  <app-icon name="panel-right-close" [size]="14"></app-icon>
                </button>
              </div>

              <div class="vendix-workbench-content p-0">
                <app-print-properties-panel
                  [definition]="draft"
                  [selectedRegion]="selectedRegion()"
                  (definitionChanged)="onPropertiesChanged($event)"
                  (unselectRequested)="facade.selectElement(null)"
                ></app-print-properties-panel>
              </div>
            </aside>
          } @else {
            <!-- Right Collapsed Compact Rail -->
            <aside class="vendix-collapsed-rail vendix-rail-right">
              <button
                type="button"
                (click)="facade.toggleRightSidebar()"
                class="p-2.5 rounded-lg bg-surface border border-border text-text-secondary hover:text-primary-500 hover:bg-surface-hover shadow-xs transition cursor-pointer"
                title="Expandir barra de Propiedades y Posición"
              >
                <app-icon name="panel-right-open" [size]="16"></app-icon>
              </button>
              <div class="flex flex-col gap-2 mt-2">
                <button
                  type="button"
                  (click)="facade.toggleRightSidebar()"
                  class="p-2 rounded-lg text-text-secondary hover:text-primary-500 hover:bg-surface-hover transition cursor-pointer"
                  title="Inspector de Propiedades"
                >
                  <app-icon name="sliders" [size]="15"></app-icon>
                </button>
              </div>
            </aside>
          }
        </div>
      } @else {
        <div class="flex items-center justify-center min-h-[400px]">
          <span class="text-sm text-text-tertiary">Cargando definición de formato...</span>
        </div>
      }

      <!-- Library Modal -->
      <app-print-library-modal [(isOpen)]="isLibraryOpen"></app-print-library-modal>

      <!-- Anexo Técnico DIAN Modal -->
      <app-print-annex-modal
        [(isOpen)]="isAnnexModalOpen"
        [summary]="annexSummary()"
        (autoFixRequested)="onAutoFixRule($event)"
      ></app-print-annex-modal>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
        max-width: 100%;
        box-sizing: border-box;
      }
      .vendix-editor-container {
        width: 100%;
        max-width: 100%;
        box-sizing: border-box;
      }
      .vendix-editor-split {
        display: grid;
        grid-template-columns: 340px 1fr 340px;
        gap: 1rem;
        align-items: start;
        width: 100%;
        max-width: 100%;
        box-sizing: border-box;
        transition: grid-template-columns 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      }
      .vendix-editor-split.left-collapsed {
        grid-template-columns: 48px 1fr 340px;
      }
      .vendix-editor-split.right-collapsed {
        grid-template-columns: 340px 1fr 48px;
      }
      .vendix-editor-split.left-collapsed.right-collapsed {
        grid-template-columns: 48px 1fr 48px;
      }
      @media (max-width: 1200px) {
        .vendix-editor-split,
        .vendix-editor-split.left-collapsed,
        .vendix-editor-split.right-collapsed,
        .vendix-editor-split.left-collapsed.right-collapsed {
          grid-template-columns: 1fr;
        }
      }

      /* Workbench Card Styles */
      .vendix-workbench-card {
        background: var(--color-surface, #ffffff);
        border: 1px solid var(--color-border, #e5e7eb);
        border-radius: 0.75rem;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        min-width: 0;
        box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.05);
      }
      .vendix-collapsed-rail {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 0.5rem 0.25rem;
        background: var(--color-surface-secondary, #f9fafb);
        border: 1px solid var(--color-border, #e5e7eb);
        border-radius: 0.75rem;
        min-height: 480px;
      }
      .vendix-tabs-bar {
        display: flex;
        align-items: center;
        background: var(--color-surface-secondary, #f9fafb);
        border-bottom: 1px solid var(--color-border, #e5e7eb);
        overflow-x: auto;
        padding: 0.25rem;
        gap: 0.25rem;
      }
      .vendix-tab-btn {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        padding: 0.5rem 0.75rem;
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--color-text-secondary, #6b7280);
        border-radius: 0.5rem;
        border: 1px solid transparent;
        transition: all 0.15s ease-in-out;
        white-space: nowrap;
        cursor: pointer;
      }
      .vendix-tab-btn:hover {
        color: var(--color-text-primary, #111827);
        background: var(--color-surface-hover, rgba(0, 0, 0, 0.04));
      }
      .vendix-tab-btn.active {
        color: var(--color-primary, #2563eb);
        background: var(--color-surface, #ffffff);
        border-color: var(--color-border, #e5e7eb);
        box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
      }
      .vendix-workbench-content {
        padding: 1rem;
        max-height: calc(100vh - 180px);
        overflow-y: auto;
        min-height: 480px;
      }

      /* Canvas Card Styles */
      .vendix-canvas-card {
        background: var(--color-surface, #ffffff);
        border: 1px solid var(--color-border, #e5e7eb);
        border-radius: 0.75rem;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        min-width: 0;
        box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.05);
      }
      .vendix-canvas-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.625rem 0.75rem;
        background: var(--color-surface-secondary, #f9fafb);
        border-bottom: 1px solid var(--color-border, #e5e7eb);
        gap: 0.5rem;
        flex-wrap: wrap;
      }
      .vendix-viewport-scroll {
        padding: 1.5rem;
        background: #e2e8f0;
        display: flex;
        justify-content: center;
        align-items: flex-start;
        min-height: 520px;
        max-height: calc(100vh - 220px);
        overflow: auto;
      }
      .vendix-physical-paper-container {
        transform-origin: top center;
        transition: transform 0.15s ease-out;
      }

      /* Physical Paper Styling */
      .vendix-physical-sheet {
        background: #ffffff;
        color: #111827;
        box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.2), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
        border-radius: 2px;
        overflow: hidden;
        position: relative;
        min-height: 280px;
      }
      .vendix-physical-sheet.is-roll {
        border-top: 3px solid #cbd5e1;
        border-bottom: 3px dashed #94a3b8;
      }
      .vendix-physical-sheet.is-sheet {
        border: 1px solid #cbd5e1;
      }
      .vendix-preview-iframe {
        width: 100%;
        min-height: 560px;
        height: 100%;
        border: none;
        display: block;
        background: #ffffff;
      }
    `,
  ],
})
export class PrintFormatEditorComponent {
  readonly facade = inject(PrintFormatsFacade);

  readonly activeTab = signal<WorkbenchTab>('sections');
  readonly isLibraryOpen = signal<boolean>(false);
  readonly isAnnexModalOpen = signal<boolean>(false);

  readonly previewIframeRef = viewChild<ElementRef<HTMLIFrameElement>>('previewIframe');

  readonly detail = computed(() => this.facade.selectedFormatDetail());
  readonly annexSummary = computed(() => this.facade.annexValidation());
  readonly zoomLevel = computed(() => this.facade.zoomLevel());

  readonly paperWidthMm = computed<number>(() => {
    const draft = this.facade.draftDefinition();
    return draft?.paper?.width_mm || 80;
  });

  readonly regions = computed<CanvasRegion[]>(() => {
    const draft = this.facade.draftDefinition();
    if (!draft) return [];
    return definitionToRegions(draft);
  });

  readonly selectedRegion = computed<CanvasRegion | null>(() => {
    const id = this.facade.selectedRegionId();
    if (!id) return null;
    return this.regions().find((r) => r.id === id) ?? null;
  });

  onIframeLoad(event: Event): void {
    const iframe = event.target as HTMLIFrameElement;
    try {
      const doc = iframe.contentWindow?.document;
      if (doc && doc.documentElement) {
        // Auto-expand physical height
        const height = doc.documentElement.scrollHeight;
        if (height > 0) {
          iframe.style.height = `${height}px`;
        }

        // Inyectar estilos para hover sutil sobre elementos interactivos
        const style = doc.createElement('style');
        style.textContent = `
          [data-element-id], [data-section-id], [data-column-id] {
            transition: outline 0.15s ease, background-color 0.15s ease;
            cursor: pointer;
          }
          [data-element-id]:hover, [data-section-id]:hover, [data-column-id]:hover {
            outline: 1.5px dashed #3b82f6 !important;
            outline-offset: 2px;
            background-color: rgba(59, 130, 246, 0.04);
          }
        `;
        doc.head.appendChild(style);

        // Click-to-inspect bridge
        doc.body.addEventListener('click', (e: MouseEvent) => {
          let target = e.target as HTMLElement | null;
          let elementId: string | undefined;
          let sectionId: string | undefined;
          let columnId: string | undefined;

          while (target && target !== doc.body) {
            if (!columnId && target.getAttribute('data-column-id')) {
              columnId = target.getAttribute('data-column-id') || undefined;
            }
            if (!elementId && target.getAttribute('data-element-id')) {
              elementId = target.getAttribute('data-element-id') || undefined;
            }
            if (!sectionId && target.getAttribute('data-section-id')) {
              sectionId = target.getAttribute('data-section-id') || undefined;
            }
            target = target.parentElement;
          }

          if (columnId || elementId || sectionId) {
            e.preventDefault();
            e.stopPropagation();
            this.facade.selectElement({ elementId, sectionId, columnId });
          } else {
            this.facade.selectElement(null);
          }
        });
      }
    } catch {
      // ignore cors or cross-origin errors
    }
  }

  onCanvasContainerClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (target && target.classList.contains('vendix-viewport-scroll')) {
      this.facade.selectElement(null);
    }
  }

  openLeftTab(tab: WorkbenchTab): void {
    this.activeTab.set(tab);
    this.facade.isLeftSidebarCollapsed.set(false);
  }

  onPropertiesChanged(newDef: PrintFormatDefinition): void {
    this.facade.updateDraftDefinition(() => newDef);
  }

  goBack(): void {
    this.facade.clearSelection();
  }

  setPreviewMode(mode: PrintPreviewMode): void {
    this.facade.setPreviewMode(mode);
  }

  zoomIn(): void {
    this.facade.setZoom(this.zoomLevel() + 15);
  }

  zoomOut(): void {
    this.facade.setZoom(this.zoomLevel() - 15);
  }

  resetZoom(): void {
    this.facade.setZoom(100);
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

  async onDocumentPicked(documentId: number | null): Promise<void> {
    await this.facade.pickPreviewDocument(documentId);
  }

  onAutoFixRule(rule: PrintAnnexValidationRule): void {
    const draft = this.facade.draftDefinition();
    if (!draft) return;
    const next = JSON.parse(JSON.stringify(draft)) as PrintFormatDefinition;

    if (rule.fixAction?.sectionId) {
      const cleanSecId = rule.fixAction.sectionId.replace('sec_', '');
      const sec = next.sections?.find((s) => s.id === cleanSecId || s.id === rule.fixAction!.sectionId);
      if (sec) {
        sec.enabled = true;
        if (rule.fixAction.fieldKey) {
          const field = sec.fields?.find((f) => f.id === rule.fixAction!.fieldKey || f.key === rule.fixAction!.fieldKey);
          if (field) field.enabled = true;
        }
      }
    }

    if (rule.fixAction?.columnKey) {
      const cleanColKey = rule.fixAction.columnKey.replace('col_', '');
      const col = next.columns?.find((c) => c.id === cleanColKey || c.key === cleanColKey || c.id === rule.fixAction!.columnKey);
      if (col) col.enabled = true;
    }

    this.facade.draftDefinition.set(next);
    void this.facade.refreshPreview();
  }

  printTest(): void {
    const iframe = document.getElementById('vendix-preview-iframe') as HTMLIFrameElement;
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    }
  }
}
