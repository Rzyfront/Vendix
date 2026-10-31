import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { PERMISSIONS_KEY } from '../../../../auth/decorators/permissions.decorator';
import { CrmConversationsController } from './crm-conversations.controller';

/**
 * Permission per endpoint (S7). `assign` also widens visibility to the whole
 * store inside the service, so it must never guard anything else.
 */
describe('CrmConversationsController · permisos', () => {
  const permissionsOf = (handler: keyof CrmConversationsController) =>
    Reflect.getMetadata(
      PERMISSIONS_KEY,
      CrmConversationsController.prototype[handler],
    );

  it.each([
    ['list', 'store:crm_inbox:read'],
    ['stats', 'store:crm_inbox:read'],
    ['stream', 'store:crm_inbox:read'],
    ['findOne', 'store:crm_inbox:read'],
    ['messages', 'store:crm_inbox:read'],
    ['markRead', 'store:crm_inbox:read'],
    ['send', 'store:crm_inbox:manage'],
    ['addNote', 'store:crm_inbox:manage'],
    ['close', 'store:crm_inbox:manage'],
    ['reopen', 'store:crm_inbox:manage'],
    ['assign', 'store:crm_inbox:assign'],
  ] as const)('%s exige %s', (handler, permission) => {
    expect(permissionsOf(handler)).toEqual([permission]);
  });

  it('enviar responde 202: el mensaje queda en cola, no enviado', () => {
    expect(
      Reflect.getMetadata(
        HTTP_CODE_METADATA,
        CrmConversationsController.prototype.send,
      ),
    ).toBe(202);
  });
});
