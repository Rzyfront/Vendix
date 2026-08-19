import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../../../../../environments/environment';
import { ToastService } from '../../../../../../../shared/components/toast/toast.service';

interface CreatePlatformInvoicePayload {
  customer: {
    legal_name: string;
    tax_id: string;
    /**
     * DV del NIT (un dígito). El riel de plataforma emite siempre con
     * customer_document_type='31' (NIT), y la DIAN rechaza Anexo 19 sin
     * DV después de quemar el consecutivo. Por eso es requerido acá.
     */
    tax_id_dv: string;
    email?: string;
    address_line?: string;
    city?: string;
    department_code?: string;
  };
  items: Array<{ description: string; quantity: number; unit_price: number }>;
  period_start?: string;
  period_end?: string;
  currency?: string;
}

interface CreatePlatformInvoiceResponse {
  invoice_id: number;
  fiscal_number: string;
  transmission_id: number;
  transmission_status: string;
  dian_status: string;
  cufe: string | null;
}

/**
 * C.11: formulario de creación de una factura personalizada de plataforma.
 * Cubre servicios que Vendix cobra a sus tenants sin pasar por el motor
 * de suscripciones: implementación, consultoría, capacitación. El backend
 * arma la `fiscal_transmission` con `source_type='platform_invoice'`
 * y reusa la `invoice_resolution_id` activa de la plataforma.
 *
 * Componente compacto a propósito: el plan crítico
 * (CP-fiscal-puente-plataforma) prioriza que la cadena A→B→C funcione
 * end-to-end. La extracción a `<app-invoice-create>` compartido con
 * el rail de tienda queda como handoff.
 */
@Component({
  selector: 'app-platform-invoice-create',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="p-6 max-w-3xl mx-auto">
      <a
        routerLink="/super-admin/fiscal/invoicing/invoices"
        class="text-sm text-primary-600 hover:underline"
      >← Volver al listado</a>

      <h2 class="mt-4 text-2xl font-semibold text-gray-900">
        Nueva factura de plataforma
      </h2>
      <p class="text-sm text-gray-500 mt-1">
        Emite un documento fiscal por servicios de plataforma
        (implementación, consultoría, capacitación) a una organización
        tenant existente.
      </p>

      <form (ngSubmit)="submit()" class="mt-6 space-y-4">
        <fieldset class="bg-white rounded-lg shadow p-4">
          <legend class="font-semibold text-gray-900 px-2">Destinatario</legend>
          <label class="block mt-2 text-sm">
            <span class="text-gray-700">Razón social</span>
            <input
              type="text"
              [(ngModel)]="customer.legal_name"
              name="legal_name"
              required
              class="mt-1 w-full border rounded px-3 py-2"
            />
          </label>
          <label class="block mt-2 text-sm">
            <span class="text-gray-700">NIT (sin DV)</span>
            <input
              type="text"
              [(ngModel)]="customer.tax_id"
              name="tax_id"
              required
              class="mt-1 w-full border rounded px-3 py-2"
            />
          </label>
          <label class="block mt-2 text-sm">
            <span class="text-gray-700">DV <span class="text-red-600">*</span></span>
            <input
              type="text"
              [(ngModel)]="customer.tax_id_dv"
              name="tax_id_dv"
              maxlength="1"
              required
              pattern="[0-9]"
              class="mt-1 w-full border rounded px-3 py-2"
            />
          </label>
          <label class="block mt-2 text-sm">
            <span class="text-gray-700">Email (opcional)</span>
            <input
              type="email"
              [(ngModel)]="customer.email"
              name="email"
              class="mt-1 w-full border rounded px-3 py-2"
            />
          </label>
          <label class="block mt-2 text-sm">
            <span class="text-gray-700">Dirección (opcional)</span>
            <input
              type="text"
              [(ngModel)]="customer.address_line"
              name="address_line"
              class="mt-1 w-full border rounded px-3 py-2"
            />
          </label>
          <div class="grid grid-cols-2 gap-2">
            <label class="block mt-2 text-sm">
              <span class="text-gray-700">Ciudad</span>
              <input
                type="text"
                [(ngModel)]="customer.city"
                name="city"
                class="mt-1 w-full border rounded px-3 py-2"
              />
            </label>
            <label class="block mt-2 text-sm">
              <span class="text-gray-700">Departamento (código)</span>
              <input
                type="text"
                [(ngModel)]="customer.department_code"
                name="department_code"
                maxlength="2"
                class="mt-1 w-full border rounded px-3 py-2"
              />
            </label>
          </div>
        </fieldset>

        <fieldset class="bg-white rounded-lg shadow p-4">
          <legend class="font-semibold text-gray-900 px-2">Líneas</legend>
          @for (item of items(); track $index) {
            <div class="grid grid-cols-12 gap-2 mt-2 items-end">
              <label class="col-span-6 text-sm">
                <span class="text-gray-700">Descripción</span>
                <input
                  type="text"
                  [ngModel]="item.description"
                  (ngModelChange)="updateItem($index, 'description', $event)"
                  [name]="'desc_' + $index"
                  required
                  class="mt-1 w-full border rounded px-3 py-2"
                />
              </label>
              <label class="col-span-2 text-sm">
                <span class="text-gray-700">Cant.</span>
                <input
                  type="number"
                  step="0.01"
                  [ngModel]="item.quantity"
                  (ngModelChange)="updateItem($index, 'quantity', +$event)"
                  [name]="'qty_' + $index"
                  required
                  class="mt-1 w-full border rounded px-3 py-2"
                />
              </label>
              <label class="col-span-3 text-sm">
                <span class="text-gray-700">Precio unit.</span>
                <input
                  type="number"
                  step="0.01"
                  [ngModel]="item.unit_price"
                  (ngModelChange)="updateItem($index, 'unit_price', +$event)"
                  [name]="'price_' + $index"
                  required
                  class="mt-1 w-full border rounded px-3 py-2"
                />
              </label>
              <button
                type="button"
                (click)="removeItem($index)"
                [disabled]="items().length === 1"
                class="col-span-1 px-2 py-2 text-xs text-red-600 disabled:opacity-30"
              >Quitar</button>
            </div>
          }
          <button
            type="button"
            (click)="addItem()"
            class="mt-3 text-sm text-primary-600 hover:underline"
          >+ Añadir línea</button>
        </fieldset>

        @if (errorMessage(); as err) {
          <p class="text-sm text-red-600">{{ err }}</p>
        }

        <div class="flex justify-end gap-2">
          <a
            routerLink="/super-admin/fiscal/invoicing/invoices"
            class="px-3 py-1.5 text-sm border rounded text-gray-700"
          >Cancelar</a>
          <button
            type="submit"
            [disabled]="submitting()"
            class="px-3 py-1.5 bg-primary-600 text-white text-sm rounded disabled:opacity-50"
          >
            {{ submitting() ? 'Creando…' : 'Crear y emitir' }}
          </button>
        </div>
      </form>
    </div>
  `,
})
export class PlatformInvoiceCreateComponent {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  customer = {
    legal_name: '',
    tax_id: '',
    tax_id_dv: '',
    email: '',
    address_line: '',
    city: '',
    department_code: '',
  };

  readonly items = signal<Array<{ description: string; quantity: number; unit_price: number }>>([
    { description: '', quantity: 1, unit_price: 0 },
  ]);
  readonly submitting = signal(false);
  readonly errorMessage = signal<string | null>(null);

  private base = `${environment.apiUrl}/superadmin/subscriptions/fiscal`;

  addItem(): void {
    this.items.update((arr) => [...arr, { description: '', quantity: 1, unit_price: 0 }]);
  }

  removeItem(index: number): void {
    this.items.update((arr) => arr.filter((_, i) => i !== index));
  }

  updateItem(index: number, key: 'description' | 'quantity' | 'unit_price', value: string | number): void {
    this.items.update((arr) =>
      arr.map((it, i) => (i === index ? { ...it, [key]: value } : it)),
    );
  }

  async submit(): Promise<void> {
    this.submitting.set(true);
    this.errorMessage.set(null);
    try {
      const payload: CreatePlatformInvoicePayload = {
        customer: {
          legal_name: this.customer.legal_name,
          tax_id: this.customer.tax_id,
          tax_id_dv: this.customer.tax_id_dv,
          email: this.customer.email || undefined,
          address_line: this.customer.address_line || undefined,
          city: this.customer.city || undefined,
          department_code: this.customer.department_code || undefined,
        },
        items: this.items(),
        currency: 'COP',
      };
      const res = await firstValueFrom(
        this.http.post<{ success: boolean; data: CreatePlatformInvoiceResponse }>(
          `${this.base}/invoices`,
          payload,
        ),
      );
      if (res?.success && res.data) {
        this.toast.success(`Factura ${res.data.fiscal_number} creada (${res.data.dian_status})`);
        // Ruta discriminada `/platform-invoices/:id`: las platform-invoices
        // reciben su id de `fiscal_transmissions`, no de `subscription_invoices`.
        // La ruta `/invoices/:id` queda reservada a SaaS subscription invoices.
        this.router.navigate(['/super-admin/fiscal/invoicing/platform-invoices', res.data.invoice_id]);
      } else {
        this.errorMessage.set('La API no devolvió el resultado.');
      }
    } catch (error) {
      const msg =
        (error instanceof HttpErrorResponse && (error.error?.message ?? error.message)) ||
        (error instanceof Error ? error.message : null) ||
        'Error desconocido al crear la factura.';
      this.errorMessage.set(msg);
      this.toast.error(msg);
    } finally {
      this.submitting.set(false);
    }
  }
}
