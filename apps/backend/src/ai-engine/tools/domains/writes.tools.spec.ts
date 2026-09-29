import { createCustomerWriteTools } from './writes.tools';

/**
 * Spec de contrato (alcance: upsert_customer, fix F1 del review PR #874).
 *
 * `writes.tools.ts` es legacy sin spec completa (gap pre-existente, no de este
 * PR): este archivo pinnea únicamente la rama JURIDICA del alta —razón social
 * en vez de nombres, según JuridicaNameRule— y la regresión NATURAL. La
 * cobertura total de writes queda como follow-up.
 */
describe('writes.tools · upsert_customer JURIDICA (F1)', () => {
  const customersService = {
    findOrganizationIdByStoreForAgent: jest.fn(async () => 6),
    findUserByEmailInOrganizationForAgent: jest.fn(async () => null),
    findByDocumentInOrganization: jest.fn(async () => null),
    findOne: jest.fn(async () => null),
  } as any;

  const [tool] = createCustomerWriteTools({ customersService });
  const ctx = { store_id: 10, organization_id: 6 } as any;

  beforeEach(() => jest.clearAllMocks());

  it('crea empresa con solo legal_name (preview propone, target = razón social)', async () => {
    const preview = await tool.preview!(
      { person_type: 'JURIDICA', legal_name: 'Acerías S.A.S.' },
      ctx,
    );
    // warning (no ok) porque va sin documento: por diseño, igual que NATURAL.
    expect(preview.status).toBe('warning');
    expect(preview.target).toBe('Acerías S.A.S.');
    expect(preview.changes.map((c) => c.field)).toContain('legal_name');
    expect(preview.changes.map((c) => c.label)).toContain('Razón social');
  });

  it('JURIDICA sin legal_name falla con guía accionable (sin dead-end)', async () => {
    const preview = await tool.preview!({ person_type: 'JURIDICA' }, ctx);
    expect(preview.status).toBe('error');
    expect(preview.message).toContain('razón social');
    expect(preview.message).toContain('legal_name');
  });

  it('JURIDICA con first_name falla: uno u otro, nunca ambos', async () => {
    const preview = await tool.preview!(
      {
        person_type: 'JURIDICA',
        legal_name: 'Acerías S.A.S.',
        first_name: 'Juan',
      },
      ctx,
    );
    expect(preview.status).toBe('error');
    expect(preview.message).toContain('solo con razón social');
  });

  it('NATURAL con nombres sigue creando (regresión)', async () => {
    const preview = await tool.preview!(
      { first_name: 'Juan', last_name: 'Pérez' },
      ctx,
    );
    expect(preview.status).toBe('warning');
    expect(preview.target).toBe('Juan Pérez');
  });

  it('NATURAL sin nombres sigue fallando con guía (regresión)', async () => {
    const preview = await tool.preview!({ first_name: 'Juan' }, ctx);
    expect(preview.status).toBe('error');
    expect(preview.message).toContain('nombres y los apellidos');
  });
});
