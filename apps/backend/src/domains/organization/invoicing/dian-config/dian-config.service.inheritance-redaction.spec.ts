import { OrgDianConfigService } from './dian-config.service';
import { RequestContextService } from '../../../../common/context/request-context.service';

describe('OrgDianConfigService — SEC-3: no expone la fila fuente de la herencia', () => {
  const row = () => ({
    id: 10,
    store_id: null,
    software_pin_encrypted: 'enc:pin',
    certificate_password_encrypted: null,
    enablement_inherited_from_id: 99,
    enablement_evidence: {
      success: true,
      inheritance: {
        from_dian_configuration_id: 99,
        source_environment: 'production',
      },
    },
  });

  const build = () => {
    const prisma = {
      withoutScope: () => ({
        dian_configurations: {
          findMany: jest.fn().mockResolvedValue([row()]),
          findFirst: jest.fn().mockResolvedValue(row()),
        },
      }),
    };
    return new OrgDianConfigService(prisma as any, {} as any, {} as any);
  };

  const inCtx = <T>(fn: () => Promise<T>) =>
    RequestContextService.run(
      { organization_id: 10, is_super_admin: false, is_owner: true } as any,
      fn,
    );

  const expectSanitized = (out: any) => {
    expect(out).not.toHaveProperty('enablement_inherited_from_id');
    expect(out.enablement_inherited).toBe(true);
    expect(out.enablement_evidence.inheritance).not.toHaveProperty(
      'from_dian_configuration_id',
    );
    expect(out.enablement_evidence.inheritance.source_environment).toBe(
      'production',
    );
    expect(JSON.stringify(out)).not.toContain('99');
  };

  it('getConfigById', async () => {
    expectSanitized(await inCtx(() => build().getConfigById(10)));
  });

  it('getConfigs', async () => {
    const [first] = await inCtx(() => build().getConfigs());
    expectSanitized(first);
  });
});
