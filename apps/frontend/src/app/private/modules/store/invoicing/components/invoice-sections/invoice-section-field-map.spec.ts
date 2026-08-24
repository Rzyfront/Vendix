import {
  fromInvoicePayload,
  fromProfileConfig,
  toInvoicePayload,
  toProfileConfig,
} from './invoice-section-field-map';

/**
 * Estas pruebas cubren los CUATRO pares de nombres divergentes en las dos
 * direcciones, y una quinta cosa que no es un par sino una trampa: que `notes`
 * (viaja al XML) y `internal_note` (no sale del negocio) nunca se toquen.
 *
 * Si alguien "simplifica" el mapeo unificando esos dos campos, la prueba
 * «nunca publica una nota interna» falla. Es la única forma de que ese error se
 * note antes de que un cliente lea una factura con el motivo interno de su
 * descuento.
 */
describe('invoice-section-field-map', () => {
  describe('toInvoicePayload', () => {
    it('mantiene los nombres del DTO de factura', () => {
      const payload = toInvoicePayload({
        invoice_type: 'sales_invoice',
        payment_form: '2',
        payment_means_code: '42',
        notes: ['Primera nota', 'Segunda nota'],
        aiu_contract_object: 'Aseo de oficinas',
        resolution_id: 39,
      });

      expect(payload).toEqual({
        invoice_type: 'sales_invoice',
        payment_form: '2',
        payment_means_code: '42',
        notes: 'Primera nota\nSegunda nota',
        aiu_contract_object: 'Aseo de oficinas',
        resolution_id: 39,
      });
    });

    it('omite los campos ausentes en vez de mandarlos vacíos', () => {
      const payload = toInvoicePayload({
        invoice_type: '   ',
        payment_form: null,
        notes: ['  ', ''],
        resolution_id: 0,
      });

      expect(Object.keys(payload)).toEqual([]);
    });

    it('nunca publica una nota interna como nota de cabecera', () => {
      const payload = toInvoicePayload({
        internal_note: 'Descuento autorizado por gerencia',
      });

      expect(payload.notes).toBeUndefined();
      expect(JSON.stringify(payload)).not.toContain('gerencia');
    });
  });

  describe('toProfileConfig', () => {
    it('traduce a los nombres del JSON de perfil', () => {
      const config = toProfileConfig({
        invoice_type: 'export_invoice',
        payment_form: '1',
        payment_means_code: '10',
        notes: ['Nota de cabecera'],
        internal_note: 'Contrato interno 4471',
        aiu_contract_object: 'Vigilancia',
        resolution_id: 39,
      });

      expect(config.dian.document_type).toBe('export_invoice');
      expect(config.dian.payment_method_code).toBe('1');
      expect(config.dian.payment_means_code).toBe('10');
      expect(config.dian.header_notes).toEqual(['Nota de cabecera']);
      expect(config.dian.resolution_id).toBe(39);
      expect(config.general.internal_note).toBe('Contrato interno 4471');
      expect(config.aiu).toEqual({ contract_object: 'Vigilancia' });
    });

    it('deja el bloque AIU nulo cuando no hay objeto de contrato', () => {
      const config = toProfileConfig({ invoice_type: 'sales_invoice' });
      expect(config.aiu).toBeNull();
    });

    it('nunca guarda la nota interna donde van las de cabecera', () => {
      const config = toProfileConfig({
        internal_note: 'Motivo interno del recargo',
      });

      expect(config.dian.header_notes).toBeNull();
      expect(JSON.stringify(config.dian)).not.toContain('Motivo interno');
    });
  });

  describe('vuelta y vuelta', () => {
    it('perfil → canónico → perfil no pierde ningún par', () => {
      const original = {
        dian: {
          document_type: 'sales_invoice',
          payment_method_code: '2',
          payment_means_code: '42',
          header_notes: ['Una', 'Dos'],
          resolution_id: 39,
        },
        general: { internal_note: 'Sólo para nosotros' },
        aiu: { contract_object: 'Servicios temporales' },
      };

      expect(toProfileConfig(fromProfileConfig(original))).toEqual(original);
    });

    it('factura → canónico → factura no pierde ningún par', () => {
      const original = {
        invoice_type: 'sales_invoice',
        payment_form: '1',
        payment_means_code: '10',
        notes: 'Una\nDos',
        aiu_contract_object: 'Aseo',
        resolution_id: 39,
      };

      expect(toInvoicePayload(fromInvoicePayload(original))).toEqual(original);
    });

    it('una nota de cabecera con comas no se trocea al volver', () => {
      const canonical = fromInvoicePayload({
        notes: 'Servicio de aseo, vigilancia y jardinería',
      });

      expect(canonical.notes).toEqual([
        'Servicio de aseo, vigilancia y jardinería',
      ]);
    });

    it('la nota interna de un perfil no cruza a la factura', () => {
      const canonical = fromProfileConfig({
        dian: { header_notes: ['Pública'] },
        general: { internal_note: 'Privada' },
        aiu: null,
      });

      expect(toInvoicePayload(canonical).notes).toBe('Pública');
    });
  });
});
