import { describeApiFailure, describeNoteIntegrityDetails } from './invoicing-errors.util';

describe('describeNoteIntegrityDetails', () => {
  it('shows source-line credit balances and ignores unrelated error codes', () => {
    expect(describeNoteIntegrityDetails('INVOICING_NOTE_LIMIT_001', {
      source_invoice_item_id: 82,
      remaining_quantity: '1.5',
      remaining_base: '12500',
      remaining_total: '14875',
    })).toEqual([
      'Cantidad disponible en el origen: 1.5.',
      'Base disponible: 12.500,00.',
      'Total disponible: 14.875,00.',
      'Línea fuente: 82.',
    ]);
    expect(describeNoteIntegrityDetails('INVOICING_STATUS_001', { remaining_total: '100' })).toEqual([]);
  });

  it('uses source diagnostics for ambiguous or missing origins', () => {
    expect(describeNoteIntegrityDetails('INVOICING_NOTE_SOURCE_001', {
      source_description: 'No se pudo resolver la línea de origen de forma inequívoca.',
      source_invoice_item_id: 42,
    })).toEqual([
      'No se pudo resolver la línea de origen de forma inequívoca.',
      'Línea fuente: 42.',
    ]);
  });
});

describe('describeApiFailure — integridad de origen y saldo de notas', () => {
  it('curates SOURCE without leaking integration detail', () => {
    const failure = describeApiFailure({ error: {
      error_code: 'INVOICING_NOTE_SOURCE_001',
      message: 'Invoice note source item is missing, ambiguous, or does not belong to the corrected invoice',
      details: { source_description: 'Línea no vinculada.' },
    } });
    expect(failure.errorCode).toBe('INVOICING_NOTE_SOURCE_001');
    expect(failure.message).toContain('origen de una línea');
    expect(failure.message).not.toContain('Invoice note source item');
  });

  it('curates LIMIT around available source balances, not tax editing', () => {
    const failure = describeApiFailure({ error: {
      error_code: 'INVOICING_NOTE_LIMIT_001',
      message: 'Credit note exceeds the remaining source-item or invoice credit limit',
      details: { remaining_quantity: '1' },
    } });
    expect(failure.errorCode).toBe('INVOICING_NOTE_LIMIT_001');
    expect(failure.message).toContain('saldo disponible');
    expect(failure.message).not.toContain('impuesto');
  });
});

/**
 * Copy curado de `INVOICING_CREDIT_NOTE_001` / `NOTE_TAX_TYPE_UNRESOLVABLE_001`.
 *
 * `parseApiError` deja pasar el `message` de estos dos códigos porque SÍ es
 * español presentable (ver `isPresentableApiMessage`), pero ese `message` no
 * es apto para el operador: el primero concatena `Prisma.Decimal.toString()`
 * crudo (sin separador de miles, decimales inconsistentes) y el segundo está
 * redactado para quien integra la API, no para quien opera la pantalla de
 * notas. `describeApiFailure` debe reconstruir el mensaje desde `details` en
 * vez de mostrar el que trae el backend.
 */
describe('describeApiFailure — copy curado de notas crédito/débito', () => {
  function httpError(body: Record<string, unknown>) {
    return { error: body };
  }

  it('INVOICING_CREDIT_NOTE_001 — formatea las cifras con separador de miles y 2 decimales, no el toString() crudo', () => {
    const failure = describeApiFailure(
      httpError({
        error_code: 'INVOICING_CREDIT_NOTE_001',
        message:
          'La nota crédito de 1220 excede el saldo acreditable de la factura FV-1: ' +
          'de 3900 facturados ya hay 2600 acreditados en 2 nota(s) aceptada(s), así ' +
          'que quedan 1300. Emite la nota por ese saldo o menos.',
        details: {
          related_invoice_id: 9100,
          related_invoice_number: 'FV-1',
          parent_total: '3900',
          already_credited: '2600',
          remaining: '1300',
          attempted: '1220',
          accepted_note_ids: [1, 2],
        },
      }),
    );

    expect(failure.errorCode).toBe('INVOICING_CREDIT_NOTE_001');
    // Ninguna cifra cruda de 4 dígitos sin separador de miles.
    expect(failure.message).not.toContain('3900');
    expect(failure.message).not.toContain('2600');
    expect(failure.message).not.toContain('1300 ');
    expect(failure.message).toContain('1.220,00');
    expect(failure.message).toContain('3.900,00');
    expect(failure.message).toContain('2.600,00');
    expect(failure.message).toContain('1.300,00');
    expect(failure.message).toContain('FV-1');
  });

  it('INVOICING_CREDIT_NOTE_001 — sin cifras mínimas en `details`, cae al mensaje genérico en vez de una frase coja', () => {
    const failure = describeApiFailure(
      httpError({
        error_code: 'INVOICING_CREDIT_NOTE_001',
        message: 'La nota crédito excede el saldo acreditable de la factura.',
        details: {},
      }),
    );

    expect(failure.errorCode).toBe('INVOICING_CREDIT_NOTE_001');
    expect(failure.message).toBe('La nota crédito excede el saldo acreditable de la factura.');
  });

  it('NOTE_TAX_TYPE_UNRESOLVABLE_001 — sustituye el mensaje de integrador por una instrucción de UI, nombrando el impuesto', () => {
    const failure = describeApiFailure(
      httpError({
        error_code: 'NOTE_TAX_TYPE_UNRESOLVABLE_001',
        message:
          'El impuesto «INC» de la nota no declara tipo fiscal y no hay fila de ' +
          'catálogo de la cual deducirlo. Envía `tax_type` (iva/inc/ica/...) o un ' +
          '`tax_rate_id` que exista en esta tienda: una nota que acredita un ' +
          'tributo distinto del que se facturó descuadra la declaración.',
        details: {
          tax_index: 0,
          tax_name: 'INC',
          tax_rate_id: null,
          related_invoice_id: 9100,
          document_type: 'credit_note',
        },
      }),
    );

    expect(failure.errorCode).toBe('NOTE_TAX_TYPE_UNRESOLVABLE_001');
    expect(failure.message).toContain('«INC»');
    // No repite el vocabulario de integrador de API.
    expect(failure.message).not.toContain('Envía `tax_type`');
  });

  it('NOTE_TAX_TYPE_UNRESOLVABLE_001 — sin tax_name en `details`, usa el sujeto genérico sin romper', () => {
    const failure = describeApiFailure(
      httpError({
        error_code: 'NOTE_TAX_TYPE_UNRESOLVABLE_001',
        message: 'El impuesto de la nota no declara tipo fiscal.',
        details: { tax_index: 1 },
      }),
    );

    expect(failure.message).toContain('Uno de los impuestos');
  });

  it('otro código sin copy curado sigue la cascada normal de parseApiError sin tocarse', () => {
    const failure = describeApiFailure(
      httpError({
        error_code: 'INVOICING_FIND_001',
        message: 'No se encontro la factura.',
      }),
    );

    expect(failure.errorCode).toBe('INVOICING_FIND_001');
    expect(failure.message).toBe('No se encontro la factura.');
  });
});

describe('describeApiFailure — bloqueo de notas por aceptación RADIAN', () => {
  const message = 'No puedes crear ni emitir una nota crédito o débito: la factura tiene aceptación expresa o tácita registrada en RADIAN. Revisa sus eventos legales.';

  for (const event_code of ['033', '034']) {
    it(`INVOICING_STATUS_002 con evento ${event_code} muestra el motivo RADIAN curado, nunca el mensaje del backend`, () => {
      const failure = describeApiFailure({
        error: {
          error_code: 'INVOICING_STATUS_002',
          message: 'BACKEND DETAIL MUST NOT BE SHOWN',
          details: { event_code },
        },
      });

      expect(failure.errorCode).toBe('INVOICING_STATUS_002');
      expect(failure.message).toBe(message);
      expect(failure.message).not.toContain('BACKEND DETAIL');
    });
  }

  it('preserva el copy genérico de otros eventos y no aplica a otros códigos', () => {
    const unrelatedEvent = describeApiFailure({
      error: {
        error_code: 'INVOICING_STATUS_002',
        message: 'No puedes modificar la factura en su estado actual.',
        details: { event_code: '030' },
      },
    });
    const unrelatedCode = describeApiFailure({
      error: {
        error_code: 'INVOICING_STATUS_001',
        message: 'Invalid invoice state transition',
        details: { event_code: '033' },
      },
    });

    expect(unrelatedEvent.message).toBe('No puedes modificar la factura en su estado actual.');
    expect(unrelatedCode.errorCode).toBe('INVOICING_STATUS_001');
    expect(unrelatedCode.message).not.toBe(message);
  });
});
