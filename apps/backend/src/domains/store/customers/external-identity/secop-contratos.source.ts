import { Injectable } from '@nestjs/common';
import { computeNitDv } from '@common/utils/nit.util';
import { SocrataClient } from './socrata.client';
import {
  ExternalIdentity,
  ExternalIdentitySource,
  ExternalPersonType,
  SourceOutcome,
} from './external-identity.types';
import {
  clean,
  inferDocTypeByShape,
  normalizeName,
} from './external-identity.util';

/**
 * SECOP Integrado (contratos I+II), dataset `rpmr-utcd`. Una fila por contrato:
 * se toma el más reciente. `tipo_documento_proveedor` viene sucio ("No Definido",
 * capitalización inconsistente), por eso lo indefinido se infiere por forma.
 */
const DATASET = 'rpmr-utcd';
const SELECT =
  'nom_raz_social_contratista,tipo_documento_proveedor,documento_proveedor,fecha_de_firma_del_contrato';

interface SecopContratoRow {
  nom_raz_social_contratista?: string;
  tipo_documento_proveedor?: string;
  documento_proveedor?: string;
  fecha_de_firma_del_contrato?: string;
}

const foldKey = (v: string | undefined): string =>
  (v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

@Injectable()
export class SecopContratosSource implements ExternalIdentitySource {
  readonly id = 'secop_contratos' as const;

  constructor(private readonly socrata: SocrataClient) {}

  async lookup(doc: string, signal: AbortSignal): Promise<SourceOutcome> {
    const rows = await this.socrata.fetchRows(
      DATASET,
      {
        where: `documento_proveedor='${doc}'`,
        select: SELECT,
        order: 'fecha_de_firma_del_contrato DESC',
        limit: 1,
      },
      signal,
    );
    if (rows === null) return 'unavailable';
    if (rows.length === 0) return null;
    return this.toIdentity(rows[0] as SecopContratoRow, doc);
  }

  private resolveType(
    raw: string | undefined,
    doc: string,
  ): { document_type: string; person_type: ExternalPersonType } {
    switch (foldKey(raw)) {
      case 'cedula de ciudadania':
        return { document_type: 'CC', person_type: 'NATURAL' };
      case 'cedula de extranjeria':
        return { document_type: 'CE', person_type: 'NATURAL' };
      case 'nit':
      case 'nit de persona juridica':
        return { document_type: 'NIT', person_type: 'JURIDICA' };
      default:
        return inferDocTypeByShape(doc);
    }
  }

  private toIdentity(row: SecopContratoRow, doc: string): ExternalIdentity {
    const { document_type, person_type } = this.resolveType(
      row.tipo_documento_proveedor,
      doc,
    );
    const signed = clean(row.fecha_de_firma_del_contrato);
    const day = signed ? signed.slice(0, 10) : null;
    return {
      source: 'secop_contratos',
      document_type,
      document_number: doc,
      verification_digit:
        document_type === 'NIT' ? computeNitDv(doc) || null : null,
      person_type,
      legal_name: normalizeName(row.nom_raz_social_contratista),
      first_name: null,
      last_name: null,
      trade_name: null,
      registration_status: null,
      is_active: true,
      last_renewed_year: null,
      chamber: null,
      source_updated_at: signed,
      source_detail: day ? `Último contrato: ${day}` : null,
    };
  }
}
