import { HttpClient } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../../environments/environment';
import {
  ApiResponse,
  DianEmissionStatus,
  InvoiceResolution,
} from '../../../private/modules/store/invoicing/interfaces/invoice.interface';

/**
 * Qué puede escribir el host que monta el wizard de habilitación.
 *
 * El servicio no las aplica: solo las publica para que la UI decida qué
 * ofrecer. La autorización real vive en el backend.
 */
export interface DianApiCapabilities {
  /** Crear, editar, borrar o marcar como predeterminada una configuración. */
  readonly writeConfig: boolean;
  /** Subir el certificado y su contraseña. */
  readonly uploadCertificate: boolean;
  /** Enviar o descartar el set de pruebas de habilitación. */
  readonly runTestSet: boolean;
  /** Promover la configuración a producción. */
  readonly promoteToProduction: boolean;
}

export const ALL_DIAN_CAPABILITIES: DianApiCapabilities = {
  writeConfig: true,
  uploadCertificate: true,
  runTestSet: true,
  promoteToProduction: true,
};

export interface DianApiContext {
  /** Base sin barra final, relativa a `environment.apiUrl`. Ej: `store/invoicing`. */
  basePath: () => string;
  capabilities: () => DianApiCapabilities;
}

// ── Rangos de numeración: la verdad de la DIAN vs. lo guardado ────────────

/** Fila local con la que se compara un rango que la DIAN reporta. */
export interface DianNumberingRangeLocal {
  id: number;
  prefix: string;
  resolution_number: string;
  range_from: number;
  range_to: number;
  valid_from: string;
  valid_to: string;
  current_number: number;
  is_active: boolean;
  document_type: string;
}

export type DianNumberingRangeStatus = 'in_sync' | 'differs' | 'missing_local';

/**
 * Un rango tal como la DIAN lo tiene registrado, con la fila local enfrentada.
 *
 * Los campos de la DIAN llegan anulables porque `GetNumberingRange` no garantiza
 * ninguno: un elemento ausente en su XML se traduce a `null` y no a un valor
 * inventado, que es lo que haría creer que la resolución dice algo que no dice.
 */
export interface DianNumberingRange {
  resolution_number: string | null;
  prefix: string | null;
  range_from: number | null;
  range_to: number | null;
  valid_from: string | null;
  valid_to: string | null;
  resolution_date: string | null;
  local: DianNumberingRangeLocal | null;
  /** Nombres de campo que difieren. Puede incluir `technical_key`. */
  differences: string[];
  /**
   * Si la ClTec guardada es la que la DIAN tiene ligada a ESTA resolución.
   * `null` cuando no hay fila local con la que comparar.
   *
   * Es un booleano y NUNCA la clave: la ClTec no viaja al navegador. Con ella
   * cualquiera podría recomputar CUFEs de la tienda fuera del backend.
   */
  technical_key_matches: boolean | null;
  /**
   * FORMA de la ClTec que reportó la DIAN: longitud y familia de caracteres,
   * nunca el valor. `null` cuando la DIAN no reportó clave para ese rango.
   *
   * Sirve para decidir quién se equivoca cuando el backend rechaza la clave de
   * la propia DIAN: nuestra suposición de 40 caracteres, o el servicio. Con la
   * longitud sola no se distingue (hex de 64 = SHA-256; base64 de 64 = otro
   * artefacto); con la familia sí.
   */
  technical_key_shape: {
    length: number;
    charset: 'hex' | 'base64' | 'alphanumeric' | 'other';
  } | null;
  status: DianNumberingRangeStatus;
  /**
   * Si este rango es la numeración de HABILITACIÓN (pruebas) que la DIAN reparte
   * idéntica a todo contribuyente: prefijo `SETP`, resolución `18760000001`,
   * rango 990000000-995000000 y la MISMA clave técnica para todos.
   *
   * Importa más de lo que parece: `invoice_resolutions` no tiene columna de
   * entorno, así que nada en la base distingue una resolución de prueba de una
   * real. Si una de habilitación se guarda sin que nadie lo note, la pantalla de
   * crear factura puede ofrecerla y saldría una factura REAL numerada con un
   * rango de pruebas y con la clave técnica que la DIAN le da a todo el mundo.
   * Esta bandera es la única señal que existe para distinguirlas.
   */
  is_habilitation_numbering: boolean;
}

/** Resolución guardada que la DIAN no reporta. Nunca se borra: se señala. */
export interface DianNumberingRangeLocalOnly {
  id: number;
  prefix: string;
  resolution_number: string;
  range_from: number;
  range_to: number;
  valid_from: string;
  valid_to: string;
  is_active: boolean;
}

export interface DianNumberingRangesResponse {
  dian_configuration_id: number;
  nit: string;
  software_id: string;
  environment: 'production' | 'test';
  /** ISO. Marca de cuándo se le preguntó a la DIAN, no de cuándo se pintó. */
  queried_at: string;
  ranges: DianNumberingRange[];
  local_only: DianNumberingRangeLocalOnly[];
  /**
   * Sólo llega cuando no se pudo interpretar NINGÚN rango. Lista los elementos
   * que sí venían en la respuesta: es lo único que hace depurable un cambio de
   * contrato de la DIAN sin acceso al XML crudo.
   */
  unparsed?: { element_names: string[] };
}

/**
 * Un elemento del lote que se pide aplicar.
 *
 * La identidad es `resolution_number` + `prefix`, nunca el id local: el rango
 * puede no existir todavía de este lado, y ese par es lo que la DIAN considera
 * la identidad de la autorización.
 */
export interface DianNumberingRangeApplyItem {
  resolution_number: string;
  prefix: string;
}

/**
 * Resultado de UN elemento del lote.
 *
 * Cada elemento se resuelve por su cuenta: un lote donde unos entran y otros no
 * es un resultado legítimo, no un fallo del lote. Por eso el `ok` y el `error`
 * viven aquí y no en el sobre.
 */
export interface DianNumberingRangeApplyResult {
  /** Se repiten los dos identificadores para poder casar el resultado con su fila. */
  resolution_number: string;
  prefix: string;
  ok: boolean;
  /** `null` cuando no se llegó a escribir nada. */
  resolution_id: number | null;
  created: boolean;
  /** Campos que el backend sí escribió. */
  applied_fields: string[];
  /** Campos que NO escribió (inmutables porque la resolución ya numeró). */
  skipped_fields: string[];
  /** Presente sólo cuando `ok` es `false`. */
  error: { code: string; message: string } | null;
  /** Si lo aplicado era numeración de habilitación (pruebas). Ver `DianNumberingRange`. */
  is_habilitation_numbering: boolean;
}

/**
 * Sobre del lote completo.
 *
 * `applied` y `failed` son un resumen para el encabezado; la verdad de qué pasó
 * está en `results`, elemento a elemento. Resumir el lote como «se aplicó» o
 * «falló» sería mentir en el caso normal, que es el parcial.
 */
export interface DianNumberingRangeApplyReport {
  applied: number;
  failed: number;
  results: DianNumberingRangeApplyResult[];
}

/** Tope que acepta el backend en una sola petición. */
export const DIAN_NUMBERING_RANGE_APPLY_MAX = 50;

/**
 * El default apunta al panel de tienda, que es lo que hace que POS, Ajustes y
 * los effects de facturación —todos inyectando desde el injector RAÍZ— sigan
 * viendo exactamente el mismo comportamiento que antes de extraer el servicio.
 *
 * Un host que necesite otra base (super admin operando sobre otro tenant) la
 * sobrescribe con un provider en su propia rama del injector.
 */
export const DIAN_API_CONTEXT = new InjectionToken<DianApiContext>('DIAN_API_CONTEXT', {
  providedIn: 'root',
  factory: () => ({
    basePath: () => 'store/invoicing',
    capabilities: () => ALL_DIAN_CAPABILITIES,
  }),
});

@Injectable({
  providedIn: 'root',
})
export class DianConfigApiService {
  private readonly http = inject(HttpClient);
  private readonly context = inject(DIAN_API_CONTEXT);

  /**
   * Lectura reactiva: si el host publica las capacidades con un signal, el
   * template que llame a `capabilities()` se resuscribe solo.
   */
  readonly capabilities = (): DianApiCapabilities => this.context.capabilities();

  /**
   * La base se resuelve en cada llamada, nunca en el constructor: el contexto
   * de super admin cambia de tenant por navegación y el servicio es singleton
   * de raíz, así que una base cacheada quedaría apuntando al tenant anterior.
   */
  private getApiUrl(endpoint: string): string {
    const base = `${environment.apiUrl}/${this.context.basePath()}`;
    return endpoint ? `${base}/${endpoint}` : base;
  }

  // ── Resolutions ───────────────────────────────────────────

  getResolutions(): Observable<ApiResponse<InvoiceResolution[]>> {
    return this.http.get<ApiResponse<InvoiceResolution[]>>(
      this.getApiUrl('resolutions'),
    );
  }

  /**
   * Alta de resolución de numeración.
   *
   * Va por `{rail}/resolutions`, igual que la lectura: el rail lo resuelve
   * `DIAN_API_CONTEXT`, así que el MISMO formulario compartido escribe en la
   * tienda del comerciante o en la del tenant abierto en la consola de super
   * admin sin que el componente sepa cuál de las dos es.
   *
   * `payload` va sin tipar contra un DTO propio a propósito: el contrato lo
   * declara `DianResolutionFormValue`
   * (`shared/components/dian/dian-resolution-form/`), que ya usa los nombres de
   * `CreateResolutionDto`. Duplicar aquí una interfaz paralela crearía un tercer
   * sitio donde el contrato puede desincronizarse.
   */
  createResolution(payload: Record<string, unknown>): Observable<any> {
    return this.http.post(this.getApiUrl('resolutions'), payload);
  }

  updateResolution(
    id: number,
    payload: Record<string, unknown>,
  ): Observable<any> {
    return this.http.patch(this.getApiUrl(`resolutions/${id}`), payload);
  }

  // ── Estado fiscal agregado ────────────────────────────────

  /**
   * Estado de las CUATRO habilitaciones DIAN de una vez, tenga configuración o
   * no cada una.
   *
   * Existe porque `dian-config/:id/production-readiness` responde por `configId`
   * y, para preguntarle algo, hay que saber ya que la configuración existe. Eso
   * deja mudos justamente los ejes que nadie ha creado —documento soporte,
   * nómina, documento equivalente—, que se vuelven invisibles en el panel y por
   * eso nadie los crea. Este endpoint declara los cuatro siempre y reporta
   * `not_started` en lugar de ausencia.
   *
   * Responde `{ success, data: FiscalReadinessResponse }`; el tipo del agregado
   * vive en `shared/components/dian/fiscal-readiness.interface.ts`.
   */
  getFiscalReadiness(): Observable<any> {
    return this.http.get(this.getApiUrl('dian-config/fiscal-readiness'));
  }

  // ── DIAN Config ─────────────────────────────────────────

  getDianDashboard(): Observable<any> {
    return this.http.get(this.getApiUrl('dian-config/dashboard'));
  }

  getDianConfigs(): Observable<any> {
    return this.http.get(this.getApiUrl('dian-config'));
  }

  getDianConfigById(id: number): Observable<any> {
    return this.http.get(this.getApiUrl(`dian-config/${id}`));
  }

  createDianConfig(data: any): Observable<any> {
    return this.http.post(this.getApiUrl('dian-config'), data);
  }

  updateDianConfig(id: number, data: any): Observable<any> {
    return this.http.patch(this.getApiUrl(`dian-config/${id}`), data);
  }

  deleteDianConfig(id: number): Observable<any> {
    return this.http.delete(this.getApiUrl(`dian-config/${id}`));
  }

  setDefaultDianConfig(id: number): Observable<any> {
    return this.http.patch(this.getApiUrl(`dian-config/${id}/set-default`), {});
  }

  uploadDianCertificate(config_id: number, file: File, password: string): Observable<any> {
    const form_data = new FormData();
    form_data.append('certificate', file);
    form_data.append('password', password);
    form_data.append('config_id', String(config_id));
    return this.http.post(this.getApiUrl('dian-config/upload-certificate'), form_data);
  }

  testDianConnection(config_id: number): Observable<any> {
    return this.http.post(this.getApiUrl(`dian-config/${config_id}/test-connection`), {});
  }

  /**
   * Encola el set de pruebas. Responde 202 con `job_id`, no con el resultado:
   * construir, firmar y subir los 50 documentos toma ~74 s, y nginx corta el
   * request a los 60 s. El resultado se obtiene sondeando `getDianTestSetJob`.
   */
  runDianTestSet(config_id: number, resolution_id: number): Observable<any> {
    return this.http.post(this.getApiUrl(`dian-config/${config_id}/run-test-set`), { resolution_id });
  }

  getDianTestSetJob(config_id: number, job_id: string): Observable<any> {
    return this.http.get(
      this.getApiUrl(`dian-config/${config_id}/run-test-set/${job_id}`),
    );
  }

  getDianTestResults(config_id: number): Observable<any> {
    return this.http.get(this.getApiUrl(`dian-config/${config_id}/test-results`));
  }

  /**
   * Re-polls DIAN for the verdict of the ALREADY SUBMITTED test set, using the
   * stored ZipKey. Safe to call repeatedly — it never re-sends the documents,
   * so it does not burn resolution numbers.
   */
  checkDianTestSetStatus(config_id: number): Observable<any> {
    return this.http.get(this.getApiUrl(`dian-config/${config_id}/test-set-status`));
  }

  /**
   * Asks DIAN document by document whether the submitted batch reached its
   * records. Answers what the ZipKey cannot: whether the batch is queued or was
   * never classified at all. Read-only, never re-sends.
   */
  getDianTestSetDocuments(config_id: number): Observable<any> {
    return this.http.get(
      this.getApiUrl(`dian-config/${config_id}/test-set-documents`),
    );
  }

  /**
   * Discards a batch DIAN never judged, releasing the re-send guard so a new
   * test set can be submitted.
   */
  abandonDianTestSet(config_id: number): Observable<any> {
    return this.http.post(
      this.getApiUrl(`dian-config/${config_id}/abandon-test-set`),
      {},
    );
  }

  /** Read-only checklist of what is still missing before emitting real invoices. */
  getDianProductionReadiness(config_id: number): Observable<any> {
    return this.http.get(
      this.getApiUrl(`dian-config/${config_id}/production-readiness`),
    );
  }

  /**
   * Whether this store is really issuing electronic invoices right now.
   *
   * The settings UI must not decide this from `fiscal_status.invoicing.state`:
   * that flag only says the fiscal wizard was completed, so a store still in the
   * DIAN test set would be told it is live and would stop offering sale
   * receipts — which is exactly what it must keep emitting until production.
   */
  getDianEmissionStatus(): Observable<ApiResponse<DianEmissionStatus>> {
    return this.http.get<ApiResponse<DianEmissionStatus>>(
      this.getApiUrl('dian-config/emission-status'),
    );
  }

  /** Switches the config to environment=production + enablement_status=enabled. */
  promoteDianToProduction(config_id: number): Observable<any> {
    return this.http.post(
      this.getApiUrl(`dian-config/${config_id}/promote-to-production`),
      {},
    );
  }

  // ── Rangos de numeración ────────────────────────────────

  /**
   * Le pregunta a la DIAN qué numeración tiene registrada para este NIT.
   *
   * Es una LECTURA del web service `GetNumberingRange`: no consume consecutivos
   * ni toca nada guardado. Existe porque la clave técnica que el portal MUISCA
   * muestra como «vigente» no siempre es la que la DIAN tiene ligada a cada
   * resolución, y es esta última la que usa para recomputar el CUFE. Con la
   * clave equivocada cada factura vuelve rechazada por FAD06 y desde la pantalla
   * no había forma de verlo, porque la clave se teclea de un PDF y nadie la
   * puede contrastar.
   */
  getNumberingRanges(
    config_id: number,
  ): Observable<ApiResponse<DianNumberingRangesResponse>> {
    return this.http.get<ApiResponse<DianNumberingRangesResponse>>(
      this.getApiUrl(`dian-config/${config_id}/numbering-ranges`),
    );
  }

  /**
   * Copia a las resoluciones locales lo que la DIAN reporta para cada prefijo.
   *
   * Es un LOTE (de 1 a 50) y no una llamada por fila: un contribuyente con
   * varias resoluciones registradas en el mismo software tiene que poder
   * corregirlas de una vez, y encadenar N peticiones desde el navegador dejaría
   * la mitad escrita si una falla a medio camino.
   *
   * Cada elemento se resuelve por separado, así que la respuesta puede traer
   * unos `ok: true` y otros `ok: false` a la vez. No es un error del lote: es el
   * caso normal, y quien la consuma tiene que pintarlo elemento a elemento.
   *
   * El backend decide qué campos son escribibles: una resolución que ya consumió
   * consecutivos no puede mover su rango sin romper la trazabilidad de lo ya
   * emitido, así que devuelve por separado lo aplicado y lo omitido.
   */
  applyNumberingRanges(
    config_id: number,
    payload: { ranges: DianNumberingRangeApplyItem[] },
  ): Observable<ApiResponse<DianNumberingRangeApplyReport>> {
    return this.http.post<ApiResponse<DianNumberingRangeApplyReport>>(
      this.getApiUrl(`dian-config/${config_id}/numbering-ranges/apply`),
      payload,
    );
  }

  getDianAuditLogs(page = 1, limit = 20, config_id?: number): Observable<any> {
    const params: Record<string, string> = { page: String(page), limit: String(limit) };
    if (config_id) params['config_id'] = String(config_id);
    return this.http.get(this.getApiUrl('dian-config/audit-logs'), { params });
  }
}
