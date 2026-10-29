import { Prisma } from '@prisma/client';
import {
  amountDueNow,
  bookingConfirmationEmail,
  bookingHoldMinutes,
  holdExpiry,
  policyText,
} from './booking-engine-text';

describe('booking engine text (H6.6)', () => {
  it('cobra en línea el depósito del plan, o toda la estadía si el plan no pide depósito', () => {
    const total = new Prisma.Decimal(750000);
    expect(amountDueNow(total, new Prisma.Decimal(30)).toFixed(2)).toBe('225000.00');
    expect(amountDueNow(total, new Prisma.Decimal(0)).toFixed(2)).toBe('750000.00');
    expect(amountDueNow(total, new Prisma.Decimal(100)).toFixed(2)).toBe('750000.00');
  });

  it('el hold dura los minutos configurados (15 por defecto, entre 5 y 120)', () => {
    expect(bookingHoldMinutes(undefined)).toBe(15);
    expect(bookingHoldMinutes(30)).toBe(30);
    expect(bookingHoldMinutes(1)).toBe(5);
    expect(bookingHoldMinutes(500)).toBe(120);
    expect(holdExpiry(new Date('2026-11-01T15:00:00.000Z'), 15).toISOString()).toBe(
      '2026-11-01T15:15:00.000Z',
    );
  });

  it('muestra la política antes de pagar', () => {
    expect(policyText(null)).toBeNull();
    expect(
      policyText({
        id: 8,
        name: 'Flexible',
        rules: [{ hours_before: 48, penalty_type: 'nights', penalty_value: 1 }],
        no_show_penalty: { penalty_type: 'percent', penalty_value: 100 },
      }),
    ).toBe(
      'Flexible: gratis hasta 48 h antes de la llegada; menos de 48 h: 1 noche; no-show: 100 % de la estadía',
    );
  });

  it('el email de confirmación lleva número, fechas, pago y saldo, sin HTML inyectado', () => {
    const email = bookingConfirmationEmail({
      guest_name: '<b>Ana</b>',
      store_name: 'Hotel Roku',
      reservation_number: 'H-0012',
      arrival_date: '2026-11-20',
      departure_date: '2026-11-22',
      nights: 2,
      room_type: 'Doble',
      adults: 2,
      children: 0,
      total: '$ 500.000',
      paid: '$ 150.000',
      balance: '$ 350.000',
      check_in_time: '15:00',
      check_out_time: '12:00',
      policy: null,
      rnt_number: '12345',
    });
    expect(email.subject).toBe('Reserva H-0012 confirmada · Hotel Roku');
    // H4.3 — the voucher carries the hotel's RNT at its foot.
    expect(email.text).toContain('Hotel Roku · RNT 12345');
    expect(email.html).toContain('Hotel Roku · RNT 12345');
    expect(email.text).toContain('Llegada: 20-nov desde las 15:00');
    expect(email.text).toContain('Pagado en línea: $ 150.000');
    expect(email.text).toContain('Saldo en el hotel: $ 350.000');
    expect(email.html).toContain('&lt;b&gt;Ana&lt;/b&gt;');
    expect(email.html).not.toContain('<b>Ana</b>');
  });

  it('H4.3 — sin RNT el voucher no imprime la línea del RNT', () => {
    const email = bookingConfirmationEmail({
      guest_name: 'Ana',
      store_name: 'Hotel Roku',
      reservation_number: 'H-0012',
      arrival_date: '2026-11-20',
      departure_date: '2026-11-22',
      nights: 2,
      room_type: 'Doble',
      adults: 2,
      children: 0,
      total: '$ 500.000',
      paid: '$ 150.000',
      balance: '$ 350.000',
      check_in_time: '15:00',
      check_out_time: '12:00',
      policy: null,
      rnt_number: null,
    });
    expect(email.text).not.toContain('RNT');
    expect(email.html).not.toContain('RNT');
  });
});
