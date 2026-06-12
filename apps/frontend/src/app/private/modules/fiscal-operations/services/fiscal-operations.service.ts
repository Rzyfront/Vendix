import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../environments/environment';
import {
  ApiResponse,
  CreateFiscalRuleSetPayload,
  FiscalApiScope,
  FiscalCloseSession,
  FiscalConfigChecklist,
  FiscalDataEnvelope,
  FiscalEvidence,
  FiscalFlowState,
  FiscalObligation,
  FiscalOperationEvent,
  FiscalOverview,
  FiscalResponsibilitiesCatalog,
  FiscalRuleSet,
  FiscalRuleSetDetail,
  PaginatedApiResponse,
  TaxDeclarationDraft,
  TaxDeclarationLine,
  UpdateFiscalRuleSetPayload,
} from '../interfaces/fiscal-operations.interface';

export interface FiscalListQuery {
  type?: string;
  status?: string;
  period_year?: number;
  period_month?: number;
  store_id?: number;
  accounting_entity_id?: number;
  page?: number;
  limit?: number;
}

export interface AttachFiscalEvidencePayload {
  evidence_type: string;
  storage_key?: string;
  content_hash?: string;
  metadata?: Record<string, unknown>;
  source_type?: string;
  source_id?: number;
  store_id?: number;
}

@Injectable({
  providedIn: 'root',
})
export class FiscalOperationsService {
  private readonly http = inject(HttpClient);

  /**
   * Resuelve el segmento de URL base para un scope. Los scopes de tenant
   * (store, organization) viven bajo `{scope}/fiscal`; el scope platform
   * vive bajo el namespace del super-admin (`/super-admin/fiscal`).
   * Mantener el helper centralizado garantiza que cualquier endpoint
   * nuevo en el service respete la convención sin repetir el branch.
   */
  private scopeToBasePath(scope: FiscalApiScope): string {
    if (scope === 'platform') return 'super-admin/fiscal';
    return `${scope}/fiscal`;
  }

  private getApiUrl(scope: FiscalApiScope, endpoint = ''): string {
    const suffix = endpoint ? `/${endpoint}` : '';
    return `${environment.apiUrl}/${this.scopeToBasePath(scope)}${suffix}`;
  }

  private toParams(query: FiscalListQuery = {}): HttpParams {
    let params = new HttpParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        params = params.set(key, String(value));
      }
    });
    return params;
  }

  getOverview(scope: FiscalApiScope): Observable<ApiResponse<FiscalOverview>> {
    return this.http.get<ApiResponse<FiscalOverview>>(
      this.getApiUrl(scope, 'overview'),
    );
  }

  listObligations(
    scope: FiscalApiScope,
    query: FiscalListQuery = {},
  ): Observable<PaginatedApiResponse<FiscalObligation>> {
    return this.http.get<PaginatedApiResponse<FiscalObligation>>(
      this.getApiUrl(scope, 'obligations'),
      { params: this.toParams(query) },
    );
  }

  generateObligations(
    scope: FiscalApiScope,
    dto: {
      period_year: number;
      period_month?: number;
      period_quarter?: number;
      types?: string[];
      force_refresh?: boolean;
      store_id?: number;
    },
  ): Observable<ApiResponse<FiscalObligation[]>> {
    return this.http.post<ApiResponse<FiscalObligation[]>>(
      this.getApiUrl(scope, 'obligations/generate'),
      dto,
    );
  }

  updateObligationStatus(
    scope: FiscalApiScope,
    id: number,
    status: string,
    dto: {
      evidence_id?: number;
      notes?: string;
      payment_info?: Record<string, unknown>;
    } = {},
  ): Observable<ApiResponse<FiscalObligation>> {
    return this.http.patch<ApiResponse<FiscalObligation>>(
      this.getApiUrl(scope, `obligations/${id}/status`),
      { status, ...dto },
    );
  }

  attachObligationEvidence(
    scope: FiscalApiScope,
    id: number,
    dto: AttachFiscalEvidencePayload,
  ): Observable<ApiResponse<FiscalEvidence>> {
    return this.http.post<ApiResponse<FiscalEvidence>>(
      this.getApiUrl(scope, `obligations/${id}/evidence`),
      dto,
    );
  }

  listDeclarations(
    scope: FiscalApiScope,
    query: FiscalListQuery = {},
  ): Observable<PaginatedApiResponse<TaxDeclarationDraft>> {
    return this.http.get<PaginatedApiResponse<TaxDeclarationDraft>>(
      this.getApiUrl(scope, 'declarations'),
      { params: this.toParams(query) },
    );
  }

  createDeclarationDraft(
    scope: FiscalApiScope,
    dto: {
      declaration_type: string;
      period_year: number;
      period_month?: number;
      period_quarter?: number;
      obligation_id?: number;
      store_id?: number;
    },
  ): Observable<ApiResponse<TaxDeclarationDraft>> {
    return this.http.post<ApiResponse<TaxDeclarationDraft>>(
      this.getApiUrl(scope, 'declarations/draft'),
      dto,
    );
  }

  approveDeclaration(
    scope: FiscalApiScope,
    id: number,
  ): Observable<ApiResponse<TaxDeclarationDraft>> {
    return this.http.patch<ApiResponse<TaxDeclarationDraft>>(
      this.getApiUrl(scope, `declarations/${id}/approve`),
      {},
    );
  }

  markDeclarationSubmitted(
    scope: FiscalApiScope,
    id: number,
    dto: {
      submitted_at: string;
      evidence_id: number;
      external_reference?: string;
      notes?: string;
    },
  ): Observable<ApiResponse<TaxDeclarationDraft>> {
    return this.http.patch<ApiResponse<TaxDeclarationDraft>>(
      this.getApiUrl(scope, `declarations/${id}/mark-submitted`),
      dto,
    );
  }

  attachDeclarationEvidence(
    scope: FiscalApiScope,
    id: number,
    dto: AttachFiscalEvidencePayload,
  ): Observable<ApiResponse<FiscalEvidence>> {
    return this.http.post<ApiResponse<FiscalEvidence>>(
      this.getApiUrl(scope, `declarations/${id}/evidence`),
      dto,
    );
  }

  getDeclarationLines(
    scope: FiscalApiScope,
    id: number,
  ): Observable<ApiResponse<TaxDeclarationLine[]>> {
    return this.http.get<ApiResponse<TaxDeclarationLine[]>>(
      this.getApiUrl(scope, `declarations/${id}/lines`),
    );
  }

  listCloseSessions(
    scope: FiscalApiScope,
    query: FiscalListQuery = {},
  ): Observable<ApiResponse<FiscalCloseSession[]>> {
    return this.http.get<ApiResponse<FiscalCloseSession[]>>(
      this.getApiUrl(scope, 'close-sessions'),
      { params: this.toParams(query) },
    );
  }

  createCloseSession(
    scope: FiscalApiScope,
    dto: {
      period_year: number;
      period_month?: number;
      close_type?: string;
      store_id?: number;
    },
  ): Observable<ApiResponse<FiscalCloseSession>> {
    return this.http.post<ApiResponse<FiscalCloseSession>>(
      this.getApiUrl(scope, 'close-sessions'),
      dto,
    );
  }

  runCloseChecks(
    scope: FiscalApiScope,
    id: number,
  ): Observable<ApiResponse<FiscalCloseSession>> {
    return this.http.patch<ApiResponse<FiscalCloseSession>>(
      this.getApiUrl(scope, `close-sessions/${id}/run-checks`),
      {},
    );
  }

  approveClose(
    scope: FiscalApiScope,
    id: number,
  ): Observable<ApiResponse<FiscalCloseSession>> {
    return this.http.patch<ApiResponse<FiscalCloseSession>>(
      this.getApiUrl(scope, `close-sessions/${id}/approve`),
      {},
    );
  }

  closeSession(
    scope: FiscalApiScope,
    id: number,
  ): Observable<ApiResponse<FiscalCloseSession>> {
    return this.http.patch<ApiResponse<FiscalCloseSession>>(
      this.getApiUrl(scope, `close-sessions/${id}/close`),
      {},
    );
  }

  reopenCloseSession(
    scope: FiscalApiScope,
    id: number,
    reason: string,
  ): Observable<ApiResponse<FiscalCloseSession>> {
    return this.http.patch<ApiResponse<FiscalCloseSession>>(
      this.getApiUrl(scope, `close-sessions/${id}/reopen`),
      { reason },
    );
  }

  attachCloseEvidence(
    scope: FiscalApiScope,
    id: number,
    dto: AttachFiscalEvidencePayload,
  ): Observable<ApiResponse<FiscalEvidence>> {
    return this.http.post<ApiResponse<FiscalEvidence>>(
      this.getApiUrl(scope, `close-sessions/${id}/evidence`),
      dto,
    );
  }

  listEvidence(
    scope: FiscalApiScope,
    query: FiscalListQuery = {},
  ): Observable<ApiResponse<FiscalEvidence[]>> {
    return this.http.get<ApiResponse<FiscalEvidence[]>>(
      this.getApiUrl(scope, 'evidence'),
      { params: this.toParams(query) },
    );
  }

  listHistory(
    scope: FiscalApiScope,
    query: FiscalListQuery = {},
  ): Observable<PaginatedApiResponse<FiscalOperationEvent>> {
    return this.http.get<PaginatedApiResponse<FiscalOperationEvent>>(
      this.getApiUrl(scope, 'history'),
      { params: this.toParams(query) },
    );
  }

  listRules(
    scope: FiscalApiScope,
    query: FiscalListQuery = {},
  ): Observable<ApiResponse<FiscalRuleSet[]>> {
    return this.http.get<ApiResponse<FiscalRuleSet[]>>(
      this.getApiUrl(scope, 'rules'),
      { params: this.toParams(query) },
    );
  }

  // -------------------------------------------------------------------------
  // Centro Fiscal — append-only
  // -------------------------------------------------------------------------

  /** Estado vivo del pipeline fiscal del período (ventas/compras/nómina + convergencia). */
  getFlowState(
    scope: FiscalApiScope,
    params: { year: number; month: number; store_id?: number },
  ): Observable<ApiResponse<FiscalFlowState>> {
    let httpParams = new HttpParams()
      .set('year', String(params.year))
      .set('month', String(params.month));
    if (params.store_id !== undefined && params.store_id !== null) {
      httpParams = httpParams.set('store_id', String(params.store_id));
    }
    return this.http.get<ApiResponse<FiscalFlowState>>(
      this.getApiUrl(scope, 'flow-state'),
      { params: httpParams },
    );
  }

  /** Checklist de configuración fiscal con % de completitud. */
  getConfigChecklist(
    scope: FiscalApiScope,
  ): Observable<ApiResponse<FiscalConfigChecklist>> {
    return this.http.get<ApiResponse<FiscalConfigChecklist>>(
      this.getApiUrl(scope, 'config-checklist'),
    );
  }

  // -------------------------------------------------------------------------
  // Identidad fiscal (tab "Identidad") — append-only
  // -------------------------------------------------------------------------

  /**
   * URL de la sección de settings del scope (a diferencia de `getApiUrl`,
   * que apunta al namespace `/fiscal`). `fiscal_data` vive bajo
   * `{store|organization}/settings/fiscal-data` para tenants, y bajo
   * `/super-admin/fiscal/identity/fiscal-data` para la plataforma
   * (no existe namespace `/super-admin/settings`).
   */
  private getSettingsUrl(scope: FiscalApiScope, endpoint: string): string {
    if (scope === 'platform') {
      return `${environment.apiUrl}/${this.scopeToBasePath(scope)}/identity/${endpoint}`;
    }
    return `${environment.apiUrl}/${scope}/settings/${endpoint}`;
  }

  /**
   * Lee la sección `fiscal_data` (identidad legal/tributaria). El envelope
   * difiere por scope — ver `FiscalDataEnvelope`; el consumidor normaliza.
   */
  getFiscalDataSettings(
    scope: FiscalApiScope,
  ): Observable<FiscalDataEnvelope> {
    return this.http.get<FiscalDataEnvelope>(
      this.getSettingsUrl(scope, 'fiscal-data'),
    );
  }

  /**
   * PATCH-merge sobre `settings.fiscal_data` (datos legales,
   * tax_responsibilities[] y vat_periodicity) sin tocar el resto del JSON
   * de settings. Mismo endpoint que usa el wizard de activación.
   */
  patchFiscalDataSettings(
    scope: FiscalApiScope,
    payload: Record<string, unknown>,
  ): Observable<FiscalDataEnvelope> {
    return this.http.patch<FiscalDataEnvelope>(
      this.getSettingsUrl(scope, 'fiscal-data'),
      payload,
    );
  }

  /**
   * Catálogo estático y versionado de responsabilidades DIAN (casilla 53 del
   * RUT): labels, descripciones en lenguaje llano y efectos para tooltips.
   */
  getResponsibilitiesCatalog(
    scope: FiscalApiScope,
  ): Observable<ApiResponse<FiscalResponsibilitiesCatalog>> {
    return this.http.get<ApiResponse<FiscalResponsibilitiesCatalog>>(
      this.getApiUrl(scope, 'responsibilities/catalog'),
    );
  }

  // -------------------------------------------------------------------------
  // Reglas fiscales — mutaciones (tab "Reglas") — append-only
  //
  // Los endpoints de escritura existen a nivel organización
  // (permiso `organization:fiscal:rules:manage`) y a nivel plataforma
  // (permiso `superadmin:fiscal:rules:manage`). El scope por defecto es
  // `organization` para preservar el call-site existente; los tabs
  // `platform` pasan explícitamente su scope.
  // -------------------------------------------------------------------------

  /**
   * Lista reglas con los query params reales del backend
   * (`FiscalRulesQueryDto`: year, rule_type, store_id). El `listRules`
   * legado usa `FiscalListQuery`, cuyos nombres no coinciden.
   */
  listRulesByYear(
    scope: FiscalApiScope,
    query: { year?: number; rule_type?: string; store_id?: number } = {},
  ): Observable<ApiResponse<FiscalRuleSetDetail[]>> {
    let params = new HttpParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        params = params.set(key, String(value));
      }
    });
    return this.http.get<ApiResponse<FiscalRuleSetDetail[]>>(
      this.getApiUrl(scope, 'rules'),
      { params },
    );
  }

  /** Crea un set de reglas (nace siempre como `draft`). */
  createRule(
    dto: CreateFiscalRuleSetPayload,
    scope: FiscalApiScope = 'organization',
  ): Observable<ApiResponse<FiscalRuleSetDetail>> {
    return this.http.post<ApiResponse<FiscalRuleSetDetail>>(
      this.getApiUrl(scope, 'rules'),
      dto,
    );
  }

  /** Edita un set de reglas. El backend solo permite editar drafts. */
  updateRule(
    id: number,
    dto: UpdateFiscalRuleSetPayload,
    scope: FiscalApiScope = 'organization',
  ): Observable<ApiResponse<FiscalRuleSetDetail>> {
    return this.http.patch<ApiResponse<FiscalRuleSetDetail>>(
      this.getApiUrl(scope, `rules/${id}`),
      dto,
    );
  }

  /**
   * Activa un draft. El backend archiva en la misma transacción la versión
   * activa anterior del mismo scope/año/tipo (a lo sumo una activa).
   */
  activateRule(
    id: number,
    scope: FiscalApiScope = 'organization',
  ): Observable<ApiResponse<FiscalRuleSetDetail>> {
    return this.http.post<ApiResponse<FiscalRuleSetDetail>>(
      this.getApiUrl(scope, `rules/${id}/activate`),
      {},
    );
  }

  /** Archiva un set de reglas (draft o active) con `effective_to = now`. */
  archiveRule(
    id: number,
    scope: FiscalApiScope = 'organization',
  ): Observable<ApiResponse<FiscalRuleSetDetail>> {
    return this.http.post<ApiResponse<FiscalRuleSetDetail>>(
      this.getApiUrl(scope, `rules/${id}/archive`),
      {},
    );
  }
}
