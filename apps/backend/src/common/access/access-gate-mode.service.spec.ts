import { AccessGateModeService } from './access-gate-mode.service';

describe('AccessGateModeService', () => {
  const build = (values: Record<string, string | null> | Error) => {
    const redis: any = {
      get: jest.fn(async (key: string) => {
        if (values instanceof Error) throw values;
        return values[key] ?? null;
      }),
    };
    return { svc: new AccessGateModeService(redis), redis };
  };

  it('enforce when the per-store key is 1', async () => {
    const { svc } = build({ 'access_gate:enforce:store:7': '1' });
    await expect(svc.modeForStore(7)).resolves.toBe('enforce');
    await expect(svc.modeForStore(8)).resolves.toBe('audit');
  });

  it('enforce for every store when the all key is 1', async () => {
    const { svc } = build({ 'access_gate:enforce:all': '1' });
    await expect(svc.modeForStore(99)).resolves.toBe('enforce');
    await expect(svc.modeForOrganization()).resolves.toBe('enforce');
  });

  it('audit when the keys are absent or not exactly 1', async () => {
    const { svc } = build({ 'access_gate:enforce:all': '0' });
    await expect(svc.modeForStore(1)).resolves.toBe('audit');
    await expect(svc.modeForOrganization()).resolves.toBe('audit');
  });

  it('organization ignores the per-store key', async () => {
    const { svc } = build({ 'access_gate:enforce:store:7': '1' });
    await expect(svc.modeForOrganization()).resolves.toBe('audit');
  });

  it('Redis error → audit (fail-open) and warns once', async () => {
    const { svc } = build(new Error('down'));
    const warn = jest
      .spyOn((svc as any).logger, 'warn')
      .mockImplementation(() => undefined);
    await expect(svc.modeForStore(1)).resolves.toBe('audit');
    await expect(svc.modeForOrganization()).resolves.toBe('audit');
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
