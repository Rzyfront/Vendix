import { DianConfigService } from './dian-config.service';

describe('DianConfigService — SEC-1: production-readiness no devuelve la ClTec', () => {
  const KEY = 'a'.repeat(40);

  const build = () => {
    const prisma: any = {
      dian_configurations: {
        findFirst: jest.fn().mockResolvedValue({
          id: 10,
          organization_id: 1,
          store_id: 1,
          accounting_entity_id: null,
          configuration_type: 'invoicing',
          environment: 'test',
          enablement_status: 'enabled',
        }),
      },
      invoice_resolutions: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 7,
            prefix: 'FE',
            resolution_number: '18760000001',
            range_from: 1,
            range_to: 1000,
            current_number: 5,
            valid_from: new Date('2020-01-01'),
            valid_to: new Date('2099-01-01'),
            technical_key: KEY,
            technical_key_encrypted: 'cipher',
            technical_key_fingerprint: 'fp',
          },
        ]),
      },
    };
    const readiness: any = {
      findResolutionsSharingTechnicalKey: jest.fn().mockResolvedValue([]),
      findDuplicateTechnicalKeys: jest.fn().mockResolvedValue([]),
      evaluateProductionReadiness: jest.fn().mockReturnValue({ checks: [] }),
      buildResolutionRangeWarning: jest.fn().mockReturnValue(null),
    };
    return new DianConfigService(
      prisma,
      {} as any,
      {} as any,
      readiness,
      {} as any,
      { emit: jest.fn() } as any,
    );
  };

  it('resolutions[] trae technical_key_set/length y ningún campo de la clave', async () => {
    const report: any = await build().getProductionReadiness(10);
    const [resolution] = report.resolutions;

    expect(resolution).not.toHaveProperty('technical_key');
    expect(resolution).not.toHaveProperty('technical_key_encrypted');
    expect(resolution).not.toHaveProperty('technical_key_fingerprint');
    expect(resolution.technical_key_set).toBe(true);
    expect(resolution.technical_key_length).toBe(40);
    expect(resolution).toMatchObject({ id: 7, is_habilitacion_range: false });
    expect(JSON.stringify(report)).not.toContain(KEY);
  });
});
