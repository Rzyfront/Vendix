import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { ToastService } from '../../../../../shared/components';
import {
  PlatformResolution,
  SubscriptionFiscalEnvironment,
  SubscriptionFiscalStatus,
} from '../../subscriptions/interfaces/fiscal-billing.interface';
import { FiscalBillingAdminService } from '../../subscriptions/services/fiscal-billing-admin.service';

/**
 * Estado compartido por las pestañas de Facturación de plataforma.
 *
 * Se provee **a nivel de ruta** (`invoicing.routes.ts`), no en `root`: vive
 * mientras el usuario esté dentro del módulo y se destruye al salir. Eso da dos
 * cosas que un servicio raíz no daría — datos frescos al reentrar, y ninguna
 * suscripción viva de un módulo que ya no se está mirando.
 *
 * Guarda solo lo que **cruza** pestañas:
 *   - `status`      — Config lo edita; Facturas lee sus `stats`; las tres
 *                     pestañas de acción lo consultan para saber si hay config.
 *   - `resolutions` — Resoluciones las administra; Config y Documento soporte
 *                     las ofrecen en sus selectores.
 *
 * El estado propio de cada pestaña (formularios, banderas de guardado, su
 * paginación) se queda en su componente: meterlo aquí sería acoplar de nuevo lo
 * que estamos separando.
 */
@Injectable()
export class PlatformInvoicingStore {
  private readonly fiscal = inject(FiscalBillingAdminService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly _status = signal<SubscriptionFiscalStatus | null>(null);
  private readonly _resolutions = signal<PlatformResolution[]>([]);
  private readonly _loadingStatus = signal(true);
  private readonly _loadingResolutions = signal(false);

  readonly status = this._status.asReadonly();
  readonly resolutions = this._resolutions.asReadonly();
  readonly loadingStatus = this._loadingStatus.asReadonly();
  readonly loadingResolutions = this._loadingResolutions.asReadonly();

  /** Hay una `dian_configurations` enlazada: sin esto no se puede emitir nada. */
  readonly configured = computed(
    () => !!this._status()?.settings.dian_configuration_id,
  );

  readonly stats = computed(
    () => this._status()?.stats ?? { accepted: 0, errors: 0, pending: 0 },
  );

  readonly settings = computed(() => this._status()?.settings ?? null);
  readonly dianConfig = computed(() => this._status()?.dian_config ?? null);

  /**
   * Resoluciones activas del tipo y ambiente pedidos, en formato de selector.
   * Reemplaza los dos `computed` casi idénticos que tenía el monolito (uno para
   * factura, otro para documento soporte).
   */
  resolutionOptions(
    documentType: 'sales_invoice' | 'support_document',
    environment: SubscriptionFiscalEnvironment,
  ): { value: string; label: string }[] {
    return [
      { value: '', label: 'Sin resolución asignada' },
      ...this._resolutions()
        .filter(
          (r) =>
            r.document_type === documentType &&
            r.is_active &&
            r.environment === environment,
        )
        .map((r) => ({
          value: String(r.id),
          label: `${r.prefix} · rango ${r.range_from}-${r.range_to}`,
        })),
    ];
  }

  /**
   * @param force Recarga aunque ya haya datos. Sin esto, navegar entre pestañas
   *   reusa lo cargado; con esto, una escritura refresca a todos los lectores.
   */
  loadStatus(force = false): void {
    if (!force && this._status()) return;
    this._loadingStatus.set(true);
    this.fiscal
      .getStatus()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (status) => {
          this._status.set(status);
          this._loadingStatus.set(false);
        },
        error: () => {
          this.toast.error(
            'No se pudo cargar la configuración de facturación',
            'Error',
          );
          this._loadingStatus.set(false);
        },
      });
  }

  /** Publica el status devuelto por una escritura, sin releer. */
  setStatus(status: SubscriptionFiscalStatus): void {
    this._status.set(status);
    this._loadingStatus.set(false);
  }

  loadResolutions(force = false): void {
    if (!force && this._resolutions().length > 0) return;
    this._loadingResolutions.set(true);
    this.fiscal
      .listResolutions()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => {
          this._resolutions.set(rows);
          this._loadingResolutions.set(false);
        },
        error: () => {
          this.toast.error(
            'No se pudieron cargar las resoluciones DIAN',
            'Error',
          );
          this._loadingResolutions.set(false);
        },
      });
  }
}
