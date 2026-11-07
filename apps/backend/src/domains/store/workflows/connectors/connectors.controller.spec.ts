jest.mock('../../../../messaging/messaging.service', () => ({ MessagingService: class {} }));
jest.mock('../../../../email/email.service', () => ({ EmailService: class {} }));

import 'reflect-metadata';
import { PERMISSIONS_KEY } from '../../../auth/decorators/permissions.decorator';
import { WorkflowConnectorsController } from './connectors.controller';

const permissionsOf = (method: keyof WorkflowConnectorsController) =>
  Reflect.getMetadata(PERMISSIONS_KEY, WorkflowConnectorsController.prototype[method]);

describe('WorkflowConnectorsController surface', () => {
  it('lists with design permission and tests with manage permission', () => {
    expect(permissionsOf('list')).toEqual(['store:workflows:design']);
    expect(permissionsOf('test')).toEqual(['store:workflows:manage']);
  });

  it('is mounted under store/workflows/connectors', () => {
    expect(Reflect.getMetadata('path', WorkflowConnectorsController)).toBe('store/workflows/connectors');
  });
});
