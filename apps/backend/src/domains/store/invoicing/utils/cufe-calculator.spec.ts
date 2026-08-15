import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { CufeCalculator, CufeParams } from './cufe-calculator';
import { dianAmount } from './dian-money.util';

/**
 * Regression suite for the CUFE scale/sanitization defect.
 *
 * The DIAN recomputes this hash from the XML it receives, so the hash Vendix
 * signs must be derivable from the values the XML publishes. Two divergences
 * used to break that:
 *
 * 1. Amounts arrived as `Prisma.Decimal.toString()` (`'1000'`) while the XML
 *    emitted `'1000.00'`.
 * 2. The acquirer's document arrived punctuated (`'900.123.456-7'`) while the
 *    Anexo requires bare digits.
 *
 * Both are now normalized inside `CufeCalculator.generate`, so these tests pin
 * the invariant "differently-formatted equivalent inputs produce ONE hash".
 */
describe('CufeCalculator', () => {
  const base: CufeParams = {
    invoice_number: 'SETP990000001',
    issue_date: '2026-08-04',
    issue_time: '10:15:30-05:00',
    total_before_tax: '1000.00',
    tax_iva: '190.00',
    tax_inc: '0.00',
    tax_ica: '0.00',
    total_amount: '1190.00',
    issuer_nit: '900123456',
    customer_nit: '1020304050',
    technical_key: 'fc8eac422eba16e22ffd8c6f94b3f40a6e38162c',
    environment: '2',
  };

  describe('monetary scale normalization', () => {
    it('produces the same CUFE for an unscaled Decimal and its padded string', () => {
      // The exact production path: invoice_flow handed over `.toString()`.
      const unscaled = new Prisma.Decimal('1000.00').toString();
      expect(unscaled).toBe('1000');

      const from_unscaled = CufeCalculator.generate({
        ...base,
        total_before_tax: unscaled,
      });
      const from_padded = CufeCalculator.generate({
        ...base,
        total_before_tax: '1000.00',
      });

      expect(from_unscaled).toBe(from_padded);
    });

    it('normalizes every monetary field, not only the subtotal', () => {
      const unscaled = CufeCalculator.generate({
        ...base,
        total_before_tax: '1000',
        tax_iva: '190',
        tax_inc: '0',
        tax_ica: '0',
        total_amount: '1190',
      });
      expect(unscaled).toBe(CufeCalculator.generate(base));
    });

    it('treats an absent optional tax as 0.00', () => {
      const omitted = CufeCalculator.generate({
        ...base,
        tax_inc: undefined,
        tax_ica: undefined,
      });
      expect(omitted).toBe(CufeCalculator.generate(base));
    });

    it('truncates a sub-cent amount instead of rounding it up', () => {
      const truncated = CufeCalculator.generate({
        ...base,
        total_before_tax: '1000.009',
      });
      expect(truncated).toBe(
        CufeCalculator.generate({ ...base, total_before_tax: '1000.00' }),
      );
    });
  });

  describe('NIT sanitization (Anexo §11.2)', () => {
    it('produces the same CUFE for a punctuated and a bare acquirer NIT', () => {
      const punctuated = CufeCalculator.generate({
        ...base,
        customer_nit: '1.020.304.050',
      });
      expect(punctuated).toBe(CufeCalculator.generate(base));
    });

    it('strips the issuer NIT separators too', () => {
      const punctuated = CufeCalculator.generate({
        ...base,
        issuer_nit: '900.123.456',
      });
      expect(punctuated).toBe(CufeCalculator.generate(base));
    });
  });

  describe('hash contract', () => {
    it('is a 96-char lowercase hex SHA-384 digest', () => {
      expect(CufeCalculator.generate(base)).toMatch(/^[0-9a-f]{96}$/);
    });

    it('changes when the environment changes', () => {
      const test_env = CufeCalculator.generate({ ...base, environment: '2' });
      const prod_env = CufeCalculator.generate({ ...base, environment: '1' });
      expect(test_env).not.toBe(prod_env);
    });

    it('changes when the technical key changes', () => {
      const other = CufeCalculator.generate({
        ...base,
        technical_key: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      });
      expect(other).not.toBe(CufeCalculator.generate(base));
    });

    it('reproduces the hash a verifier recomputes from XML-published values', () => {
      // Mirrors what an auditor does: read the 15 fields off the XML (already
      // DIAN-formatted) and hash them. If generate() normalized differently from
      // the XML builders, this would diverge.
      const from_xml_values = CufeCalculator.generate({
        ...base,
        total_before_tax: dianAmount('1000'),
        tax_iva: dianAmount('190'),
        tax_inc: dianAmount('0'),
        tax_ica: dianAmount('0'),
        total_amount: dianAmount('1190'),
      });
      expect(from_xml_values).toBe(CufeCalculator.generate(base));
    });
  });

  /**
   * §11.7 — el QR de la representación gráfica.
   *
   * Reemplaza al antiguo `generateQrUrl(cufe)`, que tenía la URL de producción
   * escrita a mano y un docstring que se declaraba «fake […] for testing
   * purposes» mientras seis rutas del proveedor real lo consumían.
   */
  describe('resolveQrUrl (§11.7.1)', () => {
    it('apunta al catálogo de producción sólo en ambiente 1', () => {
      expect(CufeCalculator.resolveQrUrl('ABC', '1')).toBe(
        'https://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey=ABC',
      );
    });

    /**
     * El defecto que esto fija: un documento emitido en habilitación NO existe
     * en el catálogo de producción. Apuntar siempre allí producía un QR que,
     * escaneado, responde «documento no encontrado» — el adquiriente no puede
     * verificar nada.
     */
    it('apunta al catálogo de habilitación en ambiente 2', () => {
      expect(CufeCalculator.resolveQrUrl('ABC', '2')).toBe(
        'https://catalogo-vpfe-hab.dian.gov.co/document/searchqr?documentkey=ABC',
      );
    });

    it('trata un ambiente ausente o desconocido como habilitación', () => {
      // Lado seguro: mandar a alguien al catálogo de pruebas es un error
      // visible; publicar como productivo un documento de pruebas, no.
      expect(CufeCalculator.resolveQrUrl('ABC', undefined)).toContain(
        'catalogo-vpfe-hab',
      );
      expect(CufeCalculator.resolveQrUrl('ABC', '')).toContain(
        'catalogo-vpfe-hab',
      );
    });
  });

  describe('buildQrContent (§11.7)', () => {
    const qr_base = {
      invoice_number: 'SETP990000001',
      issue_date: '2026-08-04',
      issue_time: '10:15:30-05:00',
      issuer_nit: '900123456-1',
      issuer_document_type: '31',
      customer_nit: '1020304050',
      customer_document_type: '13',
      total_before_tax: '1000.00',
      tax_iva: '190.00',
      total_amount: '1190.00',
      document_key: 'CUFE_DE_PRUEBA',
      environment: '2',
    };

    /**
     * El QR **no es la URL**. El anexo fija once líneas para que el adquiriente
     * verifique el documento leyendo el propio código, sin conexión. Guardar
     * sólo la URL —lo que se hacía— elimina esa verificación.
     */
    it('emite las once líneas del anexo, en orden', () => {
      const lines = CufeCalculator.buildQrContent(qr_base).split('\n');
      expect(lines).toHaveLength(11);
      expect(lines.slice(0, 10).map((l) => l.split(':')[0])).toEqual([
        'NumFac',
        'FecFac',
        'HorFac',
        'NitFac',
        'DocAdq',
        'ValFac',
        'ValIva',
        'ValOtroIm',
        'ValTolFac',
        'CUFE',
      ]);
      expect(lines[10]).toBe(
        CufeCalculator.resolveQrUrl('CUFE_DE_PRUEBA', '2'),
      );
    });

    it('agrega en ValOtroIm todo impuesto que no sea IVA', () => {
      const content = CufeCalculator.buildQrContent({
        ...qr_base,
        tax_inc: '80.00',
        tax_ica: '8.28',
        tax_other: '1.72',
      });
      expect(content).toContain('ValOtroIm: 90.00');
      // Y el IVA sigue solo en su propia línea.
      expect(content).toContain('ValIva: 190.00');
    });

    it('trata los impuestos ausentes como 0.00 en vez de omitir la línea', () => {
      expect(CufeCalculator.buildQrContent(qr_base)).toContain(
        'ValOtroIm: 0.00',
      );
    });

    /**
     * La cara visible y el hash deben declarar los MISMOS números. Si el QR
     * formateara por su cuenta, un documento podría mostrar cifras que no son
     * las que la DIAN validó.
     */
    it('publica las identificaciones con la misma regla que el hash', () => {
      const content = CufeCalculator.buildQrContent(qr_base);
      expect(content).toContain('NitFac: 900123456'); // NIT: sin DV
      expect(content).toContain('DocAdq: 1020304050'); // cédula: íntegra
    });

    it('formatea los importes con la misma regla que el hash', () => {
      const content = CufeCalculator.buildQrContent({
        ...qr_base,
        total_before_tax: '1000',
        tax_iva: '190.009',
      });
      expect(content).toContain('ValFac: 1000.00');
      expect(content).toContain('ValIva: 190.00'); // truncado, no redondeado
    });
  });

  /**
   * The strongest verification available for a hash contract: the annex publishes a
   * worked example, so the assertion is the DIAN's own output rather than our
   * reading of a field list.
   *
   * Source: Anexo Técnico de documento equivalente electrónico v1.0
   * (Res. 000165/2023), numerales 14.1.7 (field list) and 14.1.8 (this vector).
   */
  describe('generateEventCude — official vector', () => {
    const OFFICIAL_VECTOR = {
      event_number: '1',
      issue_date: '2019-04-30',
      issue_time: '19:48:50-05:00',
      issuer_nit: '99998888',
      customer_nit: '800197268',
      event_code: '030',
      referenced_document_number: 'FE123',
      referenced_document_type_code: '01',
      software_pin: '11111',
    };

    const OFFICIAL_CUDE =
      '0d91ba25b01f5e7dbda870a11b274501d3a62a73e91932c473c86c93f12a142a2ac45876efcde3e679024a01c0be41f9';

    it('reproduces the CUDE published by the annex', () => {
      expect(CufeCalculator.generateEventCude(OFFICIAL_VECTOR)).toBe(
        OFFICIAL_CUDE,
      );
    });

    /**
     * Each of these was a real defect in the shipped implementation, and any ONE of
     * them yields a key the DIAN cannot reproduce — i.e. every RADIAN event Vendix
     * transmitted was rejected. Pinned individually so a future refactor cannot
     * reintroduce one of them while the happy path still passes.
     */
    it('places the event code AFTER both identifications', () => {
      // The old order hashed the code right after the time.
      const wrong_order = [
        '1',
        '2019-04-30',
        '19:48:50-05:00',
        '030',
        '99998888',
        '800197268',
        'FE123',
        '01',
        '11111',
      ].join('');
      expect(OFFICIAL_CUDE).not.toBe(
        require('crypto').createHash('sha384').update(wrong_order).digest('hex'),
      );
    });

    it('binds the referenced document number and type', () => {
      const other_document = CufeCalculator.generateEventCude({
        ...OFFICIAL_VECTOR,
        referenced_document_number: 'FE124',
      });
      expect(other_document).not.toBe(OFFICIAL_CUDE);

      const other_type = CufeCalculator.generateEventCude({
        ...OFFICIAL_VECTOR,
        referenced_document_type_code: '02',
      });
      expect(other_type).not.toBe(OFFICIAL_CUDE);
    });

    it('defaults the referenced document type to 01 (FEV)', () => {
      const { referenced_document_type_code, ...without_type } =
        OFFICIAL_VECTOR;
      expect(referenced_document_type_code).toBe('01');
      expect(CufeCalculator.generateEventCude(without_type)).toBe(
        OFFICIAL_CUDE,
      );
    });

    it('ends the chain at the Software-PIN, with no environment digit', () => {
      // The old implementation appended TipoAmbiente ('1'/'2') after the PIN.
      const with_environment = require('crypto')
        .createHash('sha384')
        .update(
          '12019-04-3019:48:50-05:0099998888800197268030FE1230111111' + '2',
        )
        .digest('hex');
      expect(OFFICIAL_CUDE).not.toBe(with_environment);
    });

    /**
     * `onlyDigits` removes dots and dashes, NOT the verification digit — the annex
     * asks for both, and stripping a trailing digit blindly would mutilate a
     * cédula. Callers must hand over the identification already without its DV, the
     * same contract the invoice CUFE path has.
     */
    it('strips punctuation from both identifications', () => {
      expect(
        CufeCalculator.generateEventCude({
          ...OFFICIAL_VECTOR,
          issuer_nit: '99.998.888',
          customer_nit: '800.197.268',
        }),
      ).toBe(OFFICIAL_CUDE);
    });

    it('does NOT silently drop a verification digit the caller left in', () => {
      // Would be a wrong key rather than a corrected one, so it must differ —
      // the DV belongs in `@schemeID`, never in the hashed identification.
      expect(
        CufeCalculator.generateEventCude({
          ...OFFICIAL_VECTOR,
          customer_nit: '800197268-4',
        }),
      ).not.toBe(OFFICIAL_CUDE);
    });
  });

  /**
   * The equivalent document (POS ticket) reuses the 15-field invoice shape with the
   * Software-PIN in the ClTec position — Res. 000165/2023 Anexo DE §14.1.2.
   */
  describe('generateEquivalentDocumentCude', () => {
    it('substitutes the Software-PIN for the technical key', () => {
      const { technical_key, ...without_key } = base;
      expect(technical_key).toBeDefined();

      const cude = CufeCalculator.generateEquivalentDocumentCude({
        ...without_key,
        software_pin: '11111',
      });

      expect(cude).toBe(
        CufeCalculator.generate({ ...without_key, technical_key: '11111' }),
      );
      // And it must NOT coincide with the invoice CUFE of the same document.
      expect(cude).not.toBe(CufeCalculator.generate(base));
    });

    it('applies the same money and NIT normalization as the CUFE', () => {
      const padded = CufeCalculator.generateEquivalentDocumentCude({
        ...base,
        total_before_tax: '1000',
        customer_nit: '10.203.040-50',
        software_pin: '11111',
      });
      const normalized = CufeCalculator.generateEquivalentDocumentCude({
        ...base,
        total_before_tax: '1000.00',
        customer_nit: '1020304050',
        software_pin: '11111',
      });
      expect(padded).toBe(normalized);
    });
  });

  /**
   * Vectores publicados por el Anexo Técnico 1.9 §11.2 y §11.4, con su cadena de
   * concatenación Y su digest impresos. Son la única verificación NO circular de
   * esta clase: cualquier otra prueba comprueba que nuestro código reproduce
   * nuestro código.
   *
   * El de nota crédito es el que importa aquí: confirma que el Software-PIN ocupa
   * la posición de la clave técnica, que es exactamente lo que el generador del
   * set de pruebas tenía mal. (El vector de evento §11.6 ya se cubre arriba.)
   */
  describe('vectores del Anexo Técnico 1.9', () => {
    /**
     * Vector de control de la pág. 657, el único del anexo que trae una clave
     * técnica REAL —40 hexadecimales, la forma que el WS de Rangos de
     * Numeración entrega— en vez de un valor abreviado de ejemplo.
     *
     * Por eso es el ancla de esta suite: fija a la vez la composición de los 15
     * campos y la forma de la ClTec. Si alguna de las dos se rompe, falla aquí.
     */
    it('reproduce el CUFE publicado en la pág. 657 (ClTec de 40 hex)', () => {
      const OFFICIAL_CLTEC = '693ff6f2a553c3646a063436fd4dd9ded0311471';
      expect(OFFICIAL_CLTEC).toHaveLength(40);

      expect(
        CufeCalculator.generate({
          invoice_number: '323200000129',
          issue_date: '2019-01-16',
          issue_time: '10:53:10-05:00',
          total_before_tax: '1500000.00',
          tax_iva: '285000.00',
          tax_inc: '0.00',
          tax_ica: '0.00',
          total_amount: '1785000.00',
          issuer_nit: '700085371',
          customer_nit: '800199436',
          technical_key: OFFICIAL_CLTEC,
          environment: '1',
        }),
      ).toBe(
        '8bb918b19ba22a694f1da11c643b5e9de39adf60311cf179179e9b33381030bcd4c3c3f156c506ed5908f9276f5bd9b4',
      );
    });

    it('reproduce el CUFE de factura de §11.2 (ClTec en la 14ª posición)', () => {
      expect(
        CufeCalculator.generate({
          invoice_number: '8110007871',
          issue_date: '2019-02-20',
          issue_time: '16:46:55-05:00',
          total_before_tax: '235.28',
          tax_iva: '19.00',
          tax_inc: '0.00',
          // El vector imprime `038.28`: código ICA `03` + valor `8.28`. La
          // aritmética lo confirma — 235.28 + 19.00 + 8.28 = 262.56.
          tax_ica: '8.28',
          total_amount: '262.56',
          issuer_nit: '900373076',
          customer_nit: '8355990123',
          technical_key: '45',
          environment: '2',
        }),
      ).toBe(
        '955327eb55f8bdf16d069358a063d87e1577a292cb088ec186ed60bbc38e750b7b3980659b278ead789b95f9c51a9ef7',
      );
    });

    it('reproduce el CUDE de nota crédito de §11.4 con el Software-PIN, no la clave técnica', () => {
      // El anexo define el CUDE con `Software-PIN` —«Pin del software registrado
      // en el catálogo del participante»— en la misma posición donde el CUFE
      // lleva la clave técnica. Ninguno de los dos viaja en el XML, así que
      // pasar el valor equivocado produce un documento de apariencia perfecta
      // que la DIAN rechaza al recalcular el hash.
      expect(
        CufeCalculator.generate({
          invoice_number: '8110007871',
          issue_date: '2019-01-12',
          issue_time: '07:00:00-05:00',
          total_before_tax: '5000.00',
          tax_iva: '950.00',
          tax_inc: '0.00',
          tax_ica: '0.00',
          total_amount: '5950.00',
          issuer_nit: '900373076',
          customer_nit: '8355990123',
          technical_key: '01', // Software-PIN
          environment: '1',
        }),
      ).toBe(
        '907e4444decc9e59c160a2fb3b6659b33dc5b632a5008922b9a62f83f757b1c448e47f5867f2b50dbdb96f48c7681168',
      );
    });

    /**
     * El cuarto vector del anexo —§11.4.5, nota débito `ND1001`— es
     * INTERNAMENTE INCONSISTENTE: el digest que imprime no es el SHA-384 de la
     * cadena que imprime a su lado.
     *
     *   cadena  ND10012019-01-1810:58:00-05:0030000.00010.00042400.00030.00
     *           32400.0090019726410254102102012
     *   digest  b9483dc2a17167feedf37b6bd67c4204e7b601933e0e389cffbd545e4d0ec370…
     *   real    3fa73a86d57d9341c536afde1f85c4efd9d4591c2c22bce4dfb0e6b0d2e83b8f…
     *
     * Queda escrito para que nadie «arregle» el calculador para alcanzar ese
     * digest: los otros tres vectores coinciden, así que la composición es
     * correcta y el error está en el ejemplo del anexo. La referencia que el
     * propio anexo cita para ese cálculo es `sha1-online.com`.
     */
    it('la composición reproduce la CADENA del vector §11.4.5, cuyo digest publicado está errado', () => {
      const cude = CufeCalculator.generate({
        invoice_number: 'ND1001',
        issue_date: '2019-01-18',
        issue_time: '10:58:00-05:00',
        total_before_tax: '30000.00',
        tax_iva: '0.00',
        tax_inc: '2400.00',
        tax_ica: '0.00',
        total_amount: '32400.00',
        issuer_nit: '900197264',
        customer_nit: '10254102',
        technical_key: '10201', // Software-PIN
        environment: '2',
      });
      const string_of_the_annex =
        'ND10012019-01-1810:58:00-05:0030000.00010.00042400.00030.0032400.00' +
        '90019726410254102102012';
      expect(cude).toBe(
        createHash('sha384').update(string_of_the_annex).digest('hex'),
      );
      // Y NO al digest impreso, que no corresponde a esa cadena.
      expect(cude).not.toBe(
        'b9483dc2a17167feedf37b6bd67c4204e7b601933e0e389cffbd545e4d0ec370b403cbb41ff656776cb6cb5d8348ecd4',
      );
    });
  });

  /**
   * REGRESIÓN DE UN INCIDENTE REAL DE PRODUCCIÓN (14/08/2026).
   *
   * Una factura se rechazó con «Valor del CUFE no está calculado
   * correctamente.» y quemó un consecutivo autorizado, irrecuperable.
   *
   * El diagnóstico recompuso el hash desde los valores literales del XML
   * transmitido y reprodujo EXACTAMENTE el CUFE persistido: la composición de
   * este calculador era correcta. Lo que estaba mal era la ENTRADA — la
   * `technical_key` almacenada tenía **38 caracteres hexadecimales**, todos
   * válidos, sin espacios ni saltos de línea, cuando la clave técnica de la
   * DIAN es un SHA-1 en hex de **exactamente 40** (§11.2, y el vector oficial
   * de la pág. 657 lo confirma). Se perdieron dos caracteres en la captura.
   *
   * La lección que estos tests fijan: **el CUFE no puede detectar su propia
   * entrada corrupta.** Hashea cualquier cadena y devuelve 96 hex de aspecto
   * impecable; el primer sistema capaz de notar el error es la DIAN, y para
   * entonces el consecutivo ya se gastó. Por eso la defensa vive AGUAS ARRIBA
   * —DTO, servicio, escáner OCR y precondición previa a tomar el consecutivo—
   * y no aquí.
   */
  describe('regresión: clave técnica truncada (incidente de producción)', () => {
    const CLTEC_VALIDA = '693ff6f2a553c3646a063436fd4dd9ded0311471';
    const CLTEC_TRUNCADA = CLTEC_VALIDA.slice(0, 38);

    it('dos caracteres perdidos bastan para producir un CUFE que la DIAN rechaza', () => {
      expect(CLTEC_VALIDA).toHaveLength(40);
      expect(CLTEC_TRUNCADA).toHaveLength(38);
      expect(CLTEC_TRUNCADA).toMatch(/^[0-9a-f]+$/); // hex válido: nada delata el defecto

      expect(
        CufeCalculator.generate({ ...base, technical_key: CLTEC_TRUNCADA }),
      ).not.toBe(
        CufeCalculator.generate({ ...base, technical_key: CLTEC_VALIDA }),
      );
    });

    it('el calculador acepta la clave truncada sin protestar — por eso la puerta va aguas arriba', () => {
      // Documenta el límite del componente, no un comportamiento deseable: el
      // hash de una entrada inválida es indistinguible del de una válida.
      const cufe = CufeCalculator.generate({
        ...base,
        technical_key: CLTEC_TRUNCADA,
      });
      expect(cufe).toMatch(/^[0-9a-f]{96}$/);
    });
  });

  /**
   * §11.2 exige `NitOFE` y `NumAdq` «sin puntos, sin guiones y SIN dígito de
   * verificación». `onlyDigits()` sólo cumplía los dos primeros: sobre
   * `900123456-7` devolvía `9001234567`, con el DV pegado.
   *
   * El recorte NO puede ser ciego. **Sólo el NIT lleva DV.** Una cédula son
   * dígitos de dato de punta a punta; quitarle el último la convierte en la
   * cédula de otra persona — un daño peor que el que se quería evitar. De ahí
   * que la decisión dependa del tipo de documento declarado.
   */
  describe('identificación de las partes (§11.2): el DV se recorta sólo al NIT', () => {
    it('recorta el DV de un adquiriente NIT', () => {
      expect(
        CufeCalculator.generate({
          ...base,
          customer_nit: '900123456-7',
          customer_document_type: '31',
        }),
      ).toBe(
        CufeCalculator.generate({
          ...base,
          customer_nit: '900123456',
          customer_document_type: '31',
        }),
      );
    });

    it('deja intacta la cédula de un adquiriente persona natural', () => {
      const cedula = CufeCalculator.generate({
        ...base,
        customer_nit: '1020304050',
        customer_document_type: '13',
      });
      // Un recorte ciego habría hasheado nueve dígitos: otra persona.
      const mutilada = CufeCalculator.generate({
        ...base,
        customer_nit: '102030405',
        customer_document_type: '13',
      });
      expect(cedula).not.toBe(mutilada);
    });

    it('trata un tipo de documento ausente como NO-NIT y preserva el número', () => {
      // Lectura conservadora: sin declaración de tipo, no se mutila por
      // suposición. El adquiriente de una factura POS llega así.
      expect(
        CufeCalculator.generate({
          ...base,
          customer_nit: '1020304050',
          customer_document_type: undefined,
        }),
      ).toBe(
        CufeCalculator.generate({
          ...base,
          customer_nit: '1020304050',
          customer_document_type: '13',
        }),
      );
    });

    it('recorta el DV del emisor aunque el llamador no declare su tipo', () => {
      // Un OFE es siempre NIT — no existe factura electrónica emitida por una
      // cédula—, así que aquí la suposición sí es segura y evita depender de
      // que cada ruta recuerde declararlo.
      expect(
        CufeCalculator.generate({ ...base, issuer_nit: '900123456-1' }),
      ).toBe(CufeCalculator.generate({ ...base, issuer_nit: '900123456' }));
    });
  });
});
