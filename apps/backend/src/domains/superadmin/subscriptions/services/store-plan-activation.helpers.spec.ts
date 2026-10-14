import { Prisma } from '@prisma/client';
import {
  DAY_MS,
  billingCycleMs,
  computeActivationQuote,
  computeActivationWindow,
  isActivationStartInRange,
  todayInBogota,
} from './store-plan-activation.helpers';

const D = (v: string) => new Prisma.Decimal(v);

describe('store-plan-activation.helpers', () => {
  describe('billingCycleMs', () => {
    it('maps cycles', () => {
      expect(billingCycleMs('monthly')).toBe(30 * DAY_MS);
      expect(billingCycleMs('quarterly')).toBe(90 * DAY_MS);
      expect(billingCycleMs('semiannual')).toBe(180 * DAY_MS);
      expect(billingCycleMs('annual')).toBe(365 * DAY_MS);
      expect(billingCycleMs('lifetime')).toBe(100 * 365 * DAY_MS);
      expect(billingCycleMs('weird')).toBe(30 * DAY_MS);
    });
  });

  describe('computeActivationWindow', () => {
    const now = new Date('2026-10-13T15:00:00Z');
    it('without startsAt uses now', () => {
      const w = computeActivationWindow('monthly', undefined, now);
      expect(w.periodStart).toEqual(now);
      expect(w.periodEnd.getTime()).toBe(now.getTime() + 30 * DAY_MS);
    });
    it('past startsAt anchors at noon UTC', () => {
      const w = computeActivationWindow('annual', '2026-10-01', now);
      expect(w.periodStart.toISOString()).toBe('2026-10-01T12:00:00.000Z');
      expect(w.periodEnd.getTime()).toBe(w.periodStart.getTime() + 365 * DAY_MS);
    });
    it('today before noon UTC uses now', () => {
      const early = new Date('2026-10-13T08:00:00Z');
      const w = computeActivationWindow('monthly', '2026-10-13', early);
      expect(w.periodStart).toEqual(early);
    });
  });

  describe('isActivationStartInRange', () => {
    const now = new Date('2026-10-13T15:00:00Z');
    it('accepts today and today-31', () => {
      expect(isActivationStartInRange('2026-10-13', now)).toBe(true);
      expect(isActivationStartInRange('2026-09-12', now)).toBe(true);
    });
    it('rejects today-32 and tomorrow', () => {
      expect(isActivationStartInRange('2026-09-11', now)).toBe(false);
      expect(isActivationStartInRange('2026-10-14', now)).toBe(false);
    });
    it('rejects invalid formats', () => {
      expect(isActivationStartInRange('2026-13-45', now)).toBe(false);
      expect(isActivationStartInRange('abc', now)).toBe(false);
    });
    it('uses Bogota day at midnight boundary', () => {
      const edge = new Date('2026-10-14T03:00:00Z');
      expect(todayInBogota(edge)).toBe('2026-10-13');
      expect(isActivationStartInRange('2026-10-13', edge)).toBe(true);
      expect(isActivationStartInRange('2026-10-14', edge)).toBe(false);
    });
  });

  describe('computeActivationQuote', () => {
    const paid = { effective_price: D('100000'), margin_amount: D('0') };
    it('free plan yields zeros', () => {
      const q = computeActivationQuote({
        pricing: { effective_price: D('0'), margin_amount: D('0') },
        subscriptionMetadata: { pending_credit: '500' },
        amount: '50',
      });
      expect(q).toEqual({
        is_free: true,
        effective_price: '0.00',
        pending_credit_applied: '0.00',
        invoice_total: '0.00',
        amount_received: '0.00',
        excess_to_credit: '0.00',
        shortfall: '0.00',
      });
    });
    it('partial credit', () => {
      const q = computeActivationQuote({
        pricing: paid,
        subscriptionMetadata: { pending_credit: '30000.50' },
      });
      expect(q.pending_credit_applied).toBe('30000.50');
      expect(q.invoice_total).toBe('69999.50');
      expect(q.amount_received).toBe('69999.50');
      expect(q.excess_to_credit).toBe('0.00');
      expect(q.shortfall).toBe('0.00');
    });
    it('credit larger than price caps to total 0', () => {
      const q = computeActivationQuote({
        pricing: paid,
        subscriptionMetadata: { pending_credit: 250000 },
      });
      expect(q.pending_credit_applied).toBe('100000.00');
      expect(q.invoice_total).toBe('0.00');
    });
    it('excess, shortfall and exact amount', () => {
      const hi = computeActivationQuote({ pricing: paid, amount: '120000' });
      expect(hi.excess_to_credit).toBe('20000.00');
      expect(hi.shortfall).toBe('0.00');
      const lo = computeActivationQuote({ pricing: paid, amount: '90000' });
      expect(lo.shortfall).toBe('10000.00');
      expect(lo.excess_to_credit).toBe('0.00');
      const eq = computeActivationQuote({ pricing: paid, amount: '100000' });
      expect(eq.shortfall).toBe('0.00');
      expect(eq.excess_to_credit).toBe('0.00');
    });
    it('amount undefined defaults to total', () => {
      const q = computeActivationQuote({ pricing: paid });
      expect(q.amount_received).toBe('100000.00');
    });
  });
});
