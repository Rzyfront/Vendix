import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { IS_PUBLIC_KEY } from '../../../../common/decorators/public.decorator';
import { INDUSTRY_MODULE_KEY } from '../../../../common/decorators/industry-module.decorator';
import { IndustryModuleGuard } from '../../../../common/guards/industry-module.guard';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { PERMISSIONS_KEY } from '../../../auth/decorators/permissions.decorator';
import { WorkflowWebhooksController } from './workflow-webhooks.controller';
import { CreateWebhookDto, UpdateWebhookDto } from './workflow-webhook.dto';

const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];

describe('WorkflowWebhooksController · superficie', () => {
  const proto = WorkflowWebhooksController.prototype as any;
  const routes = Object.getOwnPropertyNames(proto).filter(
    (n) =>
      n !== 'constructor' &&
      Reflect.getMetadata('path', proto[n]) !== undefined,
  );

  it('ruta store/integrations/webhooks, solo JWT, industria flows y permiso store:integrations:api_keys', () => {
    expect(Reflect.getMetadata('path', WorkflowWebhooksController)).toBe(
      'store/integrations/webhooks',
    );
    expect(
      Reflect.getMetadata(IS_PUBLIC_KEY, WorkflowWebhooksController),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata('__guards__', WorkflowWebhooksController),
    ).toEqual([PermissionsGuard, IndustryModuleGuard]);
    expect(
      Reflect.getMetadata(INDUSTRY_MODULE_KEY, WorkflowWebhooksController),
    ).toBe('flows');
    expect(routes.sort()).toEqual(
      [
        'create',
        'deliveries',
        'list',
        'remove',
        'retry',
        'rotate',
        'test',
        'update',
      ].sort(),
    );
    for (const r of routes) {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, proto[r])).toEqual([
        'store:integrations:api_keys',
      ]);
    }
  });

  it('verbos y paths', () => {
    const at = (name: string) => [
      METHODS[Reflect.getMetadata('method', proto[name])],
      Reflect.getMetadata('path', proto[name]),
    ];
    expect(at('list')).toEqual(['GET', '/']);
    expect(at('create')).toEqual(['POST', '/']);
    expect(at('update')).toEqual(['PATCH', ':id']);
    expect(at('remove')).toEqual(['DELETE', ':id']);
    expect(at('rotate')).toEqual(['POST', ':id/rotate-secret']);
    expect(at('test')).toEqual(['POST', ':id/test']);
    expect(at('deliveries')).toEqual(['GET', ':id/deliveries']);
    expect(at('retry')).toEqual(['POST', 'deliveries/:deliveryId/retry']);
  });
});

describe('DTOs de webhooks', () => {
  const errors = async (cls: any, body: object) =>
    (
      await validate(plainToInstance(cls, body), {
        whitelist: true,
        forbidNonWhitelisted: true,
      })
    ).map((e) => e.property);

  it('crear exige url y eventos conocidos, únicos y no vacíos', async () => {
    expect(
      await errors(CreateWebhookDto, {
        url: 'https://a.example.com/x',
        event_types: ['workflow.task.created'],
      }),
    ).toEqual([]);
    expect(
      await errors(CreateWebhookDto, {
        event_types: ['workflow.task.created'],
      }),
    ).toContain('url');
    expect(
      await errors(CreateWebhookDto, {
        url: 'https://a.example.com',
        event_types: [],
      }),
    ).toContain('event_types');
    expect(
      await errors(CreateWebhookDto, {
        url: 'https://a.example.com',
        event_types: ['nope'],
      }),
    ).toContain('event_types');
    expect(
      await errors(CreateWebhookDto, {
        url: 'https://a.example.com',
        event_types: ['workflow.task.created', 'workflow.task.created'],
      }),
    ).toContain('event_types');
    expect(
      await errors(CreateWebhookDto, {
        url: 'x'.repeat(501),
        event_types: ['workflow.task.created'],
      }),
    ).toContain('url');
  });

  it('actualizar no acepta secretos ni campos ajenos', async () => {
    expect(await errors(UpdateWebhookDto, { is_active: false })).toEqual([]);
    expect(await errors(UpdateWebhookDto, { secret_enc: 'x' })).toContain(
      'secret_enc',
    );
    expect(await errors(UpdateWebhookDto, { store_id: 9 })).toContain(
      'store_id',
    );
    expect(await errors(UpdateWebhookDto, { is_active: 'si' })).toContain(
      'is_active',
    );
  });
});
