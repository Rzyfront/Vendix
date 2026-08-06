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

  getDianAuditLogs(page = 1, limit = 20, config_id?: number): Observable<any> {
    const params: Record<string, string> = { page: String(page), limit: String(limit) };
    if (config_id) params['config_id'] = String(config_id);
    return this.http.get(this.getApiUrl('dian-config/audit-logs'), { params });
  }
}
