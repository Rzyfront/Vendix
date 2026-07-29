import { ProductsBulkEditController } from './products-bulk-edit.controller';
import { ProductsBulkEditService } from './products-bulk-edit.service';
import { ResponseService } from '@common/responses/response.service';
import { VendixHttpException } from '@common/errors';

/**
 * Refuerzo de permisos del controller de edición/archivado masivo (QUI-567).
 *
 * Esta suite NO prueba la lógica de negocio (eso vive en
 * `products-bulk-edit.service.spec.ts`): prueba la única barrera que impide que
 * la separación de permisos del ticket sea decorativa.
 *
 * Contexto: `PermissionsGuard` resuelve con OR entre match por nombre y match
 * por ruta, y el match por ruta es `currentPath.startsWith(permission.path)`
 * (`permissions.guard.ts:48-57`). La fila sembrada `store:products:create`
 * declara `path: '/api/store/products'` + `POST`, que prefija CUALQUIER POST
 * anidado bajo productos. Sin el refuerzo por nombre del controller, quien solo
 * pueda crear un producto pasaría el guard para editar o archivar 100.
 *
 * Los casos de abajo son exactamente los escenarios de fuga que el refuerzo
 * cierra, más los dos casos en que NO debe estorbar (permiso presente y
 * super_admin).
 */
describe('ProductsBulkEditController — refuerzo de permisos', () => {
  let controller: ProductsBulkEditController;
  let bulkEditService: jest.Mocked<Partial<ProductsBulkEditService>>;
  let responseService: Partial<ResponseService>;

  const activePerm = (name: string) => ({ name, status: 'active' });

  /** Request mínimo tal como lo deja `JwtAuthGuard` en `request.user`. */
  const requestWith = (
    permissions: Array<{ name: string; status: string }>,
    roles: string[] = ['owner'],
  ) => ({ user: { id: 15, roles, permissions } });

  beforeEach(() => {
    bulkEditService = {
      preview: jest.fn().mockResolvedValue({ total: 0, items: [] }),
      apply: jest.fn().mockResolvedValue({ successful: 0, failed: 0, items: [] }),
      previewArchive: jest.fn().mockResolvedValue({ total: 0, items: [] }),
      archive: jest.fn().mockResolvedValue({ successful: 0, failed: 0, items: [] }),
    };
    responseService = {
      success: jest.fn((data) => ({ success: true, data })),
      updated: jest.fn((data) => ({ success: true, data })),
      error: jest.fn((message) => ({ success: false, message })),
    } as unknown as Partial<ResponseService>;

    controller = new ProductsBulkEditController(
      bulkEditService as ProductsBulkEditService,
      responseService as ResponseService,
    );
  });

  describe('edición masiva', () => {
    it('rechaza el preview si falta store:products:bulk_update, aunque tenga create', async () => {
      const request = requestWith([activePerm('store:products:create')]);

      await expect(
        controller.preview({ ids: [1], changes: {} } as any, request),
      ).rejects.toThrow(VendixHttpException);
      expect(bulkEditService.preview).not.toHaveBeenCalled();
    });

    it('rechaza aplicar si falta store:products:bulk_update, aunque tenga update de un producto', async () => {
      const request = requestWith([activePerm('store:products:update')]);

      await expect(
        controller.apply({ ids: [1], changes: {} } as any, request),
      ).rejects.toThrow(VendixHttpException);
      expect(bulkEditService.apply).not.toHaveBeenCalled();
    });

    it('deja pasar con store:products:bulk_update activo', async () => {
      const request = requestWith([activePerm('store:products:bulk_update')]);

      await controller.apply({ ids: [1], changes: {} } as any, request);
      expect(bulkEditService.apply).toHaveBeenCalledTimes(1);
    });
  });

  describe('archivado masivo', () => {
    it('rechaza si el usuario tiene bulk_update pero no admin_delete', async () => {
      // El escenario de fuga concreto: `/bulk-edit/archive` cuelga del prefijo
      // `/bulk-edit`, así que el `startsWith` del guard lo deja pasar con
      // `bulk_update`. Archivar no puede heredar el permiso de editar.
      const request = requestWith([activePerm('store:products:bulk_update')]);

      await expect(
        controller.archive({ ids: [1] } as any, request),
      ).rejects.toThrow(VendixHttpException);
      expect(bulkEditService.archive).not.toHaveBeenCalled();
    });

    it('rechaza con store:products:delete, que solo cubre deactivate (reversible)', async () => {
      const request = requestWith([activePerm('store:products:delete')]);

      await expect(
        controller.previewArchive({ ids: [1] } as any, request),
      ).rejects.toThrow(VendixHttpException);
      expect(bulkEditService.previewArchive).not.toHaveBeenCalled();
    });

    it('rechaza si admin_delete existe pero está inactivo', async () => {
      const request = requestWith([
        { name: 'store:products:admin_delete', status: 'inactive' },
      ]);

      await expect(
        controller.archive({ ids: [1] } as any, request),
      ).rejects.toThrow(VendixHttpException);
      expect(bulkEditService.archive).not.toHaveBeenCalled();
    });

    it('deja pasar con store:products:admin_delete activo', async () => {
      const request = requestWith([activePerm('store:products:admin_delete')]);

      await controller.archive({ ids: [1] } as any, request);
      expect(bulkEditService.archive).toHaveBeenCalledTimes(1);
    });

    it('no es más estricto que el guard: super_admin pasa sin lista de permisos', async () => {
      const request = requestWith([], ['super_admin']);

      await controller.archive({ ids: [1] } as any, request);
      expect(bulkEditService.archive).toHaveBeenCalledTimes(1);
    });

    it('rechaza si request.user viene sin permisos ni roles', async () => {
      await expect(
        controller.archive({ ids: [1] } as any, {} as any),
      ).rejects.toThrow(VendixHttpException);
      expect(bulkEditService.archive).not.toHaveBeenCalled();
    });
  });
});
