import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { lastValueFrom, of, toArray } from 'rxjs';
import {
  ResponseSecretsInterceptor,
  stripResponseSecrets,
} from './response-secrets.interceptor';

function userRow(id: number) {
  return {
    id,
    email: `user${id}@tienda.co`,
    first_name: 'Ana',
    password: '$2b$10$abcdefghijklmnopqrstuv',
    two_factor_secret: 'JBSWY3DPEHPK3PXP',
    two_factor_enabled: false,
    failed_login_attempts: 2,
    locked_until: null,
  };
}

function run(body: unknown): Promise<unknown> {
  const interceptor = new ResponseSecretsInterceptor();
  const next: CallHandler = { handle: () => of(body) };
  return lastValueFrom(interceptor.intercept({} as ExecutionContext, next));
}

describe('ResponseSecretsInterceptor', () => {
  it('removes password and two_factor_secret from users at any depth of the envelope', async () => {
    const body = {
      success: true,
      data: {
        id: 1,
        slug: 'org',
        users: [userRow(5), userRow(6)],
        stores: [{ id: 3, owner: { user: userRow(7) } }],
      },
    };

    const result = (await run(body)) as typeof body;

    const users = [
      ...result.data.users,
      result.data.stores[0].owner.user,
    ];
    for (const user of users) {
      expect(user).not.toHaveProperty('password');
      expect(user).not.toHaveProperty('two_factor_secret');
      expect(user).toEqual(
        expect.objectContaining({ id: user.id, first_name: 'Ana' }),
      );
    }
    expect(result.data.slug).toBe('org');
  });

  it('keeps the lockout counters, which the Super Admin unlock screen reads', async () => {
    const result = (await run({ data: userRow(5) })) as {
      data: Record<string, unknown>;
    };

    expect(result.data).toEqual(
      expect.objectContaining({ failed_login_attempts: 2, locked_until: null }),
    );
  });

  it('does not mutate the handler object and returns clean branches by reference', () => {
    const cached = userRow(5);
    const clean = { id: 3, name: 'Tienda' };
    const body = { data: { user: cached, store: clean } };

    const result = stripResponseSecrets(body);

    expect(cached.password).toBe('$2b$10$abcdefghijklmnopqrstuv');
    expect(cached.two_factor_secret).toBe('JBSWY3DPEHPK3PXP');
    expect(result).not.toBe(body);
    expect(result.data.store).toBe(clean);
  });

  it('returns the same body when it carries no secret', () => {
    const body = { data: [{ id: 1, name: 'Producto' }], meta: { total: 1 } };

    expect(stripResponseSecrets(body)).toBe(body);
  });

  it('passes dates, decimals, buffers, primitives and empty bodies through untouched', () => {
    const when = new Date('2026-11-23T10:00:00Z');
    const amount = new Prisma.Decimal('1250.50');
    const file = Buffer.from('pdf');
    const body = { data: { when, amount, file, count: 0, label: null } };

    const result = stripResponseSecrets(body);

    expect(result).toBe(body);
    expect(result.data.when).toBe(when);
    expect(result.data.amount).toBe(amount);
    expect(result.data.file).toBe(file);
    expect(stripResponseSecrets(undefined)).toBeUndefined();
    expect(stripResponseSecrets(null)).toBeNull();
    expect(stripResponseSecrets('ok')).toBe('ok');
  });

  it('terminates on a cyclic object instead of recursing forever', () => {
    const node: Record<string, unknown> = userRow(1);
    node.self = node;

    const result = stripResponseSecrets(node) as Record<string, unknown>;

    expect(result).not.toHaveProperty('password');
    expect(result.id).toBe(1);
  });

  it('cleans every event of a streamed response', async () => {
    const interceptor = new ResponseSecretsInterceptor();
    const next: CallHandler = {
      handle: () => of({ data: userRow(1) }, { data: userRow(2) }),
    };

    const events = await lastValueFrom(
      interceptor.intercept({} as ExecutionContext, next).pipe(toArray()),
    );

    expect(events).toHaveLength(2);
    for (const event of events as Array<{ data: object }>) {
      expect(event.data).not.toHaveProperty('password');
    }
  });

  it('keeps the sign-in payload the frontend needs (login non-regression)', async () => {
    const { password: _password, ...loggedUser } = userRow(5);
    const loginBody = {
      success: true,
      message: 'Login exitoso',
      data: {
        user: { ...loggedUser, roles: ['owner'], store: { id: 3 } },
        user_settings: { id: 1, user_id: 5, app_type: 'STORE_ADMIN', config: {} },
        permissions: ['orders:read'],
        access_token: 'access.jwt',
        refresh_token: 'refresh.jwt',
        token_type: 'Bearer',
        expires_in: 900,
      },
    };

    const result = (await run(loginBody)) as typeof loginBody;

    expect(result.data).toEqual(
      expect.objectContaining({
        access_token: 'access.jwt',
        refresh_token: 'refresh.jwt',
        token_type: 'Bearer',
        expires_in: 900,
        permissions: ['orders:read'],
        user_settings: loginBody.data.user_settings,
      }),
    );
    expect(result.data.user).toEqual(
      expect.objectContaining({
        id: 5,
        email: 'user5@tienda.co',
        roles: ['owner'],
        two_factor_enabled: false,
        store: { id: 3 },
      }),
    );
    expect(result.data.user).not.toHaveProperty('two_factor_secret');
  });

  it('removes a stored password hash even when the query picked few columns', () => {
    const body = { data: { id: 5, email: 'user5@tienda.co', password: userRow(5).password } };

    const result = stripResponseSecrets(body);

    expect(result.data).toEqual({ id: 5, email: 'user5@tienda.co' });
  });

  it('keeps the password typed into an AI proposal, which comes back on approval', () => {
    const body = {
      data: {
        tool: 'store_users_create',
        arguments: {
          first_name: 'Ana',
          email: 'ana@tienda.co',
          password: 'Temporal-2026!',
        },
        confirmation_token: 'token-1',
      },
    };

    expect(stripResponseSecrets(body)).toBe(body);
  });

  it('keeps the password property of a tool input schema', () => {
    const body = {
      tools: [
        {
          name: 'invoicing_upload_certificate',
          inputSchema: {
            type: 'object',
            properties: {
              p12_base64: { type: 'string' },
              password: { type: 'string', description: 'Opens the .p12' },
            },
            required: ['p12_base64', 'password'],
          },
        },
      ],
    };

    expect(stripResponseSecrets(body)).toBe(body);
  });
});
