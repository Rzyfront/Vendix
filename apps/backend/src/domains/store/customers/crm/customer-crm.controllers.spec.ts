import { PERMISSIONS_KEY } from '../../../auth/decorators/permissions.decorator';
import { CustomerCrmController } from './profile/customer-crm.controller';
import { CrmTagsController } from './tags/crm-tags.controller';
import { CrmTasksController } from './tasks/crm-tasks.controller';
import { CrmPipelineController } from './pipeline/crm-pipeline.controller';
import { CrmSegmentsController } from './segments/crm-segments.controller';
import { CrmCampaignsController } from './campaigns/crm-campaigns.controller';
import { CrmUnsubscribeController } from './campaigns/crm-unsubscribe.controller';
import { IS_PUBLIC_KEY } from '../../../../common/decorators/public.decorator';

/**
 * Permission per endpoint (PLAN-CRM §4.1). Visibility of a seller (only their
 * own tasks and opportunities) is enforced inside the services.
 */
describe('CRM 360, tareas y pipeline · permisos', () => {
  const permissionsOf = (controller: { prototype: object }, handler: string) =>
    Reflect.getMetadata(
      PERMISSIONS_KEY,
      (controller.prototype as Record<string, unknown>)[handler] as object,
    );

  it.each([
    [CustomerCrmController, 'profile', 'store:customers:read'],
    [CustomerCrmController, 'updateProfile', 'store:customers:update'],
    [CustomerCrmController, 'timeline', 'store:customers:read'],
    [CustomerCrmController, 'setTags', 'store:customers:update'],
    [CustomerCrmController, 'notes', 'store:customers:read'],
    [CustomerCrmController, 'createNote', 'store:customers:update'],
    [CustomerCrmController, 'updateNote', 'store:customers:update'],
    [CrmTagsController, 'list', 'store:customers:read'],
    [CrmTagsController, 'create', 'store:crm_segments:manage'],
    [CrmTagsController, 'update', 'store:crm_segments:manage'],
    [CrmTagsController, 'remove', 'store:crm_segments:manage'],
    [CrmTasksController, 'list', 'store:crm_tasks:manage'],
    [CrmTasksController, 'today', 'store:crm_tasks:manage'],
    [CrmTasksController, 'stats', 'store:crm_tasks:manage'],
    [CrmTasksController, 'create', 'store:crm_tasks:manage'],
    [CrmTasksController, 'update', 'store:crm_tasks:manage'],
    [CrmTasksController, 'complete', 'store:crm_tasks:manage'],
    [CrmTasksController, 'reopen', 'store:crm_tasks:manage'],
    [CrmPipelineController, 'pipelines', 'store:crm_pipeline:read'],
    [CrmPipelineController, 'board', 'store:crm_pipeline:read'],
    [CrmPipelineController, 'findOne', 'store:crm_pipeline:read'],
    [CrmPipelineController, 'createStage', 'store:crm_pipeline:manage'],
    [CrmPipelineController, 'updateStage', 'store:crm_pipeline:manage'],
    [CrmPipelineController, 'create', 'store:crm_pipeline:manage'],
    [CrmPipelineController, 'update', 'store:crm_pipeline:manage'],
    [CrmPipelineController, 'move', 'store:crm_pipeline:manage'],
    [CrmPipelineController, 'win', 'store:crm_pipeline:manage'],
    [CrmPipelineController, 'lose', 'store:crm_pipeline:manage'],
    [CrmSegmentsController, 'list', 'store:customers:read'],
    [CrmSegmentsController, 'get', 'store:customers:read'],
    [CrmSegmentsController, 'preview', 'store:customers:read'],
    [CrmSegmentsController, 'customers', 'store:customers:read'],
    [CrmSegmentsController, 'create', 'store:crm_segments:manage'],
    [CrmSegmentsController, 'update', 'store:crm_segments:manage'],
    [CrmSegmentsController, 'remove', 'store:crm_segments:manage'],
  ] as const)('%p.%s exige %s', (controller, handler, permission) => {
    expect(permissionsOf(controller, handler)).toEqual([permission]);
  });

  it('every campaign endpoint requires store:crm_campaigns:send', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, CrmCampaignsController)).toEqual([
      'store:crm_campaigns:send',
    ]);
    for (const handler of ['estimate', 'list', 'create', 'get', 'estimateSaved', 'send', 'cancel', 'recipients']) {
      expect(
        Reflect.getMetadata(
          PERMISSIONS_KEY,
          (CrmCampaignsController.prototype as unknown as Record<string, object>)[handler],
        ),
      ).toBeUndefined();
    }
  });

  it('the unsubscribe link is the only public CRM route', () => {
    for (const handler of ['open', 'oneClick']) {
      expect(
        Reflect.getMetadata(
          IS_PUBLIC_KEY,
          (CrmUnsubscribeController.prototype as unknown as Record<string, object>)[handler],
        ),
      ).toBe(true);
    }
  });
});
