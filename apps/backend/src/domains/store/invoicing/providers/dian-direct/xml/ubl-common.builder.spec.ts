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
});
