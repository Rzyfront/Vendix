import { RequestContextService } from '../../../common/context/request-context.service';
import { InvoicingService } from './invoicing.service';

describe('defaults AIU de documento', () => {
  it('responde defaults explícitos sin consultar configuración tenant legacy', async () => {
    const service = Object.create(InvoicingService.prototype) as any;
    service.prisma = {
      store_settings: { findUnique: jest.fn() },
    };
    const result = await RequestContextService.run(
      {
        user_id: 1,
        organization_id: 2,
        store_id: 3,
        is_super_admin: false,
        is_owner: true,
      },
      () => service.getAiuSettingsView(),
    );

    expect(result).toMatchObject({
      regime: 'et_462_1',
      contract_object: '',
      enforce_minimum_base: true,
      minimum_base_percent: 10,
      is_default: true,
    });
    expect(service.prisma.store_settings.findUnique).not.toHaveBeenCalled();
  });
});
