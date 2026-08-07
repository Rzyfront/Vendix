import { create } from 'xmlbuilder2';
import { DOMParser } from '@xmldom/xmldom';
import { UblCommonBuilder } from './ubl-common.builder';
import { UBL_NAMESPACES } from './xml-namespaces';
import { DianIssuerData } from '../interfaces/dian-config.interface';

describe('UblCommonBuilder.buildSupplierParty', () => {
  /**
   * Creates a root UBL element with CAC/CBC/EXT namespaces registered,
   * mirroring how the real invoice/credit-note builders construct the tree
   * before delegating to UblCommonBuilder.
   */
  function createRoot(): any {
    return create({ version: '1.0', encoding: 'UTF-8' }).ele(
      UBL_NAMESPACES.INVOICE,
      'Invoice',
      {
        'xmlns:cac': UBL_NAMESPACES.CAC,
        'xmlns:cbc': UBL_NAMESPACES.CBC,
        'xmlns:ext': UBL_NAMESPACES.EXT,
      },
    );
  }

  /**
   * Builds a minimal valid issuer conforming to DianIssuerData, overriding
   * only the fiscal fields under test.
   */
  function buildIssuer(overrides: Partial<DianIssuerData>): DianIssuerData {
    return {
      document_type: '31',
      nit: '900123456',
      nit_dv: '7',
      legal_name: 'Vendix SAS',
      trade_name: 'Vendix',
      address_line: 'Calle 1 # 2-3',
      city_code: '11001',
      city_name: 'Bogota',
      department_code: '11',
      department_name: 'Bogota',
      country_code: 'CO',
      postal_code: '110111',
      email: 'contabilidad@vendix.test',
      tax_regime: '48',
      tax_scheme: 'O-15',
      ...overrides,
    };
  }

  function serializeSupplierParty(
    issuer: DianIssuerData,
    numbering_prefix?: string,
  ): string {
    const root = createRoot();
    UblCommonBuilder.buildSupplierParty(root, issuer, numbering_prefix);
    return root.end({ prettyPrint: true });
  }

  it('puts the person type in AdditionalAccountID and the fiscal responsibilities in TaxLevelCode', () => {
    // No person_type set → default '1' (Persona Jurídica). The regime code
    // ('49') must NOT appear in AdditionalAccountID; the fiscal responsibility
    // ('R-99-PN') goes in TaxLevelCode with @listName='No aplica' (DIAN annex).
    const issuer = buildIssuer({ tax_regime: '49', tax_scheme: 'R-99-PN' });

    const xml = serializeSupplierParty(issuer);

    expect(xml).toContain('AdditionalAccountID');
    expect(xml).toMatch(/AdditionalAccountID>1</);
    // The regime is no longer misplaced in AdditionalAccountID.
    expect(xml).not.toMatch(/AdditionalAccountID>49</);
    // Responsibility → TaxLevelCode value; @listName is the literal 'No aplica'.
    expect(xml).toMatch(/TaxLevelCode listName="No aplica"/);
    expect(xml).toMatch(/TaxLevelCode[^>]*>R-99-PN</);
  });

  it('honors an explicit person_type and carries a different responsibility', () => {
    const issuer = buildIssuer({
      person_type: '2',
      tax_regime: '48',
      tax_scheme: 'O-15',
    });

    const xml = serializeSupplierParty(issuer);

    expect(xml).toMatch(/AdditionalAccountID>2</);
    expect(xml).toMatch(/TaxLevelCode listName="No aplica"/);
    expect(xml).toMatch(/TaxLevelCode[^>]*>O-15</);

    // Ensure the alternate-case values from the other test are NOT present,
    // confirming the serialized values are driven by this issuer instance.
    expect(xml).not.toContain('R-99-PN');
    expect(xml).not.toMatch(/AdditionalAccountID>49</);
  });

  // Reglas FAJ49/FAJ50 (y sus espejos CAJ49/CAJ50, DAJ49/DAJ50). Los asertos van
  // por DOM y no por `toContain`: la DIAN identifica el punto de facturación por
  // el XPath COMPLETO, así que el mismo `cbc:ID` colgado de otro padre —el error
  // que produjo FAJ28 con la dirección fiscal— dejaría la regla igual de abierta
  // mientras una prueba de substring pasa en verde.
  describe('cac:CorporateRegistrationScheme (punto de facturación)', () => {
    function legalEntityOf(xml: string): any {
      const doc = new DOMParser().parseFromString(xml, 'text/xml');
      const entities = doc.getElementsByTagNameNS(
        UBL_NAMESPACES.CAC,
        'PartyLegalEntity',
      );
      expect(entities.length).toBe(1);
      return entities.item(0);
    }

    it('emits the numbering prefix under PartyLegalEntity, never under PartyTaxScheme', () => {
      const xml = serializeSupplierParty(buildIssuer({}), 'SETP');
      const legal = legalEntityOf(xml);

      const scheme = legal.getElementsByTagNameNS(
        UBL_NAMESPACES.CAC,
        'CorporateRegistrationScheme',
      );
      expect(scheme.length).toBe(1);

      const id = scheme
        .item(0)
        .getElementsByTagNameNS(UBL_NAMESPACES.CBC, 'ID');
      expect(id.length).toBe(1);
      // FAJ50: debe ser IGUAL al `sts:Prefix` del encabezado, y mide 1-4.
      expect(id.item(0).textContent).toBe('SETP');
      expect(id.item(0).textContent.length).toBeLessThanOrEqual(4);

      // El grupo cuelga de PartyLegalEntity y de nada más: el árbol completo
      // tiene exactamente una aparición, y su padre es la entidad legal. Sin
      // este aserto, colgarlo de `cac:PartyTaxScheme` pasaría igual.
      const doc = new DOMParser().parseFromString(xml, 'text/xml');
      const all = doc.getElementsByTagNameNS(
        UBL_NAMESPACES.CAC,
        'CorporateRegistrationScheme',
      );
      expect(all.length).toBe(1);
      expect((all.item(0) as any).parentNode.localName).toBe(
        'PartyLegalEntity',
      );
    });

    it('omits cbc:Name — the matrícula mercantil is not stored and must not be invented', () => {
      const scheme = legalEntityOf(
        serializeSupplierParty(buildIssuer({}), 'SETP'),
      ).getElementsByTagNameNS(
        UBL_NAMESPACES.CAC,
        'CorporateRegistrationScheme',
      );

      expect(
        scheme.item(0).getElementsByTagNameNS(UBL_NAMESPACES.CBC, 'Name').length,
      ).toBe(0);
    });

    it('omits the whole group when there is no resolution prefix (documento soporte)', () => {
      const legal = legalEntityOf(serializeSupplierParty(buildIssuer({})));

      expect(
        legal.getElementsByTagNameNS(
          UBL_NAMESPACES.CAC,
          'CorporateRegistrationScheme',
        ).length,
      ).toBe(0);
    });
  });

  // Reglas CAS01b / DAS01b. Antes del cuerpo compartido, las notas crédito y
  // débito escribían su línea aparte y salían SIN `cac:TaxTotal` de línea. Estos
  // asertos recorren los tres tipos: si un arreglo futuro vuelve a alcanzar solo
  // a la factura, dos de los tres casos fallan aquí y no en la DIAN.
  describe('buildDocumentLines — los tres tipos comparten cuerpo', () => {
    const CASES = [
      { line_element: 'InvoiceLine', quantity_element: 'InvoicedQuantity' },
      { line_element: 'CreditNoteLine', quantity_element: 'CreditedQuantity' },
      { line_element: 'DebitNoteLine', quantity_element: 'DebitedQuantity' },
    ] as const;

    function buildLine(kase: (typeof CASES)[number]): any {
      const root = createRoot();
      UblCommonBuilder.buildDocumentLines(
        root,
        [
          {
            description: 'Producto de prueba',
            quantity: '1.00',
            unit_price: '100000.00',
            discount_amount: '0.00',
            tax_amount: '19000.00',
            total_amount: '119000.00',
          } as any,
        ],
        [
          {
            tax_name: 'IVA',
            tax_rate: '19.00',
            taxable_amount: '100000.00',
            tax_amount: '19000.00',
          } as any,
        ],
        'COP',
        kase,
      );
      const doc = new DOMParser().parseFromString(
        root.end({ prettyPrint: true }),
        'text/xml',
      );
      const lines = doc.getElementsByTagNameNS(
        UBL_NAMESPACES.CAC,
        kase.line_element,
      );
      expect(lines.length).toBe(1);
      return lines.item(0);
    }

    it.each(CASES)(
      '$line_element carries its own TaxTotal with the (ID, Name) tax pair',
      (kase) => {
        const line = buildLine(kase);

        // CAS01b/DAS01b: el TaxTotal es de LÍNEA, no el de cabecera.
        const tax_total = line.getElementsByTagNameNS(
          UBL_NAMESPACES.CAC,
          'TaxTotal',
        );
        expect(tax_total.length).toBe(1);

        const scheme = tax_total
          .item(0)
          .getElementsByTagNameNS(UBL_NAMESPACES.CAC, 'TaxScheme');
        expect(scheme.length).toBe(1);
        expect(
          scheme
            .item(0)
            .getElementsByTagNameNS(UBL_NAMESPACES.CBC, 'ID')
            .item(0).textContent,
        ).toBe('01');
        // FAS01b/CAS01b comparan el PAR (ID, Name), no solo el código.
        expect(
          scheme
            .item(0)
            .getElementsByTagNameNS(UBL_NAMESPACES.CBC, 'Name')
            .item(0).textContent,
        ).toBe('IVA');
      },
    );

    it.each(CASES)(
      '$line_element uses $quantity_element and carries StandardItemIdentification (FAZ09)',
      (kase) => {
        const line = buildLine(kase);

        expect(
          line.getElementsByTagNameNS(
            UBL_NAMESPACES.CBC,
            kase.quantity_element,
          ).length,
        ).toBe(1);
        expect(
          line.getElementsByTagNameNS(
            UBL_NAMESPACES.CAC,
            'StandardItemIdentification',
          ).length,
        ).toBe(1);
      },
    );
  });
});
