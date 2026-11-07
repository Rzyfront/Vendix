import 'reflect-metadata';
import { IS_PUBLIC_KEY } from '../../../../common/decorators/public.decorator';
import { INDUSTRY_MODULE_KEY } from '../../../../common/decorators/industry-module.decorator';
import { IndustryModuleGuard } from '../../../../common/guards/industry-module.guard';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { PERMISSIONS_KEY } from '../../../auth/decorators/permissions.decorator';
import { WorkflowInstancesController } from '../../workflows/instances/workflow-instances.controller';
import { WorkflowTasksController } from '../../workflows/tasks/workflow-tasks.controller';
import { WorkflowInboxController } from '../../workflows/inbox/workflow-inbox.controller';
import { WorkflowDefinitionsController } from '../../workflows/definitions/workflow-definitions.controller';
import { ApiKeyGuard } from './api-key.guard';
import { ApiKeyThrottlerGuard } from './api-key-throttler.guard';
import { StoreApiKeysController } from './store-api-keys.controller';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];

describe('API key surfaces are separate', () => {
  it('management is JWT-only: not @Public, no ApiKeyGuard, gated by store:integrations:api_keys and the flows industry', () => {
    expect(Reflect.getMetadata('path', StoreApiKeysController)).toBe(
      'store/integrations/api-keys',
    );
    expect(
      Reflect.getMetadata(IS_PUBLIC_KEY, StoreApiKeysController),
    ).toBeUndefined();
    expect(Reflect.getMetadata('__guards__', StoreApiKeysController)).toEqual([
      PermissionsGuard,
      IndustryModuleGuard,
    ]);
    expect(
      Reflect.getMetadata(INDUSTRY_MODULE_KEY, StoreApiKeysController),
    ).toBe('flows');
    const proto = StoreApiKeysController.prototype as any;
    const routes = Object.getOwnPropertyNames(proto).filter(
      (n) =>
        n !== 'constructor' &&
        Reflect.getMetadata('path', proto[n]) !== undefined,
    );
    expect(routes.sort()).toEqual(['create', 'list', 'revoke']);
    for (const r of routes) {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, proto[r])).toEqual([
        'store:integrations:api_keys',
      ]);
    }
    expect(METHODS[Reflect.getMetadata('method', proto.list)]).toBe('GET');
    expect(METHODS[Reflect.getMetadata('method', proto.create)]).toBe('POST');
    expect(METHODS[Reflect.getMetadata('method', proto.revoke)]).toBe('DELETE');
  });

  it.each([
    StoreApiKeysController,
    WorkflowInstancesController,
    WorkflowTasksController,
    WorkflowInboxController,
    WorkflowDefinitionsController,
  ])(
    '%p stays on the JWT chain: not @Public and no API key guard (an API key cannot reach it)',
    (ctrl) => {
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, ctrl)).toBeUndefined();
      const guards = Reflect.getMetadata('__guards__', ctrl) as unknown[];
      expect(guards).not.toContain(ApiKeyGuard);
      expect(guards).not.toContain(ApiKeyThrottlerGuard);
    },
  );
});

describe('ApiKeyThrottlerGuard', () => {
  const guard: any = Object.create(ApiKeyThrottlerGuard.prototype);

  it('tracks per key, so two keys behind one IP have separate budgets', async () => {
    expect(await guard.getTracker({ apiKey: { api_key_id: 7 } })).toBe(
      'api_key:7',
    );
    expect(await guard.getTracker({ apiKey: { api_key_id: 8 } })).toBe(
      'api_key:8',
    );
  });

  it('falls back to the client IP bucket, never to "unlimited"', async () => {
    const t = await guard.getTracker({ ip: '5.6.7.8', headers: {} });
    expect(t).toContain('5.6.7.8');
  });

  it('answers 429 API_KEY_RATE_LIMITED', async () => {
    await expect(guard.throwThrottlingException({})).rejects.toMatchObject({
      errorCode: 'API_KEY_RATE_LIMITED',
    });
    try {
      await guard.throwThrottlingException({});
    } catch (e: any) {
      expect(e.getStatus()).toBe(429);
    }
  });
});

describe('CreateApiKeyDto', () => {
  const errors = async (o: object) =>
    (await validate(plainToInstance(CreateApiKeyDto, o)))
      .map((e) => e.property)
      .sort();

  it('accepts a valid body', async () => {
    expect(
      await errors({
        name: 'ERP',
        scopes: ['workflows:read', 'workflows:write'],
        expires_in_days: 730,
      }),
    ).toEqual([]);
    expect(await errors({ name: 'ERP', scopes: ['workflows:read'] })).toEqual(
      [],
    );
  });
  it.each([
    [{ scopes: ['workflows:read'] }, ['name']],
    [{ name: '', scopes: ['workflows:read'] }, ['name']],
    [{ name: 'x'.repeat(121), scopes: ['workflows:read'] }, ['name']],
    [{ name: 'a', scopes: [] }, ['scopes']],
    [{ name: 'a', scopes: ['documents:read'] }, ['scopes']],
    [{ name: 'a', scopes: ['workflows:read', 'workflows:read'] }, ['scopes']],
    [
      { name: 'a', scopes: ['workflows:read'], expires_in_days: 0 },
      ['expires_in_days'],
    ],
    [
      { name: 'a', scopes: ['workflows:read'], expires_in_days: 731 },
      ['expires_in_days'],
    ],
  ])('rejects %j', async (body, props) => {
    expect(await errors(body)).toEqual(props);
  });
});
