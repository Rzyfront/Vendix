import { OnboardingWizardService } from './onboarding-wizard.service';
import {
  expectNoSensitiveUserFields,
  fullUserRow,
} from '../../../testing/user-row-fixture';

/**
 * Wizard step «Tus datos» (`POST /organization/onboarding/wizard/setup-user`)
 * answers with the user: profile columns only, whether it saves or the data
 * was already there.
 */
describe('OnboardingWizardService.setupUser — minimal user columns in the answer', () => {
  const prisma = {
    users: { findUnique: jest.fn(), update: jest.fn() },
    addresses: { findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
  };
  let service: OnboardingWizardService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.users.findUnique.mockResolvedValue({
      ...fullUserRow(5),
      addresses: [],
    });
    prisma.users.update.mockResolvedValue({
      ...fullUserRow(5),
      first_name: 'Ana María',
    });
    service = new OnboardingWizardService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  });

  it('saves new data and answers without credentials nor lockout counters', async () => {
    const result = await service.setupUser(5, {
      first_name: 'Ana María',
      last_name: 'Pérez',
    } as never);

    expectNoSensitiveUserFields(result);
    expect(result).toEqual(
      expect.objectContaining({ id: 5, first_name: 'Ana María' }),
    );
  });

  it('answers the same way when the data was already saved', async () => {
    const result = await service.setupUser(5, {
      first_name: 'Ana',
      last_name: 'Pérez',
      phone: null,
    } as never);

    expectNoSensitiveUserFields(result);
    expect(result).toEqual(
      expect.objectContaining({ id: 5, already_completed: true }),
    );
    expect(prisma.users.update).not.toHaveBeenCalled();
  });
});
