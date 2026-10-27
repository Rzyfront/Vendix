import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PERMISSIONS_KEY } from '../../auth/decorators/permissions.decorator';
import { UpdateTableSessionInformalNotesDto } from './dto/table-session.dto';
import { ReassignTableSessionDto } from './dto/table-session.dto';
import { STAFF_EVENT_WHITELIST, TableSessionsController } from './table-sessions.controller';

describe('staff table-session SSE whitelist', () => {
  it('forwards session_paid while retaining default-deny', () => {
    expect(STAFF_EVENT_WHITELIST('session_paid')).toBe(true);
    expect(STAFF_EVENT_WHITELIST('session_paid_extra')).toBe(false);
    expect(STAFF_EVENT_WHITELIST('payment.refunded')).toBe(false);
    expect(STAFF_EVENT_WHITELIST('unknown')).toBe(false);
  });
});

describe('POST /store/table-sessions/reassign', () => {
  it('uses an update permission, literal POST route and a created response', async () => {
    const session = { id: 77, order_id: 9001, table_id: 7 };
    const service = { reassignSessionToTable: jest.fn().mockResolvedValue(session) };
    const response = { created: jest.fn().mockReturnValue({ data: session }) };
    const controller = new TableSessionsController(
      service as any, response as any, {} as any, {} as any,
    );
    const handler = (controller as any).reassign;

    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('reassign');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual(['store:table_sessions:update']);
    await expect(handler.call(controller, { order_id: 9001, target_table_id: 7 }))
      .resolves.toEqual({ data: session });
    expect(service.reassignSessionToTable).toHaveBeenCalledWith({ order_id: 9001, target_table_id: 7 });
    expect(response.created).toHaveBeenCalledWith(session, expect.any(String));
  });

  it('rejects undeclared fields and invalid ids via the global DTO contract', () => {
    const valid = plainToInstance(ReassignTableSessionDto, { order_id: 9001, target_table_id: 7 });
    expect(validateSync(valid, { whitelist: true, forbidNonWhitelisted: true })).toHaveLength(0);
    const invalid = plainToInstance(ReassignTableSessionDto, {
      order_id: 0, target_table_id: -1, unexpected: true,
    });
    const errors = validateSync(invalid, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors.map((error) => error.property).sort()).toEqual(['order_id', 'target_table_id', 'unexpected']);
  });
});

describe('PATCH /store/table-sessions/:id/informal-notes (QUI-898)', () => {
  it('delegates to the service with id and dto.informal_notes', async () => {
    const session = { id: 83, informal_notes: 'vaso extra' };
    const service = { updateInformalNotes: jest.fn().mockResolvedValue(session) };
    const response = { updated: jest.fn().mockReturnValue({ data: session }) };
    const controller = new TableSessionsController(
      service as any, response as any, {} as any, {} as any,
    );
    const handler = (controller as any).updateInformalNotes;

    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(':id/informal-notes');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.PATCH);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual(['store:table_sessions:update']);
    await expect(
      handler.call(controller, 83, { informal_notes: 'vaso extra' }),
    ).resolves.toEqual({ data: session });
    expect(service.updateInformalNotes).toHaveBeenCalledWith(83, 'vaso extra');
    expect(response.updated).toHaveBeenCalledWith(session, 'Notas de la mesa actualizadas');
  });

  it('validates the DTO (max 2000, null allowed)', () => {
    const opts = { whitelist: true, forbidNonWhitelisted: true };
    expect(validateSync(plainToInstance(UpdateTableSessionInformalNotesDto, { informal_notes: null }), opts)).toHaveLength(0);
    expect(validateSync(plainToInstance(UpdateTableSessionInformalNotesDto, { informal_notes: 'a'.repeat(2001) }), opts)).toHaveLength(1);
  });
});
