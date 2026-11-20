import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { IconComponent } from '../../../../../../shared/components/index';
import {
  TransferDraft,
  TransferDraftHandoffService,
  totalUnits,
} from './transfer-draft';

/**
 * Vista avanzada del movimiento de inventario (tabla `stock_transfers`), común
 * a tienda y organización.
 *
 * En esta fase es el esqueleto funcional: muestra lo que el comerciante ya
 * llenó en el modal rápido (origen, destino, líneas y notas) para que no vuelva
 * a teclearlo. La orden completa —transporte, vehículo, remisiones, borrador y
 * aprobación— llega en la siguiente fase sobre esta misma pantalla.
 */
@Component({
  selector: 'app-transfer-advanced-page',
  standalone: true,
  imports: [RouterLink, IconComponent],
  template: `
    <div class="w-full max-w-4xl mx-auto px-2 md:px-0">
      <div class="flex items-center gap-3 mb-4">
        <a
          routerLink="/admin/inventory/transfers"
          class="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-primary"
          data-testid="advanced-back"
        >
          <app-icon name="arrow-left" [size]="14"></app-icon>
          Transferencias
        </a>
      </div>

      <div class="mb-4">
        <h1 class="text-xl font-bold text-text-primary">Movimiento avanzado</h1>
        <p class="text-sm text-text-secondary mt-1">
          Orden completa entre bodegas: varios productos, transporte, remisión y
          aprobación antes de mover el inventario.
        </p>
      </div>

      <div
        class="p-3 mb-4 bg-info/10 border border-info/30 rounded-xl text-sm text-text-primary flex items-start gap-2"
      >
        <app-icon name="info" [size]="16" class="text-info shrink-0 mt-0.5"></app-icon>
        <span>
          Esta vista está en construcción: por ahora conserva lo que llenaste en
          el movimiento rápido. Mientras tanto, el inventario se mueve al
          instante desde el modal rápido.
        </span>
      </div>

      @if (!draft()) {
        <div class="p-8 text-center border border-dashed border-border rounded-xl">
          <app-icon name="package" [size]="28" class="mx-auto mb-2 text-gray-300"></app-icon>
          <p class="text-sm text-text-secondary">
            No hay datos heredados. Empieza un movimiento desde la lista de
            transferencias.
          </p>
        </div>
      } @else {
        <div class="p-4 bg-surface-secondary rounded-xl border border-border space-y-3 mb-4">
          <div class="flex items-center gap-3">
            <app-icon name="map-pin" [size]="16" class="text-info"></app-icon>
            <div class="min-w-0">
              <p class="text-xs text-text-secondary">Origen</p>
              <p class="text-sm font-medium text-text-primary truncate">
                {{ draft()!.from_location_name || 'Bodega de origen' }}
              </p>
            </div>
            <app-icon name="arrow-right" [size]="14" class="text-text-secondary"></app-icon>
            <div class="min-w-0">
              <p class="text-xs text-text-secondary">Destino</p>
              <p class="text-sm font-medium text-text-primary truncate">
                {{ draft()!.to_location_name || 'Bodega de destino' }}
              </p>
            </div>
          </div>
          @if (draft()!.notes) {
            <div class="flex items-start gap-3">
              <app-icon name="file-text" [size]="16" class="text-text-secondary mt-0.5"></app-icon>
              <div class="min-w-0">
                <p class="text-xs text-text-secondary">Notas</p>
                <p class="text-sm text-text-primary">{{ draft()!.notes }}</p>
              </div>
            </div>
          }
        </div>

        <div class="border border-border rounded-xl overflow-hidden">
          <div
            class="grid grid-cols-[1fr_70px_80px] gap-0 bg-surface-secondary text-xs font-medium text-text-secondary border-b border-border"
          >
            <div class="px-3 py-2">Producto</div>
            <div class="px-2 py-2 text-center">Cantidad</div>
            <div class="px-2 py-2 text-center">Disponible</div>
          </div>
          @for (line of draft()!.lines; track line.key) {
            <div
              class="grid grid-cols-[1fr_70px_80px] gap-0 items-center border-b border-border last:border-b-0"
            >
              <div class="px-3 py-2.5 min-w-0">
                <p class="text-sm font-medium text-text-primary truncate">
                  {{ line.product_name }}
                  @if (line.variant_name) {
                    <span class="text-text-secondary">· {{ line.variant_name }}</span>
                  }
                </p>
                <p class="text-xs text-text-secondary truncate">
                  {{ line.sku || 'Sin SKU' }}
                </p>
              </div>
              <div class="px-2 py-2.5 text-center text-sm font-bold text-text-primary">
                {{ line.quantity }}
              </div>
              <div class="px-2 py-2.5 text-center text-xs text-text-secondary">
                {{ line.available_at_origin }}
              </div>
            </div>
          }
        </div>

        <div class="mt-3 flex items-center justify-between">
          <p class="text-sm text-text-secondary">
            {{ draft()!.lines.length }} producto(s) · {{ units() }} unidad(es)
          </p>
          @if (draft()!.lines.length === 0) {
            <p class="text-xs text-text-secondary">
              Vuelve al movimiento rápido para agregar productos.
            </p>
          }
        </div>
      }
    </div>
  `,
})
export class TransferAdvancedPageComponent {
  private readonly handoff = inject(TransferDraftHandoffService);

  /** Se consume una sola vez: recargar la página deja la vista vacía. */
  private readonly inherited = this.consumeOnce();

  readonly draft = signal<TransferDraft | null>(this.inherited);
  readonly units = computed(() => totalUnits(this.draft()?.lines ?? []));

  private consumeOnce(): TransferDraft | null {
    return this.handoff.consume();
  }
}
