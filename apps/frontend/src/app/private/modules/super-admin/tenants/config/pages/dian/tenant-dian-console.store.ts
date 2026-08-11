import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { forkJoin, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

import { extractApiErrorMessage } from '../../../../../../../core/utils/api-error-handler';
import { DianConfigApiService } from '../../../../../../../shared/services/dian';
import {
  DIAN_CONFIGURATION_TYPES,
  DIAN_CONFIGURATION_TYPE_LABELS,
  configurationTypeFor,
  isFiscalDocumentType,
  type DianCertificateState,
  type DianConfigurationType,
  type FiscalReadinessAxis,
  type FiscalReadinessResolution,
  type ProductionReadinessReport,
} from '../../../../../../../shared/components/dian';

/**
 * Una fila de `dian_configurations` tal como la sirve el rail de super admin.
 *
 * Se tipa explícitamente —y no como `any`— porque el proyecto compila con
 * `noPropertyAccessFromIndexSignature`: sobre un índice, `config?.campo` no
 * compila, y castear a `any` esconde exactamente los errores que esta consola
 * existe para mostrar.
 *
 * `certificate_s3_key` NO está: el controlador lo REDACTA y publica
 * `certificate_present` en su lugar. Una clave de objeto no es la clave privada,
 * pero nombra dónde vive, y en una consola cross-tenant el que mira no es el
 * dueño del NIT.
 */
export interface TenantDianConfigRow {
  readonly id: number;
  readonly name: string;
  readonly nit: string;
  readonly nit_dv?: string | null;
  readonly is_default: boolean;
  readonly configuration_type?: string | null;
  readonly operation_mode?: string | null;
  readonly environment: string;
  readonly enablement_status: string;
  readonly software_id?: string | null;
  readonly test_set_id?: string | null;
  readonly certificate_present?: boolean;
  readonly certificate_expiry?: string | null;
  readonly certificate_fingerprint?: string | null;
  readonly certificate_subject?: string | null;
  readonly certificate_issuer?: string | null;
  readonly certificate_serial_number?: string | null;
  readonly certificate_nit?: string | null;
  readonly certificate_source?: string | null;
  readonly certificate_uploaded_at?: string | null;
  readonly certificate_kms_key_id?: string | null;
  readonly certificate_password_encrypted?: string | null;
}

/** Respuesta de `dian-config/emission-status`, en lo que esta consola usa. */
export interface TenantEmissionStatus {
  readonly is_live: boolean;
  readonly configuration_id: number | null;
  readonly environment: string | null;
  readonly enablement_status: string | null;
  readonly reason: string | null;
}

/**
 * Estado DIAN del tenant abierto, compartido por las cinco sub-vistas.
 *
 * ## Por qué el agregado se compone AQUÍ y no llega hecho
 *
 * `GET {rail}/dian-config/fiscal-readiness` existe en el rail del comerciante
 * (`store/invoicing`) pero **no en el de super admin**: `TenantDianConfigController`
 * no lo declara, así que la petición caería en `dian-config/:configId` y
 * `ParseIntPipe` la rechazaría con un 400 sobre el literal. Mientras ese endpoint
 * no exista en el rail de tenants, los cuatro ejes se componen desde el cliente
 * con las tres lecturas que el rail SÍ expone:
 *
 * - `dian-config` — las configuraciones, con su `configuration_type`.
 * - `dian-config/:id/production-readiness` — el checklist por configuración.
 * - `resolutions` — TODAS las resoluciones, de todos los documentos, con
 *   `technical_key_set` y `resolution_number` (el checklist sólo devuelve las de
 *   factura de venta activas, que no bastan para la vista de Numeración).
 *
 * La regla que el agregado del backend impone se respeta igual: **los cuatro
 * ejes se publican SIEMPRE**, tengan configuración o no. Un eje ausente de la
 * lista se lee como «no aplica a este contribuyente», que es exactamente la
 * lectura equivocada que hace invisible al documento soporte y a la nómina.
 *
 * ## Ámbito: la rama de ruta de la sección DIAN
 *
 * Se provee en `TENANT_DIAN_ROUTES`, no en raíz. El router NO destruye el
 * injector de una ruta al salir de ella, así que `reload()` limpia y vuelve a
 * pedir con un token de secuencia que descarta las respuestas rezagadas: sin él,
 * la lectura del tenant anterior podría aterrizar sobre la ficha del siguiente.
 */
@Injectable()
export class TenantDianConsoleStore {
  private readonly api = inject(DianConfigApiService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly _configs = signal<readonly TenantDianConfigRow[]>([]);
  private readonly _resolutions = signal<readonly FiscalReadinessResolution[]>(
    [],
  );
  private readonly _readiness = signal<
    ReadonlyMap<number, ProductionReadinessReport | null>
  >(new Map());
  private readonly _emission = signal<TenantEmissionStatus | null>(null);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _loaded = signal(false);

  /**
   * Eje sobre el que operan Certificado, Numeración y Set de pruebas.
   *
   * Vive en el store y no en cada página para que cambiar de pestaña NO cambie
   * de contribuyente-eje sin avisar: soporte abre Certificado del documento
   * soporte, salta a Numeración y sigue mirando el mismo eje.
   */
  private readonly _selectedAxis =
    signal<DianConfigurationType>('invoicing');

  /** Descarta respuestas de una carga que ya quedó obsoleta. */
  private requestToken = 0;

  readonly configs = this._configs.asReadonly();
  readonly resolutions = this._resolutions.asReadonly();
  readonly emission = this._emission.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly loaded = this._loaded.asReadonly();
  readonly selectedAxisType = this._selectedAxis.asReadonly();

  /**
   * Los CUATRO ejes, siempre. Mismo contrato que publica el agregado del
   * backend, compuesto desde las lecturas que el rail de tenants sí expone.
   */
  readonly axes = computed<readonly FiscalReadinessAxis[]>(() => {
    const configs = this._configs();
    const resolutions = this._resolutions();
    const readiness = this._readiness();

    return DIAN_CONFIGURATION_TYPES.map((type) => {
      const config = this.pickConfig(configs, type);
      return {
        configuration_type: type,
        label: DIAN_CONFIGURATION_TYPE_LABELS[type],
        config_id: config?.id ?? null,
        environment: config?.environment ?? null,
        // `not_started` y no `null`: sin configuración el eje no está mudo,
        // está sin empezar, y son dos cosas distintas para quien lo lee.
        enablement_status: config?.enablement_status ?? 'not_started',
        readiness: config ? (readiness.get(config.id) ?? null) : null,
        resolutions: resolutions.filter(
          (row) => configurationTypeFor(row.document_type) === type,
        ),
      } satisfies FiscalReadinessAxis;
    });
  });

  readonly selectedAxis = computed<FiscalReadinessAxis | null>(
    () =>
      this.axes().find(
        (axis) => axis.configuration_type === this._selectedAxis(),
      ) ?? null,
  );

  readonly selectedConfig = computed<TenantDianConfigRow | null>(() => {
    const configId = this.selectedAxis()?.config_id ?? null;
    if (configId === null) return null;
    return this._configs().find((config) => config.id === configId) ?? null;
  });

  /** Estado del certificado del eje elegido, en el contrato del panel compartido. */
  readonly selectedCertificate = computed<DianCertificateState | null>(() => {
    const config = this.selectedConfig();
    if (!config) return null;
    return {
      nit: config.nit,
      certificate_expiry: config.certificate_expiry ?? null,
      certificate_fingerprint: config.certificate_fingerprint ?? null,
      certificate_subject: config.certificate_subject ?? null,
      certificate_issuer: config.certificate_issuer ?? null,
      certificate_serial_number: config.certificate_serial_number ?? null,
      certificate_nit: config.certificate_nit ?? null,
      certificate_source: config.certificate_source ?? null,
      certificate_uploaded_at: config.certificate_uploaded_at ?? null,
      certificate_kms_key_id: config.certificate_kms_key_id ?? null,
      // El rail redacta `certificate_s3_key` y publica su presencia. Leer sólo
      // la clave haría que esta consola dijera «sin certificado» sobre uno que
      // existe, y la reacción natural a eso es volver a subirlo.
      certificate_s3_key: config.certificate_present ? 'present' : null,
    };
  });

  selectAxis(type: DianConfigurationType): void {
    this._selectedAxis.set(type);
  }

  /**
   * Recarga las tres lecturas y el estado de emisión.
   *
   * Las configuraciones se piden PRIMERO porque el checklist cuelga de sus ids:
   * sin ellas no hay a qué preguntarle por la habilitación. El resto va en
   * paralelo — describen el mismo tenant en el mismo momento.
   */
  reload(): void {
    const token = ++this.requestToken;
    this._loading.set(true);
    this._error.set(null);

    this.api
      .getDianConfigs()
      .pipe(
        map((response: unknown) =>
          this.unwrapArray<TenantDianConfigRow>(response),
        ),
        switchMap((configs) =>
          forkJoin({
            configs: of(configs),
            readiness: this.loadReadiness(configs),
          }),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ configs, readiness }) => {
          if (token !== this.requestToken) return;
          this._configs.set(configs);
          this._readiness.set(readiness);
          this._loading.set(false);
          this._loaded.set(true);
        },
        error: (err: unknown) => {
          if (token !== this.requestToken) return;
          this._configs.set([]);
          this._readiness.set(new Map());
          this._loading.set(false);
          this._loaded.set(true);
          this._error.set(
            extractApiErrorMessage(err) ||
              'No se pudieron leer las configuraciones DIAN de este tenant.',
          );
        },
      });

    this.api
      .getResolutions()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: unknown) => {
          if (token !== this.requestToken) return;
          this._resolutions.set(this.normalizeResolutions(response));
        },
        // Un fallo aquí NO vacía los ejes: el checklist y el certificado siguen
        // siendo legibles sin la lista de resoluciones, y quedarse en blanco
        // haría creer que el tenant no tiene numeración registrada.
        error: () => {
          if (token !== this.requestToken) return;
          this._resolutions.set([]);
        },
      });

    this.api
      .getDianEmissionStatus()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: unknown) => {
          if (token !== this.requestToken) return;
          this._emission.set(
            (this.unwrapObject(response) as TenantEmissionStatus | null) ?? null,
          );
        },
        error: () => {
          if (token !== this.requestToken) return;
          this._emission.set(null);
        },
      });
  }

  // ── Internos ────────────────────────────────────────────────────────

  /**
   * Qué configuración representa a un eje cuando hay varias.
   *
   * La predeterminada manda; si ninguna lo es, la de menor id. Elegir «la
   * última creada» dejaría que un alta de prueba desplazara a la configuración
   * con la que el comerciante factura de verdad.
   */
  private pickConfig(
    configs: readonly TenantDianConfigRow[],
    type: DianConfigurationType,
  ): TenantDianConfigRow | null {
    const matching = configs.filter(
      (config) => this.configurationTypeOf(config) === type,
    );
    if (!matching.length) return null;
    return (
      matching.find((config) => config.is_default) ??
      [...matching].sort((a, b) => a.id - b.id)[0]
    );
  }

  /**
   * `invoicing` es el defecto de la columna en Prisma, así que una fila antigua
   * sin el campo pertenece a facturación. Dejarla fuera la volvería invisible.
   */
  private configurationTypeOf(
    config: TenantDianConfigRow,
  ): DianConfigurationType {
    const raw = config.configuration_type ?? 'invoicing';
    return (
      DIAN_CONFIGURATION_TYPES.find((type) => type === raw) ?? 'invoicing'
    );
  }

  /**
   * Checklist de cada configuración existente.
   *
   * El fallo de UNA no tumba las demás: `catchError` la reporta como `null`, que
   * la tarjeta lee como «sin evaluar» — honesto y distinto de «cumple todo».
   */
  private loadReadiness(configs: readonly TenantDianConfigRow[]) {
    if (!configs.length) {
      return of(new Map<number, ProductionReadinessReport | null>());
    }

    return forkJoin(
      configs.map((config) =>
        this.api.getDianProductionReadiness(config.id).pipe(
          map(
            (response: unknown) =>
              [
                config.id,
                this.unwrapObject(response) as ProductionReadinessReport | null,
              ] as const,
          ),
          catchError(() =>
            of([config.id, null] as readonly [
              number,
              ProductionReadinessReport | null,
            ]),
          ),
        ),
      ),
    ).pipe(map((entries) => new Map(entries)));
  }

  /**
   * Filas de `invoice_resolutions` al contrato compartido.
   *
   * La conversión existe porque el rail devuelve la fila cruda de Prisma y el
   * formulario compartido consume `FiscalReadinessResolution`. Se normaliza AQUÍ
   * y no en cada página para que las tres vistas que las leen —Habilitaciones,
   * Numeración y Set de pruebas— vean exactamente las mismas filas.
   *
   * `technical_key` no viaja nunca: el rail la elimina y reporta
   * `technical_key_set`. Si un rail antiguo la mandara, aquí se descarta igual.
   */
  private normalizeResolutions(
    response: unknown,
  ): readonly FiscalReadinessResolution[] {
    return this.unwrapArray<Record<string, unknown>>(response)
      .map((row) => this.toResolution(row))
      .filter((row): row is FiscalReadinessResolution => row !== null);
  }

  private toResolution(
    row: Record<string, unknown>,
  ): FiscalReadinessResolution | null {
    const id = Number(row['id']);
    if (!Number.isFinite(id)) return null;

    const documentType = row['document_type'];
    // Un tipo desconocido NO se fuerza a `sales_invoice`: colocaría la fila en
    // el eje de facturación y el formulario le exigiría clave técnica.
    if (!isFiscalDocumentType(documentType)) return null;

    return {
      id,
      document_type: documentType,
      prefix: this.asString(row['prefix']),
      range_from: Number(row['range_from'] ?? 0),
      range_to: Number(row['range_to'] ?? 0),
      current_number: Number(row['current_number'] ?? 0),
      valid_from: this.asString(row['valid_from']) ?? '',
      valid_to: this.asString(row['valid_to']) ?? '',
      is_active: row['is_active'] === true,
      technical_key_set: row['technical_key_set'] === true,
      resolution_number: this.asString(row['resolution_number']),
      resolution_date: this.asString(row['resolution_date']),
    };
  }

  private asString(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return value.toISOString();
    return String(value);
  }

  private unwrapObject(response: unknown): Record<string, unknown> | null {
    if (!response || typeof response !== 'object') return null;
    const envelope = response as Record<string, unknown>;
    const data = envelope['data'];
    if (data && typeof data === 'object') return data as Record<string, unknown>;
    return envelope;
  }

  private unwrapArray<T>(response: unknown): T[] {
    if (Array.isArray(response)) return response as T[];
    if (!response || typeof response !== 'object') return [];
    const data = (response as Record<string, unknown>)['data'];
    return Array.isArray(data) ? (data as T[]) : [];
  }
}
