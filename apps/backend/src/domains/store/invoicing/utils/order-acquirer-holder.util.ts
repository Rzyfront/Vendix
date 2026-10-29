import { ErrorCodes, VendixHttpException } from 'src/common/errors';
import {
  AcquirerRailInput,
  resolveAcquirerRail,
} from '../validators/acquirer-rail.resolver';

/**
 * Holder (acquirer) of an order's invoice, computed with the SAME rule as
 * `InvoicingService.createFromOrder`. Pure — no I/O — so the emission path and
 * the bulk preview cannot diverge.
 */

export type OrderHolderSource = 'customer' | 'guest_request' | 'none';

export interface OrderHolderSourceRows {
  users?: {
    document_type?: string | null;
    document_number?: string | null;
    legal_name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    verification_digit?: string | null;
  } | null;
  invoice_data_requests?: Array<{
    document_type?: string | null;
    document_number?: string | null;
    first_name?: string | null;
    last_name?: string | null;
  }> | null;
}

/**
 * One COMPLETE source for the acquirer — the `users` row when the order has an
 * identified customer, otherwise the newest guest invoice-data request — and
 * never fields mixed between the two (a mixed identity is the half-identity
 * defect `resolveAcquirerRail` exists to close).
 */
export function buildDeclaredAcquirer(order: OrderHolderSourceRows): {
  source: OrderHolderSource;
  input: AcquirerRailInput;
} {
  const users = order.users;
  if (users) {
    return {
      source: 'customer',
      input: {
        document_type: users.document_type,
        document_number: users.document_number,
        legal_name: users.legal_name,
        first_name: users.first_name,
        last_name: users.last_name,
      },
    };
  }
  const request = order.invoice_data_requests?.[0];
  if (request) {
    return {
      source: 'guest_request',
      input: {
        document_type: request.document_type,
        document_number: request.document_number,
        legal_name: null,
        first_name: request.first_name,
        last_name: request.last_name,
      },
    };
  }
  return { source: 'none', input: {} };
}

export type OrderHolderIssueCode =
  | 'missing_document_number'
  | 'missing_name'
  | 'final_consumer_sentinel'
  | 'document_type_required';

/**
 * Stable `missing_fields` vocabulary (consumed by the frontend to label and
 * focus form fields — do not rename):
 * `document_number`, `document_type`, `first_name`, `last_name`, `legal_name`.
 *
 * Name rule: a nominative holder needs EITHER a razón social (`legal_name`) OR
 * nombres y apellidos (`first_name` AND `last_name`). When neither is complete
 * the three name fields are listed; when only one half of the pair is missing
 * just that half is listed.
 */
export type OrderHolderMissingField =
  | 'document_number'
  | 'document_type'
  | 'first_name'
  | 'last_name'
  | 'legal_name';

/** Issues that can be bypassed by an explicit opt-in to Consumidor final. */
export function isCfOverridable(issue: OrderHolderIssue | null): boolean {
  return issue !== null && issue.code !== 'document_type_required';
}

/**
 * Buyer with no real document on file — Consumidor final customer (sentinel
 * `222222222222`), a guest, or a customer registered only with a reference
 * name: nobody asked for an invoice in their name. A paid order of such a buyer
 * is issued to Consumidor final without asking; a partial or wrong document
 * (number present but no name, missing type) still asks to complete it.
 */
export function isUnidentifiedHolder(issue: OrderHolderIssue | null): boolean {
  return (
    issue?.code === 'missing_document_number' ||
    issue?.code === 'final_consumer_sentinel'
  );
}

/** The order's customer record IS the Consumidor final (sentinel document). */
export function isFinalConsumerCustomer(order: OrderHolderSourceRows): boolean {
  return digits(trim(order.users?.document_number)) === FINAL_CONSUMER_NUMBER;
}

export interface OrderHolderIssue {
  code: OrderHolderIssueCode;
  missing_fields: OrderHolderMissingField[];
  message: string;
}

export interface OrderHolderEvaluation {
  source: OrderHolderSource;
  rail: 'nominative' | 'final_consumer';
  name: string;
  document_type: string;
  document_number: string;
  verification_digit: string | null;
  issue: OrderHolderIssue | null;
}

const FINAL_CONSUMER_NUMBER = '222222222222';

const trim = (value: string | null | undefined): string => (value ?? '').trim();
const digits = (value: string): string => value.replace(/\D/g, '');

/** Display name used inside the Spanish messages. */
function describeHolder(
  source: OrderHolderSource,
  input: AcquirerRailInput,
): string {
  const label =
    trim(input.legal_name) ||
    [trim(input.first_name), trim(input.last_name)].filter(Boolean).join(' ') ||
    'sin nombre';
  return source === 'guest_request'
    ? `Al comprador (datos de facturación del pedido) ${label}`
    : `Al cliente ${label}`;
}

function where(source: OrderHolderSource): string {
  return source === 'guest_request'
    ? 'los datos de facturación del pedido'
    : 'la ficha del cliente';
}

function buildIssue(
  source: OrderHolderSource,
  input: AcquirerRailInput,
): OrderHolderIssue | null {
  const number = trim(input.document_number);
  const first = trim(input.first_name);
  const last = trim(input.last_name);
  const has_name = Boolean(trim(input.legal_name)) || Boolean(first && last);

  const name_fields: OrderHolderMissingField[] = [];
  const name_parts: string[] = [];
  if (!has_name) {
    if (!first && !last) {
      name_fields.push('legal_name', 'first_name', 'last_name');
      name_parts.push('el nombre y el apellido (o la razón social)');
    } else if (!last) {
      name_fields.push('last_name');
      name_parts.push('el apellido');
    } else {
      name_fields.push('first_name');
      name_parts.push('el nombre');
    }
  }

  const subject = describeHolder(source, input);
  // Say which alternative satisfies the name rule.
  const name_hint = name_fields.length
    ? ' (razón social, o nombres y apellidos)'
    : '';
  const tail = `la factura saldría a Consumidor final. Complétalo en ${where(source)}${name_hint}.`;

  if (!number) {
    return {
      code: 'missing_document_number',
      missing_fields: ['document_number', ...name_fields],
      message: `${subject} le falta ${['el número de documento', ...name_parts].join(' y ')}; ${tail}`,
    };
  }
  if (digits(number) === FINAL_CONSUMER_NUMBER) {
    return {
      code: 'final_consumer_sentinel',
      missing_fields: ['document_number', ...name_fields],
      message: `${subject} tiene como documento el de Consumidor final (${FINAL_CONSUMER_NUMBER}); la factura saldría a Consumidor final. Corrígelo en ${where(source)}.`,
    };
  }
  if (!has_name) {
    return {
      code: 'missing_name',
      missing_fields: name_fields,
      message: `${subject} le falta ${name_parts.join(' y ')}; ${tail}`,
    };
  }
  return null;
}

/**
 * What `createFromOrder` will declare as the holder of this order, plus the
 * reason when an order WITH a customer (or guest request) would silently fall
 * to Consumidor final or cannot be emitted at all.
 */
export function evaluateOrderHolder(
  order: OrderHolderSourceRows,
): OrderHolderEvaluation {
  const { source, input } = buildDeclaredAcquirer(order);
  const verification_digit =
    source === 'customer' ? (order.users?.verification_digit ?? null) : null;

  try {
    const resolution = resolveAcquirerRail(input);
    if (resolution.rail === 'final_consumer') {
      return {
        source,
        rail: 'final_consumer',
        name: resolution.identity.name,
        document_type: resolution.identity.document_type,
        document_number: resolution.identity.document_number,
        verification_digit: null,
        issue: source === 'none' ? null : buildIssue(source, input),
      };
    }
    return {
      source,
      rail: 'nominative',
      name: resolution.identity.name,
      document_type: resolution.identity.document_type,
      document_number: resolution.identity.document_number,
      verification_digit,
      issue: null,
    };
  } catch (error) {
    if (
      error instanceof VendixHttpException &&
      error.errorCode === ErrorCodes.INVOICING_ACQUIRER_DOCUMENT_TYPE_REQUIRED.code
    ) {
      const name =
        trim(input.legal_name) ||
        [trim(input.first_name), trim(input.last_name)].filter(Boolean).join(' ');
      return {
        source,
        rail: 'nominative',
        name,
        document_type: '',
        document_number: trim(input.document_number),
        verification_digit,
        issue: {
          code: 'document_type_required',
          missing_fields: ['document_type'],
          message: `${describeHolder(source, input)} le falta el tipo de documento (CC, NIT, CE…); no se puede facturar así. Complétalo en ${where(source)}.`,
        },
      };
    }
    throw error;
  }
}

/** Name shown for the holder source in messages and error details. */
export function describeHolderSource(order: OrderHolderSourceRows): string | null {
  const { source, input } = buildDeclaredAcquirer(order);
  if (source === 'none') return null;
  return (
    trim(input.legal_name) ||
    [trim(input.first_name), trim(input.last_name)].filter(Boolean).join(' ') ||
    null
  );
}

/** Holder data already on file, shaped like the completion form. */
export interface OrderHolderCurrentData {
  document_type: string | null;
  document_number: string | null;
  verification_digit: string | null;
  legal_name: string | null;
  first_name: string | null;
  last_name: string | null;
}

/**
 * What the declared holder (customer row or guest request) already has, so the
 * UI can prefill it and ask only for what is missing. The Consumidor final
 * sentinel is not a real document and is reported as absent.
 */
export function holderCurrentData(
  order: OrderHolderSourceRows,
): OrderHolderCurrentData | null {
  const { source, input } = buildDeclaredAcquirer(order);
  if (source === 'none') return null;
  const value = (v: string | null | undefined): string | null => trim(v) || null;
  const number = value(input.document_number);
  return {
    document_type: value(input.document_type),
    document_number:
      number && digits(number) === FINAL_CONSUMER_NUMBER ? null : number,
    verification_digit:
      source === 'customer' ? value(order.users?.verification_digit) : null,
    legal_name: value(input.legal_name),
    first_name: value(input.first_name),
    last_name: value(input.last_name),
  };
}
