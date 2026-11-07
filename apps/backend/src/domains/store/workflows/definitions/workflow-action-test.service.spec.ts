jest.mock('../../../../messaging/messaging.service', () => ({ MessagingService: class {} }));
jest.mock('../../../../email/email.service', () => ({ EmailService: class {} }));

import { BadRequestException } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { PERMISSIONS_KEY } from '../../../auth/decorators/permissions.decorator';
import { WorkflowConnectorsService } from '../connectors/connectors.service';
import { WorkflowHttpTestService } from '../secrets/workflow-http-test.service';
import { WorkflowActionTestDto } from '../dto/workflow-action-test.dto';
import { WorkflowActionTestController } from './workflow-action-test.controller';
import { WorkflowActionTestService } from './workflow-action-test.service';

const http = { test: jest.fn() };
const connectors = { test: jest.fn() };
const service = new WorkflowActionTestService(
  http as unknown as WorkflowHttpTestService,
  connectors as unknown as WorkflowConnectorsService,
);

const as = <T>(permissions: string[], fn: () => T) =>
  RequestContextService.runIsolated(
    { store_id: 1, organization_id: 1, user_id: 7, is_super_admin: false, is_owner: false, permissions },
    fn,
  );

const dto = (body: Record<string, unknown>) => body as unknown as WorkflowActionTestDto;

describe('WorkflowActionTestService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('previews a vendix action: resolved input, nothing executed, permission granted', async () => {
    const r = await as(['store:customers:create'], () =>
      service.test(
        dto({
          action: {
            action: 'vendix.customer.create',
            map: {
              first_name: '{{fields.nombre}}',
              last_name: 'Pérez',
              email: '{{fields.correo}}',
            },
          },
          data: { nombre: 'Ana', correo: 'ana@x.co' },
        }),
      ),
    );
    expect(r).toEqual({
      mode: 'preview',
      executed: false,
      action: 'vendix.customer.create',
      label: 'Crear cliente',
      resolved_input: { first_name: 'Ana', last_name: 'Pérez', email: 'ana@x.co' },
      schema_errors: [],
      permission: { required: 'store:customers:create', granted: true },
    });
    expect(http.test).not.toHaveBeenCalled();
    expect(connectors.test).not.toHaveBeenCalled();
  });

  it('reports a missing required input and a wrongly typed one', async () => {
    const r = await as(['store:customers:create'], () =>
      service.test(
        dto({
          action: {
            action: 'vendix.customer.update',
            map: { customer_id: '{{fields.cliente}}', phone: '1', extra: 'x' },
          },
          data: { cliente: 'abc' },
        }),
      ),
    );
    expect(r.mode).toBe('preview');
    if (r.mode !== 'preview') return;
    expect(r.schema_errors).toEqual([
      { key: 'extra', label: 'extra', message: 'Este dato no existe en la acción.' },
      { key: 'customer_id', label: 'Cliente', message: 'Debe ser un número entero.' },
    ]);
    const missing = await as([], () =>
      service.test(
        dto({
          action: { action: 'vendix.customer.create', map: { first_name: '{{fields.nombre}}' } },
          data: {},
        }),
      ),
    );
    if (missing.mode !== 'preview') throw new Error('expected preview');
    expect(missing.schema_errors.map((e) => e.key)).toEqual(['first_name', 'last_name', 'email']);
  });

  it('says the permission is not granted instead of throwing', async () => {
    const r = await as(['store:workflows:design'], () =>
      service.test(
        dto({
          action: { action: 'vendix.customer.add_tag', map: { customer_id: '1', tag_id: '2' } },
        }),
      ),
    );
    if (r.mode !== 'preview') throw new Error('expected preview');
    expect(r.permission).toEqual({ required: 'store:customers:update', granted: false });
    expect(r.schema_errors).toEqual([]);
  });

  it('previews notify and set_field with the sample data', async () => {
    const notify = await service.test(
      dto({
        action: {
          action: 'notify',
          to: { kind: 'initiator' },
          message: 'Solicitud {{instance.reference}} de {{fields.nombre}}',
        },
        data: { nombre: 'Ana' },
        instance: { reference: 'COM-9' },
      }),
    );
    expect(notify).toMatchObject({
      mode: 'preview',
      executed: false,
      resolved_input: { to: 'Quien inició', message: 'Solicitud COM-9 de Ana' },
      schema_errors: [],
    });
    const set = await service.test(
      dto({ action: { action: 'set_field', field: 'estado', value: 'listo' } }),
    );
    expect(set).toMatchObject({
      mode: 'preview',
      executed: false,
      resolved_input: { field: 'estado', value: 'listo' },
    });
  });

  it('delegates HTTP to the real test service with the sample fields', async () => {
    http.test.mockResolvedValue({ ok: true, status: 200 });
    const r = await service.test(
      dto({
        action: {
          action: 'vendix.http.request',
          map: { method: 'GET', url: 'https://api.test/{{fields.id}}' },
          output: { estado: 'status' },
        },
        data: { id: '5' },
      }),
    );
    expect(http.test).toHaveBeenCalledWith({
      map: { method: 'GET', url: 'https://api.test/{{fields.id}}' },
      output: { estado: 'status' },
      sample_fields: { id: '5' },
    });
    expect(r).toMatchObject({ mode: 'http', executed: true, result: { ok: true, status: 200 } });
  });

  it('delegates WhatsApp to the connector test with the resolved map and email without a body', async () => {
    connectors.test.mockResolvedValue({ ok: true, simulated: false, message: 'ok' });
    const wa = await service.test(
      dto({
        action: {
          action: 'vendix.whatsapp.send',
          map: { to: '{{fields.tel}}', template: 'aviso', params: '{{fields.nombre}}' },
        },
        data: { tel: '3001234567', nombre: 'Ana' },
      }),
    );
    expect(connectors.test).toHaveBeenCalledWith('whatsapp', {
      to: '3001234567',
      template: 'aviso',
      language: undefined,
      params: 'Ana',
    });
    expect(wa).toMatchObject({ mode: 'connector', executed: true, connector: 'whatsapp' });
    await service.test(
      dto({ action: { action: 'vendix.email.send', map: { to: 'a@b.co', subject: 's', body: 'b' } } }),
    );
    expect(connectors.test).toHaveBeenLastCalledWith('email_out', undefined);
  });

  it('an unknown action is a 400 and nothing runs', async () => {
    await expect(
      service.test(dto({ action: { action: 'vendix.nope.nothing', map: {} } })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(http.test).not.toHaveBeenCalled();
    expect(connectors.test).not.toHaveBeenCalled();
  });
});

describe('WorkflowActionTestController', () => {
  it('requires store:workflows:design', () => {
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, WorkflowActionTestController.prototype.test),
    ).toEqual(['store:workflows:design']);
  });
});
