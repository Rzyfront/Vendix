import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  BadgeComponent,
  ButtonComponent,
  DialogService,
  IconComponent,
  SpinnerComponent,
  ToastService,
} from '../../../../../../../shared/components';
import { formatStockWarningSummary } from '../../../../../../../core/utils/stock-shortage.util';
import { ProductionOrder, ProductionOrderComponent } from '../../interfaces';
import { ProductionOrdersService } from '../../services';
import { formatYieldQuantity } from '../../services/yield-unit.util';
import { ProductionSaleLinesComponent } from '../production-sale-lines/production-sale-lines.component';

/**
 * Shared detail of one production order (QUI-995 / T13): product, quantity,
 * status, base recipe, sale link with every line, notes and add-ons, plus the
 * Iniciar / Completar / Cancelar actions over the existing endpoints. Hosts:
 * the restaurant detail route and the modal opened from the sale detail,
 * the scheduled-orders screens and Planta.
 */
@Component({
  selector: 'app-production-order-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    BadgeComponent,
    ButtonComponent,
    IconComponent,
    SpinnerComponent,
    ProductionSaleLinesComponent,
  ],
  template: `
    @if (loading() && !order()) {
      <div class="flex justify-center py-10"><app-spinner /></div>
    } @else if (order(); as o) {
      <div class="flex flex-col gap-4">
        <div class="flex items-start gap-3">
          @if (o.product?.image_url) {
            <img
              [src]="o.product!.image_url"
              [alt]="o.product!.name"
              class="h-16 w-16 shrink-0 rounded-xl object-cover"
            />
          } @else {
            <div
              class="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-muted text-text-secondary"
            >
              <app-icon name="flame" [size]="24" />
            </div>
          }
          <div class="min-w-0 flex-1">
            <p class="truncate text-base font-semibold text-text-primary">
              {{ o.product?.name || 'Producción #' + o.id }}
            </p>
            <p class="text-sm text-text-secondary">
              {{ o.order_number || '#' + o.id }} · Planeado:
              {{ qty(o.planned_qty) }}
              @if (o.produced_qty != null) {
                · Producido: {{ qty(o.produced_qty) }}
              }
            </p>
            <div class="mt-1 flex flex-wrap items-center gap-1">
              <app-badge [variant]="statusVariant(o.status)" size="sm">
                {{ statusLabel(o.status) }}
              </app-badge>
              @if (o.source === 'order') {
                <app-badge variant="neutral" size="sm" badgeStyle="outline">Venta</app-badge>
              }
            </div>
          </div>
        </div>

        @if (baseComponents().length > 0) {
          <section>
            <h3 class="mb-1 text-sm font-semibold text-text-primary">Receta base</h3>
            <ul class="flex flex-col gap-1 text-sm">
              @for (c of baseComponents(); track $index) {
                <li class="flex items-center gap-2">
                  @if (c.image_url) {
                    <img
                      [src]="c.image_url"
                      [alt]="c.name"
                      class="h-8 w-8 shrink-0 rounded-md object-cover"
                      loading="lazy"
                    />
                  }
                  <span class="text-text-primary">{{ c.name }}</span>
                  <span class="ml-auto text-text-secondary">
                    {{ c.quantity }}{{ c.unit ? ' ' + c.unit : '' }}
                  </span>
                </li>
              }
            </ul>
          </section>
        }

        @if (o.sale_order || (o.order_lines?.length ?? 0) > 0) {
          <section>
            <h3 class="mb-1 text-sm font-semibold text-text-primary">Pedido de venta</h3>
            <app-production-sale-lines
              [saleOrder]="o.sale_order ?? null"
              [lines]="o.order_lines ?? []"
              [productName]="o.product?.name ?? ''"
            />
          </section>
        }

        @if (canStart() || canComplete() || canCancel()) {
          <div class="flex flex-wrap justify-end gap-2">
            @if (canCancel()) {
              <app-button variant="outline-danger" [disabled]="busy()" (clicked)="cancel()">
                Cancelar
              </app-button>
            }
            @if (canStart()) {
              <app-button variant="outline" [disabled]="busy()" (clicked)="start()">
                Iniciar
              </app-button>
            }
            @if (canComplete()) {
              <app-button variant="primary" [loading]="busy()" (clicked)="complete()">
                Completar
              </app-button>
            }
          </div>
        }
      </div>
    } @else {
      <p class="py-6 text-center text-sm text-text-secondary">
        No se pudo cargar la orden de producción.
      </p>
    }
  `,
})
export class ProductionOrderDetailComponent {
  private readonly service = inject(ProductionOrdersService);
  private readonly toast = inject(ToastService);
  private readonly dialog = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);

  readonly orderId = input<number | null>(null);
  /** Emitted after start / complete / cancel so hosts refresh their lists. */
  readonly changed = output<void>();

  readonly order = signal<ProductionOrder | null>(null);
  readonly loading = signal(false);
  readonly busy = signal(false);

  readonly baseComponents = computed<ProductionOrderComponent[]>(
    () => this.order()?.base_recipe?.components ?? [],
  );
  readonly canStart = computed(() => this.order()?.status === 'draft');
  readonly canComplete = computed(() => {
    const s = this.order()?.status;
    return s === 'draft' || s === 'in_progress';
  });
  readonly canCancel = this.canComplete;

  constructor() {
    effect(() => {
      const id = this.orderId();
      untracked(() => {
        this.order.set(null);
        if (id != null) this.load(id);
      });
    });
  }

  statusLabel = ProductionOrdersService.statusLabelSafe;
  statusVariant = ProductionOrdersService.statusBadgeVariant;

  qty(value: number | string | null | undefined): string {
    const o = this.order();
    const n = Number(value ?? 0);
    const text = Number.isInteger(n) ? String(n) : n.toFixed(2);
    return formatYieldQuantity(value, o?.recipe?.yield_unit, text);
  }

  private load(id: number): void {
    this.loading.set(true);
    this.service
      .getById(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (o) => {
          this.order.set(o);
          this.loading.set(false);
        },
        error: (err) => {
          this.loading.set(false);
          this.toast.error(typeof err === 'string' ? err : 'Error al cargar la orden de producción');
        },
      });
  }

  async start(): Promise<void> {
    const o = this.order();
    if (!o || this.busy()) return;
    const ok = await this.dialog.confirm({
      title: 'Iniciar producción',
      message: '¿Iniciar esta orden de producción?',
      confirmText: 'Iniciar',
      cancelText: 'Cancelar',
    });
    if (!ok) return;
    this.run(this.service.start(o.id), 'Producción iniciada', 'Error al iniciar la producción');
  }

  async complete(): Promise<void> {
    const o = this.order();
    if (!o || this.busy()) return;
    const name = o.product?.name ?? `#${o.id}`;

    if (o.source === 'order') {
      // Linked to a sale: the quantity is the purchased one, no batch rounding.
      const ok = await this.dialog.confirm({
        title: `Completar producción de ${name}`,
        message: `Se registrará lo producido (${this.qty(o.planned_qty)}) y quedará reservado para el pedido ${o.sale_order?.order_number ?? ''}.`,
        confirmText: 'Completar',
        cancelText: 'Cancelar',
      });
      if (!ok) return;
      this.doComplete(o, Number(o.planned_qty));
      return;
    }

    // Manual order: same whole-batch UX as the production list (QUI-965).
    const rawYield = Number(o.recipe?.yield_quantity);
    const yieldQty = Number.isFinite(rawYield) && rawYield > 0 ? rawYield : 1;
    const unit = o.recipe?.yield_unit ?? 'unidades';
    const plannedBatches = Math.max(1, Math.round(Number(o.planned_qty) / yieldQty));
    const value = await this.dialog.prompt({
      title: `Completar producción de ${name}`,
      message: `Indica cuántas tandas de la receta se hicieron (cada tanda rinde ${formatYieldQuantity(yieldQty, unit, String(yieldQty))}). Al confirmar, se descuentan los insumos y se suma el stock del producto terminado.`,
      placeholder: 'Número de tandas',
      defaultValue: String(plannedBatches),
      confirmText: 'Completar y registrar stock',
      cancelText: 'Cancelar',
      inputType: 'number',
    });
    if (value == null) return;
    const batches = Number(value);
    if (!Number.isInteger(batches) || batches < 1) {
      this.toast.error('Las tandas deben ser un número entero mayor o igual a 1');
      return;
    }
    this.doComplete(o, batches * yieldQty);
  }

  async cancel(): Promise<void> {
    const o = this.order();
    if (!o || this.busy()) return;
    const ok = await this.dialog.confirm({
      title: 'Cancelar producción',
      message: `¿Cancelar la producción de "${o.product?.name ?? `#${o.id}`}"? Esta acción no se puede deshacer.`,
      confirmText: 'Cancelar producción',
      cancelText: 'Volver',
      confirmVariant: 'danger',
    });
    if (!ok) return;
    this.run(this.service.cancel(o.id), 'Producción cancelada', 'Error al cancelar la producción');
  }

  private doComplete(o: ProductionOrder, producedQty: number): void {
    this.busy.set(true);
    this.service
      .complete(o.id, { produced_qty: producedQty })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (done) => {
          this.toast.success('Producción completada: stock generado y consumos registrados');
          if (done?.stock_warnings?.length) {
            this.toast.warning(formatStockWarningSummary(done.stock_warnings));
          }
          this.afterAction(o.id);
        },
        error: (err) => this.onError(err, 'Error al completar la producción'),
      });
  }

  private run(
    call: ReturnType<ProductionOrdersService['start']>,
    okMessage: string,
    errorMessage: string,
  ): void {
    const id = this.order()?.id;
    if (id == null) return;
    this.busy.set(true);
    call.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.toast.success(okMessage);
        this.afterAction(id);
      },
      error: (err) => this.onError(err, errorMessage),
    });
  }

  private afterAction(id: number): void {
    this.busy.set(false);
    this.changed.emit();
    this.load(id);
  }

  private onError(err: unknown, fallback: string): void {
    this.busy.set(false);
    this.toast.error(typeof err === 'string' ? err : fallback);
  }
}
