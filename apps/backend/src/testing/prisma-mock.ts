import { RequestContextService } from '@common/context/request-context.service';

export type PrismaMock = Record<string, any> & { $transaction: jest.Mock };

export interface MockRequestContext {
  store_id: number;
  organization_id: number;
  user_id: number;
  is_super_admin: boolean;
}

/**
 * Builds a StorePrismaService mock from a {model: [methods]} declaration.
 * `$transaction` resolves the callback against the same mock, so writes made
 * inside a transaction land on the same jest.fn handles the test asserts on.
 */
export function createPrismaMock(
  models: Record<string, readonly string[]>,
): PrismaMock {
  const mock: Record<string, any> = {};

  for (const [model, methods] of Object.entries(models)) {
    mock[model] = {};
    for (const method of methods) {
      mock[model][method] = jest.fn();
    }
  }

  mock.$transaction = jest.fn(async (arg: any) =>
    typeof arg === 'function' ? arg(mock) : Promise.all(arg),
  );

  return mock as PrismaMock;
}

/**
 * Stubs the AsyncLocalStorage tenant context. `getContext` is static, so this
 * spy must be re-applied per test — `jest.clearAllMocks()` drops it.
 */
export function mockRequestContext(
  overrides: Partial<MockRequestContext> = {},
): MockRequestContext {
  const context: MockRequestContext = {
    store_id: 100,
    organization_id: 1,
    user_id: 1,
    is_super_admin: false,
    ...overrides,
  };

  jest
    .spyOn(RequestContextService, 'getContext')
    .mockReturnValue(context as any);

  return context;
}
