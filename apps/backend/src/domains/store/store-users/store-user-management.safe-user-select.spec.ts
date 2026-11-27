import { StoreUserManagementService } from './store-user-management.service';
import {
  expectNoSensitiveUserFields,
  fullUserRow,
  projectUserRow,
} from '../../../testing/user-row-fixture';

/**
 * `POST /store/users/management/:id/deactivate` and `.../reactivate` answer
 * with the user: profile columns only.
 */
describe('StoreUserManagementService — minimal user columns in responses', () => {
  const prisma = {
    users: {
      update: jest.fn(async (args: any) =>
        projectUserRow(fullUserRow(5), args.select),
      ),
    },
  };
  let service: StoreUserManagementService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new StoreUserManagementService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      // UsernameService stub: username always free, P2002 rethrown untouched.
      {
        assertAvailable: jest.fn(),
        generateUnique: jest.fn().mockResolvedValue('generated_user'),
        rethrowAsConflict: jest.fn((error: unknown) => {
          throw error;
        }),
      } as never,
    );
    jest.spyOn(service, 'findOne').mockResolvedValue({} as never);
  });

  it('deactivate', async () => {
    expectNoSensitiveUserFields(await service.deactivate(5));
  });

  it('reactivate', async () => {
    expectNoSensitiveUserFields(await service.reactivate(5));
  });
});
