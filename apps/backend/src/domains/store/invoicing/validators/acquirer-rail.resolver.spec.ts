import { resolveAcquirerRail } from './acquirer-rail.resolver';
import {
  DIAN_FINAL_CONSUMER_DOCUMENT_NUMBER,
  DIAN_FINAL_CONSUMER_NAME,
  DIAN_FINAL_CONSUMER_TYPE_CODE,
} from './customer-fiscal-identity.validator';
import { VendixHttpException } from '@common/errors/vendix-http.exception';
import { ErrorCodes } from '@common/errors/error-codes';

describe('resolveAcquirerRail', () => {
  it('entrada completamente vacía resuelve a consumidor final', () => {
    const result = resolveAcquirerRail({});

    expect(result.rail).toBe('final_consumer');
    expect(result.identity).toEqual({
      document_type: DIAN_FINAL_CONSUMER_TYPE_CODE,
      document_number: DIAN_FINAL_CONSUMER_DOCUMENT_NUMBER,
      name: DIAN_FINAL_CONSUMER_NAME,
    });
  });

  it('solo nombre (razón social), sin número, resuelve a consumidor final', () => {
    const result = resolveAcquirerRail({ legal_name: 'Comercializadora ACME' });

    expect(result.rail).toBe('final_consumer');
    expect(result.identity.document_number).toBe(
      DIAN_FINAL_CONSUMER_DOCUMENT_NUMBER,
    );
  });

  it('solo número, sin nombre, resuelve a consumidor final', () => {
    const result = resolveAcquirerRail({ document_number: '1118860776' });

    expect(result.rail).toBe('final_consumer');
    expect(result.identity.name).toBe(DIAN_FINAL_CONSUMER_NAME);
  });

  it('número y nombre completos resuelven a nominativo mínimo', () => {
    const result = resolveAcquirerRail({
      document_type: 'CC',
      document_number: '1118860776',
      first_name: 'Juan',
      last_name: 'Pérez',
    });

    expect(result.rail).toBe('nominative_minimal');
    expect(result.identity).toEqual({
      document_type: 'CC',
      document_number: '1118860776',
      name: 'Juan Pérez',
    });
  });

  it('el número oficial de consumidor final con nombre real resuelve a consumidor final', () => {
    const result = resolveAcquirerRail({
      document_number: DIAN_FINAL_CONSUMER_DOCUMENT_NUMBER,
      legal_name: 'Cliente Identificado SAS',
    });

    expect(result.rail).toBe('final_consumer');
    expect(result.identity.name).toBe(DIAN_FINAL_CONSUMER_NAME);
    expect(result.identity.document_number).toBe(
      DIAN_FINAL_CONSUMER_DOCUMENT_NUMBER,
    );
  });

  it('un alias (solo nombre de pila, sin apellido) sin número resuelve a consumidor final', () => {
    // `first_name` sin `last_name` no cuenta como nombre nominativo — ver el
    // docblock del resolver: falta la mitad del apellido tanto como faltaría
    // el número.
    const result = resolveAcquirerRail({ first_name: 'Cliente Mostrador' });

    expect(result.rail).toBe('final_consumer');
  });

  it('nombre y número completos, sin tipo declarado, BLOQUEA en vez de inventar CC (incidente Óptica Panorama)', () => {
    // Antes: `document_type: (input.document_type ?? '').trim() || 'CC'` — así
    // se transmitió una Cédula de Ciudadanía para un NIT real. Ahora debe
    // bloquear ANTES de tomar el consecutivo, con el código de error fijado
    // (no basta con `instanceof VendixHttpException`).
    let caught: unknown;
    try {
      resolveAcquirerRail({
        document_number: '800214345',
        legal_name: 'Óptica Panorama SAS',
      });
      fail('esperaba que resolveAcquirerRail lanzara');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(VendixHttpException);
    expect((caught as VendixHttpException).errorCode).toBe(
      ErrorCodes.INVOICING_ACQUIRER_DOCUMENT_TYPE_REQUIRED.code,
    );
  });

  it('nombre y número completos CON tipo declarado (NIT) no bloquea y preserva el tipo tal cual', () => {
    const result = resolveAcquirerRail({
      document_type: 'NIT',
      document_number: '800214345',
      legal_name: 'Óptica Panorama SAS',
    });

    expect(result.rail).toBe('nominative_minimal');
    expect(result.identity.document_type).toBe('NIT');
    expect(result.identity.document_number).toBe('800214345');
  });

  it('nombre literal "Consumidor Final" con número real resuelve a nominativo — el número manda', () => {
    const result = resolveAcquirerRail({
      document_type: 'CC',
      document_number: '1118860776',
      legal_name: 'Consumidor Final',
    });

    expect(result.rail).toBe('nominative_minimal');
    expect(result.identity.document_number).toBe('1118860776');
    expect(result.identity.name).toBe('Consumidor Final');
  });

  // P1-B — corrección del sobre-alcance: 67 fichas prod con número+nombre y
  // document_type NULL, sólo 21 con forma de NIT. Sin señal de riesgo, se
  // infiere 'CC' en vez de bloquear.
  it('persona natural, número SIN forma de NIT, sin legal_name ni tipo declarado ⇒ infiere CC, no bloquea', () => {
    const result = resolveAcquirerRail({
      document_number: '1118860776',
      first_name: 'Juan',
      last_name: 'Pérez',
    });

    expect(result.rail).toBe('nominative_minimal');
    expect(result.identity.document_type).toBe('CC');
    expect(result.identity.document_number).toBe('1118860776');
  });

  it('número CON forma de NIT (8/9 + 8 dígitos), sin legal_name ni tipo declarado ⇒ BLOQUEA igual (señal de riesgo por forma)', () => {
    let caught: unknown;
    try {
      resolveAcquirerRail({
        document_number: '900123456',
        first_name: 'Juan',
        last_name: 'Pérez',
      });
      fail('esperaba que resolveAcquirerRail lanzara');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(VendixHttpException);
    expect((caught as VendixHttpException).errorCode).toBe(
      ErrorCodes.INVOICING_ACQUIRER_DOCUMENT_TYPE_REQUIRED.code,
    );
  });

  it('person_type explícito JURIDICA con número SIN forma de NIT y sin legal_name ⇒ BLOQUEA igual (señal de riesgo por person_type)', () => {
    let caught: unknown;
    try {
      resolveAcquirerRail({
        document_number: '1118860776',
        first_name: 'Empresa',
        last_name: 'X',
        person_type: 'JURIDICA',
      });
      fail('esperaba que resolveAcquirerRail lanzara');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(VendixHttpException);
    expect((caught as VendixHttpException).errorCode).toBe(
      ErrorCodes.INVOICING_ACQUIRER_DOCUMENT_TYPE_REQUIRED.code,
    );
  });
});
