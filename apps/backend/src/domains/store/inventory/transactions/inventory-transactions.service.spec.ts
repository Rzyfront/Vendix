import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { InventoryTransactionsService } from './inventory-transactions.service';

/**
 * `createTransaction` wraps write failures in a 400 with Prisma's text. A
 * transaction that expired under load (P2028) or an exhausted pool (P2024) is
 * not a bad request: it must reach the global filter untouched, which answers
 * 503 SYS_BUSY_001 ("El sistema está ocupado, intenta de nuevo en unos
 * segundos") instead of leaking "Transaction API error: …" to the user.
 */
describe('InventoryTransactionsService.createTransaction — errores de saturación', () => {
  const dto = {
    organizationId: 1,
    productId: 7,
    type: 'return',
    quantityChange: 2,
    reason: 'REUSO-INSUMO',
  } as any;

  const build = (error: unknown) => {
    const tx = {
      inventory_transactions: { create: jest.fn().mockRejectedValue(error) },
    };
    const service = new InventoryTransactionsService({} as any);
    return { service, tx };
  };

  it.each(['P2028', 'P2024'])('%s se relanza intacto para que el filtro responda 503', async (code) => {
    const busy = new Prisma.PrismaClientKnownRequestError('Transaction API error: expired', {
      code,
      clientVersion: 'test',
    });
    const { service, tx } = build(busy);

    await expect(service.createTransaction(dto, tx as any)).rejects.toBe(busy);
  });

  it('cualquier otro fallo sigue siendo 400 "Failed to create inventory transaction" (sin cambios)', async () => {
    const { service, tx } = build(new Error('boom'));

    const call = service.createTransaction(dto, tx as any);

    await expect(call).rejects.toBeInstanceOf(BadRequestException);
    await expect(call).rejects.toThrow('Failed to create inventory transaction: boom');
  });
});
