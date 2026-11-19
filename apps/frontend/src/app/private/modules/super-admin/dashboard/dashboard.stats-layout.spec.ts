import { DashboardComponent } from './dashboard.component';

/**
 * QUI-1029: en móvil (<640px) las tarjetas KPI del Panel Principal de Super
 * Admin deben usar la tira horizontal deslizable global de .stats-container
 * (styles.scss), no apilarse en una columna. El componente solo ajusta tablet
 * a 2 columnas. Se leen los estilos compilados del componente (sin node:fs,
 * porque el job Frontend corre en el navegador con Karma).
 */
function componentStyles(): string {
  const def = (DashboardComponent as unknown as { ɵcmp?: { styles?: unknown[] } }).ɵcmp;
  return (def?.styles ?? []).map(String).join('\n').replace(/\s+/g, ' ');
}

describe('QUI-1029 super-admin dashboard stats layout', () => {
  it('no pisa el modo móvil con una sola columna', () => {
    const css = componentStyles();
    expect(css).not.toMatch(/grid-template-columns: ?1fr ?[;}]/);
    expect(css).not.toMatch(/max-width: ?640px/);
  });

  it('solo ajusta tablet (640-1023px) a 2 columnas', () => {
    const css = componentStyles();
    expect(css).toMatch(/min-width: ?640px\) and \(max-width: ?1023px/);
    expect(css).toMatch(/grid-template-columns: ?repeat\(2, ?1fr\)/);
  });
});
