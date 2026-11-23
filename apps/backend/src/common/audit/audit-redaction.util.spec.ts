import {
  AUDIT_REDACTED,
  redactAuditRows,
  redactAuditSecrets,
} from './audit-redaction.util';
import { AuditAction, AuditResource, AuditService } from './audit.service';
import { RequestContextService } from '@common/context/request-context.service';

describe('audit-redaction.util', () => {
  it('replaces credential values at any depth and keeps the rest', () => {
    const input = {
      email: 'staff@example.com',
      password: 'plain-text',
      profile: { new_password: 'x', confirm_password: 'x', first_name: 'Ana' },
      items: [{ refresh_token: 'abc', id: 1 }],
      two_factor_secret: 'JBSWY3DP',
    };

    const out = redactAuditSecrets(input);

    expect(out).toEqual({
      email: 'staff@example.com',
      password: AUDIT_REDACTED,
      profile: {
        new_password: AUDIT_REDACTED,
        confirm_password: AUDIT_REDACTED,
        first_name: 'Ana',
      },
      items: [{ refresh_token: AUDIT_REDACTED, id: 1 }],
      two_factor_secret: AUDIT_REDACTED,
    });
    expect(input.password).toBe('plain-text');
  });

  it('returns the same reference when there is nothing to redact', () => {
    const input = { name: 'Rol', permissions: [1, 2], password: null };
    expect(redactAuditSecrets(input)).toBe(input);
    expect(redactAuditSecrets(null)).toBeNull();
    expect(redactAuditSecrets('password')).toBe('password');
  });

  it('tolerates cycles', () => {
    const input: Record<string, unknown> = { password: 'p' };
    input.self = input;
    const out = redactAuditSecrets(input) as Record<string, unknown>;
    expect(out.password).toBe(AUDIT_REDACTED);
  });

  it('redacts the JSON columns of rows read before the fix', () => {
    const clean = { id: 2, old_values: { name: 'a' }, new_values: null };
    const rows = redactAuditRows([
      {
        id: 1,
        old_values: { password: 'leaked', email: 'a@b.co' },
        new_values: { user: { password: '$2b$10$hash' } },
        metadata: null,
      },
      clean,
    ]);

    expect(rows[0].old_values).toEqual({
      password: AUDIT_REDACTED,
      email: 'a@b.co',
    });
    expect(rows[0].new_values).toEqual({ user: { password: AUDIT_REDACTED } });
    expect(rows[1]).toBe(clean);
  });
});

describe('AuditService.log — credentials are never stored', () => {
  afterEach(() => {
    (RequestContextService as any).currentContext = undefined;
  });

  it('redacts old_values, new_values and metadata before writing', async () => {
    const create = jest.fn().mockResolvedValue({ id: 1 });
    const service = new AuditService({ audit_logs: { create } } as any);

    await service.log({
      userId: 3,
      action: AuditAction.UPDATE,
      resource: AuditResource.USERS,
      resourceId: 9,
      oldValues: { password: 'new-plain', first_name: 'Ana' },
      newValues: { data: { id: 9, password: '$2b$10$hash' } },
      metadata: { token: 't' },
    });

    const data = create.mock.calls[0][0].data;
    expect(data.old_values).toEqual({
      password: AUDIT_REDACTED,
      first_name: 'Ana',
    });
    expect(data.new_values).toEqual({
      data: { id: 9, password: AUDIT_REDACTED },
    });
    expect(data.metadata).toEqual({ token: AUDIT_REDACTED });
  });
});
