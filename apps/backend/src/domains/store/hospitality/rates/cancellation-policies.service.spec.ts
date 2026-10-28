import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '@common/errors';
import { CreateCancellationPolicyDto } from './dto';
import { LodgingCancellationPoliciesService } from './cancellation-policies.service';

const codeOf = async (promise: Promise<unknown>) => {
  const error = await promise.catch((e) => e);
  expect(error).toBeInstanceOf(VendixHttpException);
  return ((error as VendixHttpException).getResponse() as any).error_code;
};

/** "Flexible: gratis hasta 48 h, luego 1 noche". */
const flexible = (): CreateCancellationPolicyDto => ({
  name: 'Flexible',
  rules: [{ hours_before: 48, penalty_type: 'nights', penalty_value: 1 }],
});

function build(existing: any[] = []) {
  const rows = [...existing];
  const prisma: any = {
    lodging_cancellation_policies: {
      findMany: jest.fn(async () => rows),
      findFirst: jest.fn(async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: rows.length + 1, ...data };
        rows.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = rows.find((r) => r.id === where.id);
        Object.assign(row, data);
        return row;
      }),
    },
  };
  return { service: new LodgingCancellationPoliciesService(prisma), prisma, rows };
}

describe('LodgingCancellationPoliciesService (H2.4)', () => {
  beforeEach(() => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: 5, user_id: 9 } as any);
  });
  afterEach(() => jest.restoreAllMocks());

  it('creates "Flexible" in the store with its window and no no-show penalty', async () => {
    const { service } = build();
    const policy = await service.create(flexible());
    expect(policy).toMatchObject({
      store_id: 5,
      name: 'Flexible',
      rules: [{ hours_before: 48, penalty_type: 'nights', penalty_value: 1 }],
      no_show_penalty: Prisma.DbNull,
      is_active: true,
    });
  });

  it('stores the windows widest first and the no-show penalty', async () => {
    const { service } = build();
    const policy = await service.create({
      name: 'Estricta',
      rules: [
        { hours_before: 24, penalty_type: 'percent', penalty_value: 100 },
        { hours_before: 168, penalty_type: 'percent', penalty_value: 50 },
      ],
      no_show_penalty: { penalty_type: 'nights', penalty_value: 2 },
    });
    expect(policy.rules).toEqual([
      { hours_before: 168, penalty_type: 'percent', penalty_value: 50 },
      { hours_before: 24, penalty_type: 'percent', penalty_value: 100 },
    ]);
    expect(policy.no_show_penalty).toEqual({ penalty_type: 'nights', penalty_value: 2 });
  });

  it('rejects two rules for the same window and nights outside 1-30', async () => {
    const { service } = build();
    expect(
      await codeOf(
        service.create({
          ...flexible(),
          rules: [
            { hours_before: 48, penalty_type: 'nights', penalty_value: 1 },
            { hours_before: 48, penalty_type: 'percent', penalty_value: 50 },
          ],
        }),
      ),
    ).toBe('LODGING_CANCEL_POLICY_RULES_001');
    expect(
      await codeOf(
        service.create({
          ...flexible(),
          rules: [{ hours_before: 48, penalty_type: 'nights', penalty_value: 1.5 }],
        }),
      ),
    ).toBe('LODGING_CANCEL_POLICY_RULES_001');
  });

  it('the DTO rejects unknown penalty types and percents above 100', async () => {
    const errorsOf = async (rule: Record<string, unknown>) =>
      (
        await validate(plainToInstance(CreateCancellationPolicyDto, { ...flexible(), rules: [rule] }))
      ).map((e) => e.property);
    expect(await errorsOf({ hours_before: 48, penalty_type: 'nights', penalty_value: 1 })).toEqual([]);
    expect(await errorsOf({ hours_before: 48, penalty_type: 'fixed', penalty_value: 1 })).toEqual(['rules']);
    expect(await errorsOf({ hours_before: 48, penalty_type: 'percent', penalty_value: 150 })).toEqual(['rules']);
  });

  it('editing changes the policy; a duplicate name is a 409; another store is a 404', async () => {
    const { service, prisma } = build();
    const policy = await service.create(flexible());
    const edited = await service.update(policy.id, {
      rules: [{ hours_before: 72, penalty_type: 'nights', penalty_value: 1 }],
      no_show_penalty: null,
    });
    expect(edited.rules).toEqual([{ hours_before: 72, penalty_type: 'nights', penalty_value: 1 }]);

    prisma.lodging_cancellation_policies.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' }),
    );
    expect(await codeOf(service.create(flexible()))).toBe('LODGING_CANCEL_POLICY_DUP_001');
    expect(await codeOf(service.update(99, { name: 'X' }))).toBe('LODGING_CANCEL_POLICY_FIND_001');
  });
});
