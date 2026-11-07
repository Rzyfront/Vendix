import 'reflect-metadata';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { PERMISSIONS_KEY } from '../../auth/decorators/permissions.decorator';
import { IndustryModuleGuard } from '../../../common/guards/industry-module.guard';
import { INDUSTRY_MODULE_KEY } from '../../../common/decorators/industry-module.decorator';
import { DocumentFilesController } from '../workflows/files/document-files.controller';
import { WorkflowInstancesController } from '../workflows/instances/workflow-instances.controller';
import { DossiersController } from './documents.controller';

const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];

describe('controladores documentales', () => {
  it.each([DossiersController, DocumentFilesController])(
    '%p usa PermissionsGuard + IndustryModuleGuard y el módulo "documents"',
    (ctrl) => {
      expect(Reflect.getMetadata('__guards__', ctrl)).toEqual([PermissionsGuard, IndustryModuleGuard]);
      expect(Reflect.getMetadata(INDUSTRY_MODULE_KEY, ctrl)).toBe('documents');
    },
  );

  it('rutas base', () => {
    expect(Reflect.getMetadata('path', DossiersController)).toBe('store/documents/dossiers');
    expect(Reflect.getMetadata('path', DocumentFilesController)).toBe('store/documents/files');
  });

  it.each([
    [DossiersController, 'list', ['store:documents:read'], 'GET', '/'],
    [DossiersController, 'get', ['store:documents:read'], 'GET', ':id'],
    // El participante de la solicitud no necesita documents:read: el servicio decide.
    [DocumentFilesController, 'download', ['store:documents:read', 'store:workflows:read', 'store:workflows:task'], 'GET', ':id/download'],
    [WorkflowInstancesController, 'uploadFile', ['store:workflows:task'], 'POST', ':id/files'],
  ])('%p.%s exige %j y expone %s %s', (ctrl: any, handler: string, perms, method, path) => {
    const fn = ctrl.prototype[handler];
    expect(Reflect.getMetadata(PERMISSIONS_KEY, fn)).toEqual(perms);
    expect(METHODS[Reflect.getMetadata('method', fn)]).toBe(method);
    expect(Reflect.getMetadata('path', fn)).toBe(path);
  });

  it('la subida de archivos de la solicitud pertenece al módulo "flows"', () => {
    expect(Reflect.getMetadata(INDUSTRY_MODULE_KEY, WorkflowInstancesController)).toBe('flows');
  });

  it('todo handler HTTP de los controladores documentales declara permisos', () => {
    for (const ctrl of [DossiersController, DocumentFilesController]) {
      for (const name of Object.getOwnPropertyNames(ctrl.prototype)) {
        const fn = ctrl.prototype[name];
        if (name === 'constructor' || Reflect.getMetadata('path', fn) === undefined) continue;
        expect(Reflect.getMetadata(PERMISSIONS_KEY, fn)?.length).toBeGreaterThan(0);
      }
    }
  });
});
