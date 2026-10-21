import {
  buildReminderMessage,
  computeRecurrence,
  formatDayEs,
  localDayUtc,
  normalizeWhatsappPhone,
  summarizeSubject,
} from './service-reminders.utils';

const TZ = 'America/Bogota';

describe('service-reminders utils', () => {
  describe('computeRecurrence (store timezone)', () => {
    it('uses the store-local day: 23:30 Bogotá (04:30Z next day) counts as the local day', () => {
      const base = new Date('2026-10-04T04:30:00.000Z'); // 2026-10-03 23:30 Bogotá
      const now = new Date('2026-11-02T15:00:00.000Z'); // 2026-11-02 10:00 Bogotá
      const r = computeRecurrence(base, 30, now, TZ);
      expect(r.service_date).toBe('2026-10-03');
      expect(r.next_due_date).toBe('2026-11-02');
      expect(r.days_since).toBe(30);
      expect(r.days_remaining).toBe(0);
    });

    it('today in UTC already rolled over but not in Bogotá', () => {
      const base = new Date('2026-10-01T15:00:00.000Z');
      const now = new Date('2026-10-11T03:00:00.000Z'); // 2026-10-10 22:00 Bogotá
      const r = computeRecurrence(base, 10, now, TZ);
      expect(r.days_since).toBe(9);
      expect(r.days_remaining).toBe(1);
    });

    it('negative days_remaining when overdue', () => {
      const r = computeRecurrence(new Date('2026-09-01T15:00:00Z'), 30, new Date('2026-10-21T15:00:00Z'), TZ);
      expect(r.next_due_date).toBe('2026-10-01');
      expect(r.days_remaining).toBe(-20);
    });

    it('no recurrence → null next date / days_remaining', () => {
      const r = computeRecurrence(new Date('2026-09-01T15:00:00Z'), null, new Date('2026-10-21T15:00:00Z'), TZ);
      expect(r.next_due_date).toBeNull();
      expect(r.days_remaining).toBeNull();
      expect(r.days_since).toBe(50);
    });

    it('localDayUtc returns midnight UTC of the local civil date', () => {
      expect(localDayUtc(new Date('2026-10-04T04:30:00Z'), TZ).toISOString()).toBe('2026-10-03T00:00:00.000Z');
    });
  });

  describe('summarizeSubject', () => {
    it('vehicle from metadata', () => {
      expect(summarizeSubject({ subject_type: 'vehicle', label: 'Moto AKT - abc12d', metadata: { vehicle_name: 'Moto AKT', plate: 'abc12d' } }))
        .toEqual({ display: 'Moto AKT · ABC12D', phrase: 'moto AKT (ABC12D)', plate: 'ABC12D' });
    });
    it('vehicle from label fallback', () => {
      expect(summarizeSubject({ subject_type: 'vehicle', label: 'Mazda 3 - XYZ987', metadata: null })?.phrase).toBe('Mazda 3 (XYZ987)');
    });
    it('device', () => {
      expect(summarizeSubject({ subject_type: 'other', label: 'iPhone 12', metadata: { device_model: 'iPhone 12' } })?.display).toBe('iPhone 12');
    });
    it('person → null', () => {
      expect(summarizeSubject({ subject_type: 'person', label: 'Juan Pérez', metadata: {} })).toBeNull();
    });
  });

  describe('buildReminderMessage', () => {
    const base = {
      customerName: 'Juan Pérez',
      storeName: 'Taller Rápido',
      productName: 'Cambio de aceite',
      serviceDay: new Date('2026-10-03T00:00:00Z'),
      referenceYear: 2026,
    };

    it('due exactly at the interval, with vehicle', () => {
      expect(buildReminderMessage({ ...base, subjectPhrase: 'moto AKT (ABC12D)', intervalDays: 30, daysSince: 30 })).toBe(
        'Hola Juan, en Taller Rápido le hicimos el servicio de cambio de aceite a tu moto AKT (ABC12D) el 3 de oct. ' +
          'Ya pasaron 30 días, que es el periodo recomendado; te sugerimos agendar de nuevo para repetirlo. ¡Te esperamos!',
      );
    });

    it('omits subject when none', () => {
      const msg = buildReminderMessage({ ...base, subjectPhrase: null, intervalDays: 30, daysSince: 30 });
      expect(msg.startsWith('Hola Juan, en Taller Rápido te hicimos el servicio de cambio de aceite el 3 de oct.')).toBe(true);
      expect(msg).not.toContain('a tu');
    });

    it('overdue mentions the recommended period', () => {
      expect(buildReminderMessage({ ...base, subjectPhrase: null, intervalDays: 30, daysSince: 45 }))
        .toContain('Ya pasaron 45 días y el periodo recomendado es de 30 días');
    });

    it('not yet due tells how many days are left', () => {
      expect(buildReminderMessage({ ...base, subjectPhrase: null, intervalDays: 30, daysSince: 27 }))
        .toContain('en 3 días es buen momento');
    });

    it('non recurring is a thank-you', () => {
      expect(buildReminderMessage({ ...base, subjectPhrase: null, intervalDays: null, daysSince: 5 })).toContain('Gracias por confiar en nosotros');
    });

    it('generic greeting when customer is unknown', () => {
      expect(buildReminderMessage({ ...base, customerName: 'Cliente', subjectPhrase: null, intervalDays: null, daysSince: 1 }).startsWith('Hola, en')).toBe(true);
    });
  });

  it('formatDayEs adds the year only when it differs', () => {
    expect(formatDayEs(new Date('2025-12-24T00:00:00Z'), 2026)).toBe('24 de dic de 2025');
    expect(formatDayEs(new Date('2026-12-24T00:00:00Z'), 2026)).toBe('24 de dic');
  });

  it('normalizeWhatsappPhone', () => {
    expect(normalizeWhatsappPhone('300 123 4567')).toBe('573001234567');
    expect(normalizeWhatsappPhone('+57 300 123 4567')).toBe('573001234567');
    expect(normalizeWhatsappPhone('')).toBeNull();
  });
});
