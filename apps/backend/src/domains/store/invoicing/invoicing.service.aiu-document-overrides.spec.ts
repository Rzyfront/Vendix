import { RequestContextService } from '../../../common/context/request-context.service';
import { VendixHttpException } from 'src/common/errors';
import { InvoicingService } from './invoicing.service';
import {
  InvoiceProfileConfig,
  buildDefaultAiuProfileConfig,
} from './profiles/invoice-profile-config.contract';
import { InvoiceCalculatorAiuInput } from './services/invoice-calculator.service';

/**
 * C.7 — LOS TRES CONTROLES QUE EL DOCUMENTO PUEDE APARTAR DEL PERFIL.
 *
 * Antes de este paso, `resolveAiuContext` derivaba `taxable_basis`,
 * `enforce_minimum_base` y `minimum_base_percent` EXCLUSIVAMENTE de
 * `profile_aiu`/`store_settings` — el documento no tenía forma de apartarse.
 * Este archivo cubre las dos mitades de C.7 que le tocan al backend:
 *
 *   1. Precedencia documento → perfil/tienda en `resolveAiuContext`, con la
 *      MISMA regla de ausencia que ya rige `contract_object`.
 *   2. La compuerta base↔matriz reusada en la escritura del documento
 *      (`assertAiuBaseMatchesProfileMatrix`), con el MISMO código
 *      `INVOICING_PROFILE_005` que usa el editor de perfiles.
 *
 * ## Por qué se instancia por prototipo
 *
 * Los dos métodos bajo prueba son privados y, con `profile_aiu` presente
 * (`resolveAiuContext`) o con la config ya resuelta en memoria
 * (`assertAiuBaseMatchesProfileMatrix`), ninguno toca Prisma. Mismo patrón que
 * `invoicing.service.aiu-matrix.spec.ts` con `buildAiuTaxableMatrix`: levantar
 * el grafo de ~14 dependencias de `InvoicingService` mediría el grafo, no la
 * regla. `resolveAiuContext` sí llama a `this.getContext()`, así que se
 * envuelve en `RequestContextService.run`.
 */
describe('InvoicingService · C.7 controles AIU apartables por documento', () => {
  const service = Object.create(InvoicingService.prototype) as any;

  const requestContext = {
    user_id: 1,
    organization_id: 1,
    store_id: 2,
    is_super_admin: false,
    is_owner: true,
  };

  const withContext = <T>(fn: () => T): T =>
    RequestContextService.run(requestContext as any, fn);

  describe('resolveAiuContext — precedencia documento → perfil', () => {
    /**
     * Perfil congelado con `regime: 'et_462_1'` (⇒ `taxable_basis` derivado
     * 'aiu'), piso exigido al 10 % — igual al que siembra
     * `buildDefaultAiuProfileConfig`, el mismo fixture que usa el resto de la
     * suite de perfiles.
     */
    const profileAiu = () => buildDefaultAiuProfileConfig('Aseo sede norte').aiu!;

    it('sin overrides, el documento se comporta EXACTAMENTE como antes de C.7 (checklist #4)', async () => {
      const result = await withContext(() =>
        service.resolveAiuContext('09', [], 'Contrato de aseo', profileAiu()),
      );

      expect(result.aiu?.taxable_basis).toBe('aiu');
      expect(result.aiu?.enforce_minimum_base).toBe(true);
      expect(result.aiu?.minimum_base_percent).toBe('10.00');
    });

    it('aiu_taxable_basis del documento gana sobre el del perfil', async () => {
      const result = await withContext(() =>
        service.resolveAiuContext('09', [], 'Contrato de aseo', profileAiu(), {
          taxable_basis: 'subtotal',
        }),
      );

      expect(result.aiu?.taxable_basis).toBe('subtotal');
    });

    it('aiu_enforce_minimum_base: false del documento gana sobre el true del perfil', async () => {
      // Nullish, no falsy: si esto pasara por `||` un `false` explícito del
      // documento desaparecería y volvería a ganar el `true` del perfil.
      const result = await withContext(() =>
        service.resolveAiuContext('09', [], 'Contrato de aseo', profileAiu(), {
          enforce_minimum_base: false,
        }),
      );

      expect(result.aiu?.enforce_minimum_base).toBe(false);
    });

    it('aiu_minimum_base_percent del documento gana sobre el del perfil', async () => {
      const result = await withContext(() =>
        service.resolveAiuContext('09', [], 'Contrato de aseo', profileAiu(), {
          minimum_base_percent: 15,
        }),
      );

      expect(result.aiu?.minimum_base_percent).toBe(15);
    });

    it('overrides ausentes (undefined) no pisan el valor del perfil', async () => {
      const result = await withContext(() =>
        service.resolveAiuContext('09', [], 'Contrato de aseo', profileAiu(), {
          taxable_basis: undefined,
          enforce_minimum_base: undefined,
          minimum_base_percent: undefined,
        }),
      );

      expect(result.aiu?.taxable_basis).toBe('aiu');
      expect(result.aiu?.enforce_minimum_base).toBe(true);
      expect(result.aiu?.minimum_base_percent).toBe('10.00');
    });
  });

  describe('assertAiuBaseMatchesProfileMatrix — compuerta base↔matriz en la escritura del documento', () => {
    const frozenConfig = (): InvoiceProfileConfig =>
      buildDefaultAiuProfileConfig('Aseo sede norte');

    const getIssue = (fn: () => void): any => {
      let error: any;
      try {
        fn();
      } catch (e) {
        error = e;
      }
      return error;
    };

    it('no lanza cuando el documento no se aparta de la base del perfil (checklist #4)', () => {
      const config = frozenConfig();
      const effective_aiu: InvoiceCalculatorAiuInput = {
        taxable_basis: 'aiu',
        enforce_minimum_base: true,
        minimum_base_percent: '10.00',
      };

      expect(() =>
        service.assertAiuBaseMatchesProfileMatrix(config, effective_aiu, '09', 1),
      ).not.toThrow();
    });

    it('no lanza sin perfil (flujo manual) aunque haya aiu efectivo', () => {
      const effective_aiu: InvoiceCalculatorAiuInput = { taxable_basis: 'subtotal' };

      expect(() =>
        service.assertAiuBaseMatchesProfileMatrix(null, effective_aiu, '09', null),
      ).not.toThrow();
    });

    it('no lanza sin aiu efectivo (documento no-AIU) aunque haya perfil', () => {
      const config = frozenConfig();

      expect(() =>
        service.assertAiuBaseMatchesProfileMatrix(config, undefined, '01', 1),
      ).not.toThrow();
    });

    it('no lanza cuando el perfil no declara taxes.rules', () => {
      const config = frozenConfig();
      (config as any).taxes = { rules: [] };
      const effective_aiu: InvoiceCalculatorAiuInput = { taxable_basis: 'subtotal' };

      expect(() =>
        service.assertAiuBaseMatchesProfileMatrix(config, effective_aiu, '09', 1),
      ).not.toThrow();
    });

    it('LANZA INVOICING_PROFILE_005 con TAX_MATRIX_CONTRADICTS_REGIME cuando el documento se aparta a una base que la matriz congelada no cubre', () => {
      // La matriz congelada es la de 'aiu' (administracion/imprevistos/utilidad
      // gravan, costo no). El documento se declara 'utilidad': bajo esa base
      // sólo utilidad debería gravar, así que administracion e imprevistos
      // quedan contradiciendo la matriz congelada.
      const config = frozenConfig();
      const effective_aiu: InvoiceCalculatorAiuInput = {
        taxable_basis: 'utilidad',
        enforce_minimum_base: false,
      };

      const error = getIssue(() =>
        service.assertAiuBaseMatchesProfileMatrix(config, effective_aiu, '09', 7),
      );

      expect(error).toBeInstanceOf(VendixHttpException);
      expect(error.getStatus()).toBe(422);
      expect(error.errorCode).toBe('INVOICING_PROFILE_005');
      const response = error.getResponse();
      expect(response.error_code).toBe('INVOICING_PROFILE_005');
      expect(response.details.profile_id).toBe(7);
      // administracion e imprevistos gravan en la matriz congelada ('aiu') y
      // no deberían bajo 'utilidad': exactamente 2 issues, y SOLO ese código
      // — ninguna otra sección (formato, DIAN, retenciones, moneda…) puede
      // colarse en lo que ve el cliente, se filtra adentro.
      expect(response.details.issue_count).toBe(2);
      expect(
        response.details.issues.every(
          (i: any) => i.code === 'TAX_MATRIX_CONTRADICTS_REGIME',
        ),
      ).toBe(true);
      expect(
        response.details.issues.map((i: any) => i.field).sort(),
      ).toEqual([
        'taxes.rules.administracion.taxable',
        'taxes.rules.imprevistos.taxable',
      ]);
    });

    it('LANZA cuando el documento se aparta a subtotal y la matriz congelada nunca declaró el costo gravable', () => {
      const config = frozenConfig();
      const effective_aiu: InvoiceCalculatorAiuInput = {
        taxable_basis: 'subtotal',
      };

      const error = getIssue(() =>
        service.assertAiuBaseMatchesProfileMatrix(config, effective_aiu, '09', 3),
      );

      expect(error).toBeInstanceOf(VendixHttpException);
      const response = error.getResponse();
      const costoIssue = response.details.issues.find(
        (i: any) => i.field === 'taxes.rules.costo.taxable',
      );
      // Bajo 'subtotal' el costo SÍ entra a la base (`AIU_TAXABLE_BUCKETS_BY_BASIS`)
      // y la matriz congelada lo declaró `taxable: false` — la falta en la
      // dirección contraria a `TAX_COST_MUST_NOT_BE_TAXABLE` (que dispara
      // cuando el costo grava y bajo la base NO debería), así que
      // `validateTaxSection` la reporta con el código genérico, el mismo que
      // usa el perfil.
      expect(costoIssue).toBeDefined();
      expect(costoIssue.code).toBe('TAX_MATRIX_CONTRADICTS_REGIME');
    });
  });
});
