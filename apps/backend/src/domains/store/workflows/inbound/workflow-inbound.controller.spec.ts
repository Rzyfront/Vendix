import 'reflect-metadata';
import { PERMISSIONS_KEY } from '../../../auth/decorators/permissions.decorator';
import { IS_PUBLIC_KEY } from '@common/decorators/public.decorator';
import { WorkflowInboundController } from './workflow-inbound.controller';
import { WorkflowInboundPublicController } from './workflow-inbound-public.controller';

describe('inbound controllers surface', () => {
  const handlers = [
    'hookState',
    'hookCreate',
    'hookRotate',
    'hookUpdate',
    'mailboxState',
    'mailboxActivate',
    'mailboxUpdate',
  ] as const;

  it.each(handlers)('%s requires store:workflows:design', (name) => {
    const permissions = Reflect.getMetadata(
      PERMISSIONS_KEY,
      WorkflowInboundController.prototype[name],
    );
    expect(permissions).toEqual(['store:workflows:design']);
  });

  it('the admin routes hang under definitions/:id and the public one is the only @Public route', () => {
    expect(Reflect.getMetadata('path', WorkflowInboundController)).toBe('store/workflows/definitions/:id');
    for (const name of handlers) {
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, WorkflowInboundController.prototype[name])).toBeUndefined();
    }
    expect(Reflect.getMetadata('path', WorkflowInboundPublicController)).toBe('public/workflows/hooks');
    expect(
      Reflect.getMetadata(IS_PUBLIC_KEY, WorkflowInboundPublicController.prototype.receive),
    ).toBe(true);
  });
});
