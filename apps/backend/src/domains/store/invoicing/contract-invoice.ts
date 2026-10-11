import {
  ErrorCodes,
  VendixHttpException,
} from 'src/common/errors';
import {
  buildAiuNote,
  DIAN_AIU_NOTE_MAX_LENGTH,
  DIAN_AIU_NOTE_MIN_LENGTH,
} from './providers/dian-direct/xml/ubl-common.builder';
import { InvoiceCalculatorResult } from './services/invoice-calculator.service';
import { InvoiceProfileConfig } from './profiles/invoice-profile-config.contract';
import { ProfileContractInvoiceLine } from './profiles/profile-contract-economics';

/**
 * Economic agreement sealed by the accepted quotation. The top-level
 * `contracts.snapshot` remains versioned separately for legacy contract data;
 * this schema is the exact fiscal source for a contract-derived invoice.
 */
export interface ContractEconomicSnapshotV1 {
  schema_version: 1;
  invoice_profile: {
    profile_id: number;
    version: number;
    config: InvoiceProfileConfig;
  };
  invoice_lines: ProfileContractInvoiceLine[];
  calculation: InvoiceCalculatorResult;
  direct_cost: string;
  contract_value: string;
  aiu_value: string;
  /** Explicit object agreed in the quote; never inferred from generic notes. */
  contract_object: string;
  /** Optional agreed due date, frozen by quote revision. */
  due_date?: string | null;
}

export interface ContractAiuSnapshot {
  economic?: unknown;
  quotation?: {
    notes?: string | null;
    terms_and_conditions?: string | null;
  };
}

export interface ContractAiuDraftLine {
  description: string;
  quantity: number;
  unit_price: number;
  discount_amount: number;
  aiu_component: 'administracion' | 'imprevistos' | 'utilidad' | 'contrato' | null;
  unit_code?: string;
  account_code?: string;
  taxes: Array<{
    tax_name: string;
    tax_rate: number;
    tax_type?: string;
    is_inclusive?: boolean;
  }>;
}

export interface ContractAiuDraft {
  lines: ContractAiuDraftLine[];
  contract_object: string;
  agreed_notes?: string | null;
  terms_and_conditions?: string | null;
  due_date?: string | null;
  invoice_profile: ContractEconomicSnapshotV1['invoice_profile'];
  economic: ContractEconomicSnapshotV1;
}

function snapshotIncomplete(contract_id: number, reason: string): never {
  throw new VendixHttpException(
    ErrorCodes.INVOICING_CALC_001,
    `No se puede facturar el contrato ${contract_id}: su acuerdo económico congelado está incompleto o no es compatible (${reason}). Completa una nueva revisión desde la cotización y vuelve a aceptarla; no se usará el perfil vigente ni la configuración actual de la tienda.`,
    { contract_id, reason, required_economic_schema: 1 },
  );
}

function finiteNumber(
  input: unknown,
  field: string,
  contract_id: number,
): number {
  if (
    (typeof input !== 'number' && typeof input !== 'string') ||
    (typeof input === 'string' && input.trim().length === 0)
  ) {
    snapshotIncomplete(contract_id, `${field} ausente`);
  }
  const number = Number(input);
  if (!Number.isFinite(number)) snapshotIncomplete(contract_id, field);
  return number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function economicSnapshot(
  snapshot: ContractAiuSnapshot,
  contract_id: number,
): ContractEconomicSnapshotV1 {
  if (!isRecord(snapshot?.economic)) {
    return snapshotIncomplete(contract_id, 'falta snapshot.economic schema 1');
  }
  const economic = snapshot.economic as unknown as ContractEconomicSnapshotV1;
  if (economic.schema_version !== 1) {
    return snapshotIncomplete(contract_id, 'schema económica no soportada');
  }
  const profile = economic.invoice_profile;
  if (
    !profile ||
    !Number.isInteger(profile.profile_id) ||
    profile.profile_id < 1 ||
    !Number.isInteger(profile.version) ||
    profile.version < 1 ||
    !profile.config?.aiu
  ) {
    return snapshotIncomplete(contract_id, 'perfil AIU/version/config no congelado');
  }
  if (!Array.isArray(economic.invoice_lines) || economic.invoice_lines.length === 0) {
    return snapshotIncomplete(contract_id, 'no hay líneas económicas congeladas');
  }
  if (!economic.calculation || !Array.isArray(economic.calculation.lines)) {
    return snapshotIncomplete(contract_id, 'no hay cálculo fiscal congelado');
  }
  if (typeof economic.contract_object !== 'string') {
    return snapshotIncomplete(contract_id, 'falta el objeto contractual explícito');
  }
  const note = buildAiuNote(economic.contract_object.trim());
  if (
    note.length < DIAN_AIU_NOTE_MIN_LENGTH ||
    note.length > DIAN_AIU_NOTE_MAX_LENGTH
  ) {
    throw new VendixHttpException(
      ErrorCodes.INVOICING_AIU_002,
      `El objeto contractual congelado del contrato ${contract_id} no cumple la longitud exigida para la nota AIU. Actualiza la cotización y su revisión antes de facturar.`,
      { contract_id, note_length: note.length },
    );
  }
  return economic;
}

/**
 * D.1 — convert the exact frozen quote lines into invoice DTO values. It does
 * not read quotation notes, current profiles, product pricing or tenant AIU
 * settings. The caller re-runs InvoiceCalculatorService against these lines
 * and compares every result to `economic.calculation` before numbering.
 */
export function buildContractAiuDraft(
  snapshot: ContractAiuSnapshot,
  contract_number: string,
  contract_id: number,
): ContractAiuDraft {
  void contract_number;
  const economic = economicSnapshot(snapshot, contract_id);
  const config = economic.invoice_profile.config;

  const lines = economic.invoice_lines.map((line, index) => {
    if (!line || typeof line.description !== 'string') {
      return snapshotIncomplete(contract_id, `línea ${index + 1} sin descripción`);
    }
    const source = line as ProfileContractInvoiceLine & {
      product_id?: unknown;
      product_variant_id?: unknown;
    };
    if (source.product_id != null || source.product_variant_id != null) {
      return snapshotIncomplete(
        contract_id,
        `línea ${index + 1} depende de un precio de catálogo vivo`,
      );
    }
    const allowedComponent =
      line.aiu_component == null ||
      line.aiu_component === 'administracion' ||
      line.aiu_component === 'imprevistos' ||
      line.aiu_component === 'utilidad' ||
      line.aiu_component === 'contrato';
    if (!allowedComponent) {
      return snapshotIncomplete(contract_id, `componente AIU inválido en línea ${index + 1}`);
    }
    const accountCode =
      line.bucket === 'contrato'
        ? config.accounting?.revenue_account_by_bucket?.costo
        : config.accounting?.revenue_account_by_bucket?.[line.bucket];
    return {
      description: line.description,
      quantity: finiteNumber(line.quantity, `cantidad línea ${index + 1}`, contract_id),
      unit_price: finiteNumber(line.unit_price, `precio línea ${index + 1}`, contract_id),
      discount_amount: finiteNumber(
        line.discount_amount === undefined ? 0 : line.discount_amount,
        `descuento línea ${index + 1}`,
        contract_id,
      ),
      aiu_component: line.aiu_component ?? null,
      unit_code: line.unit_code,
      ...(accountCode ? { account_code: accountCode } : {}),
      taxes: (line.taxes ?? []).map((tax) => ({
        tax_name: tax.tax_name,
        tax_rate: finiteNumber(tax.tax_rate, `tarifa línea ${index + 1}`, contract_id),
        tax_type: tax.tax_type ?? undefined,
        is_inclusive: tax.is_inclusive ?? undefined,
      })),
    };
  });

  return {
    lines,
    contract_object: economic.contract_object,
    agreed_notes: snapshot.quotation?.notes ?? null,
    terms_and_conditions: snapshot.quotation?.terms_and_conditions ?? null,
    due_date: economic.due_date ?? null,
    invoice_profile: economic.invoice_profile,
    economic,
  };
}
