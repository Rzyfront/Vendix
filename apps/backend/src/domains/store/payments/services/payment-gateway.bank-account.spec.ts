import { PaymentGatewayService } from './payment-gateway.service';
import { PaymentError } from '../utils';

describe('PaymentGatewayService.resolveAndValidateBankAccount (QUI-1061)', () => {
  let service: PaymentGatewayService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      bank_accounts: { findFirst: jest.fn() },
      stores: { findUnique: jest.fn() },
    };
    service = new PaymentGatewayService(
      prisma,
      {} as any,
      {} as any,
      undefined,
      undefined,
    );
  });

  it('accepts org account available in all stores for any store of the organization', async () => {
    prisma.bank_accounts.findFirst.mockResolvedValue({
      id: 1,
      organization_id: 1,
      store_id: null,
      available_in_all_stores: true,
      store_assignments: [],
      status: 'active',
      name: 'Org Global',
      bank_name: 'Bancolombia',
      account_number: '111',
      currency: 'COP',
    });
    prisma.stores.findUnique.mockResolvedValue({ organization_id: 1 });

    const resolved = await service.resolveAndValidateBankAccount(1, 20, prisma);
    expect(resolved.id).toBe(1);
  });

  it('accepts org account assigned only to Store A in Store A and rejects it in Store B', async () => {
    prisma.bank_accounts.findFirst.mockResolvedValue({
      id: 2,
      organization_id: 1,
      store_id: null,
      available_in_all_stores: false,
      store_assignments: [{ store_id: 10 }],
      status: 'active',
      name: 'Solo Sucursal A',
      bank_name: 'Bancolombia',
      account_number: '222',
      currency: 'COP',
    });
    prisma.stores.findUnique.mockResolvedValue({ organization_id: 1 });

    const okA = await service.resolveAndValidateBankAccount(2, 10, prisma);
    expect(okA.id).toBe(2);

    await expect(
      service.resolveAndValidateBankAccount(2, 20, prisma),
    ).rejects.toThrow(PaymentError);
  });

  it('rejects account from another organization even if available_in_all_stores=true', async () => {
    prisma.bank_accounts.findFirst.mockResolvedValue({
      id: 3,
      organization_id: 2,
      store_id: null,
      available_in_all_stores: true,
      store_assignments: [],
      status: 'active',
      name: 'Otra Org',
      bank_name: 'Nequi',
      account_number: '333',
      currency: 'COP',
    });
    prisma.stores.findUnique.mockResolvedValue({ organization_id: 1 });

    await expect(
      service.resolveAndValidateBankAccount(3, 10, prisma),
    ).rejects.toThrow(PaymentError);
  });
});
