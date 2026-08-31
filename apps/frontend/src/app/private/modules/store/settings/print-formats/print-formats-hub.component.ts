import { Component, OnInit, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { PrintThumbnailService } from '../../../../../shared/services/print/print-thumbnail.service';
import { PrintFormatsFacade } from './services/print-formats.facade';
import { PrintFormatEditorComponent } from './components/print-format-editor/print-format-editor.component';
import { PrintFormatType, StorePrintFormatSummary } from '../../../../../core/models/print-formats.model';

interface CategoryGroup {
  category: string;
  formats: StorePrintFormatSummary[];
}

@Component({
  selector: 'app-print-formats-hub',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, PrintFormatEditorComponent],
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
              Configura de manera centralizada el diseño, secciones, papel y tokens de los {{ facade.formats().length }} tipos de documentos impresos en tu tienda. Activa el <strong>Print Gateway</strong> para emisión uniforme en todos los módulos.
            </p>
          </div>

          <!-- Header Stats Banner [print-editor-dsk P6] -->
          <div class="flex items-center gap-3 text-xs font-mono bg-surface-secondary px-4 py-2.5 rounded-xl border border-border">
            <div class="px-1">
              <span class="text-text-secondary block text-[10px] uppercase">Formatos</span>
              <strong class="text-text-primary text-sm">{{ facade.formats().length }}</strong>
            </div>
            <div class="w-px h-8 bg-border"></div>
            <div class="px-1">
              <span class="text-text-secondary block text-[10px] uppercase">Gateways activos</span>
              <strong class="text-emerald-400 text-sm">{{ gatewayActiveCount() }} / {{ facade.formats().length }}</strong>
            </div>
            <div class="w-px h-8 bg-border"></div>
            <div class="px-1">
              <span class="text-text-secondary block text-[10px] uppercase">Plantilla propia</span>
              <strong class="text-primary-400 text-sm">{{ facade.customizedFormatCount() }}</strong>
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

        <!-- Catalog Body -->
        @if (facade.isLoading()) {
          <div class="p-12 text-center text-text-secondary">
            <app-icon name="loader-2" [size]="32" class="animate-spin mx-auto mb-2 text-primary-500"></app-icon>
            <p class="text-xs">Cargando catálogo de formatos de impresión...</p>
          </div>
        } @else if (facade.formats().length === 0) {
          <!-- Empty State [print-editor-dsk P6] -->
          <div class="p-12 text-center text-text-secondary bg-surface-secondary/30 rounded-2xl border border-border">
            <app-icon name="printer" [size]="48" class="mx-auto mb-3 opacity-40"></app-icon>
            <p class="text-sm font-semibold text-text-primary">No hay formatos configurados</p>
            <p class="text-xs text-text-secondary mt-1">Aún no se han detectado formatos para esta tienda.</p>
            <button
              type="button"
              (click)="reloadFormats()"
              class="mt-4 px-4 py-2 rounded-xl bg-primary-600 hover:bg-primary-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition shadow-sm"
            >
              <app-icon name="refresh-cw" [size]="14"></app-icon>
              Recargar catálogo
            </button>
          </div>
        } @else if (visibleGroups().length === 0) {
          <!-- Filtered Empty State -->
          <div class="py-12 text-center text-text-secondary">
            <app-icon name="search-x" [size]="32" class="mx-auto mb-2 opacity-40"></app-icon>
            <p class="text-sm font-semibold text-text-primary">Sin resultados</p>
            <p class="text-xs text-text-secondary mt-1">No hay formatos que coincidan con el filtro o la búsqueda.</p>
          </div>
        } @else {
          <!-- Grouped Catalog [print-editor-dsk P6] -->
          <div class="space-y-6">
            @for (group of visibleGroups(); track group.category) {
              <section class="space-y-3">
                <!-- Category Header -->
                <header class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div class="flex items-center gap-2">
                    <span
                      class="inline-block w-2.5 h-2.5 rounded-full"
                      [style.backgroundColor]="categoryColor(group.category)"
                    ></span>
                    <h2 class="text-sm font-bold text-text-primary uppercase tracking-wide">
                      {{ group.category }}
                    </h2>
                    <span class="text-[11px] font-mono px-2 py-0.5 rounded-full bg-surface-secondary border border-border text-text-secondary">
                      {{ group.formats.length }}
                    </span>
                  </div>

                  <!-- Bulk Activate / Deactivate [print-editor-dsk P6] -->
                  <div class="flex items-center gap-1.5">
                    <button
                      type="button"
                      (click)="bulkActivate(group.category, true)"
                      [disabled]="!hasInactiveIn(group.formats)"
                      class="px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 transition flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                    >
                      <app-icon name="zap" [size]="12"></app-icon>
                      Activar todos
                    </button>
                    <button
                      type="button"
                      (click)="bulkActivate(group.category, false)"
                      [disabled]="!hasActiveIn(group.formats)"
                      class="px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 transition flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                    >
                      <app-icon name="zap-off" [size]="12"></app-icon>
                      Desactivar todos
                    </button>
                  </div>
                </header>

                <!-- Cards Grid -->
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  @for (fmt of group.formats; track fmt.format_type) {
                    <article
                      (click)="openFormat(fmt.format_type)"
                      class="p-4 rounded-2xl border border-border bg-surface hover:border-primary-500/40 cursor-pointer transition-all shadow-sm flex gap-4 group"
                    >
                      <!-- Thumbnail [print-editor-dsk P6] -->
                      <div class="shrink-0 w-[80px] h-[107px] rounded-xl overflow-hidden border border-border bg-surface-secondary flex items-center justify-center">
                        <img
                          [src]="thumbnailFor(fmt.format_type)"
                          [alt]="fmt.name"
                          class="w-full h-full object-contain"
                        />
                      </div>

                      <!-- Card Body -->
                      <div class="flex-1 min-w-0 flex flex-col justify-between">
                        <!-- Header -->
                        <div>
                          <div class="flex items-start gap-2 mb-1.5">
                            <div class="p-1.5 rounded-lg bg-surface-secondary text-primary-400 border border-border group-hover:bg-primary-500/10 transition shrink-0">
                              <app-icon [name]="fmt.icon" [size]="14"></app-icon>
                            </div>
                            <div class="min-w-0 flex-1">
                              <h3 class="text-sm font-bold text-text-primary truncate">{{ fmt.name }}</h3>
                              <span class="text-[10px] uppercase tracking-wide font-medium" [style.color]="categoryColor(fmt.category)">
                                {{ fmt.category }}
                              </span>
                            </div>
                          </div>

                          <!-- Gateway Pill -->
                          <button
                            type="button"
                            (click)="toggleGateway(fmt.format_type, fmt.gateway_enabled, $event)"
                            class="text-[10px] font-semibold px-2 py-0.5 rounded-full border inline-flex items-center gap-1"
                            [class.bg-emerald-500/10]="fmt.gateway_enabled"
                            [class.text-emerald-400]="fmt.gateway_enabled"
                            [class.border-emerald-500/20]="fmt.gateway_enabled"
                            [class.bg-amber-500/10]="!fmt.gateway_enabled"
                            [class.text-amber-400]="!fmt.gateway_enabled"
                            [class.border-amber-500/20]="!fmt.gateway_enabled"
                            title="Alternar emisión por Print Gateway o emisor estándar"
                          >
                            <span class="w-1.5 h-1.5 rounded-full" [class.bg-emerald-400]="fmt.gateway_enabled" [class.bg-amber-400]="!fmt.gateway_enabled"></span>
                            {{ fmt.gateway_enabled ? 'Gateway' : 'Estándar' }}
                          </button>
                        </div>

                        <!-- Footer -->
                        <div class="flex items-center justify-between mt-2 pt-2 border-t border-border/60">
                          <span class="text-[10px] text-text-secondary font-mono truncate max-w-[110px]" [title]="fmt.template_name">
                            {{ fmt.template_name }}
                          </span>
                          <button
                            type="button"
                            (click)="openFormat(fmt.format_type)"
                            class="px-2.5 py-1 rounded-lg bg-primary-600 hover:bg-primary-500 text-white text-[11px] font-semibold flex items-center gap-1 transition shadow-sm"
                          >
                            <app-icon name="sliders" [size]="12"></app-icon>
                            Editar
                          </button>
                        </div>
                      </div>
                    </article>
                  }
                </div>
              </section>
            }
          </div>
        }
      }
    </div>
  `,
})
export class PrintFormatsHubComponent implements OnInit {
  readonly facade = inject(PrintFormatsFacade);
  private readonly thumbnails = inject(PrintThumbnailService);

  readonly gatewayActiveCount = computed(() => {
    return this.facade.formats().filter((f) => f.gateway_enabled).length;
  });

  /**
   * [print-editor-dsk P6] — Visible category groups after applying the
   * active category filter and search query. Empty groups are pruned so
   * the section header doesn't render for a category the merchant can't
   * currently see.
   */
  readonly visibleGroups = computed<CategoryGroup[]>(() => {
    const filter = this.facade.activeCategoryFilter();
    const query = this.facade.searchQuery().toLowerCase().trim();
    return this.facade.formatsByCategory()
      .filter((g) => filter === 'all' || g.category === filter)
      .map((g) => ({
        category: g.category,
        formats: g.formats.filter((f) => {
          if (!query) return true;
          return (
            f.name.toLowerCase().includes(query) ||
            f.category.toLowerCase().includes(query) ||
            f.format_type.toLowerCase().includes(query)
          );
        }),
      }))
      .filter((g) => g.formats.length > 0);
  });

  ngOnInit(): void {
    this.facade.loadFormats();
  }

  openFormat(formatType: PrintFormatType): void {
    this.facade.selectFormat(formatType);
  }

  toggleGateway(formatType: PrintFormatType, currentStatus: boolean, event: Event): void {
    event.stopPropagation();
    void this.facade.toggleGateway(formatType, currentStatus);
  }

  bulkActivate(category: string, targetStatus: boolean): void {
    void this.facade.bulkToggleCategoryGateway(category, targetStatus);
  }

  hasInactiveIn(formats: StorePrintFormatSummary[]): boolean {
    return formats.some((f) => !f.gateway_enabled);
  }

  hasActiveIn(formats: StorePrintFormatSummary[]): boolean {
    return formats.some((f) => f.gateway_enabled);
  }

  thumbnailFor(formatType: PrintFormatType): string {
    return this.thumbnails.getThumbnail(formatType);
  }

  /**
   * Returns the brand color for a category so the section header pill and
   * card eyebrow share a single source of truth with the thumbnail. Kept
   * here (not in the service) because it's a UI-only concern.
   */
  categoryColor(category: string): string {
    const map: Record<string, string> = {
      'Logística': '#3b82f6',
      'Ventas POS': '#10b981',
      'Ventas': '#06b6d4',
      'Comercial': '#8b5cf6',
      'Compras': '#f97316',
      'Inventario': '#84cc16',
      'Facturación': '#ef4444',
      'Restaurante': '#a855f7',
    };
    return map[category] ?? '#6b7280';
  }

  reloadFormats(): void {
    void this.facade.loadFormats();
  }
}
