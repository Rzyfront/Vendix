import { aggregateStat } from './aggregate-stat';

describe('aggregateStat (QUI-697)', () => {
  // Reseñas por Producto del QA: cinco productos, una reseña cada uno.
  const rows = [5, 5, 4, 5, 5].map((average_rating) => ({
    average_rating,
    total_reviews: 1,
  }));

  it('suma por defecto (comportamiento previo de los stats)', () => {
    expect(aggregateStat(rows, { key: 'total_reviews' })).toBe(5);
  });

  it('weighted_avg da 4.8 y no 24 en Promedio General', () => {
    const stat = { key: 'average_rating', aggregate: 'weighted_avg' as const, weightKey: 'total_reviews' };
    expect(aggregateStat(rows, stat)).toBeCloseTo(4.8);
  });

  it('weighted_avg pondera por el número de reseñas', () => {
    const stat = { key: 'average_rating', aggregate: 'weighted_avg' as const, weightKey: 'total_reviews' };
    const weighted = [
      { average_rating: 5, total_reviews: 3 },
      { average_rating: 1, total_reviews: 1 },
    ];
    expect(aggregateStat(weighted, stat)).toBeCloseTo(4);
  });

  it('weighted_avg sin peso total devuelve 0, no NaN', () => {
    const stat = { key: 'average_rating', aggregate: 'weighted_avg' as const, weightKey: 'total_reviews' };
    expect(aggregateStat([{ average_rating: null, total_reviews: 0 }], stat)).toBe(0);
  });
});
