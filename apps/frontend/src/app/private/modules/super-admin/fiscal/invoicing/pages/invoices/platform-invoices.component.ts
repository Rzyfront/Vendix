import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import {
  ButtonComponent,
  CardComponent,
  EmptyStateComponent,
  IconComponent,
  InputComponent,
  InputsearchComponent,
  ModalComponent,
  OptionsDropdownComponent,
  PaginationComponent,
  ResponsiveDataViewComponent,
  StatsComponent,
  TableAction,
  TableColumn,
  ToastService,
} from '../../../../../../../shared/components';
import type { ItemListCardConfig } from '../../../../../../../shared/components/responsive-data-view/responsive-data-view.component';
import type {
  DropdownAction,
  FilterConfig,
  FilterValues,
} from '../../../../../../../shared/components/options-dropdown/options-dropdown.interfaces';
import {
  SubscriptionFiscalEnvironment,
  SubscriptionFiscalTransmission,
} from '../../../../subscriptions/interfaces/fiscal-billing.interface';
// El mismo lector de errores del riel tienda: convierte el envelope del
// backend en el copy en español que ya está curado en `ERROR_MESSAGES`.
import { describeApiFailure } from '../../../../../store/invoicing/utils/invoicing-errors.util';
import type { PlatformInvoiceKind } from '../../../../subscriptions/interfaces/platform-invoice-document.interface';
import { FiscalBillingAdminService } from '../../../../subscriptions/services/fiscal-billing-admin.service';
import { PlatformInvoicingStore } from '../../platform-invoicing.store';
import { PlatformInvoiceDetailModalComponent } from '../../components/platform-invoice-detail-modal/platform-invoice-detail-modal.component';
import {
  asNumber,
  environmentLabel,
  optionalNumericIdValidator,
  parseRequiredId,
  skippedReasonLabel,
  transmissionStatusBadgeClasses,
  transmissionStatusLabel,
} from '../../platform-invoicing.constants';

/**
 * Pestaña «Facturas»: emisión manual y registro de transmisiones DIAN de las
 * facturas de suscripción SaaS con total paridad visual y funcional.
 */
@Component({
  selector: 'app-platform-invoices',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    FormsModule,
    CardComponent,
    StatsComponent,
    ButtonComponent,
    EmptyStateComponent,
    IconComponent,
    InputComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    PaginationComponent,
    ResponsiveDataViewComponent,
    ModalComponent,
    PlatformInvoiceDetailModalComponent,
  ],
  templateUrl: './platform-invoices.component.html',
})
export class PlatformInvoicesComponent {
  private readonly fb = inject(FormBuilder);
  private readonly fiscal = inject(FiscalBillingAdminService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  protected readonly store = inject(PlatformInvoicingStore);

  readonly transmissions = signal<SubscriptionFiscalTransmission[]>([]);
  readonly loadingTransmissions = signal(false);
  readonly issuingInvoice = signal(false);
  readonly retryingTransmissionId = signal<number | null>(null);
  readonly search = signal('');
  readonly filterValues = signal<FilterValues>({});
  readonly pagination = signal({ page: 1, limit: 20, total: 0, totalPages: 0 });

  readonly showManualIssueModal = signal(false);
  readonly showDetailModal = signal(false);
  readonly selectedInvoiceId = signal<number | null>(null);
  /**
   * Riel del documento abierto en el modal. NO es cosmético: decide el
   * endpoint de detalle y, con él, en qué espacio de id se interpreta
   * `selectedInvoiceId`. Antes no se enviaba y el modal asumía `platform`
   * sobre filas que siempre son SaaS.
   */
  readonly selectedInvoiceKind = signal<PlatformInvoiceKind>('subscription');
  /** Fila con una descarga o previsualización en vuelo. */
  readonly busyRowId = signal<number | null>(null);

  readonly manualInvoiceIdControl = this.fb.control<string | null>(null, [
    optionalNumericIdValidator,
  ]);

  readonly filterConfigs: FilterConfig[] = [
    {
      key: 'status',
      label: 'Estado DIAN',
      type: 'select',
      options: [
        { value: '', label: 'Todos los estados' },
        { value: 'accepted', label: 'Aceptada' },
        { value: 'rejected', label: 'Rechazada' },
        { value: 'pending', label: 'Pendiente' },
        { value: 'processing', label: 'Procesando' },
        { value: 'cancelled', label: 'Cancelada' },
      ],
    },
    {
      key: 'environment',
      label: 'Ambiente',
      type: 'select',
      options: [
        { value: '', label: 'Todos los ambientes' },
        { value: 'production', label: 'Producción' },
        { value: 'test', label: 'Habilitación / Pruebas' },
      ],
    },
    {
      key: 'source_type',
      label: 'Origen',
      type: 'select',
      options: [
        { value: '', label: 'Todos los orígenes' },
        { value: 'subscription_invoice', label: 'SaaS' },
        { value: 'platform_invoice', label: 'Factura Plataforma' },
        { value: 'platform_support_document', label: 'Documento Soporte Plataforma' },
      ],
    },
  ];

  readonly dropdownActions: DropdownAction[] = [
    {
      label: 'Nueva factura',
      icon: 'plus',
      action: 'new_invoice',
      variant: 'primary',
    },
    {
      label: 'Emisión manual SaaS',
      icon: 'send',
      action: 'manual_issue',
      variant: 'outline',
    },
    {
      label: 'Refrescar',
      icon: 'refresh-cw',
      action: 'refresh',
      variant: 'outline',
    },
  ];

  readonly columns: TableColumn[] = [
    {
      key: 'document_number',
      label: 'Documento',
      sortable: true,
      transform: (val, item: SubscriptionFiscalTransmission) => {
        return item.document_number || `ID ${item.source_id}`;
      },
    },
    {
      key: 'source_type',
      label: 'Origen',
      badge: true,
      badgeConfig: {
        type: 'custom',
        colorMap: {
          subscription_invoice: 'info',
          platform_invoice: 'primary',
          platform_support_document: 'secondary',
        },
      },
      transform: (val: string) => this.sourceTypeLabel(val),
    },
    {
      key: 'source_id',
      label: 'Ref. Factura',
      transform: (val, item: SubscriptionFiscalTransmission) => {
        return item.subscription_invoice?.invoice_number || `Factura #${val}`;
      },
    },
    {
      key: 'transmission_status',
      label: 'Estado DIAN',
      badge: true,
      badgeConfig: {
        type: 'custom',
        colorMap: {
          accepted: 'success',
          rejected: 'error',
          pending: 'warning',
          processing: 'warning',
          cancelled: 'secondary',
        },
      },
      transform: (val) => transmissionStatusLabel(val),
    },
    {
      key: 'environment',
      label: 'Ambiente',
      transform: (val, item: SubscriptionFiscalTransmission) => {
        return environmentLabel(item.dian_configuration?.environment);
      },
    },
    {
      key: 'total',
      label: 'Total',
      align: 'right',
      transform: (val, item: SubscriptionFiscalTransmission) => {
        const total = asNumber(item.subscription_invoice?.total ?? 0);
        return new Intl.NumberFormat('es-CO', {
          style: 'currency',
          currency: item.subscription_invoice?.currency || 'COP',
          minimumFractionDigits: 0,
        }).format(total);
      },
    },
    {
      key: 'created_at',
      label: 'Fecha',
      transform: (val) => (val ? new Date(val).toLocaleDateString('es-CO') : '—'),
    },
  ];

  readonly tableActions: TableAction[] = [
    {
      label: 'Ver detalle',
      icon: 'eye',
      action: (item: SubscriptionFiscalTransmission) => this.onRowClick(item),
    },
    {
      label: 'Descargar PDF',
      icon: 'file-text',
      // Antes la acción se ESCONDÍA cuando `pdf_url` venía vacío, así que una
      // factura aceptada sin PDF cacheado no ofrecía ninguna salida.
      show: (item: SubscriptionFiscalTransmission) =>
        !!item.pdf_url || this.isPlatformRow(item),
      disabled: (item: SubscriptionFiscalTransmission) =>
        this.busyRowId() === item.id,
      action: (item: SubscriptionFiscalTransmission) => this.onOpenPdf(item),
    },
    {
      label: 'Previsualizar documento',
      icon: 'file-search',
      // `POST invoices/:id/preview-pdf` resuelve por `fiscal_transmissions.id`
      // filtrando `source_type IN (platform_invoice, platform_support_document)`
      // (`platform-invoice-pdf.service.ts:370`). Sobre una fila SaaS no sólo
      // falla: cae al fallback legacy `invoices.findFirst({ id })`
      // (`:153`), que puede devolver el PDF de OTRO documento que casualmente
      // tenga ese id. Por eso la acción sólo aparece en el riel plataforma.
      show: (item: SubscriptionFiscalTransmission) => this.isPlatformRow(item),
      disabled: (item: SubscriptionFiscalTransmission) =>
        this.busyRowId() === item.id,
      action: (item: SubscriptionFiscalTransmission) => this.onPreviewPdf(item),
    },
    {
      label: 'Descargar XML',
      icon: 'code',
      // El XML ya viajó en la fila: `listTransmissions` usa `include`, no
      // `select`. No hay —ni puede haber— llamada HTTP acá porque el backend
      // no expone ninguna ruta de XML.
      show: (item: SubscriptionFiscalTransmission) => !!item.xml_document,
      action: (item: SubscriptionFiscalTransmission) => this.onDownloadXml(item),
    },
    {
      label: 'Reintentar',
      icon: 'refresh-cw',
      show: (item: SubscriptionFiscalTransmission) => item.transmission_status !== 'accepted',
      disabled: (item: SubscriptionFiscalTransmission) => this.retryingTransmissionId() === item.id,
      action: (item: SubscriptionFiscalTransmission) => this.onRetry(item),
    },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'document_number',
    subtitleKey: 'source_type',
    // `subtitleTransform` recibe el ÍTEM completo, no el valor de
    // `subtitleKey` (`item-list.component.ts:107`). Comparar el argumento
    // contra los strings del enum nunca acertaba, así que la tarjeta móvil
    // caía al `return val` y pintaba «[object Object]» de subtítulo.
    subtitleTransform: (item: SubscriptionFiscalTransmission) =>
      this.sourceTypeLabel(item.source_type),
    badgeKey: 'transmission_status',
    badgeConfig: {
      type: 'custom',
      colorMap: {
        accepted: 'success',
        rejected: 'error',
        pending: 'warning',
        processing: 'warning',
        cancelled: 'secondary',
      },
    },
    badgeTransform: (val) => transmissionStatusLabel(val),
    footerKey: 'total',
    footerLabel: 'Total',
    footerStyle: 'prominent',
    footerTransform: (val, item: SubscriptionFiscalTransmission) => {
      const total = asNumber(item.subscription_invoice?.total ?? 0);
      return new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: item.subscription_invoice?.currency || 'COP',
        minimumFractionDigits: 0,
      }).format(total);
    },
  };

  constructor() {
    this.store.loadStatus();
    this.loadTransmissions();
  }

  loadTransmissions(): void {
    this.loadingTransmissions.set(true);
    const pagination = this.pagination();
    const filters = this.filterValues();
    const status = (filters['status'] as string) || undefined;
    const environment =
      (filters['environment'] as SubscriptionFiscalEnvironment | '') || undefined;

    this.fiscal
      .listTransmissions({
        page: pagination.page,
        limit: pagination.limit,
        status,
        environment,
        search: this.search(),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.transmissions.set(res.data ?? []);
          this.pagination.update((p) => ({
            ...p,
            total: res.meta.total,
            totalPages: res.meta.totalPages,
          }));
          this.loadingTransmissions.set(false);
        },
        error: () => {
          this.toast.error('No se pudo cargar el registro fiscal', 'Error');
          this.loadingTransmissions.set(false);
        },
      });
  }

  onSearchChange(value: string): void {
    this.search.set(value);
    this.pagination.update((p) => ({ ...p, page: 1 }));
    this.loadTransmissions();
  }

  onFilterChange(values: FilterValues): void {
    this.filterValues.set(values);
    this.pagination.update((p) => ({ ...p, page: 1 }));
    this.loadTransmissions();
  }

  onClearFilters(): void {
    this.filterValues.set({});
    this.pagination.update((p) => ({ ...p, page: 1 }));
    this.loadTransmissions();
  }

  onDropdownActionClick(action: DropdownAction | string): void {
    const actionId = typeof action === 'string' ? action : action.action;
    if (actionId === 'new_invoice') {
      this.router.navigate(['/super-admin/fiscal/invoicing/invoices/new']);
    } else if (actionId === 'manual_issue') {
      this.showManualIssueModal.set(true);
    } else if (actionId === 'refresh') {
      this.loadTransmissions();
      this.store.loadStatus(true);
    }
  }

  /** Etiqueta del riel de origen. Una sola definición para tabla y tarjeta. */
  private sourceTypeLabel(sourceType: string | null | undefined): string {
    if (sourceType === 'subscription_invoice') return 'SaaS';
    if (sourceType === 'platform_invoice') return 'Plataforma';
    if (sourceType === 'platform_support_document') return 'Doc. Soporte';
    return sourceType || '—';
  }

  /** ¿La fila pertenece al riel plataforma (y no al SaaS)? */
  private isPlatformRow(row: SubscriptionFiscalTransmission): boolean {
    return (
      row.source_type === 'platform_invoice' ||
      row.source_type === 'platform_support_document'
    );
  }

  /**
   * Abre el detalle en el riel correcto.
   *
   * LOS DOS RIELES NO COMPARTEN ESPACIO DE ID. Una fila de plataforma se
   * consulta por `fiscal_transmissions.id` (`row.id`); una SaaS por
   * `subscription_invoices.id`, que es `row.source_id`. Pasar siempre
   * `source_id` era lo que abría «el documento equivocado» cuando el listado
   * traía filas de plataforma.
   *
   * Hoy `listTransmissions` filtra duro `source_type:'subscription_invoice'`
   * (`subscription-fiscal.service.ts:1503`), así que en la práctica todas las
   * filas son SaaS; la derivación se hace igual para que el día que ese filtro
   * se abra —el selector de «Origen» de esta misma pantalla ya ofrece los tres
   * valores— la pantalla no empiece a mostrar documentos ajenos.
   */
  onRowClick(row: SubscriptionFiscalTransmission): void {
    const isPlatform = this.isPlatformRow(row);
    this.selectedInvoiceKind.set(isPlatform ? 'platform' : 'subscription');
    this.selectedInvoiceId.set(isPlatform ? row.id : row.source_id);
    this.showDetailModal.set(true);
  }

  /**
   * PDF de la fila.
   *
   * `pdf_url` no significa lo mismo en los dos rieles: en el SaaS es la URL
   * que devolvió el proveedor (`subscription-fiscal.service.ts:5501`), en el
   * de plataforma es una LLAVE de S3 que se firma en el backend
   * (`platform-invoice-pdf.service.ts:169`). Abrir la llave con
   * `window.open` producía un 404 en el navegador; por eso sólo se abre
   * directo lo que ya es una URL absoluta.
   */
  onOpenPdf(row: SubscriptionFiscalTransmission): void {
    const stored = row.pdf_url?.trim();
    if (stored && /^https?:\/\//i.test(stored)) {
      window.open(stored, '_blank', 'noopener');
      return;
    }

    if (!this.isPlatformRow(row)) {
      // `GET invoices/:id/pdf` sólo resuelve transmisiones de plataforma; para
      // una SaaS sin URL del proveedor no hay de dónde sacar el archivo.
      this.toast.warning(
        'Esta transmisión no tiene PDF del proveedor.',
        'PDF no disponible',
      );
      return;
    }

    this.busyRowId.set(row.id);
    this.fiscal
      .getPlatformInvoicePdf(row.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (location) => {
          this.busyRowId.set(null);
          if (!location?.url) {
            this.toast.warning(
              'El documento todavía no tiene PDF generado.',
              'PDF',
            );
            return;
          }
          window.open(location.url, '_blank', 'noopener');
        },
        error: (err: unknown) => {
          this.busyRowId.set(null);
          this.toast.error(describeApiFailure(err).message, 'PDF');
        },
      });
  }

  /**
   * Previsualización del PDF sin quemar consecutivo. Este endpoint SÍ responde
   * binario, así que se pide como blob y se abre con una URL de objeto; leer
   * `success` sobre un `Blob` es siempre `undefined`.
   */
  onPreviewPdf(row: SubscriptionFiscalTransmission): void {
    this.busyRowId.set(row.id);
    this.fiscal
      .previewPlatformInvoicePdf(row.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blob) => {
          this.busyRowId.set(null);
          const url = URL.createObjectURL(
            new Blob([blob], { type: 'application/pdf' }),
          );
          if (!window.open(url, '_blank', 'noopener')) {
            this.toast.warning(
              'El navegador bloqueó la ventana emergente con la previsualización.',
              'Previsualización',
            );
          }
          setTimeout(() => URL.revokeObjectURL(url), 60_000);
        },
        error: (err: unknown) => {
          this.busyRowId.set(null);
          this.toast.error(describeApiFailure(err).message, 'Previsualización');
        },
      });
  }

  /** Guarda el XML que la propia fila ya trae, por la única vía que existe. */
  onDownloadXml(row: SubscriptionFiscalTransmission): void {
    const xml = row.xml_document;
    if (!xml || !xml.trim()) {
      this.toast.warning(
        'Esta transmisión aún no tiene XML firmado.',
        'XML no disponible',
      );
      return;
    }
    this.fiscal.saveXmlDocument(
      xml,
      `${row.document_number || `documento-${row.id}`}.xml`,
    );
  }

  changePage(page: number): void {
    this.pagination.update((p) => ({ ...p, page }));
    this.loadTransmissions();
  }

  onIssueManualInvoice(): void {
    const invoiceId = parseRequiredId(this.manualInvoiceIdControl.value);
    if (!invoiceId || this.issuingInvoice()) {
      this.manualInvoiceIdControl.markAsTouched();
      return;
    }

    this.issuingInvoice.set(true);
    this.fiscal
      .issueInvoice(invoiceId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.issuingInvoice.set(false);
          this.showManualIssueModal.set(false);
          if ('skipped' in result && result.skipped) {
            this.toast.warning(skippedReasonLabel(result.reason), 'No emitida');
          } else {
            this.toast.success('Solicitud de emisión registrada', 'Facturación');
          }
          this.manualInvoiceIdControl.reset(null, { emitEvent: false });
          this.loadTransmissions();
          this.store.loadStatus(true);
        },
        error: (err: { error?: { message?: string } }) => {
          this.issuingInvoice.set(false);
          this.toast.error(
            err?.error?.message ?? 'No se pudo emitir la factura',
            'Error',
          );
        },
      });
  }

  onRetry(row: SubscriptionFiscalTransmission): void {
    if (row.transmission_status === 'accepted' || this.retryingTransmissionId()) {
      return;
    }
    this.retryingTransmissionId.set(row.id);
    this.fiscal
      .retryTransmission(row.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.retryingTransmissionId.set(null);
          this.toast.success('Reintento registrado', 'Facturación');
          this.loadTransmissions();
          this.store.loadStatus(true);
        },
        error: (err: { error?: { message?: string } }) => {
          this.retryingTransmissionId.set(null);
          this.toast.error(
            err?.error?.message ?? 'No se pudo reintentar la transmisión',
            'Error',
          );
        },
      });
  }
}
