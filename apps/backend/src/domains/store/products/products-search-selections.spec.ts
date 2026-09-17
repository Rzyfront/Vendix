/**
 * CP-pos-smart-search · E.4 (F-069) — Specs del endpoint CTR-por-posición.
 *
 * DTO: query_hash sha256-hex estricto, rangos, rank_mode enum, flags/layer
 * opcionales. Servicio: tenant desde contexto (nunca del body), insert
 * append-only, 404 sin tienda.
 */
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ProductsService } from './products.service';
import { LogSearchSelectionDto } from './dto/log-search-selection.dto';
import { RequestContextService } from '@common/context/request-context.service';

const QRH =
  '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';

function validDto(over: Record<string, unknown> = {}) {
  return plainToInstance(LogSearchSelectionDto, {
    query_hash: QRH,
    position: 3,
    product_id: 286,
    result_count: 87,
    rank_mode: 'ranked',
    flags: { layer: 'l2' },
    surface: 'pos_web',
    ...over,
  });
}

describe('LogSearchSelectionDto (E.4)', () => {
  it('acepta un evento válido completo', async () => {
    const errors = await validate(validDto());
    expect(errors).toHaveLength(0);
  });

  it('acepta el mínimo (sin flags ni surface)', async () => {
    const dto = plainToInstance(LogSearchSelectionDto, {
      query_hash: QRH,
      position: 1,
      product_id: 1,
      result_count: 1,
      rank_mode: 'legacy',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it.each([
    ['query_hash corto', { query_hash: 'abc' }],
    ['query_hash no-hex', { query_hash: 'z'.repeat(64) }],
    ['position 0', { position: 0 }],
    ['position > 500', { position: 501 }],
    ['product_id 0', { product_id: 0 }],
    ['result_count 0', { result_count: 0 }],
    ['rank_mode inventado', { rank_mode: 'magic' }],
    ['surface > 16', { surface: 'x'.repeat(17) }],
  ])('rechaza %s', async (_label, over) => {
    const errors = await validate(validDto(over));
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('ProductsService.logSearchSelection (E.4)', () => {
  const mockPrisma = {
    pos_search_selections: { create: jest.fn() },
  };
  let service: ProductsService;

  beforeEach(() => {
    jest.clearAllMocks();
    // El ctor real tiene 17 deps; el método bajo test solo usa prisma.
    service = new (ProductsService as any)(mockPrisma);
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: 10, user_id: 5 } as any);
    mockPrisma.pos_search_selections.create.mockResolvedValue({ id: 99 });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('inserta append-only con tenant del contexto (nunca del body)', async () => {
    const result = await service.logSearchSelection(
      validDto() as LogSearchSelectionDto,
    );

    expect(result).toEqual({ id: 99 });
    expect(mockPrisma.pos_search_selections.create).toHaveBeenCalledTimes(1);
    const data = mockPrisma.pos_search_selections.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      store_id: 10,
      user_id: 5,
      query_hash: QRH,
      position: 3,
      product_id: 286,
      result_count: 87,
      rank_mode: 'ranked',
      flags: { layer: 'l2' },
      surface: 'pos_web',
    });
  });

  it('sin flags/surface ⇒ undefined (defaults DB), user opcional', async () => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: 10 } as any);

    await service.logSearchSelection(
      plainToInstance(LogSearchSelectionDto, {
        query_hash: QRH,
        position: 1,
        product_id: 1,
        result_count: 1,
        rank_mode: 'legacy',
      }),
    );

    const data = mockPrisma.pos_search_selections.create.mock.calls[0][0].data;
    expect(data.flags).toBeUndefined();
    expect(data.surface).toBeUndefined();
    expect(data.user_id).toBeNull();
  });

  it('sin tienda: 404 AUTH_STORE_001, sin insert', async () => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({} as any);

    const err = await service
      .logSearchSelection(validDto() as LogSearchSelectionDto)
      .catch((e) => e);

    expect(err?.errorCode).toBe('AUTH_STORE_001');
    expect(mockPrisma.pos_search_selections.create).not.toHaveBeenCalled();
  });
});
