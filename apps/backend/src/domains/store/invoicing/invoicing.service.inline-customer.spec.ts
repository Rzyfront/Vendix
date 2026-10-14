import { InvoicingService } from './invoicing.service';
import { CreateCustomerDto } from '../customers/dto/create-customer.dto';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';

/**
 * `createInlineCustomer` ya no mantiene un alta paralela: delega en
 * `CustomersService.resolveInlineCustomer` (reglas del modal de clientes +
 * reutilización por documento, ver `customers.service.inline-customer.spec.ts`).
 * Aquí se fija sólo el cableado: contexto exigido, delegación y propagación de
 * los errores 4xx tal cual.
 */
describe('InvoicingService.createInlineCustomer', () => {
  const build = (customersService: any) =>
    new InvoicingService(
      {} as any,
      {} as any,
      { emit: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      undefined,
      customersService,
    );

  const juridica = {
    document_type: 'NIT',
    document_number: '900123456',
    verification_digit: '8',
    person_type: 'JURIDICA',
    legal_name: 'Tecnicell S.A.S.',
  } as CreateCustomerDto;

  it('persona jurídica con NIT: delega en CustomersService con la tienda del contexto', async () => {
    const customersService = {
      resolveInlineCustomer: jest
        .fn()
        .mockResolvedValue({ customer_id: 99, was_created: true }),
    };
    const service = build(customersService);

    const id = await (service as any).createInlineCustomer(
      { organization_id: 3, store_id: 7 },
      juridica,
    );

    expect(id).toBe(99);
    expect(customersService.resolveInlineCustomer).toHaveBeenCalledWith(
      7,
      juridica,
    );
  });

  it('persona natural: delega igual y devuelve el id creado', async () => {
    const natural = {
      document_type: 'CC',
      document_number: '1020304050',
      first_name: 'Ana',
      last_name: 'Pérez',
    } as CreateCustomerDto;
    const customersService = {
      resolveInlineCustomer: jest
        .fn()
        .mockResolvedValue({ customer_id: 100, was_created: true }),
    };

    const id = await (build(customersService) as any).createInlineCustomer(
      { organization_id: 3, store_id: 7 },
      natural,
    );

    expect(id).toBe(100);
    expect(customersService.resolveInlineCustomer).toHaveBeenCalledWith(
      7,
      natural,
    );
  });

  it('documento duplicado: usa el cliente existente que devuelve CustomersService', async () => {
    const customersService = {
      resolveInlineCustomer: jest
        .fn()
        .mockResolvedValue({ customer_id: 41, was_created: false }),
    };

    const id = await (build(customersService) as any).createInlineCustomer(
      { organization_id: 3, store_id: 7 },
      juridica,
    );

    expect(id).toBe(41);
  });

  it('propaga el 4xx de validación sin envolverlo', async () => {
    const error = new VendixHttpException(
      ErrorCodes.CUST_VALIDATE_001,
      'La razón social es obligatoria',
    );
    const customersService = {
      resolveInlineCustomer: jest.fn().mockRejectedValue(error),
    };

    await expect(
      (build(customersService) as any).createInlineCustomer(
        { organization_id: 3, store_id: 7 },
        { document_type: 'NIT', document_number: '900123456' },
      ),
    ).rejects.toBe(error);
  });

  it('sin tienda en el contexto responde SYS_VALIDATION_001 y no delega', async () => {
    const customersService = { resolveInlineCustomer: jest.fn() };

    const promise = (build(customersService) as any).createInlineCustomer(
      { organization_id: 3 },
      juridica,
    );

    await expect(promise).rejects.toBeInstanceOf(VendixHttpException);
    await promise.catch((err: VendixHttpException) =>
      expect(err.errorCode).toBe('SYS_VALIDATION_001'),
    );
    expect(customersService.resolveInlineCustomer).not.toHaveBeenCalled();
  });
});
