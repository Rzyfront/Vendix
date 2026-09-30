export type ExternalIdentitySourceId =
  | 'rues'
  | 'secop_proveedores'
  | 'secop_contratos'
  | 'rnt';

export type ExternalPersonType = 'NATURAL' | 'JURIDICA';

export interface ExternalIdentity {
  source: ExternalIdentitySourceId;
  document_type: string;
  document_number: string;
  verification_digit: string | null;
  person_type: ExternalPersonType;
  legal_name: string | null;
  first_name: string | null;
  last_name: string | null;
  /** RNT: nombre del ESTABLECIMIENTO (no del titular). null en las demás. */
  trade_name: string | null;
  registration_status: string | null;
  is_active: boolean;
  last_renewed_year: number | null;
  chamber: string | null;
  source_updated_at: string | null;
  /** SECOP contratos: 'Último contrato: YYYY-MM-DD'; RNT: '<categoria> · corte <ano>'. */
  source_detail: string | null;
  dv_mismatch?: boolean;
}

export interface ExternalLookupResult {
  found: boolean;
  unavailable?: boolean;
  identity?: ExternalIdentity;
}

/** Identidad encontrada, `null` = la fuente respondió y no lo tiene, `'unavailable'` = falló. */
export type SourceOutcome = ExternalIdentity | null | 'unavailable';

export interface ExternalIdentitySource {
  readonly id: ExternalIdentitySourceId;
  lookup(doc: string, signal: AbortSignal): Promise<SourceOutcome>;
}
