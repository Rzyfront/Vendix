/**
 * Catálogo rico de campos por sección: el logo no vive en secciones
 * (`definition.logo` lo maneja) y los totales exponen envío/propina/
 * retención para elegir en factura.
 */
import {
  SECTION_FIELD_CATALOG,
  catalogFieldsForSectionType,
} from '../section-field-catalog';

describe('section-field-catalog', () => {
  it('ninguna sección ofrece f_logo como fila (pintaba la URL cruda)', () => {
    for (const [type, fields] of Object.entries(SECTION_FIELD_CATALOG)) {
      expect(fields.map((f) => f.id)).not.toContain('f_logo');
      expect(fields.map((f) => f.key)).not.toContain('store.logo_url');
    }
  });

  it('totals expone envío, propina, retención y valor en letras', () => {
    const ids = catalogFieldsForSectionType('totals_summary').map((f) => f.id);
    for (const id of ['f_sub', 'f_ship', 'f_tip', 'f_reten', 'f_tot', 'f_words']) {
      expect(ids).toContain(id);
    }
  });

  it('header expone dirección desglosada y email (lo pedido para factura)', () => {
    const ids = catalogFieldsForSectionType('header').map((f) => f.id);
    for (const id of ['f_addr', 'f_addr1', 'f_city', 'f_phone', 'f_email', 'f_nit']) {
      expect(ids).toContain(id);
    }
  });

  it('tipo desconocido devuelve lista vacía (no rompe el editor)', () => {
    expect(catalogFieldsForSectionType('no_existe')).toEqual([]);
  });
});
