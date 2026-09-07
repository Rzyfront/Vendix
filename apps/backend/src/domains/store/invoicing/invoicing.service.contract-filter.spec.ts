import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { InvoicingService } from './invoicing.service';
import { QueryInvoiceDto } from './dto/query-invoice.dto';

/**
 * D.2 (FB-09) — `GET /store/invoicing?contract_id=` filtra el listado por
 * contrato origen (`invoices.contract_id`, DB-05). La ficha del contrato lo
 * usa para navegar a su factura sin un endpoint dedicado.
 *
 * Dos niveles: el `where` que `findAll` manda a Prisma (mockeado, patron de
 * `invoicing.service.spec.ts`) y la validacion del DTO (400 ante id mal
 * formado, nunca 200 vacio ni 500).
 */
describe('D.2 · filtro ?contract_id= del listado de facturas', () => {
  const createService = () => {
    const prisma: any = {
      invoices: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    const retry_queue = {
      getRetryStatusByInvoiceIds: jest.fn().mockResolvedValue(new Map()),
    } as any;
    const service = new InvoicingService(
      prisma,
      {} as any,
      { emit: jest.fn() } as any,
      {} as any,
      retry_queue,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    return { service, prisma };
  };

  it('aplica where.contract_id en findMany y count cuando el query lo trae', async () => {
    const { service, prisma } = createService();

    await service.findAll({ contract_id: 5 } as QueryInvoiceDto);

    expect(prisma.invoices.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ contract_id: 5 }),
      }),
    );
    expect(prisma.invoices.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ contract_id: 5 }),
      }),
    );
  });

  it('no filtra por contrato cuando el query no lo trae', async () => {
    const { service, prisma } = createService();

    await service.findAll({} as QueryInvoiceDto);

    const where = prisma.invoices.findMany.mock.calls[0][0].where;
    expect(where).not.toHaveProperty('contract_id');
  });

  it('combina contract_id con los demas filtros sin pisarlos', async () => {
    const { service, prisma } = createService();

    await service.findAll({
      contract_id: 5,
      status: 'draft',
    } as QueryInvoiceDto);

    expect(prisma.invoices.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          contract_id: 5,
          status: 'draft',
        }),
      }),
    );
  });

  describe('validacion del DTO', () => {
    const errorsFor = (input: unknown) =>
      validate(plainToInstance(QueryInvoiceDto, input));

    it('acepta contract_id entero positivo', async () => {
      await expect(errorsFor({ contract_id: 5 })).resolves.toEqual([]);
    });

    it('transforma el query string "?contract_id=7" a numero', async () => {
      const dto = plainToInstance(QueryInvoiceDto, { contract_id: '7' });
      expect(dto.contract_id).toBe(7);
      await expect(validate(dto)).resolves.toEqual([]);
    });

    it('rechaza contract_id 0 y negativo (400, no 200 vacio)', async () => {
      for (const contract_id of [0, -3]) {
        const errors = await errorsFor({ contract_id });
        expect(errors.map((error) => error.property)).toContain(
          'contract_id',
        );
      }
    });

    it('rechaza contract_id no numerico', async () => {
      const errors = await errorsFor({ contract_id: 'abc' });
      expect(errors.map((error) => error.property)).toContain('contract_id');
    });
  });
});
