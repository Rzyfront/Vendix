import { Injectable } from '@nestjs/common';
import { computeNitDv } from '@common/utils/nit.util';
import { SocrataClient } from './socrata.client';
import {
  ExternalIdentity,
  ExternalIdentitySource,
  SourceOutcome,
} from './external-identity.types';
import { clean, inferDocTypeByShape } from './external-identity.util';

/**
 * Registro Nacional de Turismo, dataset `thwd-ivmp` (corte 2019).
 * `razon_social_establecimiento` es el nombre del ESTABLECIMIENTO, no del
 * titular: se expone como `trade_name` y el nombre del titular queda en null.
 */
const DATASET = 'thwd-ivmp';
const SELECT = 'razon_social_establecimiento,nit,categoria,estado_rnt,ano';

interface RntRow {
  razon_social_establecimiento?: string;
  nit?: string;
  categoria?: string;
  estado_rnt?: string;
  ano?: string;
}

@Injectable()
export class RntSource implements ExternalIdentitySource {
  readonly id = 'rnt' as const;

  constructor(private readonly socrata: SocrataClient) {}

  async lookup(doc: string, signal: AbortSignal): Promise<SourceOutcome> {
    const rows = await this.socrata.fetchRows(
      DATASET,
      { where: `nit='${doc}'`, select: SELECT, limit: 1 },
      signal,
    );
    if (rows === null) return 'unavailable';
    if (rows.length === 0) return null;
    return this.toIdentity(rows[0] as RntRow, doc);
  }

  private toIdentity(row: RntRow, doc: string): ExternalIdentity {
    const { document_type, person_type } = inferDocTypeByShape(doc);
    const status = clean(row.estado_rnt);
    const categoria = clean(row.categoria);
    const ano = clean(row.ano);
    const detail = [categoria, ano ? `corte ${ano}` : null]
      .filter(Boolean)
      .join(' · ');
    const year = Number.parseInt(ano ?? '', 10);
    return {
      source: 'rnt',
      document_type,
      document_number: doc,
      verification_digit:
        document_type === 'NIT' ? computeNitDv(doc) || null : null,
      person_type,
      legal_name: null,
      first_name: null,
      last_name: null,
      trade_name: clean(row.razon_social_establecimiento),
      registration_status: status,
      is_active: status === 'ACTIVO',
      last_renewed_year: Number.isFinite(year) && year > 0 ? year : null,
      chamber: null,
      source_updated_at: null,
      source_detail: detail === '' ? null : detail,
    };
  }
}
