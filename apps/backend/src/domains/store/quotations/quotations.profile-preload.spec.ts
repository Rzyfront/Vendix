import { QuotationsService } from './quotations.service';
import { RequestContextService } from '@common/context/request-context.service';

/**
 * F-003 — precarga desde el perfil con la version congelada: `profile_id`
 * persiste y los vacios se rellenan (payment_terms, notes, validity_days);
 * lo digitado manda y sin perfil nada cambia.
 */
describe('QuotationsService precarga por perfil (F-003)', () => {
  const requestContext = {
    user_id: 9,
    organization_id: 1,
    store_id: 2,
    is_super_admin: false,
    is_owner: true,
  };

  const quotationsMock = {
    findFirst: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockImplementation(({ data }: any) =>
      Promise.resolve({ id: 1, ...data }),
    ),
  };
  const profilesMock = { resolveForQuotation: jest.fn() };
  const service = new QuotationsService(
    { quotations: quotationsMock } as any,
    {} as any,
    { emit: jest.fn() } as any,
    {} as any,
    profilesMock as any,
  );

  beforeEach(() => jest.clearAllMocks());

  const baseDto = { items: [] } as any;

  it('precarga textos y vigencia, y persiste profile_id', async () => {
    profilesMock.resolveForQuotation.mockResolvedValue({
      current_config: {
        payment_terms: 'Pago 50/50',
        notes: 'Objeto obra',
        validity_days: 10,
      },
    });

    const result: any = await RequestContextService.run(requestContext, () =>
      service.create({ ...baseDto, profile_id: 4 } as any),
    );

    expect(profilesMock.resolveForQuotation).toHaveBeenCalledWith(4);
    expect(result.profile_id).toBe(4);
    expect(result.terms_and_conditions).toBe('Pago 50/50');
    expect(result.notes).toBe('Objeto obra');
    expect(result.valid_until).toBeInstanceOf(Date);
  });

  it('lo digitado manda sobre el perfil', async () => {
    profilesMock.resolveForQuotation.mockResolvedValue({
      current_config: { payment_terms: 'Pago 50/50', notes: 'Objeto obra' },
    });

    const result: any = await RequestContextService.run(requestContext, () =>
      service.create({
        ...baseDto,
        profile_id: 4,
        terms_and_conditions: 'Mias',
        notes: 'Mias',
      } as any),
    );

    expect(result.terms_and_conditions).toBe('Mias');
    expect(result.notes).toBe('Mias');
  });

  it('sin perfil no resuelve ni cambia el create actual', async () => {
    const result: any = await RequestContextService.run(requestContext, () =>
      service.create(baseDto),
    );

    expect(profilesMock.resolveForQuotation).not.toHaveBeenCalled();
    expect(result.profile_id).toBeNull();
    expect(result.valid_until).toBeNull();
  });
});
