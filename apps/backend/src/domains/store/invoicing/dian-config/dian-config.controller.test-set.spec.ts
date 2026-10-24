import { NotFoundException } from '@nestjs/common';
import { DianConfigController } from './dian-config.controller';

describe('DianConfigController (tienda) — sondeo del job del set de pruebas', () => {
  const build = (guardError?: Error) => {
    const config = { getConfigById: jest.fn().mockResolvedValue({ id: 7 }) };
    if (guardError) config.getConfigById.mockRejectedValue(guardError);
    const test = {
      getTestSetJobStatus: jest.fn().mockResolvedValue({ state: 'completed' }),
    };
    const response = { success: jest.fn((d) => d) };
    const controller = new DianConfigController(
      config as any,
      test as any,
      {} as any,
      {} as any,
      response as any,
      {} as any,
      {} as any,
      {} as any,
    );
    return { controller, config, test };
  };

  it('carga la configuración con scope y luego sondea el job', async () => {
    const { controller, config, test } = build();
    await controller.getTestSetJobStatus(7, '55');
    expect(config.getConfigById).toHaveBeenCalledWith(7);
    expect(test.getTestSetJobStatus).toHaveBeenCalledWith('55', 7);
  });

  it('con una configuración ajena (DIAN_CONFIG_001) no consulta el job', async () => {
    const { controller, test } = build(new NotFoundException('DIAN_CONFIG_001'));
    await expect(controller.getTestSetJobStatus(7, '55')).rejects.toThrow();
    expect(test.getTestSetJobStatus).not.toHaveBeenCalled();
  });
});
