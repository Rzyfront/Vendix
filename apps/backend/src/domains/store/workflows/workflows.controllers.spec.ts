import 'reflect-metadata';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { PERMISSIONS_KEY } from '../../auth/decorators/permissions.decorator';
import { IndustryModuleGuard } from '../../../common/guards/industry-module.guard';
import { INDUSTRY_MODULE_KEY } from '../../../common/decorators/industry-module.decorator';
import { ResponseService } from '../../../common/responses/response.service';
import { WorkflowDefinitionsController } from './definitions/workflow-definitions.controller';
import { WorkflowInstancesController } from './instances/workflow-instances.controller';
import { WorkflowBoardController } from './board/workflow-board.controller';
import { WorkflowInboxController } from './inbox/workflow-inbox.controller';
import { WorkflowTasksController } from './tasks/workflow-tasks.controller';
import { WorkGroupsController } from './work-groups.controller';

const R = 'store:workflows:read';
const D = 'store:workflows:design';
const S = 'store:workflows:start';
const T = 'store:workflows:task';
const M = 'store:workflows:manage';
const G = 'store:work_groups:manage';

/** [handler, permission, HTTP method, path] */
const EXPECTED: Array<[any, string, string | string[], string, string]> = [
  [WorkflowDefinitionsController, 'schema', R, 'GET', 'schema'],
  [WorkflowDefinitionsController, 'validateBody', D, 'POST', 'validate'],
  [WorkflowDefinitionsController, 'import', D, 'POST', 'import'],
  [WorkflowDefinitionsController, 'list', [R, S], 'GET', '/'],
  [WorkflowDefinitionsController, 'create', D, 'POST', '/'],
  [WorkflowDefinitionsController, 'get', [R, S], 'GET', ':id'],
  [WorkflowDefinitionsController, 'getDraft', D, 'GET', ':id/draft'],
  [WorkflowDefinitionsController, 'saveDraft', D, 'PATCH', ':id/draft'],
  [WorkflowDefinitionsController, 'validate', D, 'POST', ':id/validate'],
  [WorkflowDefinitionsController, 'simulate', D, 'POST', ':id/simulate'],
  [WorkflowDefinitionsController, 'publish', D, 'POST', ':id/publish'],
  [WorkflowDefinitionsController, 'versions', R, 'GET', ':id/versions'],
  [WorkflowDefinitionsController, 'version', R, 'GET', ':id/versions/:version'],
  [WorkflowDefinitionsController, 'export', D, 'GET', ':id/export'],
  [WorkflowDefinitionsController, 'publicLink', D, 'GET', ':id/public-link'],
  [WorkflowDefinitionsController, 'createPublicLink', D, 'POST', ':id/public-link'],
  [WorkflowDefinitionsController, 'revokePublicLink', D, 'DELETE', ':id/public-link'],
  [WorkflowDefinitionsController, 'archive', D, 'POST', ':id/archive'],
  [WorkflowDefinitionsController, 'unarchive', D, 'POST', ':id/unarchive'],
  [WorkflowInstancesController, 'start', S, 'POST', '/'],
  [WorkflowInstancesController, 'list', [R, S, T], 'GET', '/'],
  [WorkflowInstancesController, 'get', [R, S, T], 'GET', ':id'],
  [WorkflowInstancesController, 'listComments', [R, S, T], 'GET', ':id/comments'],
  [WorkflowInstancesController, 'addComment', [R, S, T], 'POST', ':id/comments'],
  [WorkflowInboxController, 'list', T, 'GET', '/'],
  [WorkflowBoardController, 'get', R, 'GET', ':definitionId'],
  [WorkflowInstancesController, 'cancel', M, 'POST', ':id/cancel'],
  [WorkflowInstancesController, 'forceTransition', M, 'POST', ':id/force-transition'],
  [WorkflowInstancesController, 'uploadFile', T, 'POST', ':id/files'],
  [WorkflowTasksController, 'claim', T, 'POST', ':id/claim'],
  [WorkflowTasksController, 'complete', T, 'POST', ':id/complete'],
  [WorkGroupsController, 'list', R, 'GET', '/'],
  [WorkGroupsController, 'get', R, 'GET', ':id'],
  [WorkGroupsController, 'create', G, 'POST', '/'],
  [WorkGroupsController, 'update', G, 'PATCH', ':id'],
  [WorkGroupsController, 'setMember', G, 'PUT', ':id/members/:userId'],
  [WorkGroupsController, 'removeMember', G, 'DELETE', ':id/members/:userId'],
];
const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];

describe('controladores de Flujos', () => {
  it.each([
    WorkflowDefinitionsController,
    WorkflowInstancesController,
    WorkflowTasksController,
    WorkflowInboxController,
    WorkflowBoardController,
    WorkGroupsController,
  ])('%p usa PermissionsGuard + IndustryModuleGuard y el módulo "flows"', (ctrl) => {
    expect(Reflect.getMetadata('__guards__', ctrl)).toEqual([PermissionsGuard, IndustryModuleGuard]);
    expect(Reflect.getMetadata(INDUSTRY_MODULE_KEY, ctrl)).toBe('flows');
  });

  it('rutas base', () => {
    expect(Reflect.getMetadata('path', WorkflowDefinitionsController)).toBe('store/workflows/definitions');
    expect(Reflect.getMetadata('path', WorkflowInstancesController)).toBe('store/workflows/instances');
    expect(Reflect.getMetadata('path', WorkflowTasksController)).toBe('store/workflows/tasks');
    expect(Reflect.getMetadata('path', WorkflowInboxController)).toBe('store/workflows/inbox');
    expect(Reflect.getMetadata('path', WorkflowBoardController)).toBe('store/workflows/board');
    expect(Reflect.getMetadata('path', WorkGroupsController)).toBe('store/work-groups');
  });

  it.each(EXPECTED)('%p.%s exige %s y expone %s %s', (ctrl, handler, permission, method, path) => {
    const fn = ctrl.prototype[handler];
    expect(Reflect.getMetadata(PERMISSIONS_KEY, fn)).toEqual(
      Array.isArray(permission) ? permission : [permission],
    );
    expect(METHODS[Reflect.getMetadata('method', fn)]).toBe(method);
    expect(Reflect.getMetadata('path', fn)).toBe(path);
  });

  it('todo handler HTTP de cada controlador tiene permiso declarado (nada queda abierto)', () => {
    for (const ctrl of [WorkflowDefinitionsController, WorkflowInstancesController, WorkflowTasksController, WorkGroupsController]) {
      for (const name of Object.getOwnPropertyNames(ctrl.prototype)) {
        const fn = ctrl.prototype[name];
        if (name === 'constructor' || Reflect.getMetadata('path', fn) === undefined) continue;
        expect(Reflect.getMetadata(PERMISSIONS_KEY, fn)?.length ?? 0).toBeGreaterThan(0);
      }
    }
  });

  it('en definiciones, las rutas estáticas se declaran antes que las de :id', () => {
    const order = Object.getOwnPropertyNames(WorkflowDefinitionsController.prototype);
    const idx = (n: string) => order.indexOf(n);
    expect(idx('schema')).toBeLessThan(idx('get'));
    expect(idx('validateBody')).toBeLessThan(idx('get'));
    expect(idx('import')).toBeLessThan(idx('get'));
  });

  describe('Idempotency-Key', () => {
    const engine = {
      start: jest.fn().mockResolvedValue({ instance: { id: 1 } }),
      completeTask: jest.fn().mockResolvedValue({ instance: { id: 1 } }),
    };
    const responses = new ResponseService();
    const instances = new WorkflowInstancesController(engine as any, {} as any, responses, {} as any, {} as any);
    const tasks = new WorkflowTasksController(engine as any, responses);
    beforeEach(() => jest.clearAllMocks());

    const errorOf = async (p: Promise<unknown>) => {
      try {
        await p;
      } catch (e: any) {
        return e;
      }
    };

    it('POST /instances: sin cabecera -> 400 WORKFLOW_IDEMPOTENCY_KEY_REQUIRED y no llama al motor', async () => {
      const e = await errorOf(instances.start({ definition_id: 1 } as any, undefined));
      expect(e.errorCode).toBe('WORKFLOW_IDEMPOTENCY_KEY_REQUIRED');
      expect(e.getStatus()).toBe(400);
      expect((await errorOf(instances.start({ definition_id: 1 } as any, 'x'.repeat(81)))).errorCode).toBe(
        'WORKFLOW_IDEMPOTENCY_KEY_REQUIRED',
      );
      expect(engine.start).not.toHaveBeenCalled();
    });

    it('POST /instances: pasa la clave como idempotencyKey', async () => {
      await instances.start({ definition_key: 'purchase', title: 'T', data: { a: 1 } } as any, 'k-1');
      expect(engine.start).toHaveBeenCalledWith(
        expect.objectContaining({ definitionKey: 'purchase', title: 'T', idempotencyKey: 'k-1' }),
      );
    });

    it('POST /tasks/:id/complete: exige la cabecera y la pasa al motor', async () => {
      const dto = { outcome: 'approve', expected_row_version: 3, comment: 'ok' } as any;
      expect((await errorOf(tasks.complete(5, dto, undefined))).errorCode).toBe('WORKFLOW_IDEMPOTENCY_KEY_REQUIRED');
      expect(engine.completeTask).not.toHaveBeenCalled();
      await tasks.complete(5, dto, 'k-2');
      expect(engine.completeTask).toHaveBeenCalledWith({
        taskId: 5, outcome: 'approve', values: undefined, comment: 'ok', expectedRowVersion: 3, idempotencyKey: 'k-2',
      });
    });
  });
});
