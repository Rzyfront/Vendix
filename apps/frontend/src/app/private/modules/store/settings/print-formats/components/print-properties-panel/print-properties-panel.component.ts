import {
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  CanvasRegion,
  PrintFormatDefinition,
} from '../../../../../../../core/models/print-formats.model';
import { PrintPaperPanelComponent } from './paper-panel.component';
import { PrintSectionPanelComponent } from './section-panel.component';
import { PrintColumnPanelComponent } from './column-panel.component';
import { PrintLogoPanelComponent } from './logo-panel.component';
import { PrintCompanyPanelComponent } from './company-panel.component';
import { PrintStylesPanelComponent } from './styles-panel.component';
import { PrintCustomTemplatePanelComponent } from './custom-template-panel.component';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';

/**
 * [print-editor-dsk P5] — Per-element property panel shell.
 *
 * Renders the right subpanel that matches the currently selected
 * `CanvasRegion`. When nothing is selected the paper panel is shown
 * (global paper + format + styles + custom template fall through here).
 *
 * The shell is a pure router: it never mutates `definition` directly —
 * every subpanel emits `(definitionChanged)` with a new
 * `PrintFormatDefinition` and the shell re-emits it up to the canvas.
 * The canvas (`PrintCanvasComponent`) is responsible for routing those
 * emits through the history service and the debounced output.
 */
@Component({
  selector: 'app-print-properties-panel',
  standalone: true,
  imports: [
    CommonModule,
    IconComponent,
    PrintPaperPanelComponent,
    PrintSectionPanelComponent,
    PrintColumnPanelComponent,
    PrintLogoPanelComponent,
    PrintCompanyPanelComponent,
    PrintStylesPanelComponent,
    PrintCustomTemplatePanelComponent,
  ],
  template: `
    <aside class="vendix-properties-panel">
      <header class="vendix-properties-panel__header">
        @if (selectedRegion(); as r) {
          <div class="flex items-center gap-2">
            <app-icon [name]="regionIcon(r.kind)" [size]="14"></app-icon>
            <span class="text-sm font-semibold text-text-primary">{{ regionTitle(r) }}</span>
          </div>
          <span class="text-[10px] font-mono text-text-tertiary uppercase tracking-wider">
            {{ r.kind }}
          </span>
        } @else {
          <div class="flex items-center gap-2">
            <app-icon name="file-text" [size]="14"></app-icon>
            <span class="text-sm font-semibold text-text-primary">Propiedades del Documento</span>
          </div>
          <span class="text-[10px] font-mono text-text-tertiary uppercase tracking-wider">
            global
          </span>
        }
      </header>

      <div class="vendix-properties-panel__body">
        @switch (selectedRegion()?.kind) {
          @case ('section') {
            <app-print-section-panel
              [definition]="definition()"
              [sectionId]="selectedRegion()!.anchorId"
              (definitionChanged)="definitionChanged.emit($event)"
            ></app-print-section-panel>
          }
          @case ('column') {
            <app-print-column-panel
              [definition]="definition()"
              [columnId]="selectedRegion()!.anchorId"
              (definitionChanged)="definitionChanged.emit($event)"
            ></app-print-column-panel>
          }
          @case ('logo') {
            <app-print-logo-panel
              [definition]="definition()"
              (definitionChanged)="definitionChanged.emit($event)"
            ></app-print-logo-panel>
          }
          @case ('company-field') {
            <app-print-company-panel
              [definition]="definition()"
              (definitionChanged)="definitionChanged.emit($event)"
            ></app-print-company-panel>
          }
          @default {
            <app-print-paper-panel
              [definition]="definition()"
              (definitionChanged)="definitionChanged.emit($event)"
            ></app-print-paper-panel>
            <app-print-styles-panel
              [definition]="definition()"
              (definitionChanged)="definitionChanged.emit($event)"
            ></app-print-styles-panel>
            <app-print-custom-template-panel
              [definition]="definition()"
              (definitionChanged)="definitionChanged.emit($event)"
            ></app-print-custom-template-panel>
          }
        }
      </div>
    </aside>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }
      .vendix-properties-panel {
        display: flex;
        flex-direction: column;
        height: 100%;
        background: var(--color-surface, #ffffff);
        border: 1px solid var(--color-border, #e5e7eb);
        border-radius: 0.5rem;
        overflow: hidden;
      }
      .vendix-properties-panel__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.625rem 0.75rem;
        border-bottom: 1px solid var(--color-border, #e5e7eb);
        background: var(--color-surface-secondary, #f9fafb);
      }
      .vendix-properties-panel__body {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        padding: 0.75rem;
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }
    `,
  ],
})
export class PrintPropertiesPanelComponent {
  /** Live print-format definition being edited. */
  readonly definition = input.required<PrintFormatDefinition>();

  /** Currently selected canvas region, or `null` for the global view. */
  readonly selectedRegion = input<CanvasRegion | null>(null);

  /** Emitted with the new definition when any subpanel mutates it. */
  readonly definitionChanged = output<PrintFormatDefinition>();

  /** Pre-computed title for the header. */
  readonly headerTitle = computed<string>(() => {
    const r = this.selectedRegion();
    if (!r) return 'Propiedades del Documento';
    return r.label || r.kind;
  });

  regionIcon(kind: CanvasRegion['kind'] | undefined): string {
    switch (kind) {
      case 'section':
        return 'layout-list';
      case 'column':
        return 'columns';
      case 'logo':
        return 'image';
      case 'company-field':
        return 'building';
      case 'header':
        return 'arrow-left';
      case 'footer':
        return 'arrow-right';
      default:
        return 'file-text';
    }
  }

  regionTitle(r: CanvasRegion): string {
    if (r.label) return r.label;
    switch (r.kind) {
      case 'section':
        return 'Sección';
      case 'column':
        return 'Columna';
      case 'logo':
        return 'Logo';
      case 'company-field':
        return 'Campo de Empresa';
      case 'header':
        return 'Encabezado';
      case 'footer':
        return 'Pie';
      default:
        return 'Elemento';
    }
  }
}