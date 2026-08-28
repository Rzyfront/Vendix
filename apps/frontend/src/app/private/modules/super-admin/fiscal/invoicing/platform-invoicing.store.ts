import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable } from 'rxjs';

import { ToastService } from '../../../../../shared/components';
import {
  CreatePlatformProfilePayload,
  ClonePlatformProfilePayload,
  PlatformInvoiceProfile,
  PlatformInvoiceProfileCatalogEntry,
  PlatformInvoiceProfileDetail,
  PlatformProfilePageMeta,
  PlatformProfilePreviewResult,
  PlatformResolution,
  PreviewPlatformProfilePayload,
  SubscriptionFiscalEnvironment,
  SubscriptionFiscalStatus,
  UpdatePlatformProfilePayload,
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

  // ─── Perfiles ────────────────────────────────────────────────────────────────

  private readonly _profiles = signal<PlatformInvoiceProfile[]>([]);
  private readonly _loadingProfiles = signal(false);
  private readonly _profilesMeta = signal<PlatformProfilePageMeta | null>(null);
  private readonly _profileCatalog = signal<PlatformInvoiceProfileCatalogEntry[]>([]);
  private readonly _selectedProfile = signal<PlatformInvoiceProfileDetail | null>(null);

  readonly profiles = this._profiles.asReadonly();
  readonly loadingProfiles = this._loadingProfiles.asReadonly();
  readonly profilesMeta = this._profilesMeta.asReadonly();
  readonly profileCatalog = this._profileCatalog.asReadonly();
  readonly selectedProfile = this._selectedProfile.asReadonly();

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
   * Estado del lote de habilitación tal como lo lee el backend. Vive en el store
   * y no en la página para que la pestaña se abra ya sabiendo si hay un lote en
   * curso: antes solo se enteraba después de pulsar un botón, y un lote en cola
   * era indistinguible de "no hay nada".
   */
  readonly testSet = computed(() => this._status()?.test_set ?? null);

  /**
   * Requisitos pendientes para poder enviar el set de habilitación. Separa lo que
   * falta por hacer de lo que falta porque la DIAN aún no lo emite.
   */
  readonly habilitationReadiness = computed(
    () => this._status()?.habilitation_readiness ?? null,
  );

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

  // ─── Perfiles ────────────────────────────────────────────────────────────────

  /** Recarga la lista de perfiles. `force` invalida la caché. */
  loadProfiles(force = false): void {
    if (!force && this._profiles().length > 0) return;
    this._loadingProfiles.set(true);
    this.fiscal
      .listProfiles()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ data, meta }) => {
          this._profiles.set(data);
          this._profilesMeta.set(meta);
          this._loadingProfiles.set(false);
        },
        error: () => {
          this.toast.error('No se pudieron cargar los perfiles', 'Error');
          this._loadingProfiles.set(false);
        },
      });
  }

  /** Recarga el catálogo de perfiles activos para el selector del wizard. */
  loadProfileCatalog(): void {
    this.fiscal
      .getProfileCatalog()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (entries) => this._profileCatalog.set(entries),
        // El catálogo es secundarios; no ensucia con toast si falla.
      });
  }

  /** Carga el detalle de un perfil y lo establece como seleccionado. */
  loadProfile(id: number): void {
    this._selectedProfile.set(null);
    this.fiscal
      .getProfile(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (profile) => this._selectedProfile.set(profile),
        error: () => {
          this.toast.error('No se pudo cargar el perfil', 'Error');
        },
      });
  }

  /**
   * Crea un perfil e invalida la lista.
   * El toast de éxito/error lo muestra el llamador (effect/component).
   */
  createProfile(dto: CreatePlatformProfilePayload): Observable<PlatformInvoiceProfileDetail> {
    return this.fiscal.createProfile(dto);
  }

  /**
   * Actualiza un perfil (PATCH) e invalida la lista.
   * El toast de éxito/error lo muestra el llamador.
   */
  updateProfile(id: number, dto: UpdatePlatformProfilePayload): Observable<PlatformInvoiceProfileDetail> {
    return this.fiscal.updateProfile(id, dto);
  }

  /**
   * Ejecuta una mutación de perfil (clone/activate/deactivate/set-default/delete).
   * Tras completarse satisfactoriamente, invalida la lista y, si hay un `selectedProfile`,
   * lo recarga para mantener la coherencia de la vista de detalle.
   */
  private mutateProfile<T extends PlatformInvoiceProfileDetail>(
    mutation: () => Observable<T>,
  ): Observable<T> {
    return new Observable<T>((observer) => {
      mutation()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (result) => {
            // Invalida la caché de la lista para que la siguiente navegación
            // obtenga datos frescos. No recargar aquí para no generar una
            // petición extra: la lista se reusará con `force=true` cuando se
            // navegue de vuelta.
            this._profiles.set([]);
            // Si el detalle en memoria es del perfil mutado, recargar para
            // mantener coherencia con la versión vigente del servidor.
            if (this._selectedProfile()?.id === result.id) {
              this.loadProfile(result.id);
            }
            observer.next(result);
            observer.complete();
          },
          error: (err) => observer.error(err),
        });
    });
  }

  cloneProfile(id: number, dto: ClonePlatformProfilePayload): Observable<PlatformInvoiceProfileDetail> {
    return this.mutateProfile(() => this.fiscal.cloneProfile(id, dto));
  }

  activateProfile(id: number): Observable<PlatformInvoiceProfileDetail> {
    return this.mutateProfile(() => this.fiscal.activateProfile(id));
  }

  deactivateProfile(id: number): Observable<PlatformInvoiceProfileDetail> {
    return this.mutateProfile(() => this.fiscal.deactivateProfile(id));
  }

  setDefaultProfile(id: number): Observable<PlatformInvoiceProfileDetail> {
    return this.mutateProfile(() => this.fiscal.setDefaultProfile(id));
  }

  deleteProfile(id: number): Observable<{ id: number; deleted: boolean }> {
    return new Observable<{ id: number; deleted: boolean }>((observer) => {
      this.fiscal
        .deleteProfile(id)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (result) => {
            // Invalida la caché de la lista tras borrar.
            this._profiles.set([]);
            // Si el perfil eliminado estaba seleccionado, limpia la selección.
            if (this._selectedProfile()?.id === id) {
              this._selectedProfile.set(null);
            }
            observer.next(result);
            observer.complete();
          },
          error: (err) => observer.error(err),
        });
    });
  }

  /** Previsualizar perfil. No modifica estado; retorna el resultado directamente. */
  previewProfile(
    id: number,
    dto: PreviewPlatformProfilePayload,
  ): Observable<PlatformProfilePreviewResult> {
    return this.fiscal.previewProfile(id, dto);
  }

  /** Limpia el perfil seleccionado (al cerrar el editor, por ejemplo). */
  clearSelectedProfile(): void {
    this._selectedProfile.set(null);
  }
}
