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
import {
  WithholdingCertificateData,
  SufferedWithholdingCertificateData,
  EmployeeIncomeCertificateData,
} from '../interfaces/withholding.interface';
import { SuppliersService } from '../../inventory/services/suppliers.service';
import { Supplier } from '../../inventory/interfaces';
import { CustomersService } from '../../customers/services/customers.service';
import { Customer } from '../../customers/models/customer.model';
import { PayrollService } from '../../payroll/services/payroll.service';
import { Employee } from '../../payroll/interfaces/payroll.interface';
import {
  ButtonComponent,
  IconComponent,
  SelectorComponent,
  SelectorOption,
  ToastService,
} from '../../../../../shared/components';
import { CurrencyFormatService } from '../../../../../shared/pipes/currency/currency.pipe';

/** Tipo de certificado renderizable en este viewer. */
type CertificateKind = 'supplier_practiced' | 'suffered' | 'employee';

/** Contraparte del certificado de retención sufrida. */
type SufferedCounterpartyType = 'customer' | 'supplier';

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

const CERTIFICATE_KIND_OPTIONS: SelectorOption[] = [
  { value: 'supplier_practiced', label: 'Retención practicada (proveedor)' },
  { value: 'suffered', label: 'Retención sufrida (cliente/proveedor)' },
  { value: 'employee', label: 'Ingresos y retenciones (Form. 220 — empleado)' },
];

const SUFFERED_COUNTERPARTY_OPTIONS: SelectorOption[] = [
  { value: 'customer', label: 'Cliente' },
  { value: 'supplier', label: 'Proveedor' },
];

/**
 * "Certificados" tab — picks a certificate kind (retención practicada a
 * proveedor / retención sufrida de un cliente-proveedor / ingresos y
 * retenciones Formulario 220 de un empleado) + counterparty + fiscal year,
 * loads the certificate data from the matching backend endpoint and renders
 * a printable preview with monthly breakdown, totals and a print action.
 */
@Component({
  selector: 'app-withholding-certificate-viewer',
  standalone: true,
  imports: [FormsModule, ButtonComponent, IconComponent, SelectorComponent],
  template: `
    <div class="bg-[var(--color-surface)] rounded-lg shadow">
      <!-- Selectors -->
      <div class="p-4 border-b border-border">
        <div class="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <h2 class="text-lg font-semibold text-text-primary">
            Certificados de Retención
          </h2>
          <div class="grid grid-cols-2 gap-2 md:flex md:flex-wrap md:gap-3">
            <app-selector
              label="Tipo de certificado"
              size="sm"
              [options]="kindOptions"
              [ngModel]="kind()"
              (ngModelChange)="onKindChange($event)"
            ></app-selector>

            @if (kind() === 'supplier_practiced') {
              <app-selector
                label="Proveedor"
                size="sm"
                placeholder="Seleccionar proveedor..."
                [options]="supplierOptions()"
                [ngModel]="selectedSupplierId()"
                (ngModelChange)="onSupplierChange($event)"
              ></app-selector>
            }

            @if (kind() === 'suffered') {
              <app-selector
                label="Contraparte"
                size="sm"
                [options]="sufferedCounterpartyOptions"
                [ngModel]="sufferedCounterpartyType()"
                (ngModelChange)="onSufferedCounterpartyTypeChange($event)"
              ></app-selector>
              @if (sufferedCounterpartyType() === 'customer') {
                <app-selector
                  label="Cliente"
                  size="sm"
                  placeholder="Seleccionar cliente..."
                  [options]="customerOptions()"
                  [ngModel]="selectedCounterpartyId()"
                  (ngModelChange)="onCounterpartyChange($event)"
                ></app-selector>
              } @else {
                <app-selector
                  label="Proveedor"
                  size="sm"
                  placeholder="Seleccionar proveedor..."
                  [options]="supplierOptions()"
                  [ngModel]="selectedCounterpartyId()"
                  (ngModelChange)="onCounterpartyChange($event)"
                ></app-selector>
              }
            }

            @if (kind() === 'employee') {
              <app-selector
                label="Empleado"
                size="sm"
                placeholder="Seleccionar empleado..."
                [options]="employeeOptions()"
                [ngModel]="selectedEmployeeId()"
                (ngModelChange)="onEmployeeChange($event)"
              ></app-selector>
            }

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
            <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--color-primary)]"></div>
          </div>
        } @else if (kind() === 'supplier_practiced' && practicedCertificate(); as cert) {
          <!-- Certificate header -->
          <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between mb-4">
            <div>
              <h3 class="text-base font-bold text-text-primary uppercase">
                Certificado de Retención en la Fuente
              </h3>
              <p class="text-sm text-text-secondary">
                Año Gravable {{ cert.year }} · Art. 381 Estatuto Tributario
              </p>
              <div class="mt-2 text-sm text-text-primary">
                <p class="font-semibold">{{ cert.supplier_name }}</p>
                @if (cert.supplier_nit) {
                  <p class="text-text-secondary">NIT: {{ cert.supplier_nit }}</p>
                }
              </div>
            </div>
            <app-button variant="primary" size="sm" (clicked)="printCertificate()">
              <app-icon name="printer" [size]="16" slot="icon"></app-icon>
              Imprimir
            </app-button>
          </div>

          <!-- Monthly breakdown -->
          <div class="overflow-x-auto border border-border rounded-lg">
            <table class="min-w-full divide-y divide-[var(--color-border)]">
              <thead class="bg-[var(--color-surface-secondary)]">
                <tr>
                  <th class="px-4 py-3 text-left text-xs font-medium text-text-secondary uppercase">Mes</th>
                  <th class="px-4 py-3 text-left text-xs font-medium text-text-secondary uppercase">Concepto</th>
                  <th class="px-4 py-3 text-right text-xs font-medium text-text-secondary uppercase">Base</th>
                  <th class="px-4 py-3 text-right text-xs font-medium text-text-secondary uppercase">Tarifa</th>
                  <th class="px-4 py-3 text-right text-xs font-medium text-text-secondary uppercase">Valor Retenido</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-[var(--color-border)]">
                @for (row of cert.monthly_breakdown; track $index) {
                  <tr class="hover:bg-[var(--color-surface-secondary)]">
                    <td class="px-4 py-3 text-sm">{{ monthLabel(row.month) }}</td>
                    <td class="px-4 py-3 text-sm">{{ row.concept }}</td>
                    <td class="px-4 py-3 text-sm text-right font-mono">{{ formatCurrency(row.base) }}</td>
                    <td class="px-4 py-3 text-sm text-right">{{ formatRate(row.rate) }}</td>
                    <td class="px-4 py-3 text-sm text-right font-mono font-semibold">{{ formatCurrency(row.amount) }}</td>
                  </tr>
                }
                @empty {
                  <tr>
                    <td colspan="5" class="px-4 py-8 text-center text-sm text-text-secondary">
                      Sin retenciones registradas para este proveedor en {{ cert.year }}
                    </td>
                  </tr>
                }
              </tbody>
              @if (cert.monthly_breakdown.length > 0) {
                <tfoot class="bg-[var(--color-surface-secondary)]">
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
        } @else if (kind() === 'suffered' && sufferedCertificate(); as cert) {
          <!-- Certificate header -->
          <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between mb-4">
            <div>
              <h3 class="text-base font-bold text-text-primary uppercase">
                Certificado de Retención Sufrida
              </h3>
              <p class="text-sm text-text-secondary">
                Año Gravable {{ cert.year }} · Art. 381 Estatuto Tributario
              </p>
              <div class="mt-2 text-sm text-text-primary">
                <p class="font-semibold">{{ cert.counterparty_name }}</p>
                @if (cert.counterparty_nit) {
                  <p class="text-text-secondary">NIT/CC: {{ cert.counterparty_nit }}</p>
                }
              </div>
            </div>
            <app-button variant="primary" size="sm" (clicked)="printCertificate()">
              <app-icon name="printer" [size]="16" slot="icon"></app-icon>
              Imprimir
            </app-button>
          </div>

          <!-- Monthly breakdown -->
          <div class="overflow-x-auto border border-border rounded-lg">
            <table class="min-w-full divide-y divide-[var(--color-border)]">
              <thead class="bg-[var(--color-surface-secondary)]">
                <tr>
                  <th class="px-4 py-3 text-left text-xs font-medium text-text-secondary uppercase">Mes</th>
                  <th class="px-4 py-3 text-left text-xs font-medium text-text-secondary uppercase">Concepto</th>
                  <th class="px-4 py-3 text-left text-xs font-medium text-text-secondary uppercase">Tipo</th>
                  <th class="px-4 py-3 text-right text-xs font-medium text-text-secondary uppercase">Base</th>
                  <th class="px-4 py-3 text-right text-xs font-medium text-text-secondary uppercase">Tarifa</th>
                  <th class="px-4 py-3 text-right text-xs font-medium text-text-secondary uppercase">Valor Retenido</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-[var(--color-border)]">
                @for (row of cert.monthly_breakdown; track $index) {
                  <tr class="hover:bg-[var(--color-surface-secondary)]">
                    <td class="px-4 py-3 text-sm">{{ monthLabel(row.month) }}</td>
                    <td class="px-4 py-3 text-sm">{{ row.concept }}</td>
                    <td class="px-4 py-3 text-sm uppercase">{{ row.withholding_type }}</td>
                    <td class="px-4 py-3 text-sm text-right font-mono">{{ formatCurrency(row.base) }}</td>
                    <td class="px-4 py-3 text-sm text-right">{{ formatRate(row.rate) }}</td>
                    <td class="px-4 py-3 text-sm text-right font-mono font-semibold">{{ formatCurrency(row.amount) }}</td>
                  </tr>
                }
                @empty {
                  <tr>
                    <td colspan="6" class="px-4 py-8 text-center text-sm text-text-secondary">
                      Sin retenciones sufridas registradas en {{ cert.year }}
                    </td>
                  </tr>
                }
              </tbody>
              @if (cert.monthly_breakdown.length > 0) {
                <tfoot class="bg-[var(--color-surface-secondary)]">
                  <tr>
                    <td colspan="3" class="px-4 py-3 text-sm font-bold text-right">Totales</td>
                    <td class="px-4 py-3 text-sm text-right font-mono font-bold">{{ formatCurrency(cert.total_base) }}</td>
                    <td class="px-4 py-3"></td>
                    <td class="px-4 py-3 text-sm text-right font-mono font-bold">{{ formatCurrency(cert.total_withheld) }}</td>
                  </tr>
                </tfoot>
              }
            </table>
          </div>
        } @else if (kind() === 'employee' && employeeCertificate(); as cert) {
          <!-- Certificate header -->
          <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between mb-4">
            <div>
              <h3 class="text-base font-bold text-text-primary uppercase">
                Certificado de Ingresos y Retenciones
              </h3>
              <p class="text-sm text-text-secondary">
                Formulario 220 DIAN · Año Gravable {{ cert.year }}
              </p>
              <div class="mt-2 text-sm text-text-primary">
                <p class="font-semibold">{{ cert.employee_name }}</p>
                @if (cert.employee_document_number) {
                  <p class="text-text-secondary">
                    {{ (cert.employee_document_type || 'CC').toUpperCase() }}: {{ cert.employee_document_number }}
                  </p>
                }
              </div>
            </div>
            <app-button variant="primary" size="sm" (clicked)="printCertificate()">
              <app-icon name="printer" [size]="16" slot="icon"></app-icon>
              Imprimir
            </app-button>
          </div>

          <!-- Monthly breakdown -->
          <div class="overflow-x-auto border border-border rounded-lg">
            <table class="min-w-full divide-y divide-[var(--color-border)]">
              <thead class="bg-[var(--color-surface-secondary)]">
                <tr>
                  <th class="px-4 py-3 text-left text-xs font-medium text-text-secondary uppercase">Mes</th>
                  <th class="px-4 py-3 text-right text-xs font-medium text-text-secondary uppercase">Salario</th>
                  <th class="px-4 py-3 text-right text-xs font-medium text-text-secondary uppercase">Aporte Salud</th>
                  <th class="px-4 py-3 text-right text-xs font-medium text-text-secondary uppercase">Aporte Pensión</th>
                  <th class="px-4 py-3 text-right text-xs font-medium text-text-secondary uppercase">Retefuente</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-[var(--color-border)]">
                @for (row of cert.monthly_breakdown; track $index) {
                  <tr class="hover:bg-[var(--color-surface-secondary)]">
                    <td class="px-4 py-3 text-sm">{{ monthLabel(row.month) }}</td>
                    <td class="px-4 py-3 text-sm text-right font-mono">{{ formatCurrency(row.salary) }}</td>
                    <td class="px-4 py-3 text-sm text-right font-mono">{{ formatCurrency(row.health_deduction) }}</td>
                    <td class="px-4 py-3 text-sm text-right font-mono">{{ formatCurrency(row.pension_deduction) }}</td>
                    <td class="px-4 py-3 text-sm text-right font-mono font-semibold">{{ formatCurrency(row.withholding) }}</td>
                  </tr>
                }
                @empty {
                  <tr>
                    <td colspan="5" class="px-4 py-8 text-center text-sm text-text-secondary">
                      Sin nómina registrada para este empleado en {{ cert.year }}
                    </td>
                  </tr>
                }
              </tbody>
              @if (cert.monthly_breakdown.length > 0) {
                <tfoot class="bg-[var(--color-surface-secondary)]">
                  <tr>
                    <td class="px-4 py-3 text-sm font-bold text-right">Totales</td>
                    <td class="px-4 py-3 text-sm text-right font-mono font-bold">{{ formatCurrency(cert.total_salaries) }}</td>
                    <td class="px-4 py-3 text-sm text-right font-mono font-bold">{{ formatCurrency(cert.total_health_deduction) }}</td>
                    <td class="px-4 py-3 text-sm text-right font-mono font-bold">{{ formatCurrency(cert.total_pension_deduction) }}</td>
                    <td class="px-4 py-3 text-sm text-right font-mono font-bold">{{ formatCurrency(cert.total_withholding) }}</td>
                  </tr>
                </tfoot>
              }
            </table>
          </div>
        } @else {
          <div class="flex flex-col items-center justify-center py-16 text-text-secondary">
            <app-icon name="printer" [size]="48"></app-icon>
            <p class="mt-4 text-base">{{ emptyStateHint() }}</p>
          </div>
        }
      </div>
    </div>
  `,
})
export class WithholdingCertificateViewerComponent {
  private readonly service = inject(WithholdingTaxService);
  private readonly suppliersService = inject(SuppliersService);
  private readonly customersService = inject(CustomersService);
  private readonly payrollService = inject(PayrollService);
  private readonly printService = inject(WithholdingCertificatePrintService);
  private readonly currencyService = inject(CurrencyFormatService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly kindOptions = CERTIFICATE_KIND_OPTIONS;
  readonly sufferedCounterpartyOptions = SUFFERED_COUNTERPARTY_OPTIONS;

  readonly kind = signal<CertificateKind>('supplier_practiced');
  readonly sufferedCounterpartyType = signal<SufferedCounterpartyType>('customer');

  readonly suppliers = signal<Supplier[]>([]);
  readonly customers = signal<Customer[]>([]);
  readonly employees = signal<Employee[]>([]);

  readonly practicedCertificate = signal<WithholdingCertificateData | null>(null);
  readonly sufferedCertificate = signal<SufferedWithholdingCertificateData | null>(null);
  readonly employeeCertificate = signal<EmployeeIncomeCertificateData | null>(null);
  readonly loading = signal(false);

  readonly selectedSupplierId = signal<number | ''>('');
  readonly selectedCounterpartyId = signal<number | ''>('');
  readonly selectedEmployeeId = signal<number | ''>('');
  readonly selectedYear = signal<number>(new Date().getFullYear());

  readonly supplierOptions = computed<SelectorOption[]>(() =>
    this.suppliers().map((supplier) => ({
      value: supplier.id,
      label: supplier.tax_id
        ? `${supplier.name} (${supplier.tax_id})`
        : supplier.name,
    })),
  );

  readonly customerOptions = computed<SelectorOption[]>(() =>
    this.customers().map((customer) => ({
      value: customer.id,
      label: customer.document_number
        ? `${customer.first_name} ${customer.last_name} (${customer.document_number})`
        : `${customer.first_name} ${customer.last_name}`,
    })),
  );

  readonly employeeOptions = computed<SelectorOption[]>(() =>
    this.employees().map((employee) => ({
      value: employee.id,
      label: `${employee.first_name} ${employee.last_name} (${employee.document_number})`,
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
    this.loadCustomers();
    this.loadEmployees();
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

  private loadCustomers(): void {
    this.customersService
      .getCustomers(1, 100)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => this.customers.set(res.data ?? []),
        error: () => this.customers.set([]),
      });
  }

  private loadEmployees(): void {
    this.payrollService
      .getEmployees({ status: 'active', limit: 100 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => this.employees.set(res?.data ?? []),
        error: () => this.employees.set([]),
      });
  }

  onKindChange(value: CertificateKind): void {
    this.kind.set(value);
    this.clearCertificates();
  }

  onSufferedCounterpartyTypeChange(value: SufferedCounterpartyType): void {
    this.sufferedCounterpartyType.set(value);
    this.selectedCounterpartyId.set('');
    this.sufferedCertificate.set(null);
  }

  onSupplierChange(value: number | ''): void {
    this.selectedSupplierId.set(value === '' ? '' : Number(value));
    this.loadCertificate();
  }

  onCounterpartyChange(value: number | ''): void {
    this.selectedCounterpartyId.set(value === '' ? '' : Number(value));
    this.loadCertificate();
  }

  onEmployeeChange(value: number | ''): void {
    this.selectedEmployeeId.set(value === '' ? '' : Number(value));
    this.loadCertificate();
  }

  onYearChange(value: number): void {
    this.selectedYear.set(Number(value));
    this.loadCertificate();
  }

  private clearCertificates(): void {
    this.practicedCertificate.set(null);
    this.sufferedCertificate.set(null);
    this.employeeCertificate.set(null);
  }

  emptyStateHint(): string {
    switch (this.kind()) {
      case 'suffered':
        return 'Selecciona una contraparte y un año gravable. El certificado se genera con las retenciones sufridas por parte del cliente o proveedor seleccionado.';
      case 'employee':
        return 'Selecciona un empleado y un año gravable. El certificado (Formulario 220) se genera con la nómina consolidada del año.';
      default:
        return 'Selecciona un proveedor y un año gravable. El certificado se genera con las retenciones practicadas al proveedor.';
    }
  }

  private loadCertificate(): void {
    const year = this.selectedYear();

    if (this.kind() === 'supplier_practiced') {
      const supplierId = this.selectedSupplierId();
      if (supplierId === '') {
        this.practicedCertificate.set(null);
        return;
      }
      this.loading.set(true);
      this.service
        .getCertificate(Number(supplierId), year)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (res) => {
            this.practicedCertificate.set(res?.data ?? null);
            this.loading.set(false);
          },
          error: () => {
            this.practicedCertificate.set(null);
            this.loading.set(false);
            this.toast.error('No se pudo generar el certificado');
          },
        });
      return;
    }

    if (this.kind() === 'suffered') {
      const counterpartyId = this.selectedCounterpartyId();
      if (counterpartyId === '') {
        this.sufferedCertificate.set(null);
        return;
      }
      this.loading.set(true);
      this.service
        .getSufferedCertificate(
          this.sufferedCounterpartyType(),
          Number(counterpartyId),
          year,
        )
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (res) => {
            this.sufferedCertificate.set(res?.data ?? null);
            this.loading.set(false);
          },
          error: () => {
            this.sufferedCertificate.set(null);
            this.loading.set(false);
            this.toast.error('No se pudo generar el certificado');
          },
        });
      return;
    }

    // kind === 'employee'
    const employeeId = this.selectedEmployeeId();
    if (employeeId === '') {
      this.employeeCertificate.set(null);
      return;
    }
    this.loading.set(true);
    this.service
      .getEmployeeCertificate(Number(employeeId), year)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.employeeCertificate.set(res?.data ?? null);
          this.loading.set(false);
        },
        error: () => {
          this.employeeCertificate.set(null);
          this.loading.set(false);
          this.toast.error('No se pudo generar el certificado');
        },
      });
  }

  printCertificate(): void {
    switch (this.kind()) {
      case 'suffered': {
        const cert = this.sufferedCertificate();
        if (cert) this.printService.printSufferedCertificate(cert);
        return;
      }
      case 'employee': {
        const cert = this.employeeCertificate();
        if (cert) this.printService.printEmployeeCertificate(cert);
        return;
      }
      default: {
        const cert = this.practicedCertificate();
        if (cert) this.printService.printCertificate(cert);
      }
    }
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
