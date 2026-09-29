import { Injectable } from '@nestjs/common';
import { computeNitDv } from '@common/utils/nit.util';
import { SocrataClient } from './socrata.client';
import {
  ExternalIdentity,
  ExternalIdentitySource,
  SourceOutcome,
} from './external-identity.types';
import { clean, normalizeName } from './external-identity.util';

/**
 * SECOP II – Proveedores Registrados, dataset `qmzu-gj57`.
 * El dataset trae teléfono/correo/dirección personales: el `$select` es
 * explícito y NUNCA los pide (Ley 1581).
 */
const DATASET = 'qmzu-gj57';
const SELECT = 'nombre,nit,tipo_empresa,esta_activa,fecha_creacion';
const NATURAL_TYPE = 'PERSONA NATURAL COLOMBIANA';

interface SecopProveedorRow {
  nombre?: string;
  nit?: string;
  tipo_empresa?: string;
  esta_activa?: string;
  fecha_creacion?: string;
}

@Injectable()
export class SecopProveedoresSource implements ExternalIdentitySource {
  readonly id = 'secop_proveedores' as const;

  constructor(private readonly socrata: SocrataClient) {}

  async lookup(doc: string, signal: AbortSignal): Promise<SourceOutcome> {
    const rows = await this.socrata.fetchRows(
      DATASET,
      { where: `nit='${doc}'`, select: SELECT, limit: 5 },
      signal,
    );
    if (rows === null) return 'unavailable';
    if (rows.length === 0) return null;
    const list = rows as SecopProveedorRow[];
    const row = list.find((r) => r.esta_activa === 'Si') ?? list[0];
    return this.toIdentity(row, doc);
  }

  private toIdentity(row: SecopProveedorRow, doc: string): ExternalIdentity {
    const isNatural =
      (row.tipo_empresa ?? '').trim().toUpperCase() === NATURAL_TYPE;
    const active = row.esta_activa === 'Si';
    return {
      source: 'secop_proveedores',
      document_type: isNatural ? 'CC' : 'NIT',
      document_number: doc,
      verification_digit: isNatural ? null : computeNitDv(doc) || null,
      person_type: isNatural ? 'NATURAL' : 'JURIDICA',
      legal_name: normalizeName(row.nombre),
      first_name: null,
      last_name: null,
      trade_name: null,
      registration_status: active ? 'ACTIVO' : 'INACTIVO',
      is_active: active,
      last_renewed_year: null,
      chamber: null,
      source_updated_at: clean(row.fecha_creacion),
      source_detail: null,
    };
  }
}
