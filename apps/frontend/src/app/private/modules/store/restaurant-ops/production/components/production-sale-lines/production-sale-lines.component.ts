import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { StoreSettingsFacade } from '../../../../../../../core/store/store-settings/store-settings.facade';
import { IconComponent } from '../../../../../../../shared/components';
import { formatStoreDateTime } from '../../../../../../../shared/utils/date.util';
import {
  ProductionOrderComponent,
  ProductionOrderSaleLine,
  ProductionOrderSaleOrder,
} from '../../interfaces';

/**
 * "Pedido de venta" block shared by the production order detail (restaurant),
 * its modal and the Planta detail: link to the sale, and every sale line with
 * its notes and add-ons (note, image and preparation recipe). Presentational.
 */
@Component({
  selector: 'app-production-sale-lines',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent],
  template: `
    @if (saleOrder(); as so) {
      <div
        class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface p-3 text-sm"
      >
        <div class="min-w-0">
          <a
            [routerLink]="['/admin/orders', so.id]"
            class="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
          >
            Pedido {{ so.order_number }}
            <app-icon name="external-link" [size]="14" />
          </a>
          <p class="text-text-secondary truncate">
            {{ so.customer_name || 'Cliente general' }}
          </p>
        </div>
        @if (dueLabel(); as due) {
          <p class="text-text-secondary text-xs md:text-sm">Entrega: {{ due }}</p>
        }
      </div>
    }

    @if (lines().length > 0) {
      <div class="mt-3 flex flex-col gap-2">
        @for (line of lines(); track line.order_item_id) {
          <div class="rounded-xl border border-border bg-surface p-3 text-sm">
            <p class="font-semibold text-text-primary">
              {{ line.quantity }} × {{ productName() }}
            </p>
            @if (line.notes) {
              <p class="mt-1 italic text-text-secondary">Nota: {{ line.notes }}</p>
            }
            @for (addon of line.addons; track $index) {
              <div class="mt-2 flex gap-2 rounded-lg bg-muted p-2">
                @if (addon.image_url) {
                  <img
                    [src]="addon.image_url"
                    [alt]="addon.option_name"
                    class="h-10 w-10 shrink-0 rounded-md object-cover"
                    loading="lazy"
                  />
                }
                <div class="min-w-0 flex-1">
                  <p class="text-text-primary">
                    + {{ addon.option_name }}
                    <span class="text-xs text-text-secondary">({{ addon.group_name }})</span>
                  </p>
                  @if (addon.note) {
                    <p class="italic text-text-secondary">Nota: {{ addon.note }}</p>
                  }
                  @if (addon.recipe?.components?.length) {
                    <ul class="mt-1 text-xs text-text-secondary">
                      @for (c of addon.recipe!.components; track $index) {
                        <li>{{ componentText(c) }}</li>
                      }
                    </ul>
                  }
                </div>
              </div>
            }
          </div>
        }
      </div>
    }
  `,
})
export class ProductionSaleLinesComponent {
  private readonly settings = inject(StoreSettingsFacade);

  readonly saleOrder = input<ProductionOrderSaleOrder | null>(null);
  readonly lines = input<ProductionOrderSaleLine[]>([]);
  /** Product of the production order: all its lines are this product. */
  readonly productName = input<string>('');

  readonly dueLabel = computed(() => {
    const due = this.saleOrder()?.due_at;
    return due ? formatStoreDateTime(due, this.settings.timezone()) : '';
  });

  componentText(c: ProductionOrderComponent): string {
    return `${c.quantity}${c.unit ? ' ' + c.unit : ''} ${c.name}`;
  }
}
