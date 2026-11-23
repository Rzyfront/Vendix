import { MovementsService } from './movements.service';
import {
  createPrismaMock,
  mockRequestContext,
} from '../../../../testing/prisma-mock';
import {
  expectNoSensitiveUserFields,
  fullUserRow,
  projectUserRow,
} from '../../../../testing/user-row-fixture';

/**
 * Inventory movements (`/store/inventory/movements`) show who made each one:
 * that author carries profile columns only.
 */
describe('MovementsService — movement author with minimal user columns', () => {
  const prisma = createPrismaMock({
    inventory_movements: ['create', 'findMany', 'findUnique', 'count'],
  });
  let service: MovementsService;

  const movementWithAuthor = async (args: any) => ({
    id: 40,
    movement_type: 'stock_in',
    users: projectUserRow(fullUserRow(5), args.include.users.select),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockRequestContext({ organization_id: 1, user_id: 5 });
    prisma.inventory_movements.create.mockImplementation(movementWithAuthor);
    prisma.inventory_movements.findUnique.mockImplementation(movementWithAuthor);
    prisma.inventory_movements.findMany.mockImplementation(async (args: any) => [
      await movementWithAuthor(args),
    ]);
    prisma.inventory_movements.count.mockResolvedValue(1);
    service = new MovementsService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
    );
    jest
      .spyOn(service as any, 'updateStockLevels')
      .mockResolvedValue(undefined);
  });

  it('POST /store/inventory/movements', async () => {
    const movement = await service.create({
      product_id: 9,
      movement_type: 'stock_in',
      to_location_id: 2,
      quantity: 3,
    } as never);

    expectNoSensitiveUserFields(movement.users);
    expect(movement.users).toEqual(
      expect.objectContaining({ id: 5, first_name: 'Ana' }),
    );
  });

  it('GET /store/inventory/movements', async () => {
    const { data } = await service.findAll({} as never);

    expectNoSensitiveUserFields(data[0].users);
    expect(data[0].users).toEqual(expect.objectContaining({ id: 5 }));
  });

  it('GET /store/inventory/movements/:id', async () => {
    const movement = await service.findOne(40);

    expectNoSensitiveUserFields(movement.users);
    expect(movement.users).toEqual(expect.objectContaining({ id: 5 }));
  });
});
