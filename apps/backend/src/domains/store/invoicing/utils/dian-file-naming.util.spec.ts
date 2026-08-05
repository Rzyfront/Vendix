import {
  buildDianXmlFileName,
  buildDianZipFileName,
  softwareCodeForOperationMode,
  DIAN_SOFTWARE_CODES,
} from './dian-file-naming.util';

/**
 * Estos casos NO son inventados: son los ejemplos textuales del Anexo Técnico de
 * la Factura Electrónica de Venta v1.9 (Resolución 000165 del 01/NOV/2023),
 * numerales 6.5.7 y 6.5.8, páginas 303-304. Todos usan el NIT 800197268 con
 * software propio para el año 2019.
 *
 * Sobre el consecutivo: el anexo describe `dddddddd` como hexadecimal y a la vez
 * rotula su ejemplo `00000011` como «la décima primera factura». Las dos cosas no
 * pueden ser ciertas — 0x11 es 17. Aquí se afirma el LITERAL del anexo, que es lo
 * que la DIAN parsea, alimentándolo con 17.
 */
describe('dian-file-naming.util', () => {
  const NIT = '800197268';
  const YEAR = 2019;
  const OWN = DIAN_SOFTWARE_CODES.own_software;

  describe('ejemplos textuales del Anexo Técnico 1.9', () => {
    it('factura de venta → Fv08001972680001900000011.xml', () => {
      expect(
        buildDianXmlFileName('invoice', {
          nit: NIT,
          consecutive: 0x11,
          software_code: OWN,
          year: YEAR,
        }),
      ).toBe('fv08001972680001900000011.xml');
    });

    it('nota crédito → nc08001972680001900000001.xml', () => {
      expect(
        buildDianXmlFileName('credit_note', {
          nit: NIT,
          consecutive: 1,
          software_code: OWN,
          year: YEAR,
        }),
      ).toBe('nc08001972680001900000001.xml');
    });

    it('nota débito → nd08001972680001900000003.xml', () => {
      expect(
        buildDianXmlFileName('debit_note', {
          nit: NIT,
          consecutive: 3,
          software_code: OWN,
          year: YEAR,
        }),
      ).toBe('nd08001972680001900000003.xml');
    });

    it('application response → ar08001972680001900000008.xml', () => {
      expect(
        buildDianXmlFileName('application_response', {
          nit: NIT,
          consecutive: 8,
          software_code: OWN,
          year: YEAR,
        }),
      ).toBe('ar08001972680001900000008.xml');
    });

    it('attached document → ad08001972680001900000001.xml', () => {
      expect(
        buildDianXmlFileName('attached_document', {
          nit: NIT,
          consecutive: 1,
          software_code: OWN,
          year: YEAR,
        }),
      ).toBe('ad08001972680001900000001.xml');
    });

    it('ZIP contenedor → Z08001972680001900000011.zip', () => {
      expect(
        buildDianZipFileName({
          nit: NIT,
          consecutive: 0x11,
          software_code: OWN,
          year: YEAR,
        }),
      ).toBe('z08001972680001900000011.zip');
    });
  });

  describe('largo constante — «los tamaños de cada variable son constantes»', () => {
    it('el XML mide 25 caracteres más la extensión, sea cual sea el consecutivo', () => {
      for (const consecutive of [1, 42, 990000004, 0xffffffff]) {
        const name = buildDianXmlFileName('invoice', {
          nit: '902056589',
          consecutive,
          year: 2026,
        });
        expect(name).toMatch(/^fv[0-9a-f]{23}\.xml$/);
        expect(name).toHaveLength(29); // 25 + '.xml'
      }
    });

    it('el ZIP mide 24 caracteres más la extensión', () => {
      const name = buildDianZipFileName({
        nit: '902056589',
        consecutive: 990000004,
        year: 2026,
      });
      expect(name).toMatch(/^z[0-9a-f]{23}\.zip$/);
      expect(name).toHaveLength(28); // 24 + '.zip'
    });

    it('reproduce el nombre roto que la DIAN aceptaba y descartaba, y ya no lo produce', () => {
      // Lo que se envió el 2026-08-05 y quedó «en proceso de validación» para
      // siempre: 20 caracteres, sin `ppp` ni `aa`.
      const broken = 'fv09020565893b023384.xml';
      const fixed = buildDianXmlFileName('invoice', {
        nit: '902056589',
        consecutive: 990000004,
        year: '2026-08-05',
      });
      expect(fixed).not.toBe(broken);
      expect(fixed).toBe('fv0902056589000263b023384.xml');
      expect(broken).toHaveLength(24);
      expect(fixed).toHaveLength(29);
    });
  });

  describe('normalización de campos', () => {
    it('rellena el NIT a 10 dígitos y descarta el DV pegado', () => {
      const withDv = buildDianXmlFileName('invoice', {
        nit: '902056589-9',
        consecutive: 1,
        year: 2026,
      });
      // '9020565899' son ya 10 dígitos: el DV pegado corre el campo. Se toman
      // los primeros 10 dígitos, que es lo que el anexo llama «NIT sin DV».
      expect(withDv).toBe(
        buildDianXmlFileName('invoice', {
          nit: '9020565899',
          consecutive: 1,
          year: 2026,
        }),
      );
    });

    it('toma el año de una fecha YYYY-MM-DD sin reinterpretarla en UTC', () => {
      // Un `new Date('2026-01-01')` en una zona negativa retrocede al 2025.
      expect(
        buildDianXmlFileName('invoice', {
          nit: NIT,
          consecutive: 1,
          year: '2026-01-01',
        }),
      ).toContain('26');
    });

    it('cae a software propio cuando no se informa el código', () => {
      expect(
        buildDianXmlFileName('invoice', {
          nit: NIT,
          consecutive: 1,
          year: YEAR,
        }),
      ).toBe('fv08001972680001900000001.xml');
    });
  });

  describe('softwareCodeForOperationMode', () => {
    it('mapea software propio y facturación gratuita', () => {
      expect(softwareCodeForOperationMode('own_software')).toBe('000');
      expect(softwareCodeForOperationMode(null)).toBe('000');
      expect(softwareCodeForOperationMode('dian_free_billing')).toBe('001');
    });

    it('rechaza Proveedor Tecnológico en vez de nombrarlo como software propio', () => {
      // Caer a '000' produciría un nombre bien formado pero mentiroso, que la
      // DIAN acepta con ZipKey y descarta sin rechazo — el defecto original,
      // ahora sin síntoma que lo delate.
      expect(() =>
        softwareCodeForOperationMode('technological_provider'),
      ).toThrow(/Proveedor Tecnológico/);
    });
  });
});
