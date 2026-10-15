import {
  PlatformTenantsService,
  toDianDepartmentCode,
  toDianDocumentType,
  toDianPersonType,
} from './platform-tenants.service';
import { enrichAcquirerForStandard } from './acquirer-standard';

/**
 * Precarga completa del adquiriente del riel plataforma (customers/search y
 * customers/:kind/:id): kind `customer` (platform_customers), identidad fiscal
 * de tiendas desde columnas + fiscal_data, dirección real de usuarios, y la
 * convención del emisor DIAN (person_type '1' Jurídica / '2' Natural,
 * document_type en código DIAN, tax_regime_code '48'/'49').
 */
describe('PlatformTenantsService', () => {
  const service = new PlatformTenantsService();

  const billing = {
    id: 1,
    type: 'billing',
    address_line1: 'Cra 7 # 71-21',
    address_line2: 'Of 301',
    city: 'Bogotá',
    state_province: 'Bogotá D.C.',
    municipality_code: '11001',
    phone_number: '6015551234',
  };

  describe('kind customer (platform_customers)', () => {
    const row = {
      id: 9,
      document_type: '31',
      tax_id: '900123456',
      tax_id_dv: '8',
      legal_name: 'Constructora Andina SAS',
      person_type: '1',
      tax_regime_code: '48',
      fiscal_responsibilities: ['O-13'],
      email: 'compras@andina.co',
      phone: '6015551234',
      address_line: 'Cra 7 # 71-21',
      city: 'Bogotá',
      city_code: '11001',
      department_code: '11',
    };

    it('mapea a la shape TenantSearchResult con id customer:<id>', () => {
      const r = service.customerToTenantResult(row);
      expect(r).toMatchObject({
        id: 'customer:9',
        kind: 'customer',
        tenant_id: 9,
        legal_name: 'Constructora Andina SAS',
        tax_id: '900123456',
        tax_id_dv: '8',
        document_type: '31',
        person_type: '1',
        tax_regime_code: '48',
        fiscal_responsibilities: ['O-13'],
        address: {
          line: 'Cra 7 # 71-21',
          city: 'Bogotá',
          city_code: '11001',
          department_code: '11',
        },
        organization: { id: null, name: null },
        fiscal_data_complete: true,
      });
    });

    it('kind=customer busca por documento (prefijo) y razón social', async () => {
      const findMany = jest.fn().mockResolvedValue([row]);
      const res = await service.searchTenants(
        { platform_customers: { findMany } },
        { organizationId: 1, kind: 'customer', q: '900.123' },
      );
      expect(res).toHaveLength(1);
      const where = findMany.mock.calls[0][0].where;
      expect(where.OR).toEqual(
        expect.arrayContaining([
          { tax_id: { startsWith: '900123' } },
          { legal_name: { contains: '900.123', mode: 'insensitive' } },
        ]),
      );
    });

    it('sin kind mezcla las cuatro fuentes, incluido customer', async () => {
      const prisma = {
        stores: { findMany: jest.fn().mockResolvedValue([]) },
        organizations: { findMany: jest.fn().mockResolvedValue([]) },
        users: { findMany: jest.fn().mockResolvedValue([]) },
        platform_customers: { findMany: jest.fn().mockResolvedValue([row]) },
      };
      const res = await service.searchTenants(prisma, { organizationId: 1, q: 'andina' });
      expect(res.map((r) => r.kind)).toEqual(['customer']);
      expect(prisma.platform_customers.findMany).toHaveBeenCalled();
    });

    it('getTenantByKindAndId(customer) lee platform_customers', async () => {
      const findUnique = jest.fn().mockResolvedValue(row);
      const r = await service.getTenantByKindAndId(
        { platform_customers: { findUnique } },
        { organizationId: 1, kind: 'customer', id: 9 },
      );
      expect(findUnique).toHaveBeenCalledWith({ where: { id: 9 } });
      expect(r?.id).toBe('customer:9');
    });
  });

  describe('store: identidad fiscal desde columnas + fiscal_data', () => {
    const store = (over: Record<string, unknown> = {}) => ({
      id: 4,
      name: 'Tienda Demo',
      slug: 'tienda-demo',
      legal_name: 'Tienda Demo SAS',
      tax_id: '900111222',
      tax_id_dv: '3',
      nit_type: 'NIT',
      municipality_code: null,
      department_code: null,
      organization_id: 2,
      addresses: [billing],
      store_settings: {
        settings: {
          fiscal_data: {
            person_type: 'JURIDICA',
            tax_responsibilities: ['48', 'O-13'],
          },
        },
      },
      organizations: {
        id: 2,
        name: 'Org Demo',
        tax_id: '900111222',
        fiscal_scope: 'STORE',
        email: 'org@demo.co',
        fiscal_responsibilities: [],
        organization_settings: { settings: {} },
      },
      ...over,
    });

    it('llena document_type/person_type/régimen/responsabilidades en convención DIAN', () => {
      const r = service.storeToTenantResult(store());
      expect(r.document_type).toBe('31');
      expect(r.person_type).toBe('1');
      expect(r.fiscal_responsibilities).toEqual(['O-48', 'O-13']);
      expect(r.tax_regime_code).toBe('48');
      expect(r.email).toBe('org@demo.co');
      expect(r.address).toEqual({
        line: 'Cra 7 # 71-21 Of 301',
        city: expect.any(String),
        city_code: '11001',
        department_code: '11',
      });
      // Antes leía addresses.department_code (no existe) → siempre false.
      expect(r.fiscal_data_complete).toBe(true);
    });

    it('casilla 53 sin O-48 → 49 (no responsable)', () => {
      const r = service.storeToTenantResult(
        store({
          store_settings: {
            settings: { fiscal_data: { person_type: 'NATURAL', tax_responsibilities: ['R-99-PN'] } },
          },
        }),
      );
      expect(r.tax_regime_code).toBe('49');
      expect(r.person_type).toBe('2');
    });

    it('fiscal_scope ORGANIZATION: manda la identidad de la organización', () => {
      const r = service.storeToTenantResult(
        store({
          tax_id: null,
          tax_id_dv: null,
          nit_type: null,
          organizations: {
            id: 2,
            name: 'Org Demo',
            legal_name: 'Org Demo SAS',
            tax_id: '900999888',
            verification_digit: '1',
            document_type: '31',
            person_type: '1',
            tax_regime: '48',
            fiscal_responsibilities: ['O-48'],
            fiscal_scope: 'ORGANIZATION',
            email: 'org@demo.co',
            organization_settings: {
              settings: { fiscal_data: { nit_type: 'NIT', person_type: 'JURIDICA', tax_responsibilities: ['O-48'] } },
            },
          },
        }),
      );
      expect(r.tax_id).toBe('900999888');
      expect(r.legal_name).toBe('Org Demo SAS');
      expect(r.document_type).toBe('31');
      expect(r.person_type).toBe('1');
      expect(r.tax_regime_code).toBe('48');
    });

    it('una tienda con NIT propio distinto NO hereda la identidad de la organización', () => {
      const r = service.storeToTenantResult(
        store({
          tax_id: '800555444',
          nit_type: null,
          tax_id_dv: null,
          store_settings: { settings: {} },
          organizations: {
            id: 2,
            name: 'Org Demo',
            tax_id: '900111222',
            person_type: '1',
            fiscal_responsibilities: ['O-48'],
            fiscal_scope: 'STORE',
            email: 'org@demo.co',
          },
        }),
      );
      expect(r.person_type).toBeNull();
      expect(r.fiscal_responsibilities).toEqual([]);
      expect(r.tax_regime_code).toBeNull();
      expect(r.email).toBeNull();
      expect(r.fiscal_data_complete).toBe(false);
    });

    it('sin dirección: cae a las columnas de municipio de la tienda', () => {
      const r = service.storeToTenantResult(
        store({
          addresses: [],
          municipality_code: '05001',
          store_settings: {
            settings: { fiscal_data: { fiscal_address: 'Calle 10 # 1-2', person_type: 'JURIDICA', tax_responsibilities: ['O-48'] } },
          },
        }),
      );
      expect(r.address.line).toBe('Calle 10 # 1-2');
      expect(r.address.city_code).toBe('05001');
      expect(r.address.department_code).toBe('05');
    });
  });

  describe('organization', () => {
    it('fiscal_data_complete ya no depende de una columna inexistente', () => {
      const r = service.organizationToTenantResult({
        id: 2,
        name: 'Org',
        slug: 'org',
        legal_name: 'Org SAS',
        tax_id: '900111222',
        verification_digit: '3',
        document_type: '31',
        person_type: '1',
        tax_regime: '48',
        fiscal_responsibilities: ['O-48'],
        email: 'org@demo.co',
        addresses: [billing],
      });
      expect(r.address.department_code).toBe('11');
      expect(r.address.city_code).toBe('11001');
      expect(r.fiscal_data_complete).toBe(true);
    });
  });

  describe('user', () => {
    it('documento en código DIAN, dirección desde addresses.user_id y régimen derivado', () => {
      const r = service.userToTenantResult({
        id: 7,
        username: 'jperez',
        first_name: 'Juan',
        last_name: 'Pérez',
        legal_name: null,
        document_number: '1020304050',
        document_type: 'CC',
        verification_digit: null,
        person_type: null,
        tax_regime: 'SIMPLIFICADO',
        fiscal_responsibilities: [],
        email: 'juan@x.co',
        phone: null,
        organization_id: 3,
        addresses: [{ ...billing, type: 'shipping' }],
      });
      expect(r.document_type).toBe('13');
      expect(r.person_type).toBe('2');
      expect(r.tax_regime_code).toBe('49');
      expect(r.address.line).toBe('Cra 7 # 71-21 Of 301');
      expect(r.address.city_code).toBe('11001');
      expect(r.phone).toBe('6015551234');
    });

    it('JURIDICA → 1; sin régimen ni responsabilidades → tax_regime_code null', () => {
      const r = service.userToTenantResult({
        id: 8,
        username: 'acme',
        first_name: 'A',
        last_name: 'B',
        legal_name: 'Acme SAS',
        document_number: '900123456',
        document_type: 'NIT',
        verification_digit: '8',
        person_type: 'JURIDICA',
        tax_regime: null,
        fiscal_responsibilities: [],
        addresses: [],
      });
      expect(r.document_type).toBe('31');
      expect(r.person_type).toBe('1');
      expect(r.tax_regime_code).toBeNull();
      expect(r.address).toEqual({ line: null, city: null, city_code: null, department_code: null });
    });
  });

  describe('helpers', () => {
    it('toDianDocumentType', () => {
      expect(toDianDocumentType('NIT')).toBe('31');
      expect(toDianDocumentType('PA')).toBe('41');
      expect(toDianDocumentType('PP')).toBe('41');
      expect(toDianDocumentType('NIT_EXTRANJERIA')).toBe('50');
      expect(toDianDocumentType('13')).toBe('13');
      expect(toDianDocumentType('XX')).toBeNull();
      expect(toDianDocumentType(null)).toBeNull();
    });

    it('toDianPersonType', () => {
      expect(toDianPersonType('JURIDICA')).toBe('1');
      expect(toDianPersonType('natural')).toBe('2');
      expect(toDianPersonType('2')).toBe('2');
      expect(toDianPersonType('X')).toBeNull();
    });

    it('toDianDepartmentCode acepta código o nombre', () => {
      expect(toDianDepartmentCode('11')).toBe('11');
      expect(toDianDepartmentCode('5')).toBe('05');
      expect(toDianDepartmentCode('Bogotá D.C.')).toBe('11');
      expect(toDianDepartmentCode('valle del cauca')).toBe('76');
      expect(toDianDepartmentCode('Norte de Santander')).toBe('54');
      expect(toDianDepartmentCode('Santander')).toBe('68');
      expect(toDianDepartmentCode('Atlantis')).toBeNull();
    });
  });

  describe('enrichAcquirerForStandard (convención del emisor)', () => {
    it('cédula/pasaporte → Natural = 2 (AdditionalAccountID), no 1', () => {
      expect(
        enrichAcquirerForStandard({ tax_id: '1020', tax_id_dv: null, document_type: '13' })
          .person_type_resolved,
      ).toBe('2');
      expect(
        enrichAcquirerForStandard({ tax_id: 'AB12', tax_id_dv: null, document_type: '41' })
          .person_type_resolved,
      ).toBe('2');
    });

    it('NIT respeta lo registrado', () => {
      expect(
        enrichAcquirerForStandard({ tax_id: '900123456', tax_id_dv: '8', document_type: '31', person_type: '1' })
          .person_type_resolved,
      ).toBe('1');
    });

    it('municipality_complete lee address.city_code (lo que exponen los tenants)', () => {
      expect(
        enrichAcquirerForStandard({
          tax_id: '900123456',
          tax_id_dv: '8',
          document_type: '31',
          address: { line: 'x', city_code: '11001' },
        }).municipality_complete,
      ).toBe(true);
    });
  });
});
