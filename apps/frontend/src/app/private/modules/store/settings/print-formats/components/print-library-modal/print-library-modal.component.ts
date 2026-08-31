import { Component, inject, model, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ModalComponent } from '../../../../../../../shared/components/modal/modal.component';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { ButtonComponent } from '../../../../../../../shared/components/button/button.component';
import { PrintFormatsFacade } from '../../services/print-formats.facade';
import { PrintTemplate } from '../../../../../../../core/models/print-formats.model';

@Component({
  selector: 'app-print-library-modal',
  standalone: true,
  imports: [CommonModule, ModalComponent, IconComponent, ButtonComponent],
  template: `
    <app-modal
      [(isOpen)]="isOpen"
      size="xl"
    >
      <div slot="header" class="flex items-center gap-2">
        <app-icon name="book-open" [size]="18" class="text-primary-500"></app-icon>
        <span class="font-semibold text-text-primary text-base">Biblioteca de Plantillas de Impresión</span>
      </div>

      <div class="space-y-4 max-h-[70vh] overflow-y-auto p-1">
        <p class="text-xs text-text-secondary">
          Explora y selecciona plantillas preconfiguradas del sistema o compartidas por tu organización para aplicarlas a esta tienda.
        </p>

        @if (templates().length === 0) {
          <div class="p-8 text-center text-text-secondary bg-surface-secondary rounded-xl">
            <app-icon name="inbox" [size]="32" class="mx-auto mb-2 text-text-muted"></app-icon>
            <p class="text-sm">No hay plantillas disponibles para este formato en la biblioteca.</p>
          </div>
        } @else {
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            @for (tpl of templates(); track tpl.id) {
              <div class="p-4 rounded-xl border border-border bg-surface hover:border-primary-500/50 transition-all shadow-sm flex flex-col justify-between">
                <div>
                  <div class="flex items-center justify-between gap-2 mb-2">
                    <span class="text-xs font-bold text-text-primary">{{ tpl.name }}</span>
                    @if (tpl.is_system) {
                      <span class="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 font-medium border border-blue-500/20">
                        Sistema
                      </span>
                    } @else {
                      <span class="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-medium border border-emerald-500/20">
                        Organización
                      </span>
                    }
                  </div>

                  <p class="text-xs text-text-secondary mb-3">{{ tpl.description || 'Plantilla optimizada para operaciones comerciales.' }}</p>

                  <div class="flex items-center gap-3 text-[11px] text-text-muted mb-4 font-mono">
                    <span>Papel: {{ tpl.definition.paper.width_mm }}mm</span>
                    <span>Secciones: {{ tpl.definition.sections.length }}</span>
                  </div>
                </div>

                    <app-button
                      variant="primary"
                      size="sm"
                      (clicked)="applyTemplate(tpl.id)"
                    >
                      <app-icon slot="icon" name="download" [size]="14"></app-icon>
                      Usar esta Plantilla
                    </app-button>
              </div>
            }
          </div>
        }
      </div>

      <div slot="footer" class="flex justify-end">
        <app-button variant="outline" size="sm" (clicked)="close()">Cerrar</app-button>
      </div>
    </app-modal>
  `,
})
export class PrintLibraryModalComponent {
  readonly isOpen = model<boolean>(false);
  readonly facade = inject(PrintFormatsFacade);

  readonly templates = computed<PrintTemplate[]>(() => {
    return this.facade.libraryTemplates();
  });

  async applyTemplate(templateId: number): Promise<void> {
    await this.facade.cloneTemplate(templateId);
    this.isOpen.set(false);
  }

  close(): void {
    this.isOpen.set(false);
  }
}
