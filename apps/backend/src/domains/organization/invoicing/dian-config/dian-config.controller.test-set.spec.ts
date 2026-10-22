import { BadRequestException } from '@nestjs/common';
import { OrgDianConfigController } from './dian-config.controller';

describe('OrgDianConfigController — endpoints del set de pruebas', () => {
  const build = (guardError?: Error) => {
    const org = { assertOrgOwnedConfig: jest.fn() };
    if (guardError) org.assertOrgOwnedConfig.mockRejectedValue(guardError);
    const test = {
      checkTestSetStatus: jest.fn().mockResolvedValue({ status: 'waiting' }),
      getTestSetDocumentStatus: jest.fn().mockResolvedValue({ docs: [] }),
      abandonTestSet: jest.fn().mockResolvedValue({ abandoned: true }),
      getTestSetJobStatus: jest.fn().mockResolvedValue({ state: 'completed' }),
    };
    const response = { success: jest.fn((d) => d) };
    const controller = new OrgDianConfigController(
      org as any,
      test as any,
      {} as any,
      response as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    return { controller, org, test };
  };

  it('las tres rutas existen con el permiso de organización esperado', () => {
    const proto = OrgDianConfigController.prototype as any;
    const meta = (fn: string, key: string) =>
      Reflect.getMetadata(key, proto[fn]);
    expect(typeof proto.checkTestSetStatus).toBe('function');
    expect(typeof proto.getTestSetDocuments).toBe('function');
    expect(typeof proto.abandonTestSet).toBe('function');
    expect(meta('checkTestSetStatus', 'path')).toBe(':id/test-set-status');
    expect(meta('getTestSetDocuments', 'path')).toBe(':id/test-set-documents');
    expect(meta('abandonTestSet', 'path')).toBe(':id/abandon-test-set');
  });

  it('delegan en DianTestService tras la guarda', async () => {
    const { controller, org, test } = build();
    await controller.checkTestSetStatus(7);
    await controller.getTestSetDocuments(7);
    await controller.abandonTestSet(7);
    expect(org.assertOrgOwnedConfig).toHaveBeenCalledTimes(3);
    expect(test.checkTestSetStatus).toHaveBeenCalledWith(7);
    expect(test.getTestSetDocumentStatus).toHaveBeenCalledWith(7);
    expect(test.abandonTestSet).toHaveBeenCalledWith(7);
  });

  it('con fiscal_scope=STORE la guarda rechaza y no delega', async () => {
    const { controller, test } = build(new BadRequestException('x'));
    await expect(controller.checkTestSetStatus(7)).rejects.toThrow();
    await expect(controller.getTestSetDocuments(7)).rejects.toThrow();
    await expect(controller.abandonTestSet(7)).rejects.toThrow();
    expect(test.checkTestSetStatus).not.toHaveBeenCalled();
    expect(test.getTestSetDocumentStatus).not.toHaveBeenCalled();
    expect(test.abandonTestSet).not.toHaveBeenCalled();
  });

  it('getTestSetJobStatus exige la guarda de pertenencia antes de sondear el job', async () => {
    const { controller, org, test } = build();
    await controller.getTestSetJobStatus(7, '55');
    expect(org.assertOrgOwnedConfig).toHaveBeenCalledWith(7);
    expect(test.getTestSetJobStatus).toHaveBeenCalledWith('55', 7);
  });

  it('getTestSetJobStatus con configuración ajena rechaza y no consulta el job', async () => {
    const { controller, test } = build(new BadRequestException('x'));
    await expect(controller.getTestSetJobStatus(7, '55')).rejects.toThrow();
    expect(test.getTestSetJobStatus).not.toHaveBeenCalled();
  });
});
