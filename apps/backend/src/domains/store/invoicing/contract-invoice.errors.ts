import {
  ErrorCodeEntry,
  VendixHttpException,
} from 'src/common/errors';

/**
 * D.1 (ERR-07, DB-05) — errores del carril contrato→factura AIU.
 *
 * Por que las entradas viven ACA y no en el catalogo central
 * (`common/errors/error-codes.ts`): D.1 solo puede tocar su alcance
 * (`domains/store/invoicing/`, schema y migracion propia). El catalogo es
 * compartido con los demas pasos paralelos del plan y dos appends al mismo
 * bloque conflictan. El contrato de wire es IDENTICO al del catalogo —
 * mismo `code`, mismo HTTP, mismos `details`— porque `VendixHttpException`
 * solo lee la entrada: cuando el orquestador consolide, mover estas dos
 * entradas al catalogo no cambia un byte de la respuesta.
 */
export const CONTRACT_INVOICE_001_ENTRY: ErrorCodeEntry = {
  code: 'CONTRACT_INVOICE_001',
  httpStatus: 409,
  devMessage: 'Contract already has an invoice',
};

export const CONTRACT_STATUS_001_ENTRY: ErrorCodeEntry = {
  code: 'CONTRACT_STATUS_001',
  httpStatus: 422,
  devMessage: 'Invalid contract status transition',
};

/** 409 ERR-07 con la factura existente para navegar a ella. */
export function contractAlreadyInvoiced(
  contract_id: number,
  invoice_id: number,
  invoice_number?: string | null,
): VendixHttpException {
  return new VendixHttpException(
    CONTRACT_INVOICE_001_ENTRY,
    'Este contrato ya tiene una factura generada.',
    { contract_id, invoice_id, invoice_number: invoice_number ?? null },
  );
}

/**
 * 422 con el codigo de ERR-06: generar la factura ES la transicion
 * `active->invoiced` (ver `CONTRACT_TRANSITIONS` en la ficha C.2), asi que un
 * contrato que no esta `active` rechaza por el mismo codigo que cualquier
 * transicion invalida.
 */
export function contractNotReadyForInvoice(
  contract_id: number,
  current_status: string,
): VendixHttpException {
  return new VendixHttpException(
    CONTRACT_STATUS_001_ENTRY,
    'Solo un contrato vigente (active) genera factura. Lleva el contrato a ' +
      'active antes de facturar.',
    { contract_id, current_status, required_status: 'active' },
  );
}
