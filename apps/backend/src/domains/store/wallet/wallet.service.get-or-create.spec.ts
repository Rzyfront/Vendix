import { Prisma } from '@prisma/client';
import { WalletService } from './wallet.service';
import { RequestContextService } from '../../../common/context/request-context.service';

/**
 * El perfil del cliente pide saldo e historial en paralelo: si el cliente aún no
 * tiene billetera, las dos peticiones intentan crearla. La que pierde choca con
 * el único (store_id, customer_id) y debe devolver la billetera ya creada, no 500.
 */
describe('WalletService.getOrCreateWallet', () => {
  const WALLET = { id: 21, customer_id: 3667, store_id: 1, organization_id: 1 };

  const setup = () => {
    const prisma = {
      wallets: { findFirst: jest.fn(), create: jest.fn() },
    };
    const service = new WalletService(
      prisma as any,
      {} as any,
      { emit: jest.fn() } as any,
      {} as any,
      {} as any,
    );
    return { prisma, service };
  };

  const uniqueViolation = () =>
    new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on the constraint: `wallets_store_id_customer_id_key`',
      { code: 'P2002', clientVersion: 'test' },
    );

  beforeEach(() => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: 1, organization_id: 1 } as never);
  });
  afterEach(() => jest.restoreAllMocks());

  it('devuelve la billetera existente sin crear', async () => {
    const { prisma, service } = setup();
    prisma.wallets.findFirst.mockResolvedValue(WALLET);
    await expect(service.getOrCreateWallet(3667)).resolves.toBe(WALLET);
    expect(prisma.wallets.create).not.toHaveBeenCalled();
  });

  it('crea la billetera en cero si no existe', async () => {
    const { prisma, service } = setup();
    prisma.wallets.findFirst.mockResolvedValue(null);
    prisma.wallets.create.mockResolvedValue(WALLET);
    await expect(service.getOrCreateWallet(3667)).resolves.toBe(WALLET);
    expect(prisma.wallets.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        customer_id: 3667,
        organization_id: 1,
        balance: 0,
        held_balance: 0,
      }),
    });
  });

  it('carrera: si otra petición la creó primero (P2002), devuelve esa billetera', async () => {
    const { prisma, service } = setup();
    prisma.wallets.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(WALLET);
    prisma.wallets.create.mockRejectedValue(uniqueViolation());
    await expect(service.getOrCreateWallet(3667)).resolves.toBe(WALLET);
    expect(prisma.wallets.findFirst).toHaveBeenCalledTimes(2);
    expect(prisma.wallets.findFirst).toHaveBeenNthCalledWith(2, {
      where: { customer_id: 3667 },
    });
  });

  it('dos peticiones simultáneas resuelven la misma billetera', async () => {
    const { prisma, service } = setup();
    let created = false;
    prisma.wallets.findFirst.mockImplementation(async () =>
      created ? WALLET : null,
    );
    prisma.wallets.create.mockImplementation(async () => {
      if (created) throw uniqueViolation();
      created = true;
      return WALLET;
    });
    const [a, b] = await Promise.all([
      service.getOrCreateWallet(3667),
      service.getOrCreateWallet(3667),
    ]);
    expect(a).toBe(WALLET);
    expect(b).toBe(WALLET);
  });

  it('otros errores de Prisma se propagan', async () => {
    const { prisma, service } = setup();
    prisma.wallets.findFirst.mockResolvedValue(null);
    const fk = new Prisma.PrismaClientKnownRequestError('FK', {
      code: 'P2003',
      clientVersion: 'test',
    });
    prisma.wallets.create.mockRejectedValue(fk);
    await expect(service.getOrCreateWallet(3667)).rejects.toBe(fk);
  });

  it('P2002 sin billetera visible después se propaga (no se traga el error)', async () => {
    const { prisma, service } = setup();
    prisma.wallets.findFirst.mockResolvedValue(null);
    const err = uniqueViolation();
    prisma.wallets.create.mockRejectedValue(err);
    await expect(service.getOrCreateWallet(3667)).rejects.toBe(err);
  });
});
