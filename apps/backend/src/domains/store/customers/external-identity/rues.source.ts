import { Injectable } from '@nestjs/common';
import { computeNitDv } from '@common/utils/nit.util';
import { SocrataClient } from './socrata.client';
import {
  ExternalIdentity,
  ExternalIdentitySource,
  ExternalPersonType,
  SourceOutcome,
} from './external-identity.types';
import { clean, join } from './external-identity.util';

/**
 * RUES (Registro Único Empresarial y Social), dataset `c82u-588k`.
 * - Las filas de NIT sólo traen `numero_identificacion` (+ `digito_verificacion`);
 *   las de cédula traen además `nit`/nombres separados: el `$where` consulta ambas.
 * - Hay filas sin nombres separados: sólo `razon_social`.
 */
const DATASET = 'c82u-588k';
const ROW_LIMIT = 20;

const SELECT = [
  'codigo_clase_identificacion',
  'clase_identificacion',
  'numero_identificacion',
  'nit',
  'digito_verificacion',
  'razon_social',
  'primer_nombre',
  'segundo_nombre',
  'primer_apellido',
  'segundo_apellido',
  'organizacion_juridica',
  'estado_matricula',
  'ultimo_ano_renovado',
  'camara_comercio',
  'fecha_actualizacion',
].join(',');

interface RuesRow {
  codigo_clase_identificacion?: string;
  clase_identificacion?: string;
  numero_identificacion?: string;
  nit?: string;
  digito_verificacion?: string;
  razon_social?: string;
  primer_nombre?: string;
  segundo_nombre?: string;
  primer_apellido?: string;
  segundo_apellido?: string;
  organizacion_juridica?: string;
  estado_matricula?: string;
  ultimo_ano_renovado?: string;
  camara_comercio?: string;
  fecha_actualizacion?: string;
}

/** Código RUES de clase de identificación → tipo de documento Vendix. */
const RUES_DOCUMENT_TYPES: Record<string, string> = {
  '01': 'CC',
  '02': 'NIT',
  '03': 'CE',
  '04': 'TI',
  '05': 'PA',
};

@Injectable()
export class RuesSource implements ExternalIdentitySource {
  readonly id = 'rues' as const;

  constructor(private readonly socrata: SocrataClient) {}

  async lookup(doc: string, signal: AbortSignal): Promise<SourceOutcome> {
    const rows = await this.socrata.fetchRows(
      DATASET,
      {
        where: `nit='${doc}' OR numero_identificacion='${doc}'`,
        select: SELECT,
        limit: ROW_LIMIT,
      },
      signal,
    );
    if (rows === null) return 'unavailable';
    const row = this.pickRow(rows as RuesRow[]);
    return row ? this.toIdentity(row, doc) : null;
  }

  /** ACTIVA primero; entre iguales, la `fecha_actualizacion` más reciente. */
  private pickRow(rows: RuesRow[]): RuesRow | null {
    if (rows.length === 0) return null;
    const rank = (r: RuesRow) => (r.estado_matricula === 'ACTIVA' ? 1 : 0);
    // El formato `YYYY/MM/DD HH:mm:ss.SSS…` ordena bien como texto.
    const updated = (r: RuesRow) => r.fecha_actualizacion ?? '';
    return [...rows].sort(
      (a, b) => rank(b) - rank(a) || updated(b).localeCompare(updated(a)),
    )[0];
  }

  private toIdentity(row: RuesRow, doc: string): ExternalIdentity {
    const isNit =
      row.codigo_clase_identificacion === '02' ||
      (row.clase_identificacion ?? '').toUpperCase() === 'NIT';
    const legalOrg = (row.organizacion_juridica ?? '').toUpperCase();
    const person_type: ExternalPersonType =
      isNit || (legalOrg !== '' && legalOrg !== 'PERSONA NATURAL')
        ? 'JURIDICA'
        : 'NATURAL';

    const document_type = isNit
      ? 'NIT'
      : (RUES_DOCUMENT_TYPES[row.codigo_clase_identificacion ?? ''] ?? 'CC');

    const razon = clean(row.razon_social);
    let first_name: string | null = null;
    let last_name: string | null = null;
    let legal_name: string | null = null;

    if (person_type === 'NATURAL') {
      first_name = join(row.primer_nombre, row.segundo_nombre);
      last_name = join(row.primer_apellido, row.segundo_apellido);
      if (!first_name && !last_name) legal_name = razon;
    } else {
      legal_name = razon;
    }

    let verification_digit: string | null = null;
    let dv_mismatch: boolean | undefined;
    if (isNit) {
      verification_digit = computeNitDv(doc) || null;
      const rueDv = clean(row.digito_verificacion);
      if (rueDv && verification_digit && rueDv !== verification_digit) {
        dv_mismatch = true;
      }
    }

    const year = Number.parseInt(row.ultimo_ano_renovado ?? '', 10);
    const status = clean(row.estado_matricula);

    return {
      source: 'rues',
      document_type,
      document_number: doc,
      verification_digit,
      person_type,
      legal_name,
      first_name,
      last_name,
      trade_name: null,
      registration_status: status,
      is_active: status === 'ACTIVA',
      last_renewed_year: Number.isFinite(year) && year > 0 ? year : null,
      chamber: clean(row.camara_comercio),
      source_updated_at: clean(row.fecha_actualizacion),
      source_detail: null,
      ...(dv_mismatch ? { dv_mismatch } : {}),
    };
  }
}
