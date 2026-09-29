import { describeApiFailure } from './invoicing-errors.util';

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
