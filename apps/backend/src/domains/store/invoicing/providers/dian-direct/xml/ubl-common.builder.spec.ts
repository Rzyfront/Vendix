import { create } from 'xmlbuilder2';
import { DOMParser } from '@xmldom/xmldom';
import { UblCommonBuilder } from './ubl-common.builder';
import { UBL_NAMESPACES } from './xml-namespaces';
import {
  DianCustomerData,
  DianIssuerData,
} from '../interfaces/dian-config.interface';
import {
  toDianTaxLevelCode,
  DIAN_TAX_LEVEL_CODES,
  DIAN_TAX_LEVEL_CODE_MAX_LENGTH,
} from '../constants/dian-tax-level-codes';
import {
  DIAN_PARTY_TAX_SCHEMES,
  resolveDianPartyTaxScheme,
} from '../constants/dian-tax-codes';

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
    // No responsable de IVA (régimen '49') declara ZZ / No aplica
    expect(xml).toMatch(/<cac:TaxScheme>\s*<cbc:ID>ZZ<\/cbc:ID>\s*<cbc:Name>No aplica<\/cbc:Name>\s*<\/cac:TaxScheme>/);
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
    // Responsable de IVA (régimen '48') declara 01 / IVA
    expect(xml).toMatch(/<cac:TaxScheme>\s*<cbc:ID>01<\/cbc:ID>\s*<cbc:Name>IVA<\/cbc:Name>\s*<\/cac:TaxScheme>/);

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

describe('UblCommonBuilder.buildCustomerParty — Anexo Técnico 19 structural branch', () => {
  /**
   * Anexo Técnico 19 fixes the customer block to TWO structural siblings:
   *
   *   cac:PartyLegalEntity  → personas jurídicas, carries `cbc:RegistrationName`
   *                           and `cbc:CompanyID`.
   *   cac:Person            → personas naturales, carries `cbc:FirstName`,
   *                           `cbc:FamilyName`, `cbc:ID`.
   *
   * Emitting `cac:PartyLegalEntity` for a persona natural (the previous behavior)
   * is a DIAN rejection — `RegistrationName` is dishonest for a person and the
   * annex does not allow the legal entity as the customer's structural anchor.
   */

  /**
   * Creates a root UBL element with CAC/CBC/EXT namespaces registered. Lives
   * at this scope (not the outer describe) because the outer scope's
   * `createRoot` is hoisted into the supplier-party describe and not visible
   * here.
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
   * Builds a minimal valid customer conforming to DianCustomerData and emits
   * the UBL `cac:AccountingCustomerParty` block via the builder.
   */
  function buildCustomerPartyXml(
    customerOverrides: Partial<DianCustomerData>,
  ): string {
    const customer: DianCustomerData = {
      document_type: 'CC',
      document_number: '12345678',
      verification_digit: null,
      legal_name: null,
      trade_name: undefined,
      first_name: undefined,
      last_name: undefined,
      address_line: undefined,
      city_code: undefined,
      city_name: undefined,
      department_code: undefined,
      department_name: undefined,
      country_code: undefined,
      postal_code: undefined,
      phone: undefined,
      email: undefined,
      tax_regime: undefined,
      tax_responsibilities: ['R-99-PN'],
      person_type: 'NATURAL',
      ciiu_code: null,
      ...customerOverrides,
    };
    const root = createRoot();
    UblCommonBuilder.buildCustomerParty(root, customer);
    return root.end({ prettyPrint: true });
  }

  /**
   * Acota el conteo de `cbc:AdditionalAccountID` al bloque
   * `cac:AccountingCustomerParty`. El emisor (`cac:AccountingSupplierParty`)
   * también emite el suyo — contar sobre el XML entero daría un falso verde
   * si algún día ambos builders comparten un mismo documento en la prueba.
   */
  function customerPartyXml(xml: string): string {
    const start = xml.indexOf('<cac:AccountingCustomerParty>');
    const end = xml.indexOf('</cac:AccountingCustomerParty>');
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    return xml.slice(start, end);
  }

  it('persona natural — emite cac:Person con FirstName/FamilyName y NO PartyLegalEntity', () => {
    const xml = buildCustomerPartyXml({
      document_type: 'CC',
      document_number: '12345678',
      verification_digit: null,
      person_type: 'NATURAL',
      first_name: 'Ana',
      last_name: 'Pérez',
      legal_name: null,
      tax_responsibilities: ['R-99-PN'],
      ciiu_code: null,
    });

    // cac:Person presente con FirstName y FamilyName correctos.
    expect(xml).toContain('<cac:Person>');
    expect(xml).toContain('<cbc:FirstName>Ana</cbc:FirstName>');
    expect(xml).toContain('<cbc:FamilyName>Pérez</cbc:FamilyName>');
    // cac:PartyLegalEntity NO debe aparecer cuando es persona natural.
    expect(xml).not.toContain('<cac:PartyLegalEntity>');
    // TaxLevelCode = R-99-PN para consumidor final.
    expect(xml).toMatch(/TaxLevelCode[^>]*>R-99-PN</);
    // AdditionalAccountID = '2' (Persona Natural).
    expect(xml).toMatch(/AdditionalAccountID>2</);
  });

  it('persona jurídica — emite cac:PartyLegalEntity con CompanyID@schemeID=31 y NO cac:Person', () => {
    const xml = buildCustomerPartyXml({
      document_type: 'NIT',
      document_number: '900123456',
      verification_digit: '7',
      person_type: 'JURIDICA',
      legal_name: 'Acme S.A.S',
      tax_responsibilities: ['O-13', 'O-15'],
      ciiu_code: '4711',
    });

    // cac:PartyLegalEntity presente con RegistrationName + CompanyID@schemeID=31.
    expect(xml).toContain('<cac:PartyLegalEntity>');
    expect(xml).toContain(
      '<cbc:RegistrationName>Acme S.A.S</cbc:RegistrationName>',
    );
    // El número va DESNUDO y el DV en `@schemeID`: `cac:PartyTaxScheme/
    // cbc:CompanyID` es el XPath del que §11.2 toma `NumAdq`, y lo exige sin
    // DV. Con `900123456-7` en el texto, la DIAN recomputa el CUFE sobre otro
    // valor y rechaza.
    expect(xml).toMatch(
      /<cbc:CompanyID[^>]*schemeID="7"[^>]*>900123456<\/cbc:CompanyID>/,
    );
    // schemeName = código DIAN del tipo de documento, igual que el emisor.
    expect(xml).toMatch(/<cbc:CompanyID[^>]*schemeName="31"/);
    // El número con DV pegado no puede aparecer en NINGÚN identificador.
    expect(xml).not.toContain('900123456-7');
    // cac:Person NO debe aparecer.
    expect(xml).not.toContain('<cac:Person>');
    // TaxLevelCode concatenado: O-13;O-15.
    expect(xml).toMatch(/TaxLevelCode[^>]*>O-13;O-15</);
    // CIIU como cbc:IndustryClassificationCode.
    expect(xml).toContain('<cbc:IndustryClassificationCode>4711</cbc:IndustryClassificationCode>');
    // `cbc:AdditionalAccountID` es 1..1 en el perfil DIAN: UNA sola ocurrencia
    // con el código de persona ('1' Jurídica). Gran contribuyente (O-13) y
    // autorretenedor (O-15) NO generan hermanos adicionales — viajan en
    // TaxLevelCode, ya afirmado arriba. Emitir un segundo hermano fue lo que
    // produjo el rechazo «Receptor debe ser persona natural o jurídica» en
    // FVJL7/FVJL8.
    const customer_block = customerPartyXml(xml);
    const additional_account_ids =
      customer_block.match(/<cbc:AdditionalAccountID>/g) || [];
    expect(additional_account_ids.length).toBe(1);
    expect(customer_block).toMatch(
      /<cbc:AdditionalAccountID>1<\/cbc:AdditionalAccountID>/,
    );
  });

  it('cliente agente de retención — emite UN solo cbc:AdditionalAccountID y declara O-23 en cbc:TaxLevelCode cuando el RUT lo trae', () => {
    const xml = buildCustomerPartyXml({
      document_type: 'NIT',
      document_number: '900123456',
      verification_digit: '7',
      person_type: 'JURIDICA',
      legal_name: 'Retenedora S.A',
      tax_responsibilities: ['O-23'],
      ciiu_code: null,
      is_withholding_agent: true,
    });

    // Un solo `cbc:AdditionalAccountID`, con el código de persona ('1').
    const customer_block = customerPartyXml(xml);
    const additional_account_ids =
      customer_block.match(/<cbc:AdditionalAccountID>/g) || [];
    expect(additional_account_ids.length).toBe(1);
    expect(customer_block).toMatch(
      /<cbc:AdditionalAccountID>1<\/cbc:AdditionalAccountID>/,
    );
    // O-23 (agente de retención IVA) declarado en TaxLevelCode, tomado del RUT
    // (`tax_responsibilities`) — NUNCA derivado de `is_withholding_agent`.
    expect(xml).toMatch(/TaxLevelCode[^>]*>O-23</);
    // El literal que producía el rechazo no puede reaparecer.
    expect(xml).not.toContain(
      '<cbc:AdditionalAccountID>3</cbc:AdditionalAccountID>',
    );
  });

  it('REGRESIÓN — O-13 + O-15 + is_withholding_agent ya no producen tres cbc:AdditionalAccountID', () => {
    const xml = buildCustomerPartyXml({
      document_type: 'NIT',
      document_number: '900123456',
      verification_digit: '7',
      person_type: 'JURIDICA',
      legal_name: 'Gran Contribuyente Autorretenedor S.A.S',
      tax_responsibilities: ['O-13', 'O-15'],
      ciiu_code: null,
      is_withholding_agent: true,
    });

    // Antes del fix esta combinación —gran contribuyente + autorretenedor +
    // agente de retención— producía TRES etiquetas: '1' (persona) + '1'
    // (O-13) + '2' (O-15). Esta prueba es la red de seguridad: debe fallar si
    // alguien reintroduce los marcadores.
    const customer_block = customerPartyXml(xml);
    const additional_account_ids =
      customer_block.match(/<cbc:AdditionalAccountID>/g) || [];
    expect(additional_account_ids.length).toBe(1);
  });
});

describe('toDianTaxLevelCode — enumeración cerrada (FAJ26)', () => {
  // Migrado desde `UblCommonBuilder.toTaxLevelCode` (eliminado): la función
  // canónica vive ahora en `constants/dian-tax-level-codes.ts` y es la que
  // `buildSupplierParty`/`buildCustomerParty` consumen.
  it('conserva los códigos que la lista de cbc:TaxLevelCode acepta', () => {
    expect(toDianTaxLevelCode('O-13')).toBe('O-13');
    expect(toDianTaxLevelCode('O-13;O-47')).toBe('O-13;O-47');
    expect(toDianTaxLevelCode('R-99-PN')).toBe('R-99-PN');
  });

  it('descarta los códigos del RUT que NO están en la lista', () => {
    // Casilla 53 del RUT de Quickss. Ninguno pertenece a la enumeración de
    // TaxLevelCode: declararlos produjo FAJ26 «Responsabilidad informada por
    // emisor no valida según lista».
    expect(toDianTaxLevelCode('O-05')).toBe('R-99-PN');
    expect(toDianTaxLevelCode('O-05;O-07;O-14;O-42;O-48')).toBe('R-99-PN');
  });

  it('conserva solo la intersección cuando la cadena mezcla ambos catálogos', () => {
    expect(toDianTaxLevelCode('O-05;O-13;O-48')).toBe('O-13');
  });

  it('cae a R-99-PN ante vacío, nulo o basura', () => {
    expect(toDianTaxLevelCode('')).toBe('R-99-PN');
    expect(toDianTaxLevelCode(null)).toBe('R-99-PN');
    expect(toDianTaxLevelCode('COMUN')).toBe('R-99-PN');
  });

  it('tolera espacios alrededor de los códigos', () => {
    expect(toDianTaxLevelCode(' O-13 ; O-47 ')).toBe('O-13;O-47');
  });
});

describe('Step D.1 — Blindaje UBL 2.1 e invariante de cortafuegos de responsabilidades', () => {
  function createDoc(): any {
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

  function serializeIssuer(tax_scheme: string): string {
    const root = createDoc();
    const issuer: DianIssuerData = {
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
      tax_scheme,
    };
    UblCommonBuilder.buildSupplierParty(root, issuer);
    return root.end({ prettyPrint: true });
  }

  function serializeCustomer(tax_responsibilities: string[]): string {
    const root = createDoc();
    const customer: DianCustomerData = {
      document_type: 'CC',
      document_number: '12345678',
      verification_digit: null,
      legal_name: null,
      tax_responsibilities,
      person_type: 'NATURAL',
      ciiu_code: null,
    };
    UblCommonBuilder.buildCustomerParty(root, customer);
    return root.end({ prettyPrint: true });
  }

  it('emisor con ["O-05","O-16","O-52"] genera TaxLevelCode>R-99-PN', () => {
    const xml = serializeIssuer('O-05;O-16;O-52');
    expect(xml).toMatch(/<cbc:TaxLevelCode[^>]*>R-99-PN<\/cbc:TaxLevelCode>/);
  });

  it('emisor con ["O-05","O-13","O-48","O-52"] genera TaxLevelCode>O-13', () => {
    const xml = serializeIssuer('O-05;O-13;O-48;O-52');
    expect(xml).toMatch(/<cbc:TaxLevelCode[^>]*>O-13<\/cbc:TaxLevelCode>/);
  });

  it('cliente con ["O-05","O-23","O-55"] genera TaxLevelCode>O-23', () => {
    const xml = serializeCustomer(['O-05', 'O-23', 'O-55']);
    expect(xml).toMatch(/<cbc:TaxLevelCode[^>]*>O-23<\/cbc:TaxLevelCode>/);
  });

  it('resolveTaxCodeFromTax permanece intacto mapeando tax_type IVA a código DIAN 01', () => {
    const taxProbe = {
      tax_type: 'IVA',
      tax_name: 'IVA',
      tax_rate: '19.00',
      taxable_amount: '1000.00',
      tax_amount: '190.00',
    };
    const code = UblCommonBuilder.resolveTaxCodeFromTax(taxProbe as any);
    expect(code).toBe('01');
  });
});

/**
 * Regresión del rechazo `FAS01b` del 17/08/2026.
 *
 * `buildTaxTotals` creaba el elemento `cac:TaxTotal` ANTES del bucle que añade
 * los `cac:TaxSubtotal`. Con una lista de tributos vacía —el caso de una
 * operación EXCLUIDA de IVA— emitía un grupo huérfano: `cbc:TaxAmount` en 0.00
 * y ningún subtotal. La DIAN recompone la base gravable desde los subtotales,
 * no encuentra ninguno y rechaza.
 *
 * Su hermana `buildWithholdingTaxTotal` sí tenía la guarda. La asimetría entre
 * las dos era el defecto.
 */
describe('UblCommonBuilder.buildTaxTotals — grupo vacío (FAS01b)', () => {
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

  function build(taxes: any[]): string {
    const doc = createRoot();
    UblCommonBuilder.buildTaxTotals(doc, taxes as any, 'COP');
    return doc.end({ prettyPrint: false });
  }

  function countTag(xml: string, tag: string): number {
    return xml.split(`<${tag}`).length - 1;
  }

  it('no emite NINGÚN cac:TaxTotal cuando el documento no tiene tributos', () => {
    const xml = build([]);

    expect(countTag(xml, 'cac:TaxTotal')).toBe(0);
    expect(xml).not.toContain('cbc:TaxAmount');
  });

  it('tampoco lo emite si la lista llega nula o indefinida', () => {
    expect(countTag(build(null as any), 'cac:TaxTotal')).toBe(0);
    expect(countTag(build(undefined as any), 'cac:TaxTotal')).toBe(0);
  });

  it('un EXENTO sí informa su grupo: tarifa 0.00 con subtotal, que no es lo mismo que excluido', () => {
    // Art. 477 ET: gravado a tarifa cero. Informa `cac:TaxSubtotal` y aporta
    // base gravable. La señal de «no informar» es la lista vacía, nunca el
    // importe en cero.
    const xml = build([
      {
        tax_name: 'IVA',
        tax_rate: '0.00',
        taxable_amount: '69900.00',
        tax_amount: '0.00',
      },
    ]);

    expect(countTag(xml, 'cac:TaxTotal')).toBe(1);
    expect(countTag(xml, 'cac:TaxSubtotal')).toBe(1);
    expect(xml).toContain('<cbc:TaxableAmount currencyID="COP">69900.00</cbc:TaxableAmount>');
    expect(xml).toContain('<cbc:Percent>0.00</cbc:Percent>');
  });

  it('con tributos sigue emitiendo el grupo completo, sin cambios', () => {
    const xml = build([
      {
        tax_name: 'IVA',
        tax_rate: '19.00',
        taxable_amount: '1000.00',
        tax_amount: '190.00',
      },
    ]);

    expect(countTag(xml, 'cac:TaxTotal')).toBe(1);
    expect(countTag(xml, 'cac:TaxSubtotal')).toBe(1);
    expect(xml).toContain('<cbc:TaxAmount currencyID="COP">190.00</cbc:TaxAmount>');
  });
});


/**
 * `cac:PartyTaxScheme/cac:TaxScheme` del EMISOR — tabla 13.2.6.2 del anexo
 * técnico FEV 1.9, que NO es la tabla 13.2.2 de tributos de línea.
 *
 * Cuatro valores y sólo cuatro: `01` IVA, `04` INC, `ZA` IVA e INC, `ZZ` No
 * aplica. Hasta el 2026-09-22 el constructor emitía dos (`01` o `ZZ`) desde un
 * booleano — `issuer.tax_regime !== '49'` — de modo que un contribuyente
 * responsable Únicamente de INC no tenía forma de declararse: salía como IVA.
 *
 * `ZA` existe sólo en esta tabla. Buscarlo en `DIAN_TAX_TABLE` no lo encuentra,
 * y eso es correcto: como tributo de línea no existe.
 */
describe('resolveDianPartyTaxScheme — las cuatro combinaciones (13.2.6.2)', () => {
  it('IVA + INC ⇒ ZA / IVA e INC', () => {
    expect(
      resolveDianPartyTaxScheme({ vat_responsible: true, inc_responsible: true }),
    ).toEqual({ id: 'ZA', name: 'IVA e INC' });
  });

  it('sólo IVA ⇒ 01 / IVA', () => {
    expect(
      resolveDianPartyTaxScheme({ vat_responsible: true, inc_responsible: false }),
    ).toEqual({ id: '01', name: 'IVA' });
  });

  it('sólo INC ⇒ 04 / INC', () => {
    expect(
      resolveDianPartyTaxScheme({ vat_responsible: false, inc_responsible: true }),
    ).toEqual({ id: '04', name: 'INC' });
  });

  it('ninguno ⇒ ZZ / No aplica', () => {
    expect(
      resolveDianPartyTaxScheme({ vat_responsible: false, inc_responsible: false }),
    ).toEqual({ id: 'ZZ', name: 'No aplica' });
  });

  it('banderas ausentes se leen como false, nunca como responsabilidad', () => {
    // Un emisor a medio construir no puede terminar afirmando un tributo.
    expect(resolveDianPartyTaxScheme({})).toEqual(
      DIAN_PARTY_TAX_SCHEMES.NOT_APPLICABLE,
    );
    expect(
      resolveDianPartyTaxScheme({
        vat_responsible: undefined,
        inc_responsible: undefined,
      }),
    ).toEqual(DIAN_PARTY_TAX_SCHEMES.NOT_APPLICABLE);
  });

  it('el cbc:Name acompaña al cbc:ID — el par no se puede separar', () => {
    expect(DIAN_PARTY_TAX_SCHEMES.IVA).toEqual({ id: '01', name: 'IVA' });
    expect(DIAN_PARTY_TAX_SCHEMES.INC).toEqual({ id: '04', name: 'INC' });
    expect(DIAN_PARTY_TAX_SCHEMES.IVA_AND_INC).toEqual({ id: 'ZA', name: 'IVA e INC' });
    expect(DIAN_PARTY_TAX_SCHEMES.NOT_APPLICABLE).toEqual({ id: 'ZZ', name: 'No aplica' });
  });
});

describe('buildSupplierParty — esquema tributario del emisor en el XML', () => {
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

  function issuer(overrides: Partial<DianIssuerData>): DianIssuerData {
    return {
      document_type: '31',
      nit: '901234567',
      nit_dv: '1',
      legal_name: 'Restaurante Pollo Árabe S.A.S.',
      address_line: 'Calle 10 # 5-20',
      city_code: '11001',
      city_name: 'Bogota',
      department_code: '11',
      department_name: 'Bogota',
      country_code: 'CO',
      email: 'facturacion@polloarabe.test',
      tax_regime: '49',
      tax_scheme: 'R-99-PN',
      ...overrides,
    };
  }

  function schemeOf(data: DianIssuerData): { id: string; name: string } {
    const root = createRoot();
    UblCommonBuilder.buildSupplierParty(root, data);
    const xml: string = root.end({ prettyPrint: true });
    // El emisor tiene UN solo cac:PartyTaxScheme, así que el primer
    // cac:TaxScheme del fragmento es el suyo.
    const match = xml.match(
      /<cac:TaxScheme>\s*<cbc:ID>([^<]*)<\/cbc:ID>\s*<cbc:Name>([^<]*)<\/cbc:Name>/,
    );
    if (!match) throw new Error('El emisor no emitió cac:TaxScheme:\n' + xml);
    return { id: match[1], name: match[2] };
  }

  it('POLLO ÁRABE — casilla 53 sin O-48 y con O-33 declara 04 / INC', () => {
    // El defecto en producción: este emisor salía firmado como '01 / IVA'.
    expect(
      schemeOf(
        issuer({
          party_tax_scheme: { id: '04', name: 'INC' },
          tax_scheme: 'O-05;O-07;O-14;O-33;O-42;O-52;O-55',
        }),
      ),
    ).toEqual({ id: '04', name: 'INC' });
  });

  it('deriva el esquema de la casilla 53 cuando el emisor no lo trae resuelto', () => {
    // Ruta del emisor construido a mano (p. ej. el vendedor sintético del
    // documento soporte), que no pasa por projectTenantIdentityToDian. Debe
    // llegar al MISMO valor, o los dos caminos declararían cosas distintas.
    // `tax_regime '49'` es lo que esa proyección emite para este RUT.
    expect(
      schemeOf(
        issuer({ tax_scheme: 'O-05;O-07;O-14;O-33;O-42;O-52;O-55', tax_regime: '49' }),
      ),
    ).toEqual({ id: '04', name: 'INC' });
  });

  it("tax_regime '48' es afirmación de IVA que la lista no revoca — suma, no resta", () => {
    // El eje IVA es un OR. Un emisor armado a mano puede traer en `tax_scheme`
    // una responsabilidad SUELTA que no es la casilla 53 completa; leerla como
    // completa degradaría a un responsable de IVA real. Con O-33 presente el
    // resultado correcto es ZA (los dos tributos), nunca sólo INC.
    expect(schemeOf(issuer({ tax_scheme: 'O-33', tax_regime: '48' }))).toEqual({
      id: 'ZA',
      name: 'IVA e INC',
    });
    // Y una responsabilidad suelta sin relación con el IVA no lo revoca.
    expect(schemeOf(issuer({ tax_scheme: 'O-15', tax_regime: '48' }))).toEqual({
      id: '01',
      name: 'IVA',
    });
  });

  it('FRANQUICIA — O-48 sin O-33 declara 01 / IVA', () => {
    expect(schemeOf(issuer({ tax_scheme: 'O-13;O-48', tax_regime: '48' }))).toEqual({
      id: '01',
      name: 'IVA',
    });
  });

  it('MIXTO — O-48 y O-33 declaran ZA / IVA e INC', () => {
    expect(schemeOf(issuer({ tax_scheme: 'O-33;O-48', tax_regime: '48' }))).toEqual({
      id: 'ZA',
      name: 'IVA e INC',
    });
  });

  it('NINGUNO — R-99-PN declara ZZ / No aplica', () => {
    expect(schemeOf(issuer({ tax_scheme: 'R-99-PN', tax_regime: '49' }))).toEqual({
      id: 'ZZ',
      name: 'No aplica',
    });
  });

  it('sin casilla 53, el tax_regime 48 sigue siendo el respaldo (sin regresión)', () => {
    // Emisores viejos que sólo transportan el booleano colapsado no pueden
    // dejar de declarar IVA de un día para otro.
    expect(schemeOf(issuer({ tax_scheme: '', tax_regime: '48' }))).toEqual({
      id: '01',
      name: 'IVA',
    });
    expect(schemeOf(issuer({ tax_scheme: '', tax_regime: '49' }))).toEqual({
      id: 'ZZ',
      name: 'No aplica',
    });
  });

  it('party_tax_scheme precomputado gana a cualquier derivación', () => {
    // Es el valor que resolvió projectTenantIdentityToDian sobre la identidad
    // completa; el constructor no debe recalcularlo con menos información.
    expect(
      schemeOf(
        issuer({
          party_tax_scheme: { id: 'ZA', name: 'IVA e INC' },
          tax_scheme: 'R-99-PN',
          tax_regime: '49',
        }),
      ),
    ).toEqual({ id: 'ZA', name: 'IVA e INC' });
  });
});

describe('toDianTaxLevelCode — tope de 30 caracteres', () => {
  it('la unión completa de la enumeración cabe en el tope', () => {
    // 'O-13;O-15;O-23;O-47;R-99-PN' = 27. El margen es de TRES caracteres: la
    // guardia existe porque este holgura es accidental, no garantizada.
    const all = Object.values(DIAN_TAX_LEVEL_CODES).join(';');

    expect(all.length).toBeLessThanOrEqual(DIAN_TAX_LEVEL_CODE_MAX_LENGTH);
    expect(toDianTaxLevelCode(all).length).toBeLessThanOrEqual(
      DIAN_TAX_LEVEL_CODE_MAX_LENGTH,
    );
  });

  it('la casilla 53 de 34 caracteres que motivó la guardia sale dentro del tope', () => {
    const raw = 'O-05;O-07;O-14;O-33;O-42;O-52;O-55';
    expect(raw.length).toBeGreaterThan(DIAN_TAX_LEVEL_CODE_MAX_LENGTH);

    const emitted = toDianTaxLevelCode(raw);

    // Hoy sobrevive porque el filtro la recorta a nada, no porque alguien la
    // midiera. Si mañana tres de esos códigos entraran a la enumeración, el
    // recorte dejaría de salvar el documento.
    expect(emitted).toBe('R-99-PN');
    expect(emitted.length).toBeLessThanOrEqual(DIAN_TAX_LEVEL_CODE_MAX_LENGTH);
  });
});
