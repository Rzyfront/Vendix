import {
  bookingLabel,
  bookingTarget,
  formatDuration,
  serviceCategories,
  servicesInCategory,
} from './service-page.util';

describe('service page util', () => {
  const facial = { id: 1, name: 'Facial', slug: 'facial' };
  const spa = { id: 2, name: 'Spa', slug: 'spa' };
  const services = [
    { id: 10, slug: 'limpieza', categories: [facial], requires_booking: true },
    { id: 11, slug: 'masaje', categories: [spa], requires_booking: true },
    { id: 12, slug: 'hidratacion', categories: [facial, spa], requires_booking: false },
    { id: 13, slug: 'asesoria', categories: [], requires_booking: true },
  ];

  it('lists categories in order of appearance with their counts', () => {
    expect(serviceCategories(services)).toEqual([
      { ...facial, count: 2 },
      { ...spa, count: 2 },
    ]);
  });

  it('filters by category and keeps the page order', () => {
    expect(servicesInCategory(services, 2).map((s) => s.id)).toEqual([11, 12]);
    expect(servicesInCategory(services, null)).toBe(services);
  });

  it('formats the duration', () => {
    expect(formatDuration(45)).toBe('45 min');
    expect(formatDuration(60)).toBe('1 h');
    expect(formatDuration(90)).toBe('1 h 30 min');
    expect(formatDuration(0)).toBeNull();
    expect(formatDuration(null)).toBeNull();
  });

  it('books bookable services and opens the detail of the rest', () => {
    expect(bookingTarget(services[0])).toEqual(['/book', 10]);
    expect(bookingTarget(services[2])).toEqual(['/products', 'hidratacion']);
  });

  it('a multi-day plan opens its detail with «Ver plan» (QUI-1060)', () => {
    const plan = { id: 14, slug: 'tour-3-dias', categories: [], requires_booking: true, is_plan: true };
    expect(bookingTarget(plan)).toEqual(['/products', 'tour-3-dias']);
    expect(bookingLabel(plan, true)).toBe('Ver plan');
    expect(bookingLabel(services[0], true)).toBe('Reservar');
    expect(bookingLabel(services[0], false)).toBe('Ver servicio');
    expect(bookingLabel(services[2], true)).toBe('Ver servicio');
  });
});
