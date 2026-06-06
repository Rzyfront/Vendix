import { create } from 'xmlbuilder2';
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

  function serializeSupplierParty(issuer: DianIssuerData): string {
    const root = createRoot();
    UblCommonBuilder.buildSupplierParty(root, issuer);
    return root.end({ prettyPrint: true });
  }

  it('serializes issuer tax_regime in AdditionalAccountID and tax_scheme in TaxLevelCode', () => {
    const issuer = buildIssuer({ tax_regime: '49', tax_scheme: 'R-99-PN' });

    const xml = serializeSupplierParty(issuer);

    expect(xml).toContain('AdditionalAccountID');
    expect(xml).toMatch(/AdditionalAccountID>49</);
    expect(xml).toContain('TaxLevelCode');
    expect(xml).toContain('R-99-PN');
    expect(xml).toMatch(/TaxLevelCode[^>]*>R-99-PN</);
  });

  it('serializes a different issuer regime/scheme, proving values come from the issuer (not hardcoded)', () => {
    const issuer = buildIssuer({ tax_regime: '48', tax_scheme: 'O-15' });

    const xml = serializeSupplierParty(issuer);

    expect(xml).toMatch(/AdditionalAccountID>48</);
    expect(xml).toContain('O-15');
    expect(xml).toMatch(/TaxLevelCode[^>]*>O-15</);

    // Ensure the alternate-case values from the other test are NOT present,
    // confirming the serialized values are driven by this issuer instance.
    expect(xml).not.toContain('R-99-PN');
    expect(xml).not.toMatch(/AdditionalAccountID>49</);
  });
});
