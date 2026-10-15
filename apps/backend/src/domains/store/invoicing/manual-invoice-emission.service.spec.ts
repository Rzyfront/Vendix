import { BadRequestException } from '@nestjs/common';
import { ErrorCodes, VendixHttpException } from '../../../common/errors';
import { InvoicingController } from './invoicing.controller';
import { ManualInvoiceEmissionService } from './manual-invoice-emission.service';

/**
 * `POST /store/invoicing` con `emit_immediately` (creación manual + emisión).
 *
 * Se fija:
 *   - sin el flag (o con `false`) no se emite y la respuesta es la de siempre;
 *   - con el flag se reusan `InvoiceFlowService.validate` + `send` (los
 *     botones «Validar» y «Enviar» del detalle), en ese orden;
 *   - un fallo de emisión —tipado o genérico— NUNCA lanza: la factura vuelve
 *     releída, con `emission.success=false` y el error visible.
 */
describe('ManualInvoiceEmissionService.emitCreated', () => {
  const DRAFT = { id: 41, status: 'draft', invoice_number: 'FE-10' };

  let validate: jest.Mock;
  let send: jest.Mock;
  let findOne: jest.Mock;
  let service: ManualInvoiceEmissionService;

  beforeEach(() => {
    validate = jest.fn().mockResolvedValue({ ...DRAFT, status: 'validated' });
    send = jest.fn().mockResolvedValue({ ...DRAFT, status: 'accepted', cufe: 'abc' });
    findOne = jest.fn();
    service = new ManualInvoiceEmissionService(
      { findOne } as any,
      { validate, send } as any,
    );
  });

  it('emisión OK: valida, envía y devuelve la factura emitida', async () => {
    const { invoice, emission } = await service.emitCreated(DRAFT);

    expect(validate).toHaveBeenCalledWith(41);
    expect(send).toHaveBeenCalledWith(41);
    expect(validate.mock.invocationCallOrder[0]).toBeLessThan(
      send.mock.invocationCallOrder[0],
    );
    expect(invoice).toMatchObject({ id: 41, status: 'accepted', cufe: 'abc' });
    expect(emission).toEqual({
      attempted: true,
      success: true,
      phase: null,
      status: 'accepted',
      error_code: null,
      message: null,
      http_status: null,
      details: null,
    });
    expect(findOne).not.toHaveBeenCalled();
  });

  it('una factura que ya nace validated no se re-valida', async () => {
    await service.emitCreated({ ...DRAFT, status: 'validated' });
    expect(validate).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(41);
  });

  it('validate lanza VendixHttpException → no envía, queda en borrador con el error', async () => {
    validate.mockRejectedValue(
      new VendixHttpException(
        ErrorCodes.INVOICING_VALIDATE_001,
        'No se puede validar el documento: falta el NIT.',
        { blockers: [{ field: 'customer_tax_id' }] },
      ),
    );
    findOne.mockResolvedValue({ ...DRAFT, retry_eligible: false });

    const { invoice, emission } = await service.emitCreated(DRAFT);

    expect(send).not.toHaveBeenCalled();
    expect(findOne).toHaveBeenCalledWith(41);
    expect(invoice).toMatchObject({ id: 41, status: 'draft' });
    expect(emission).toEqual({
      attempted: true,
      success: false,
      phase: 'validate',
      status: 'draft',
      error_code: ErrorCodes.INVOICING_VALIDATE_001.code,
      message: 'No se puede validar el documento: falta el NIT.',
      http_status: ErrorCodes.INVOICING_VALIDATE_001.httpStatus,
      details: { blockers: [{ field: 'customer_tax_id' }] },
    });
  });

  it('rechazo DIAN en send → no lanza, devuelve la factura rejected releída', async () => {
    send.mockRejectedValue(
      new VendixHttpException(
        ErrorCodes.INVOICING_PROVIDER_004,
        'La DIAN rechazó el documento — FAD06: ClTec inválida',
        { invoice_id: 41, dian_errors: [{ code: 'FAD06' }] },
      ),
    );
    findOne.mockResolvedValue({ ...DRAFT, status: 'rejected' });

    const { invoice, emission } = await service.emitCreated(DRAFT);

    expect(invoice).toMatchObject({ id: 41, status: 'rejected' });
    expect(emission).toMatchObject({
      success: false,
      phase: 'send',
      status: 'rejected',
      error_code: 'INVOICING_PROVIDER_004',
      http_status: 422,
      details: { invoice_id: 41, dian_errors: [{ code: 'FAD06' }] },
    });
  });

  it('timeout / transporte en send → queda validated con retry visible', async () => {
    send.mockRejectedValue(
      new VendixHttpException(ErrorCodes.INVOICING_PROVIDER_001, 'La DIAN no respondió (timeout)', {
        invoice_id: 41,
        retry_scheduled: true,
      }),
    );
    findOne.mockResolvedValue({ ...DRAFT, status: 'validated', send_status: 'sent_error' });

    const { invoice, emission } = await service.emitCreated(DRAFT);

    expect(invoice).toMatchObject({ status: 'validated', send_status: 'sent_error' });
    expect(emission).toMatchObject({
      success: false,
      phase: 'send',
      status: 'validated',
      error_code: 'INVOICING_PROVIDER_001',
      details: { retry_scheduled: true },
    });
  });

  it('error genérico → no lanza, SYS_INTERNAL_001 sin filtrar el mensaje crudo', async () => {
    send.mockRejectedValue(new Error('connection terminated: SELECT * FROM invoices'));
    findOne.mockResolvedValue({ ...DRAFT, status: 'validated' });

    const { invoice, emission } = await service.emitCreated(DRAFT);

    expect(invoice).toMatchObject({ id: 41, status: 'validated' });
    expect(emission.success).toBe(false);
    expect(emission.phase).toBe('send');
    expect(emission.error_code).toBe('SYS_INTERNAL_001');
    expect(emission.http_status).toBe(500);
    expect(emission.message).not.toContain('SELECT');
    expect(emission.message).toContain('quedó creada');
  });

  it('HttpException de Nest sin error_code → mensaje y status visibles', async () => {
    validate.mockRejectedValue(new BadRequestException(['a inválido', 'b inválido']));
    findOne.mockResolvedValue(DRAFT);

    const { emission } = await service.emitCreated(DRAFT);

    expect(emission).toMatchObject({
      success: false,
      phase: 'validate',
      error_code: 'SYS_VALIDATION_001',
      message: 'a inválido; b inválido',
      http_status: 400,
    });
  });

  it('si la relectura falla, devuelve la factura de la creación y no lanza', async () => {
    validate.mockRejectedValue(new Error('boom'));
    findOne.mockRejectedValue(new Error('db down'));

    const { invoice, emission } = await service.emitCreated(DRAFT);

    expect(invoice).toBe(DRAFT);
    expect(emission.status).toBe('draft');
    expect(emission.success).toBe(false);
  });
});

describe('InvoicingController.create — emit_immediately', () => {
  const CREATED = { id: 7, status: 'draft', invoice_number: 'FE-1' };

  const build = (invoicing: any, manual: any) =>
    new InvoicingController(
      invoicing,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { success: jest.fn((data, message) => ({ success: true, data, message })) } as any,
      {} as any,
      manual,
    );

  it('sin el flag: no emite y la respuesta es idéntica a la de siempre', async () => {
    const invoicing = { create: jest.fn().mockResolvedValue(CREATED) };
    const manual = { emitCreated: jest.fn() };

    const res = await build(invoicing, manual).create({ invoice_type: 'sales_invoice' } as any);

    expect(manual.emitCreated).not.toHaveBeenCalled();
    expect(res).toEqual({
      success: true,
      data: CREATED,
      message: 'Invoice created successfully',
    });
    expect((res as any).data).not.toHaveProperty('emission');
  });

  it('con emit_immediately=false: tampoco emite', async () => {
    const invoicing = { create: jest.fn().mockResolvedValue(CREATED) };
    const manual = { emitCreated: jest.fn() };

    await build(invoicing, manual).create({ emit_immediately: false } as any);

    expect(manual.emitCreated).not.toHaveBeenCalled();
  });

  it('con el flag y emisión OK: devuelve la factura emitida + emission.success', async () => {
    const invoicing = { create: jest.fn().mockResolvedValue(CREATED) };
    const emission = { attempted: true, success: true, status: 'accepted' };
    const manual = {
      emitCreated: jest
        .fn()
        .mockResolvedValue({ invoice: { ...CREATED, status: 'accepted' }, emission }),
    };
    const dto = { invoice_type: 'sales_invoice', emit_immediately: true } as any;

    const res: any = await build(invoicing, manual).create(dto);

    expect(invoicing.create).toHaveBeenCalledWith(dto, { require_acquirer_email: true });
    expect(manual.emitCreated).toHaveBeenCalledWith(CREATED);
    expect(res.data).toEqual({ ...CREATED, status: 'accepted', emission });
    expect(res.message).toBe('Invoice created and issued successfully');
  });

  it('con el flag y emisión fallida: 2xx con borrador + error, sin lanzar', async () => {
    const invoicing = { create: jest.fn().mockResolvedValue(CREATED) };
    const emission = {
      attempted: true,
      success: false,
      phase: 'validate',
      status: 'draft',
      error_code: 'INVOICING_VALIDATE_001',
    };
    const manual = {
      emitCreated: jest.fn().mockResolvedValue({ invoice: CREATED, emission }),
    };

    const res: any = await build(invoicing, manual).create({ emit_immediately: true } as any);

    expect(res.success).toBe(true);
    expect(res.data).toEqual({ ...CREATED, emission });
    expect(res.message).toBe('Invoice created; immediate emission failed');
  });

  it('end-to-end con el servicio real: VendixHttpException en send no rompe el handler', async () => {
    const invoicing = {
      create: jest.fn().mockResolvedValue(CREATED),
      findOne: jest.fn().mockResolvedValue({ ...CREATED, status: 'rejected' }),
    };
    const flow = {
      validate: jest.fn().mockResolvedValue({ ...CREATED, status: 'validated' }),
      send: jest
        .fn()
        .mockRejectedValue(new VendixHttpException(ErrorCodes.INVOICING_PROVIDER_004)),
    };
    const manual = new ManualInvoiceEmissionService(invoicing as any, flow as any);

    const res: any = await build(invoicing, manual).create({ emit_immediately: true } as any);

    expect(res.data.status).toBe('rejected');
    expect(res.data.emission).toMatchObject({
      success: false,
      phase: 'send',
      error_code: 'INVOICING_PROVIDER_004',
    });
  });
});
