import {
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { WithholdingTaxService } from '../services/withholding-tax.service';
import { WithholdingCertificatePrintService } from '../services/withholding-certificate-print.service';
import { WithholdingCertificateData } from '../interfaces/withholding.interface';
import { SuppliersService } from '../../inventory/services/suppliers.service';
import { Supplier } from '../../inventory/interfaces';
import {
  ButtonComponent,
  IconComponent,
  SelectorComponent,
  SelectorOption,
  ToastService,
} from '../../../../../shared/components';
import { CurrencyFormatService } from '../../../../../shared/pipes/currency/currency.pipe';

const MONTH_LABELS = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

/**
 * "Certificados" tab — picks a supplier + fiscal year, loads the certificate
 * data from `GET /store/withholding-tax/certificates/:supplierId` and renders
 * a printable "Certificado de Retención en la Fuente" (art. 381 ET) preview
 * with monthly breakdown, totals and a print action.
 */
@Component({
  selector: 'app-withholding-certificate-viewer',
  standalone: true,
  imports: [FormsModule, ButtonComponent, IconComponent, SelectorComponent],
  template: `
    <div class="bg-white dark:bg-gray-800 rounded-lg shadow">
      <!-- Selectors -->
      <div class="p-4 border-b border-gray-200 dark:border-gray-700">
        <div class="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">
            Certificados de Retención
          </h2>
          <div class="grid grid-cols-2 gap-2 md:flex md:gap-3">
            <app-selector
              label="Proveedor"
              size="sm"
              placeholder="Seleccionar proveedor..."
              [options]="supplierOptions()"
              [ngModel]="selectedSupplierId()"
              (ngModelChange)="onSupplierChange($event)"
            ></app-selector>
            <app-selector
              label="Año gravable"
              size="sm"
              [options]="yearOptions"
              [ngModel]="selectedYear()"
              (ngModelChange)="onYearChange($event)"
            ></app-selector>
          </div>
        </div>
      </div>

      <div class="p-4">
        @if (loading()) {
          <div class="flex items-center justify-center py-16">
            <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          </div>
        } @else if (certificate(); as cert) {
          <!-- Certificate header -->
          <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between mb-4">
            <div>
              <h3 class="text-base font-bold text-gray-900 dark:text-white uppercase">
                Certificado de Retención en la Fuente
              </h3>
              <p class="text-sm text-gray-500 dark:text-gray-400">
                Año Gravable {{ cert.year }} · Art. 381 Estatuto Tributario
              </p>
              <div class="mt-2 text-sm text-gray-700 dark:text-gray-300">
                <p class="font-semibold">{{ cert.supplier_name }}</p>
                @if (cert.supplier_nit) {
                  <p class="text-gray-500 dark:text-gray-400">NIT: {{ cert.supplier_nit }}</p>
                }
              </div>
            </div>
            <app-button variant="primary" size="sm" (clicked)="printCertificate()">
              <app-icon name="printer" [size]="16" slot="icon"></app-icon>
              Imprimir
            </app-button>
          </div>

          <!-- Monthly breakdown -->
          <div class="overflow-x-auto border border-gray-200 dark:border-gray-700 rounded-lg">
            <table class="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead class="bg-gray-50 dark:bg-gray-900">
                <tr>
                  <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Mes</th>
                  <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Concepto</th>
                  <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Base</th>
                  <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Tarifa</th>
                  <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Valor Retenido</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
                @for (row of cert.monthly_breakdown; track $index) {
                  <tr class="hover:bg-gray-50 dark:hover:bg-gray-700">
                    <td class="px-4 py-3 text-sm">{{ monthLabel(row.month) }}</td>
                    <td class="px-4 py-3 text-sm">{{ row.concept }}</td>
                    <td class="px-4 py-3 text-sm text-right font-mono">{{ formatCurrency(row.base) }}</td>
                    <td class="px-4 py-3 text-sm text-right">{{ formatRate(row.rate) }}</td>
                    <td class="px-4 py-3 text-sm text-right font-mono font-semibold">{{ formatCurrency(row.amount) }}</td>
                  </tr>
                }
                @empty {
                  <tr>
                    <td colspan="5" class="px-4 py-8 text-center text-sm text-gray-500">
                      Sin retenciones registradas para este proveedor en {{ cert.year }}
                    </td>
                  </tr>
                }
              </tbody>
              @if (cert.monthly_breakdown.length > 0) {
                <tfoot class="bg-gray-50 dark:bg-gray-900">
                  <tr>
                    <td colspan="2" class="px-4 py-3 text-sm font-bold text-right">Totales</td>
                    <td class="px-4 py-3 text-sm text-right font-mono font-bold">{{ formatCurrency(cert.total_base) }}</td>
                    <td class="px-4 py-3"></td>
                    <td class="px-4 py-3 text-sm text-right font-mono font-bold">{{ formatCurrency(cert.total_withheld) }}</td>
                  </tr>
                </tfoot>
              }
            </table>
          </div>
        } @else {
          <div class="flex flex-col items-center justify-center py-16 text-gray-400">
            <app-icon name="printer" [size]="48"></app-icon>
            <p class="mt-4 text-base">Selecciona un proveedor y un año gravable</p>
            <p class="text-sm">El certificado se genera con las retenciones practicadas al proveedor.</p>
          </div>
        }
      </div>
    </div>
  `,
})
export class WithholdingCertificateViewerComponent {
  private readonly service = inject(WithholdingTaxService);
  private readonly suppliersService = inject(SuppliersService);
  private readonly printService = inject(WithholdingCertificatePrintService);
  private readonly currencyService = inject(CurrencyFormatService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly suppliers = signal<Supplier[]>([]);
  readonly certificate = signal<WithholdingCertificateData | null>(null);
  readonly loading = signal(false);

  readonly selectedSupplierId = signal<number | ''>('');
  readonly selectedYear = signal<number>(new Date().getFullYear());

  readonly supplierOptions = computed<SelectorOption[]>(() =>
    this.suppliers().map((supplier) => ({
      value: supplier.id,
      label: supplier.tax_id
        ? `${supplier.name} (${supplier.tax_id})`
        : supplier.name,
    })),
  );

  readonly yearOptions: SelectorOption[] = Array.from(
    { length: 6 },
    (_, i) => {
      const year = new Date().getFullYear() - i;
      return { value: year, label: String(year) };
    },
  );

  constructor() {
    this.loadSuppliers();
  }

  private loadSuppliers(): void {
    this.suppliersService
      .getSuppliers({ is_active: true, limit: 100 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => this.suppliers.set(res.data ?? []),
        error: () => this.suppliers.set([]),
      });
  }

  onSupplierChange(value: number | ''): void {
    this.selectedSupplierId.set(value === '' ? '' : Number(value));
    this.loadCertificate();
  }

  onYearChange(value: number): void {
    this.selectedYear.set(Number(value));
    this.loadCertificate();
  }

  private loadCertificate(): void {
    const supplierId = this.selectedSupplierId();
    if (supplierId === '') {
      this.certificate.set(null);
      return;
    }

    this.loading.set(true);
    this.service
      .getCertificate(Number(supplierId), this.selectedYear())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res: any) => {
          this.certificate.set(res?.data ?? null);
          this.loading.set(false);
        },
        error: () => {
          this.certificate.set(null);
          this.loading.set(false);
          this.toast.error('No se pudo generar el certificado');
        },
      });
  }

  printCertificate(): void {
    const cert = this.certificate();
    if (!cert) return;
    this.printService.printCertificate(cert);
  }

  monthLabel(month: number): string {
    return MONTH_LABELS[month - 1] || String(month);
  }

  formatCurrency(value: number): string {
    return this.currencyService.format(Number(value) || 0);
  }

  formatRate(rate: number): string {
    return `${((Number(rate) || 0) * 100).toFixed(2)}%`;
  }
}
