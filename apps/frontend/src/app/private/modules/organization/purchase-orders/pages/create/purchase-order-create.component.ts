import { Component, DestroyRef, inject, signal, computed } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import {
  CardComponent,
  AlertBannerComponent,
  ButtonComponent,
  ToastService,
  IconComponent,
} from '../../../../../../shared/components/index';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency/currency.pipe';
import {
  OrgPurchaseOrdersService,
  CreateOrgPurchaseOrderDto,
} from '../../services/org-purchase-orders.service';
import { ApiErrorService } from '../../../../../../core/services/api-error.service';

interface DraftLine {
  product_id: number | null;
  product_label: string;
  quantity: number;
  unit_cost: number;
}

/**
 * ORG_ADMIN — Wizard mínimo de creación de OC.
 *
 * Soporta líneas para una OC contra una location_id (resuelta a su tienda
 * en el backend vía runWithStoreContext). Para crear órdenes en múltiples
 * tiendas se crean OC separadas por location_id.
 *
 * NOTE: Este MVP usa inputs numéricos directos para product_id. Un picker
 * de productos completo (búsqueda con autocompletar) queda fuera de alcance
 * y se sugiere abrir un knowledge gap (`vendix-frontend-product-picker`).
 */
@Component({
  selector: 'vendix-org-purchase-order-create',
  standalone: true,
  imports: [
    RouterModule,
    FormsModule,
    CardComponent,
    AlertBannerComponent,
    ButtonComponent,
    IconComponent,
    CurrencyPipe,
  ],
  template: `
    <div class="w-full p-2 md:p-4">
      <header class="sticky top-0 z-10 bg-background py-2 md:py-4 mb-2 flex items-center gap-2">
        <a routerLink="/admin/purchase-orders" class="text-sm text-text-secondary hover:underline">
          ← Volver
        </a>
        <h1 class="text-lg md:text-2xl font-semibold text-text-primary ml-2">Nueva OC</h1>
      </header>

      @if (errorMessage(); as msg) {
        <app-alert-banner variant="danger" title="No se pudo crear la orden">
          {{ msg }}
        </app-alert-banner>
      }

      <app-card>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          <label class="block">
            <span class="text-text-secondary text-xs">Proveedor (ID)</span>
            <input
              type="number"
              [(ngModel)]="supplierId"
              name="supplierId"
              class="mt-1 w-full px-2 py-1.5 border border-border rounded bg-background text-sm"
              placeholder="ID del proveedor"
            />
          </label>
          <label class="block">
            <span class="text-text-secondary text-xs">Ubicación (ID)</span>
            <input
              type="number"
              [(ngModel)]="locationId"
              name="locationId"
              class="mt-1 w-full px-2 py-1.5 border border-border rounded bg-background text-sm"
              placeholder="ID de ubicación destino"
            />
          </label>
          <label class="block">
            <span class="text-text-secondary text-xs">Fecha esperada</span>
            <input
              type="date"
              [(ngModel)]="expectedDate"
              name="expectedDate"
              class="mt-1 w-full px-2 py-1.5 border border-border rounded bg-background text-sm"
            />
          </label>
          <label class="block md:col-span-3">
            <span class="text-text-secondary text-xs">Notas</span>
            <textarea
              [(ngModel)]="notes"
              name="notes"
              rows="2"
              class="mt-1 w-full px-2 py-1.5 border border-border rounded bg-background text-sm"
            ></textarea>
          </label>
        </div>
      </app-card>

      <app-card customClasses="mt-3" [padding]="false">
        <div class="px-3 py-2 border-b border-border bg-background-soft flex items-center justify-between">
          <h2 class="text-sm md:text-base font-semibold">Líneas</h2>
          <app-button variant="outline" size="sm" (click)="addLine()">
            <app-icon name="plus" /> Agregar línea
          </app-button>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-xs md:text-sm">
            <thead class="bg-background-soft border-b border-border">
              <tr class="text-left text-text-secondary">
                <th class="px-3 py-2 font-medium">Producto (ID)</th>
                <th class="px-3 py-2 font-medium text-right">Cantidad</th>
                <th class="px-3 py-2 font-medium text-right">Costo unit.</th>
                <th class="px-3 py-2 font-medium text-right">Subtotal</th>
                <th class="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              @for (line of lines(); track $index; let i = $index) {
                <tr class="border-b border-border/40">
                  <td class="px-3 py-2">
                    <input
                      type="number"
                      [(ngModel)]="line.product_id"
                      [name]="'product_id_' + i"
                      class="w-32 px-2 py-1 border border-border rounded bg-background text-xs"
                      placeholder="ID"
                    />
                  </td>
                  <td class="px-3 py-2 text-right">
                    <input
                      type="number"
                      [(ngModel)]="line.quantity"
                      [name]="'qty_' + i"
                      min="1"
                      step="1"
                      class="w-24 px-2 py-1 border border-border rounded bg-background text-xs text-right"
                    />
                  </td>
                  <td class="px-3 py-2 text-right">
                    <input
                      type="number"
                      [(ngModel)]="line.unit_cost"
                      [name]="'cost_' + i"
                      min="0"
                      step="0.01"
                      class="w-32 px-2 py-1 border border-border rounded bg-background text-xs text-right"
                    />
                  </td>
                  <td class="px-3 py-2 text-right">
                    {{ (line.quantity * line.unit_cost) | currency }}
                  </td>
                  <td class="px-3 py-2 text-right">
                    <button
                      type="button"
                      class="text-error hover:underline text-xs"
                      (click)="removeLine(i)"
                    >Quitar</button>
                  </td>
                </tr>
              } @empty {
                <tr><td colspan="5" class="px-3 py-6 text-center text-text-secondary">
                  Aún no hay líneas. Agrega una.
                </td></tr>
              }
            </tbody>
            <tfoot class="bg-background-soft border-t-2 border-border font-semibold">
              <tr>
                <td class="px-3 py-2" colspan="3">Total</td>
                <td class="px-3 py-2 text-right">{{ total() | currency }}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </app-card>

      <div class="flex justify-end gap-2 mt-4">
        <app-button variant="secondary" routerLink="/admin/purchase-orders">Cancelar</app-button>
        <app-button
          variant="primary"
          [loading]="submitting()"
          [disabled]="!canSubmit()"
          (click)="submit()"
        >Crear OC</app-button>
      </div>
    </div>
  `,
})
export class OrgPurchaseOrderCreateComponent {
  private readonly service = inject(OrgPurchaseOrdersService);
  private readonly errors = inject(ApiErrorService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  supplierId: number | null = null;
  locationId: number | null = null;
  expectedDate: string | null = null;
  notes = '';

  readonly lines = signal<DraftLine[]>([
    { product_id: null, product_label: '', quantity: 1, unit_cost: 0 },
  ]);
  readonly submitting = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly total = computed(() =>
    this.lines().reduce(
      (sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.unit_cost) || 0),
      0,
    ),
  );

  readonly canSubmit = computed(() => {
    if (!this.supplierId || !this.locationId) return false;
    const ls = this.lines();
    if (ls.length === 0) return false;
    return ls.every(
      (l) => l.product_id && Number(l.quantity) > 0 && Number(l.unit_cost) >= 0,
    );
  });

  addLine(): void {
    this.lines.update((curr) => [
      ...curr,
      { product_id: null, product_label: '', quantity: 1, unit_cost: 0 },
    ]);
  }

  removeLine(index: number): void {
    this.lines.update((curr) => curr.filter((_, i) => i !== index));
  }

  submit(): void {
    if (!this.canSubmit() || !this.supplierId || !this.locationId) return;
    this.submitting.set(true);
    this.errorMessage.set(null);

    const dto: CreateOrgPurchaseOrderDto = {
      supplier_id: Number(this.supplierId),
      location_id: Number(this.locationId),
      expected_date: this.expectedDate || undefined,
      notes: this.notes || undefined,
      lines: this.lines().map((l) => ({
        product_id: Number(l.product_id),
        quantity: Number(l.quantity),
        unit_cost: Number(l.unit_cost),
      })),
    };

    this.service
      .create(dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.submitting.set(false);
          this.toast.success('Orden de compra creada');
          const id = res?.data?.id;
          if (id) {
            this.router.navigate(['/admin/purchase-orders', id]);
          } else {
            this.router.navigate(['/admin/purchase-orders']);
          }
        },
        error: (err) => {
          console.error('[OrgPurchaseOrderCreate] submit failed', err);
          this.submitting.set(false);
          this.errorMessage.set(
            this.errors.humanize(err, 'No se pudo crear la orden.'),
          );
        },
      });
  }
}
