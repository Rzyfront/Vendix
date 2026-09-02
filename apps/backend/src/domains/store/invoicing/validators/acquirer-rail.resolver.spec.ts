import { resolveAcquirerRail } from './acquirer-rail.resolver';
import {
  DIAN_FINAL_CONSUMER_DOCUMENT_NUMBER,
  DIAN_FINAL_CONSUMER_NAME,
  DIAN_FINAL_CONSUMER_TYPE_CODE,
} from './customer-fiscal-identity.validator';

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

  it('nombre y número completos, sin tipo declarado, derivan document_type a CC', () => {
    const result = resolveAcquirerRail({
      document_number: '1118860776',
      legal_name: 'Juan Pérez',
    });

    expect(result.rail).toBe('nominative_minimal');
    expect(result.identity.document_type).toBe('CC');
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
});
