import 'reflect-metadata';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { PERMISSIONS_KEY } from '../../../auth/decorators/permissions.decorator';
import { IndustryModuleGuard } from '../../../../common/guards/industry-module.guard';
import { INDUSTRY_MODULE_KEY } from '../../../../common/decorators/industry-module.decorator';
import { DocumentExpiryController } from '../profiles/document-expiry.controller';
import { DocumentFileProfilesController } from '../profiles/document-file-profiles.controller';
import { DocumentRetentionController } from '../retention/document-retention.controller';
import { DocumentSearchController } from './document-search.controller';

const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
const CONTROLLERS = [
  DocumentFileProfilesController,
  DocumentExpiryController,
  DocumentRetentionController,
  DocumentSearchController,
];

describe('controladores de la biblioteca documental (P4.4/P4.6/P4.7)', () => {
  it.each(CONTROLLERS)('%p usa PermissionsGuard + IndustryModuleGuard y el módulo "documents"', (ctrl) => {
    expect(Reflect.getMetadata('__guards__', ctrl)).toEqual([PermissionsGuard, IndustryModuleGuard]);
    expect(Reflect.getMetadata(INDUSTRY_MODULE_KEY, ctrl)).toBe('documents');
  });

  it.each([
    [DocumentSearchController, 'find', ['store:documents:read'], 'GET', 'search'],
    [DocumentSearchController, 'folders', ['store:documents:read'], 'GET', 'folders'],
    [DocumentSearchController, 'entities', ['store:documents:read'], 'GET', 'folders/:subjectType'],
    [DocumentSearchController, 'entityFiles', ['store:documents:read'], 'GET', 'folders/:subjectType/:subjectId'],
    [DocumentExpiryController, 'list', ['store:documents:read'], 'GET', '/'],
    [DocumentFileProfilesController, 'get', ['store:documents:read'], 'GET', ':id/profile'],
    [DocumentFileProfilesController, 'update', ['store:workflows:manage'], 'PATCH', ':id/profile'],
    [DocumentFileProfilesController, 'legalHold', ['store:workflows:manage'], 'PUT', ':id/legal-hold'],
    [DocumentRetentionController, 'policies', ['store:workflows:design'], 'GET', 'policies'],
    [DocumentRetentionController, 'createPolicy', ['store:workflows:design'], 'POST', 'policies'],
    [DocumentRetentionController, 'updatePolicy', ['store:workflows:design'], 'PATCH', 'policies/:id'],
    [DocumentRetentionController, 'removePolicy', ['store:workflows:design'], 'DELETE', 'policies/:id'],
    [DocumentRetentionController, 'preview', ['store:workflows:design'], 'GET', 'preview'],
    [DocumentRetentionController, 'run', ['store:workflows:design'], 'POST', 'runs'],
    [DocumentRetentionController, 'runs', ['store:workflows:design'], 'GET', 'runs'],
    [DocumentRetentionController, 'getRun', ['store:workflows:design'], 'GET', 'runs/:id'],
  ])('%p.%s exige %j y expone %s %s', (ctrl: any, handler: string, perms, method, path) => {
    const fn = ctrl.prototype[handler];
    expect(Reflect.getMetadata(PERMISSIONS_KEY, fn)).toEqual(perms);
    expect(METHODS[Reflect.getMetadata('method', fn)]).toBe(method);
    expect(Reflect.getMetadata('path', fn)).toBe(path);
  });

  it('todo handler HTTP declara permisos', () => {
    for (const ctrl of CONTROLLERS) {
      for (const name of Object.getOwnPropertyNames(ctrl.prototype)) {
        const fn = (ctrl.prototype as unknown as Record<string, unknown>)[name];
        if (name === 'constructor' || Reflect.getMetadata('path', fn as object) === undefined) continue;
        expect(Reflect.getMetadata(PERMISSIONS_KEY, fn as object)?.length).toBeGreaterThan(0);
      }
    }
  });
});
