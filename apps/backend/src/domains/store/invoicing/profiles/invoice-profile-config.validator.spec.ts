import { VendixHttpException } from 'src/common/errors';

import { buildDefaultAiuProfileConfig } from './invoice-profile-config.contract';
import { assertValidInvoiceProfileConfig } from './invoice-profile-config.validator';

describe('assertValidInvoiceProfileConfig', () => {
  const valid = () =>
    JSON.parse(
      JSON.stringify(buildDefaultAiuProfileConfig('Vigilancia sede sur')),
    );

  it('una configuración válida no lanza', () => {
    expect(() =>
      assertValidInvoiceProfileConfig(valid(), { operation_type: '09' }),
    ).not.toThrow();
  });

  it('lanza INVOICING_PROFILE_005 con 422 y la lista completa de problemas', () => {
    const config = valid();
    // `components_basis` tiene que ser 'aiu' para que la suma se mida contra
    // 100: bajo la unidad por omisión ('contract') los tres componentes son
    // porcentajes DEL VALOR DEL CONTRATO, y 50+10+10 = 70 % es un reparto
    // perfectamente legal —el 30 % restante es costo—. Sin esta línea el
    // fixture sólo produce UN problema y el test dejaba de comprobar lo que
    // dice comprobar: que la excepción lista TODOS los problemas juntos.
    config.aiu.components_basis = 'aiu';
    config.aiu.components = {
      administracion: '50.00',
      imprevistos: '10.00',
      utilidad: '10.00',
    };
    config.aiu.minimum_base_percent = '4.00';

    let error: any;
    try {
      assertValidInvoiceProfileConfig(config, {
        operation_type: '09',
        profile_id: 42,
      });
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.getStatus()).toBe(422);
    // `details` viaja DENTRO del cuerpo de la respuesta, no como campo de la
    // instancia: se afirma lo que el cliente recibe.
    expect(error.getResponse()).toEqual(
      expect.objectContaining({
        error_code: 'INVOICING_PROFILE_005',
        details: expect.objectContaining({
          profile_id: 42,
          operation_type: '09',
          issue_count: 2,
          issues: expect.arrayContaining([
            expect.objectContaining({
              field: 'aiu.components',
              code: 'AIU_PERCENT_SUM',
            }),
            expect.objectContaining({
              field: 'aiu.minimum_base_percent',
              code: 'AIU_FLOOR_BELOW_LEGAL',
            }),
          ]),
        }),
      }),
    );
  });

  it('el mensaje dice cuántos problemas más hay, para no esconderlos', () => {
    const config = valid();
    config.aiu.components = {
      administracion: '1.00',
      imprevistos: '1.00',
      utilidad: '1.00',
    };
    config.aiu.contract_object = '';
    config.format.display_decimals = 99;

    try {
      assertValidInvoiceProfileConfig(config, { operation_type: '09' });
      fail('debía lanzar');
    } catch (e: any) {
      const body = e.getResponse();
      expect(body.details.issue_count).toBe(3);
      expect(body.message).toContain('2 problemas más');
    }
  });

  it('con un solo problema el mensaje es el del problema, sin sufijo', () => {
    const config = valid();
    config.format.display_decimals = 12;
    try {
      assertValidInvoiceProfileConfig(config, { operation_type: '09' });
      fail('debía lanzar');
    } catch (e: any) {
      const body = e.getResponse();
      expect(body.details.issue_count).toBe(1);
      expect(body.message).not.toContain('más');
    }
  });

  it('omite profile_id cuando el perfil todavía no existe (creación)', () => {
    const config = valid();
    config.aiu.regime = 'et_999';
    try {
      assertValidInvoiceProfileConfig(config, { operation_type: '09' });
      fail('debía lanzar');
    } catch (e: any) {
      expect(e.getResponse().details).not.toHaveProperty('profile_id');
    }
  });
});
