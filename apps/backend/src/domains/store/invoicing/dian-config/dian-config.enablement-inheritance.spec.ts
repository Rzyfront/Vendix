import { DianConfigService } from './dian-config.service';

const VERDICT = { success: true, dian_response: { success: true }, track_id: 't1' };

describe('DianConfigService — herencia de habilitación DIAN', () => {
  const build = (opts: {
    target?: any;
    candidates?: any[];
    decrypt?: (v: string) => string;
  }) => {
    const target = {
      id: 10,
      nit: '900123456',
      nit_dv: '7',
      software_id: 'sw-1',
      software_pin_encrypted: 'enc:pin',
      configuration_type: 'invoicing',
      operation_mode: 'own_software',
      enablement_status: 'not_started',
      enablement_inherited_from_id: null,
      test_set_id: null,
      ...(opts.target ?? {}),
    };
    const unscoped = {
      dian_configurations: {
        findMany: jest.fn().mockResolvedValue(opts.candidates ?? []),
      },
    };
    const scoped: any = {
      dian_configurations: {
        findFirst: jest.fn().mockResolvedValue(target),
        update: jest.fn().mockImplementation(async ({ data }) => ({
          ...target,
          ...data,
        })),
      },
      dian_audit_logs: { create: jest.fn().mockResolvedValue({}) },
      withoutScope: () => unscoped,
    };
    const encryption = {
      decrypt: jest.fn(opts.decrypt ?? ((v: string) => v.replace('enc:', ''))),
    } as any;
    const service = new DianConfigService(
      scoped,
      encryption,
      {} as any,
      {} as any,
      {} as any,
      { emit: jest.fn() } as any,
    );
    return { service, scoped, unscoped };
  };

  const source = (over: any = {}) => ({
    id: 99,
    nit: '900123456',
    nit_dv: '7',
    software_id: 'sw-1',
    software_pin_encrypted: 'enc:pin',
    configuration_type: 'invoicing',
    environment: 'production',
    enablement_status: 'enabled',
    enablement_evidence: VERDICT,
    enablement_inherited_from_id: null,
    test_set_id: 'ts-1',
    ...over,
  });

  it('detecta la herencia sin exponer datos de la fuente', async () => {
    const { service } = build({ candidates: [source()] });
    const res: any = await service.getEnablementInheritance(10);
    expect(res).toMatchObject({
      available: true,
      source_enablement_status: 'enabled',
      target_environment: 'production',
      issuer_nit: '900123456',
      software_id: 'sw-1',
    });
    expect(res.legal_notice).toContain('900123456');
    expect(JSON.stringify(res)).not.toMatch(/"id"|99|organization|store/);
  });

  it('no disponible sin fuente (no_source)', async () => {
    const { service } = build({ candidates: [] });
    await expect(service.getEnablementInheritance(10)).resolves.toMatchObject({
      available: false,
      reason: 'no_source',
    });
  });

  it('descarta fuentes sin veredicto y de otro NIT', async () => {
    const { service } = build({
      candidates: [
        source({ enablement_evidence: { track_id: 'x' } }),
        source({ id: 98, nit: '800000000' }),
      ],
    });
    await expect(service.getEnablementInheritance(10)).resolves.toMatchObject({
      available: false,
      reason: 'no_source',
    });
  });

  it('no copia ni expone la evidencia cruda ni el id de la fuente', async () => {
    const { service, scoped } = build({
      candidates: [
        source({
          enablement_evidence: {
            success: true,
            resolution_id: 555,
            documents: [{ cufe: 'CUFE-SECRETO', number: 1 }],
            zip_key: 'ZIP-AJENO',
            submissions: [{ a: 1 }],
            poll_history: [{ b: 2 }],
            dian_response: {
              success: true,
              status_code: '00',
              status_message: 'Procesado',
              raw_response: 'RAW-XML-AJENO',
            },
          },
        }),
      ],
    });
    const res: any = await service.inheritEnablement(10, 5);

    const stored = scoped.dian_configurations.update.mock.calls[0][0].data;
    const stored_json = JSON.stringify(stored.enablement_evidence);
    for (const leak of [
      '555',
      'CUFE-SECRETO',
      'ZIP-AJENO',
      'RAW-XML-AJENO',
      'documents',
      'submissions',
      'poll_history',
      'resolution_id',
    ]) {
      expect(stored_json).not.toContain(leak);
    }
    expect(stored.enablement_evidence).toMatchObject({
      success: true,
      dian_response: { success: true, status_code: '00' },
      inheritance: { from_dian_configuration_id: 99 },
    });
    expect(stored.enablement_inherited_from_id).toBe(99);

    const res_json = JSON.stringify(res);
    expect(res_json).not.toContain('555');
    expect(res_json).not.toContain('99');
    expect(res_json).not.toContain('enablement_evidence');
    expect(res_json).not.toContain('enablement_inherited_from_id');
    expect(res).toMatchObject({ inherited: true, enablement_status: 'enabled' });
  });

  it('aplica la herencia desde enabled+production', async () => {
    const { service, scoped } = build({ candidates: [source()] });
    await service.inheritEnablement(10, 5);
    const data = scoped.dian_configurations.update.mock.calls[0][0].data;
    expect(data).toMatchObject({
      enablement_status: 'enabled',
      environment: 'production',
      enablement_inherited_from_id: 99,
      test_set_id: 'ts-1',
    });
    expect(data.enabled_at).toBeInstanceOf(Date);
    expect(data.enablement_evidence).toMatchObject({
      success: true,
      dian_response: { success: true },
      inheritance: {
        from_dian_configuration_id: 99,
        source_enablement_status: 'enabled',
        source_environment: 'production',
        issuer_nit: '900123456',
        software_id: 'sw-1',
        configuration_type: 'invoicing',
        inherited_by_user_id: 5,
      },
    });
    expect(scoped.dian_audit_logs.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        dian_configuration_id: 10,
        action: 'enablement_inherited',
      }),
    });
  });

  it('desde test_set_passed deja environment test y sin enabled_at', async () => {
    const { service, scoped } = build({
      candidates: [
        source({ enablement_status: 'test_set_passed', environment: 'test' }),
      ],
    });
    await service.inheritEnablement(10);
    const data = scoped.dian_configurations.update.mock.calls[0][0].data;
    expect(data).toMatchObject({
      enablement_status: 'test_set_passed',
      environment: 'test',
      enabled_at: null,
    });
  });

  it('prefiere enabled+production y filas no heredadas', async () => {
    const { service, scoped } = build({
      candidates: [
        source({ id: 1, enablement_status: 'test_set_passed', environment: 'test' }),
        source({ id: 2, environment: 'test' }),
        source({ id: 3, enablement_inherited_from_id: 50 }),
        source({ id: 4 }),
      ],
    });
    await service.inheritEnablement(10);
    expect(
      scoped.dian_configurations.update.mock.calls[0][0].data
        .enablement_inherited_from_id,
    ).toBe(4);
  });

  it('sin fuente elegible (testing/not_started/suspended no se devuelven) -> DIAN_CONFIG_003', async () => {
    const { service, scoped, unscoped } = build({ candidates: [] });
    await expect(service.inheritEnablement(10)).rejects.toMatchObject({
      errorCode: 'DIAN_CONFIG_003',
    });
    const where = unscoped.dian_configurations.findMany.mock.calls[0][0].where;
    expect(where.enablement_status).toEqual({
      in: ['enabled', 'test_set_passed'],
    });
    expect(scoped.dian_configurations.update).not.toHaveBeenCalled();
  });

  it('no aplica si el objetivo ya está enabled', async () => {
    const { service, scoped } = build({
      target: { enablement_status: 'enabled' },
      candidates: [source()],
    });
    await expect(service.inheritEnablement(10)).rejects.toMatchObject({
      errorCode: 'DIAN_CONFIG_003',
    });
    expect(scoped.dian_configurations.update).not.toHaveBeenCalled();
  });

  it('PIN distinto -> DIAN_CONFIG_004 sin datos de la fuente en el mensaje', async () => {
    const { service, scoped } = build({
      target: { software_pin_encrypted: 'enc:otro' },
      candidates: [source()],
    });
    let error: any;
    try {
      await service.inheritEnablement(10);
    } catch (e) {
      error = e;
    }
    expect(error.errorCode).toBe('DIAN_CONFIG_004');
    expect(JSON.stringify(error.getResponse())).not.toMatch(/99|otro|enc:|ts-1/i);
    expect(scoped.dian_configurations.update).not.toHaveBeenCalled();
  });

  it('objetivo sin PIN -> DIAN_CONFIG_004', async () => {
    const { service } = build({
      target: { software_pin_encrypted: '' },
      candidates: [source()],
    });
    await expect(service.inheritEnablement(10)).rejects.toMatchObject({
      errorCode: 'DIAN_CONFIG_004',
    });
  });
});
