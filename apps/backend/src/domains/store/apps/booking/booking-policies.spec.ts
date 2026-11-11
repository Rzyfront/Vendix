import { BookingPoliciesService, formatCheckIn, formatCheckOut, fillPolicies } from './booking-policies';
import { AppPageDocument } from '../shared/app-page.contract';

const page = (props: Record<string, unknown>, enabled = true): AppPageDocument => ({
  schema_version: 1 as never,
  blocks: [
    { id: 'search', type: 'search', enabled: true, props: {} },
    { id: 'policies', type: 'policies', enabled, props },
  ],
});
const policiesOf = (p: AppPageDocument) => p.blocks.find((b) => b.type === 'policies')!.props;

describe('booking time formatting', () => {
  it('formats check-in as "Desde las ..."', () => {
    expect(formatCheckIn('15:00')).toBe('Desde las 3:00 p. m.');
    expect(formatCheckIn('08:30')).toBe('Desde las 8:30 a. m.');
    expect(formatCheckIn('00:00')).toBe('Desde las 12:00 a. m.');
  });

  it('formats check-out as "Hasta las ..." with noon as "m."', () => {
    expect(formatCheckOut('12:00')).toBe('Hasta las 12:00 m.');
    expect(formatCheckOut('11:00')).toBe('Hasta las 11:00 a. m.');
    expect(formatCheckOut('12:30')).toBe('Hasta las 12:30 p. m.');
  });

  it('returns null for an invalid time', () => {
    expect(formatCheckIn('late')).toBeNull();
    expect(formatCheckOut('25:00')).toBeNull();
  });
});

describe('fillPolicies', () => {
  const values = { check_in: 'Desde las 3:00 p. m.', check_out: 'Hasta las 12:00 m.', cancellation: 'Flexible: gratis' };

  it('fills the empty texts from the settings', () => {
    const out = fillPolicies(page({ title: 'Políticas' }), values);
    expect(policiesOf(out)).toEqual({ title: 'Políticas', ...values });
  });

  it('never overwrites a text the owner saved', () => {
    const out = fillPolicies(page({ check_in: 'A las 2', cancellation: '  ' }), values);
    expect(policiesOf(out)).toEqual({ check_in: 'A las 2', check_out: values.check_out, cancellation: values.cancellation });
  });

  it('does not mutate the input and ignores pages without policies', () => {
    const input = page({});
    fillPolicies(input, values);
    expect(policiesOf(input)).toEqual({});
    const bare: AppPageDocument = { schema_version: 1 as never, blocks: [] };
    expect(fillPolicies(bare, values)).toEqual(bare);
  });
});

describe('BookingPoliciesService', () => {
  const build = (hospitality: Record<string, unknown> | null, plan: unknown) => {
    const prisma = {
      store_settings: { findFirst: jest.fn().mockResolvedValue(hospitality ? { settings: { hospitality } } : null) },
      lodging_rate_plans: { findFirst: jest.fn().mockResolvedValue(plan) },
    };
    return { prisma, service: new BookingPoliciesService(prisma as never) };
  };
  const plan = {
    cancellation_policy: {
      id: 1,
      name: 'Flexible',
      is_active: true,
      rules: [{ hours_before: 48, penalty_type: 'nights', penalty_value: 1 }],
      no_show_penalty: null,
    },
  };

  it('defaults() gives the texts the editor preview uses, scoped by store (S11)', async () => {
    const { prisma, service } = build({ check_in_time: '14:00', check_out_time: '11:00' }, plan);
    await expect(service.defaults(7)).resolves.toEqual({
      check_in: 'Desde las 2:00 p. m.',
      check_out: 'Hasta las 11:00 a. m.',
      cancellation: 'Flexible: gratis hasta 48 h antes de la llegada; menos de 48 h: 1 noche',
    });
    expect(prisma.store_settings.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { store_id: 7 } }),
    );
    expect(prisma.lodging_rate_plans.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ store_id: 7 }) }),
    );
  });

  it('fills from the store settings and the default rate plan, scoped by store', async () => {
    const { prisma, service } = build({ check_in_time: '15:00', check_out_time: '12:00' }, plan);
    const out = await service.fill(7, page({ title: 'Políticas' }));
    expect(policiesOf(out)).toEqual({
      title: 'Políticas',
      check_in: 'Desde las 3:00 p. m.',
      check_out: 'Hasta las 12:00 m.',
      cancellation: 'Flexible: gratis hasta 48 h antes de la llegada; menos de 48 h: 1 noche',
    });
    expect(prisma.store_settings.findFirst.mock.calls[0][0].where).toEqual({ store_id: 7 });
    expect(prisma.lodging_rate_plans.findFirst.mock.calls[0][0].where).toMatchObject({
      store_id: 7,
      is_default: true,
      is_active: true,
    });
  });

  it('defaults to 15:00 / 12:00 and leaves cancellation empty without a policy', async () => {
    const { service } = build(null, { cancellation_policy: null });
    const out = await service.fill(7, page({}));
    expect(policiesOf(out)).toEqual({ check_in: 'Desde las 3:00 p. m.', check_out: 'Hasta las 12:00 m.' });
  });

  it('skips the queries when no enabled policies block needs them', async () => {
    const { prisma, service } = build({}, plan);
    const full = page({ check_in: 'a', check_out: 'b', cancellation: 'c' });
    expect(await service.fill(7, full)).toEqual(full);
    expect(await service.fill(7, page({}, false))).toEqual(page({}, false));
    expect(prisma.store_settings.findFirst).not.toHaveBeenCalled();
  });
});
