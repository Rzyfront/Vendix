import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * QUI-1029: en móvil (<640px) las tarjetas KPI del Panel Principal de Super
 * Admin deben usar la tira horizontal deslizable global de .stats-container,
 * no apilarse en una columna. El componente solo ajusta tablet a 2 columnas.
 */
const source = readFileSync(join(__dirname, 'dashboard.component.ts'), 'utf8');
const globalStyles = readFileSync(join(__dirname, '../../../../../styles.scss'), 'utf8');

describe('QUI-1029 super-admin dashboard stats layout', () => {
  it('no pisa el modo móvil con una columna', () => {
    expect(source).not.toMatch(/grid-template-columns:\s*1fr\s*;/);
    expect(source).not.toMatch(/max-width:\s*640px/);
  });

  it('solo ajusta tablet (640-1023px) a 2 columnas', () => {
    expect(source).toMatch(/@media \(min-width: 640px\) and \(max-width: 1023px\)/);
    expect(source).toContain('grid-template-columns: repeat(2, 1fr);');
  });

  it('el estilo global sigue dando tira horizontal en móvil', () => {
    const block = globalStyles.match(/\n\.stats-container\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(block).toContain('@media (max-width: 639px)');
    expect(block).toContain('overflow-x: auto;');
    expect(block).toContain('display: flex;');
  });
});
