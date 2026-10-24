import { InvoicingService } from './invoicing.service';
import { InvoicingController } from './invoicing.controller';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

const KEY = '3dd5fe96-659c-4ef7-b489-753007e411ca';

describe('Facturación manual — idempotencia de creación', () => {
  let service: InvoicingService;
  let findFirst: jest.Mock;
  let create: jest.SpyInstance;
  const invoice = { id: 91, status: 'accepted', transmission_status: 'accepted' };
  beforeEach(() => {
    service = Object.create(InvoicingService.prototype);
    findFirst = jest.fn().mockResolvedValue(null);
    const tx = { invoices: { findFirst }, $executeRawUnsafe: jest.fn().mockResolvedValue(1) };
    Object.assign(service, {
      prisma: { invoices: { findFirst }, $transaction: jest.fn(async (fn) => fn(tx)) },
      event_emitter: { emit: jest.fn() },
    });
    jest.spyOn(service as any, 'getContext').mockReturnValue({ store_id: 7, organization_id: 3 });
    create = jest.spyOn(service, 'create').mockResolvedValue(invoice as any);
  });
  afterEach(() => jest.restoreAllMocks());

  it('un reintento recupera la misma factura ANTES de numerar o validar otra vez', async () => {
    findFirst.mockResolvedValue(invoice);
    const result = await service.createIdempotently({ client_request_id: KEY } as any);
    expect(result).toEqual({ invoice, replayed: true });
    expect(create).not.toHaveBeenCalled();
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { store_id: 7, organization_id: 3, client_request_id: KEY },
    }));
  });

  it('primera petición persiste la clave normalizada con el mismo borrador', async () => {
    const result = await service.createIdempotently({ client_request_id: KEY.toUpperCase() } as any);
    expect(result.replayed).toBe(false);
    expect(create).toHaveBeenCalledWith({ client_request_id: KEY }, expect.objectContaining({
      transaction: expect.objectContaining({ $executeRawUnsafe: expect.any(Function) }),
      defer_created_event: true,
    }));
    expect((service as any).event_emitter.emit).toHaveBeenCalledTimes(1);
  });

  it('dos POST concurrentes: el perdedor del índice único recupera el ganador', async () => {
    findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce(invoice);
    create.mockRejectedValue({ code: 'P2002', meta: { target: ['store_id', 'client_request_id'] } });
    await expect(service.createIdempotently({ client_request_id: KEY } as any))
      .resolves.toEqual({ invoice, replayed: true });
  });

  it('no oculta otra colisión ni un fallo de DB sin factura para esa clave', async () => {
    const error = { code: 'P2002' };
    create.mockRejectedValue(error);
    await expect(service.createIdempotently({ client_request_id: KEY } as any)).rejects.toBe(error);
    create.mockRejectedValue(new Error('DB unavailable'));
    await expect(service.createIdempotently({ client_request_id: KEY } as any)).rejects.toThrow('DB unavailable');
  });

  it('el re-chequeo bajo lock gana antes del cliente inline y de consumir otro consecutivo', async () => {
    findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(invoice);
    await expect(service.createIdempotently({ client_request_id: KEY } as any)).resolves.toEqual({ invoice, replayed: true });
    expect(create).not.toHaveBeenCalled();
    expect((service as any).event_emitter.emit).not.toHaveBeenCalled();
  });

  it('P2002 de otra restricción no se transforma en replay aunque aparezca otra factura', async () => {
    findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValue(invoice);
    const error = { code: 'P2002', meta: { target: ['invoice_id', 'concept_id'] } };
    create.mockRejectedValue(error);
    await expect(service.createIdempotently({ client_request_id: KEY } as any)).rejects.toBe(error);
    expect(findFirst).toHaveBeenCalledTimes(2);
    expect((service as any).event_emitter.emit).not.toHaveBeenCalled();
  });

  it('publica invoice.created sólo DESPUÉS de confirmar la transacción', async () => {
    let committed = false;
    const prisma = (service as any).prisma;
    prisma.$transaction.mockImplementation(async (fn: any) => {
      const result = await fn({ invoices: { findFirst }, $executeRawUnsafe: jest.fn() });
      expect((service as any).event_emitter.emit).not.toHaveBeenCalled();
      committed = true;
      return result;
    });
    (service as any).event_emitter.emit.mockImplementation(() => expect(committed).toBe(true));
    await service.createIdempotently({ client_request_id: KEY } as any);
    expect(committed).toBe(true);
  });

  it('sin clave conserva compatibilidad y no consulta con undefined', async () => {
    await expect(service.createIdempotently({} as any)).resolves.toEqual({ invoice, replayed: false });
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('controller NO reenvía a DIAN al recuperar una factura aceptada o todavía en vuelo', async () => {
    const emitCreated = jest.fn();
    const controller = new InvoicingController(
      { createIdempotently: jest.fn().mockResolvedValue({ invoice, replayed: true }) } as any,
      {} as any, {} as any, {} as any, {} as any,
      { success: (data: unknown) => data } as any, {} as any, { emitCreated } as any,
    );
    const result = await controller.create({ client_request_id: KEY, emit_immediately: true } as any);
    expect(result).toEqual({ ...invoice, idempotency_replayed: true });
    expect(emitCreated).not.toHaveBeenCalled();
  });
});

describe('CreateInvoiceDto — clave de reintento', () => {
  it.each([[KEY, false], ['no-es-uuid', true], [undefined, false]])('valida client_request_id=%s', (key, invalid) => {
    const dto = plainToInstance(CreateInvoiceDto, { client_request_id: key });
    const errors = validateSync(dto).filter((error) => error.property === 'client_request_id');
    expect(errors.length > 0).toBe(invalid);
  });
});
