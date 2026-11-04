import { ErrorCodes } from '@common/errors/error-codes';
import { VendixHttpException } from '@common/errors/vendix-http.exception';
import { ResponseService } from '../../../common/responses/response.service';
import { StoreDomainsController } from './domains.controller';

/**
 * Apps F5: a business rule refused by the service (e.g. an app type whose app
 * is not published) must reach the domain modal with its code and status,
 * never as a 200 the modal reads as "Dominio actualizado correctamente".
 */
describe('StoreDomainsController', () => {
  const service = { update: jest.fn(), create: jest.fn() };
  const controller = new StoreDomainsController(
    service as any,
    new ResponseService(),
  );

  afterEach(() => jest.clearAllMocks());

  it('update keeps STORE_APPS_016 as an error with its code', async () => {
    service.update.mockRejectedValue(new VendixHttpException(ErrorCodes.STORE_APPS_016));
    await expect(controller.update(9, { app_type: 'STORE_BOOKING' } as any)).rejects.toMatchObject({
      errorCode: ErrorCodes.STORE_APPS_016.code,
    });
  });

  it('create keeps STORE_APPS_017 as an error with its code', async () => {
    service.create.mockRejectedValue(new VendixHttpException(ErrorCodes.STORE_APPS_017));
    await expect(controller.create({ hostname: 'x.com' } as any)).rejects.toMatchObject({
      errorCode: ErrorCodes.STORE_APPS_017.code,
    });
  });

  it('any other failure keeps the previous wrapped body', async () => {
    service.update.mockRejectedValue(new Error('boom'));
    await expect(controller.update(9, {} as any)).resolves.toMatchObject({
      success: false,
      message: 'Error al actualizar el dominio',
    });
  });
});
