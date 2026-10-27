import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import {
  ButtonComponent,
  CardComponent,
  EmptyStateComponent,
  IconComponent,
  InputComponent,
  ItemListCardConfig,
  ResponsiveDataViewComponent,
  SpinnerComponent,
  StatsComponent,
  StickyHeaderComponent,
  TableColumn,
  ToastService,
} from '../../../../../../../shared/components/index';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import { StoreSettingsFacade } from '../../../../../../../core/store/store-settings/store-settings.facade';
import { formatStoreDate } from '../../../../../../../shared/utils/date.util';
import { VatExemptServiceRow } from '../../interfaces/folio.interface';
import { LodgingReservationsService } from '../../services/lodging-reservations.service';

interface ReportRow extends VatExemptServiceRow {
  date_label: string;
  document_label: string;
  base_label: string;
  total_label: string;
}

/** Local civil date `YYYY-MM-DD` of the browser (the store's desk). */
function civilDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Hospitality Suite — "Servicios exentos" (H3.9). Invoices whose lodging went
 * out with VAT 0 % "Exento – art. 481 lit. d ET", with the holder's passport
 * and entry permit as support for the accountant.
 */
@Component({
  selector: 'app-hospitality-vat-exempt-services-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    StickyHeaderComponent,
    StatsComponent,
    CardComponent,
    InputComponent,
    ButtonComponent,
    IconComponent,
    ResponsiveDataViewComponent,
    EmptyStateComponent,
    SpinnerComponent,
  ],
  template: `
    <div class="w-full overflow-x-hidden">
      <app-sticky-header
        title="Servicios exentos"
        subtitle="Alojamiento a no residentes con IVA 0 % (art. 481 lit. d ET)"
        icon="file-check"
        variant="glass"
      />

      <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats title="Facturas" [value]="rows().length" iconName="receipt" [loading]="loading()" />
        <app-stats title="Base exenta" [value]="exemptTotal()" iconName="percent" [loading]="loading()" />
      </div>

      <div class="p-2 md:p-4">
        <app-card [responsive]="true" [padding]="false" overflow="visible">
          <div class="flex flex-wrap items-end gap-2 px-2 pt-2 md:px-6 md:pt-4">
            <app-input label="Desde" type="date" [formControl]="from" data-testid="exempt-from" />
            <app-input label="Hasta" type="date" [formControl]="to" data-testid="exempt-to" />
            <app-button variant="outline" size="sm" [loading]="loading()" (clicked)="load()" data-testid="exempt-search">
              <app-icon slot="icon" name="search" [size]="14" />
              Consultar
            </app-button>
          </div>

          <div class="px-2 pb-2 pt-3 md:p-4">
            @if (loading() && rows().length === 0) {
              <div class="flex flex-col items-center gap-2 py-8">
                <app-spinner size="md" />
                <p class="text-sm text-text-secondary">Cargando servicios exentos…</p>
              </div>
            } @else if (rows().length === 0) {
              <app-empty-state
                icon="file-check"
                title="Sin servicios exentos en el periodo"
                description="Las facturas de folios con la exención de IVA aplicada aparecen aquí con el pasaporte y el permiso del huésped."
                [showActionButton]="false"
              />
            } @else {
              <app-responsive-data-view
                [data]="rows()"
                [columns]="columns"
                [cardConfig]="cardConfig"
                [striped]="true"
                data-testid="exempt-table"
              />
            }
          </div>
        </app-card>
      </div>
    </div>
  `,
})
export class HospitalityVatExemptServicesPageComponent implements OnInit {
  private readonly reservationsService = inject(LodgingReservationsService);
  private readonly currency = inject(CurrencyFormatService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly from = new FormControl(civilDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1)), {
    nonNullable: true,
  });
  readonly to = new FormControl(civilDate(new Date()), { nonNullable: true });

  private readonly storeSettings = inject(StoreSettingsFacade);

  readonly loading = signal(true);
  private readonly report = signal<VatExemptServiceRow[]>([]);

  readonly rows = computed<ReportRow[]>(() =>
    this.report().map((row) => ({
      ...row,
      date_label: formatStoreDate(row.issue_date, this.storeSettings.timezone()),
      document_label: [row.document_type, row.document_number].filter(Boolean).join(' '),
      base_label: this.currency.format(row.exempt_base, 0),
      total_label: this.currency.format(row.invoice_total, 0),
    })),
  );

  readonly exemptTotal = computed(() =>
    this.currency.format(
      this.report().reduce((sum, row) => sum + row.exempt_base, 0),
      0,
    ),
  );

  readonly columns: TableColumn[] = [
    { key: 'invoice_number', label: 'Factura' },
    { key: 'date_label', label: 'Fecha' },
    { key: 'reservation_number', label: 'Reserva' },
    { key: 'guest_name', label: 'Huésped' },
    { key: 'document_label', label: 'Documento' },
    { key: 'nationality_country_code', label: 'Nacionalidad', align: 'center' },
    { key: 'entry_permit_type', label: 'Permiso', align: 'center' },
    { key: 'base_label', label: 'Base exenta', align: 'right' },
    { key: 'total_label', label: 'Total factura', align: 'right' },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'invoice_number',
    subtitleKey: 'guest_name',
    detailKeys: [
      { key: 'document_label', label: 'Documento' },
      { key: 'entry_permit_type', label: 'Permiso' },
      { key: 'date_label', label: 'Fecha' },
    ],
    footerKey: 'base_label',
    footerLabel: 'Base exenta',
  };

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.reservationsService
      .vatExemptServices(this.from.value, this.to.value)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (report) => {
          this.report.set(report.rows);
          this.loading.set(false);
        },
        error: (message: unknown) => {
          this.loading.set(false);
          this.toastService.error(
            typeof message === 'string' ? message : 'No se pudo cargar el reporte',
          );
        },
      });
  }
}
