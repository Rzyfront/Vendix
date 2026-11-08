import 'reflect-metadata';
import { PERMISSIONS_KEY } from '../../../auth/decorators/permissions.decorator';
import { INDUSTRY_MODULE_KEY } from '../../../../common/decorators/industry-module.decorator';
import { WorkflowAiUsageController } from './workflow-ai-usage.controller';
import { WorkflowInsightsController } from './workflow-insights.controller';

const perm = (target: object, name: string) => Reflect.getMetadata(PERMISSIONS_KEY, (target as any)[name]);

describe('AI usage and insights controllers', () => {
  it('guards every route with its permission and the Flows industry', () => {
    expect(perm(WorkflowAiUsageController.prototype, 'get')).toEqual(['store:workflows:read']);
    expect(perm(WorkflowInsightsController.prototype, 'list')).toEqual(['store:workflows:read']);
    expect(perm(WorkflowInsightsController.prototype, 'generate')).toEqual(['store:workflows:manage']);
    expect(Reflect.getMetadata(INDUSTRY_MODULE_KEY, WorkflowAiUsageController)).toBe('flows');
    expect(Reflect.getMetadata(INDUSTRY_MODULE_KEY, WorkflowInsightsController)).toBe('flows');
  });

  it('tells the service whether the user holds the manage permission', async () => {
    const insights = { list: jest.fn().mockResolvedValue({ items: [] }) };
    const response = { success: jest.fn((d: unknown) => d) };
    const controller = new WorkflowInsightsController(insights as any, response as any);
    const manage = { user: { permissions: [{ name: 'store:workflows:manage', status: 'active' }] } };
    const read = { user: { permissions: [{ name: 'store:workflows:read', status: 'active' }] } };
    const inactive = { user: { permissions: [{ name: 'store:workflows:manage', status: 'inactive' }] } };

    await controller.list({ limit: 12 }, manage);
    await controller.list({ limit: 12 }, read);
    await controller.list({}, inactive);
    expect(insights.list.mock.calls).toEqual([
      [12, true],
      [12, false],
      [12, false],
    ]);
  });
});
