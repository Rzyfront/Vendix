import { RequestContextService } from '@common/context/request-context.service';
import { WorkflowHttpTestService } from '../../secrets/workflow-http-test.service';
import {
  PermissionedWorkflowHttpTestService,
  requireActionPermission,
} from './action-test-permission';

const as = <T>(permissions: string[], fn: () => T, is_super_admin = false) =>
  RequestContextService.runIsolated(
    { store_id: 1, organization_id: 1, user_id: 7, is_super_admin, is_owner: false, permissions },
    fn,
  );

describe('requireActionPermission', () => {
  it('passes with the permission the catalog declares for the action', () => {
    expect(() =>
      as(['store:crm_campaigns:send'], () => requireActionPermission('vendix.whatsapp.send')),
    ).not.toThrow();
  });

  it('is 403 without it, naming the permission', () => {
    try {
      as(['store:workflows:manage'], () => requireActionPermission('vendix.whatsapp.send'));
      throw new Error('expected a 403');
    } catch (e) {
      expect(e).toMatchObject({ status: 403, errorCode: 'AUTH_PERM_001' });
      expect((e as Error).message).toContain('store:crm_campaigns:send');
    }
  });

  it('lets a super admin through, like the permissions guard', () => {
    expect(() => as([], () => requireActionPermission('vendix.http.request'), true)).not.toThrow();
  });
});

describe('PermissionedWorkflowHttpTestService (POST /store/workflows/http/test)', () => {
  const base = jest.spyOn(WorkflowHttpTestService.prototype, 'test');
  const service = Object.create(
    PermissionedWorkflowHttpTestService.prototype,
  ) as PermissionedWorkflowHttpTestService;
  const args = [{}] as unknown as Parameters<WorkflowHttpTestService['test']>;

  beforeEach(() => {
    base.mockReset();
    base.mockResolvedValue({ ok: true } as never);
  });
  afterAll(() => base.mockRestore());

  it('is 403 with design only and never runs the call (no secret is resolved)', async () => {
    await expect(
      as(['store:workflows:design'], () => service.test(...args)),
    ).rejects.toMatchObject({ status: 403, errorCode: 'AUTH_PERM_001' });
    expect(base).not.toHaveBeenCalled();
  });

  it('runs the real test with the permission of vendix.http.request', async () => {
    await expect(
      as(['store:workflows:design', 'store:workflows:manage'], () => service.test(...args)),
    ).resolves.toEqual({ ok: true });
    expect(base).toHaveBeenCalledTimes(1);
  });
});
