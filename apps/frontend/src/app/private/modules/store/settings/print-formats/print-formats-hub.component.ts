import { Component, OnInit, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';
import { PrintFormatsFacade } from './services/print-formats.facade';
import { PrintFormatEditorComponent } from './components/print-format-editor/print-format-editor.component';
import { PrintFormatType, StorePrintFormatSummary } from '../../../../../core/models/print-formats.model';

@Component({
  selector: 'app-print-formats-hub',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, ButtonComponent, PrintFormatEditorComponent],
  template: `
    <div class="space-y-6">
      @if (facade.selectedFormatDetail()) {
        <!-- Editor Mode -->
        <app-print-format-editor></app-print-format-editor>
      } @else {
        <!-- Hub Catalog View -->
        <!-- Header Banner -->
        <div class="p-6 bg-gradient-to-r from-primary-900/40 via-surface to-surface rounded-2xl border border-border shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div class="space-y-1">
            <div class="flex items-center gap-2">
              <div class="p-2 rounded-xl bg-primary-500/10 text-primary-400 border border-primary-500/20">
                <app-icon name="printer" [size]="22"></app-icon>
              </div>
              <h1 class="text-xl font-bold text-text-primary">Hub de Formatos de Impresión</h1>
            </div>
            <p class="text-xs text-text-secondary max-w-2xl">
              Configura de manera centralizada el diseño, secciones, papel y tokens de los 10 tipos de documentos impresos en tu tienda. Activa el <strong>Print Gateway</strong> para emisión uniforme en todos los módulos.
            </p>
          </div>

          <div class="flex items-center gap-4 text-xs font-mono bg-surface-secondary px-4 py-2.5 rounded-xl border border-border">
            <div>
              <span class="text-text-secondary block text-[10px] uppercase">Formatos Activos</span>
              <strong class="text-text-primary text-sm">{{ activeCount() }} / {{ facade.formats().length }}</strong>
            </div>
            <div class="w-px h-8 bg-border"></div>
            <div>
              <span class="text-text-secondary block text-[10px] uppercase">Print Gateway</span>
              <strong class="text-emerald-400 text-sm">{{ gatewayActiveCount() }} Activos</strong>
            </div>
          </div>
        </div>

        <!-- Filters and Search Toolbar -->
        <div class="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <!-- Category Pills -->
          <div class="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
            @for (cat of facade.categories(); track cat) {
              <button
                type="button"
                (click)="facade.activeCategoryFilter.set(cat)"
                [class.bg-primary-600]="facade.activeCategoryFilter() === cat"
                [class.text-white]="facade.activeCategoryFilter() === cat"
                [class.bg-surface-secondary]="facade.activeCategoryFilter() !== cat"
                [class.text-text-secondary]="facade.activeCategoryFilter() !== cat"
                class="px-3 py-1.5 rounded-lg text-xs font-medium border border-border hover:text-text-primary transition whitespace-nowrap"
              >
                {{ cat === 'all' ? 'Todos los Formatos' : cat }}
              </button>
            }
          </div>

          <!-- Search Input -->
          <div class="relative w-full sm:w-64">
            <app-icon name="search" [size]="14" class="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary"></app-icon>
            <input
              type="text"
              [ngModel]="facade.searchQuery()"
              (ngModelChange)="facade.searchQuery.set($event)"
              placeholder="Buscar formato..."
              class="w-full pl-9 pr-3 py-1.5 bg-surface-secondary border border-border rounded-lg text-xs text-text-primary focus:border-primary-500 focus:outline-none"
            />
          </div>
        </div>

        <!-- Grid of Format Cards -->
        @if (facade.isLoading()) {
          <div class="p-12 text-center text-text-secondary">
            <app-icon name="loader-2" [size]="32" class="animate-spin mx-auto mb-2 text-primary-500"></app-icon>
            <p class="text-xs">Cargando catálogo de formatos de impresión...</p>
          </div>
        } @else {
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            @for (fmt of facade.filteredFormats(); track fmt.format_type) {
              <div
                (click)="openFormat(fmt.format_type)"
                class="p-5 rounded-2xl border border-border bg-surface hover:border-primary-500/40 cursor-pointer transition-all shadow-sm flex flex-col justify-between group"
              >
                <div>
                  <!-- Card Header -->
                  <div class="flex items-start justify-between gap-3 mb-3">
                    <div class="flex items-center gap-2.5">
                      <div class="p-2 rounded-xl bg-surface-secondary text-primary-400 border border-border group-hover:bg-primary-500/10 transition">
                        <app-icon [name]="fmt.icon" [size]="18"></app-icon>
                      </div>
                      <div>
                        <h3 class="text-sm font-bold text-text-primary">{{ fmt.name }}</h3>
                        <span class="text-[11px] text-text-secondary font-medium">{{ fmt.category }}</span>
                      </div>
                    </div>

                    <!-- Active Badge -->
                    <span
                      class="text-[10px] font-semibold px-2 py-0.5 rounded-full border"
                      [class.bg-emerald-500/10]="fmt.is_active"
                      [class.text-emerald-400]="fmt.is_active"
                      [class.border-emerald-500/20]="fmt.is_active"
                      [class.bg-slate-700/20]="!fmt.is_active"
                      [class.text-slate-400]="!fmt.is_active"
                      [class.border-slate-700/30]="!fmt.is_active"
                    >
                      {{ fmt.is_active ? 'Activo' : 'Inactivo' }}
                    </span>
                  </div>

                  <!-- Template Origin Info -->
                  <div class="p-3 bg-surface-secondary/70 rounded-xl border border-border/50 space-y-1.5 mb-4">
                    <div class="flex items-center justify-between text-[11px]">
                      <span class="text-text-secondary">Plantilla Asignada:</span>
                      <span class="text-text-primary font-medium truncate max-w-[140px]">{{ fmt.template_name }}</span>
                    </div>

                    <!-- Gateway Toggle Row -->
                    <div class="flex items-center justify-between text-[11px] pt-1.5 border-t border-border/40">
                      <span class="text-text-secondary">Print Gateway:</span>
                      <button
                        type="button"
                        (click)="toggleGateway(fmt.format_type, fmt.gateway_enabled, $event)"
                        class="text-[10px] font-semibold px-2 py-0.5 rounded transition flex items-center gap-1"
                        [class.bg-emerald-500/10]="fmt.gateway_enabled"
                        [class.text-emerald-400]="fmt.gateway_enabled"
                        [class.bg-amber-500/10]="!fmt.gateway_enabled"
                        [class.text-amber-400]="!fmt.gateway_enabled"
                        title="Alternar emisión por Print Gateway o emisor estándar"
                      >
                        <span class="w-1.5 h-1.5 rounded-full" [class.bg-emerald-400]="fmt.gateway_enabled" [class.bg-amber-400]="!fmt.gateway_enabled"></span>
                        {{ fmt.gateway_enabled ? 'Habilitado (Nuevo)' : 'Modo Estándar' }}
                      </button>
                    </div>
                  </div>
                </div>

                <!-- Footer Action -->
                <div class="pt-3 border-t border-border/60 flex items-center justify-between gap-2">
                  <span class="text-[10px] text-text-secondary font-mono">
                    {{ fmt.format_type }}
                  </span>

                  <button
                    type="button"
                    (click)="openFormat(fmt.format_type)"
                    class="px-3 py-1.5 rounded-xl bg-primary-600 hover:bg-primary-500 text-white text-xs font-semibold flex items-center gap-1.5 transition shadow-sm"
                  >
                    <app-icon name="sliders" [size]="14"></app-icon>
                    Personalizar
                  </button>
                </div>
              </div>
            } @empty {
              <div class="col-span-full py-12 text-center text-text-secondary">
                <app-icon name="printer" [size]="36" class="mx-auto mb-2 opacity-40"></app-icon>
                <p class="text-sm font-semibold text-text-primary">No se encontraron formatos</p>
                <p class="text-xs text-text-secondary mt-1">Intenta con otro término de búsqueda o selecciona otra categoría.</p>
              </div>
            }
          </div>
        }
      }
    </div>
  `,
})
export class PrintFormatsHubComponent implements OnInit {
  readonly facade = inject(PrintFormatsFacade);

  readonly activeCount = computed(() => {
    return this.facade.formats().filter((f) => f.is_active).length;
  });

  readonly gatewayActiveCount = computed(() => {
    return this.facade.formats().filter((f) => f.gateway_enabled).length;
  });

  ngOnInit(): void {
    this.facade.loadFormats();
  }

  openFormat(formatType: PrintFormatType): void {
    console.log('OPEN FORMAT CLICKED:', formatType);
    this.facade.selectFormat(formatType);
  }

  toggleGateway(formatType: PrintFormatType, currentStatus: boolean, event: Event): void {
    event.stopPropagation();
    this.facade.toggleGateway(formatType, currentStatus);
  }
}
