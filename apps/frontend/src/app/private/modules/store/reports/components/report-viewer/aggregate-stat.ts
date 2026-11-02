import { ReportStatField } from '../../interfaces/report.interface';

const toNumber = (v: unknown): number | null => {
  const n = Number(v);
  return v == null || isNaN(n) ? null : n;
};

/**
 * Valor de un stat calculado en cliente sobre las filas del reporte.
 * `sum` suma la columna; `weighted_avg` pondera por `weightKey`
 * (QUI-697: el "Promedio General" sumaba promedios y daba 24 en escala 1–5).
 */
export function aggregateStat(
  rows: Array<Record<string, unknown>>,
  stat: Pick<ReportStatField, 'key' | 'aggregate' | 'weightKey'>,
): number {
  if (stat.aggregate === 'weighted_avg' && stat.weightKey) {
    // Filas sin valor (p. ej. producto sin reseñas aprobadas) no ponderan:
    // contarlas arrastraría el promedio hacia 0.
    let weighted = 0;
    let totalWeight = 0;
    for (const row of rows) {
      const value = toNumber(row[stat.key]);
      const weight = toNumber(row[stat.weightKey]) ?? 0;
      if (value === null || weight <= 0) continue;
      weighted += value * weight;
      totalWeight += weight;
    }
    return totalWeight > 0 ? weighted / totalWeight : 0;
  }
  return rows.reduce((acc, row) => acc + (toNumber(row[stat.key]) ?? 0), 0);
}
