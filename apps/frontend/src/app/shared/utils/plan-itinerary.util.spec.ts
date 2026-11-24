import {
  activitiesOutsideDuration,
  formatPlanDuration,
  groupItineraryByDay,
  itineraryDayDate,
} from './plan-itinerary.util';

describe('plan-itinerary.util (QUI-1060 F2)', () => {
  const acts = [
    { id: 1, day_number: 2, sort_order: 0, start_time: '09:00', title: 'D2' },
    { id: 2, day_number: 1, sort_order: 1, start_time: '07:00', title: 'D1 segunda' },
    { id: 3, day_number: 1, sort_order: 0, start_time: '10:00', title: 'D1 primera' },
    { id: 4, day_number: 1, sort_order: 0, start_time: null, title: 'D1 sin hora' },
    { id: 5, day_number: 4, sort_order: 0, start_time: null, title: 'Fuera' },
  ];

  it('agrupa por día y ordena por orden manual, hora y sin hora al final', () => {
    const days = groupItineraryByDay(acts, 3);
    expect(days.map((d) => d.day_number)).toEqual([1, 2]);
    expect(days[0].activities.map((a) => a.title)).toEqual(['D1 primera', 'D1 sin hora', 'D1 segunda']);
    expect(days[1].activities.map((a) => a.title)).toEqual(['D2']);
    expect(days[0].date).toBeNull();
  });

  it('en el panel incluye los días vacíos 1..N', () => {
    const days = groupItineraryByDay(acts, 3, { includeEmpty: true });
    expect(days.map((d) => [d.day_number, d.activities.length])).toEqual([
      [1, 3],
      [2, 1],
      [3, 0],
    ]);
  });

  it('pone fechas reales: día 1 = fecha de inicio, cruzando mes y año', () => {
    const days = groupItineraryByDay(acts, 3, { startDate: '2099-12-31', includeEmpty: true });
    expect(days.map((d) => d.date)).toEqual(['2099-12-31', '2100-01-01', '2100-01-02']);
    expect(itineraryDayDate('2099-02-28', 2)).toBe('2099-03-01');
  });

  it('separa las actividades que quedaron fuera de la duración', () => {
    expect(activitiesOutsideDuration(acts, 3).map((a) => a.id)).toEqual([5]);
    expect(activitiesOutsideDuration(acts, 1).map((a) => a.id)).toEqual([1, 5]);
  });

  it('formatea la duración en días y noches', () => {
    expect(formatPlanDuration(3, 2)).toBe('3 días / 2 noches');
    expect(formatPlanDuration(1, 0)).toBe('1 día');
    expect(formatPlanDuration(null)).toBe('');
  });
});
