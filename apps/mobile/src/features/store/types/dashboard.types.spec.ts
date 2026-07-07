/**
 * Smoke tests para los tokens de breakpoints (theme).
 *
 * Garantiza que `breakpoints` está alineado con Tailwind defaults
 * (paridad web). Si cambian los valores, el responsive de TODA la
 * app cambia también — el typecheck no atrapa esto, así que
 * necesitamos una prueba explícita.
 */
import { breakpoints } from '@/shared/theme/spacing';

describe('theme.breakpoints', () => {
  it('sm = 640 (Tailwind default)', () => {
    expect(breakpoints.sm).toBe(640);
  });

  it('md = 768 (Tailwind default — breakpoint principal de analytics)', () => {
    expect(breakpoints.md).toBe(768);
  });

  it('lg = 1024 (Tailwind default)', () => {
    expect(breakpoints.lg).toBe(1024);
  });

  it('xl = 1280 (Tailwind default)', () => {
    expect(breakpoints.xl).toBe(1280);
  });

  it('los breakpoints son monotónicamente crecientes', () => {
    expect(breakpoints.sm).toBeLessThan(breakpoints.md);
    expect(breakpoints.md).toBeLessThan(breakpoints.lg);
    expect(breakpoints.lg).toBeLessThan(breakpoints.xl);
  });
});
