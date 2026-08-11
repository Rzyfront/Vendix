import {
  DianEnablementStatus,
  dianEnablementLabel,
  dianEnablementVariant,
  isProductionEnabled,
  isTestSetApproved,
} from './dian-enablement-status.util';

/**
 * Estos casos existen por un bug de producción.
 *
 * La guía de habilitación de tiendas marcaba «Set de pruebas completado» con
 * `enablement_status = 'testing'`, que significa EN CURSO. HIDRO INSTALACIONES lo
 * veía en verde con la DIAN sin haber juzgado nada. La de plataforma tenía el
 * defecto opuesto: exigía `enabled`, así que el paso se quedaba gris después de
 * que la DIAN aprobara el set.
 *
 * Lo que se fija acá es la frontera: `testing` NO es aprobado, y `test_set_passed`
 * SÍ lo es.
 */
describe('dian-enablement-status.util', () => {
  const ALL: DianEnablementStatus[] = [
    'not_started',
    'testing',
    'test_set_passed',
    'enabled',
    'suspended',
    'expired',
  ];

  describe('isTestSetApproved', () => {
    it('no cuenta `testing` como aprobado: es un lote enviado y sin juzgar', () => {
      expect(isTestSetApproved('testing')).toBe(false);
    });

    it('cuenta `test_set_passed`, que es el estado que deja la aprobación de la DIAN', () => {
      expect(isTestSetApproved('test_set_passed')).toBe(true);
    });

    it('sigue contando `enabled`: producción habilitada implica set aprobado', () => {
      expect(isTestSetApproved('enabled')).toBe(true);
    });

    it('no cuenta los estados sin veredicto favorable', () => {
      expect(isTestSetApproved('not_started')).toBe(false);
      expect(isTestSetApproved('suspended')).toBe(false);
      expect(isTestSetApproved('expired')).toBe(false);
    });
  });

  describe('isProductionEnabled', () => {
    it('solo `enabled` habilita producción; el set aprobado todavía no emite', () => {
      expect(isProductionEnabled('enabled')).toBe(true);
      expect(isProductionEnabled('test_set_passed')).toBe(false);
    });
  });

  describe('dianEnablementLabel', () => {
    it('da etiqueta a los 6 estados del enum, sin imprimir la cadena cruda', () => {
      for (const status of ALL) {
        const label = dianEnablementLabel(status);
        expect(label).toBeTruthy();
        // El defecto anterior era caer al `default` y mostrar `test_set_passed`
        // tal cual en pantalla.
        expect(label).not.toBe(status);
      }
    });

    it('distingue set aprobado de habilitado: son pasos distintos del checklist', () => {
      expect(dianEnablementLabel('test_set_passed')).not.toBe(
        dianEnablementLabel('enabled'),
      );
    });
  });

  describe('entradas inválidas', () => {
    it('un estado desconocido, null o undefined degradan a `not_started`', () => {
      // `in_progress` no existe en `dian_enablement_status_enum` y la guía de
      // plataforma tenía una rama para él: código muerto que además tapaba el
      // hecho de que los estados reales no estuvieran cubiertos.
      for (const bad of ['in_progress', '', null, undefined]) {
        expect(dianEnablementLabel(bad)).toBe(
          dianEnablementLabel('not_started'),
        );
        expect(dianEnablementVariant(bad)).toBe('neutral');
        expect(isTestSetApproved(bad)).toBe(false);
      }
    });
  });

  describe('dianEnablementVariant', () => {
    it('pinta en verde lo aprobado, en rojo lo roto y en ámbar lo que está en curso', () => {
      expect(dianEnablementVariant('test_set_passed')).toBe('success');
      expect(dianEnablementVariant('enabled')).toBe('success');
      expect(dianEnablementVariant('testing')).toBe('warning');
      expect(dianEnablementVariant('suspended')).toBe('error');
      expect(dianEnablementVariant('expired')).toBe('error');
      expect(dianEnablementVariant('not_started')).toBe('neutral');
    });
  });
});
