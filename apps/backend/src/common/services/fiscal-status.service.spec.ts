import { FiscalStatusService } from './fiscal-status.service';
import type { FiscalWizardPrefill } from '../interfaces/fiscal-status.interface';

type LegalPrefillNonNull = Exclude<
  FiscalWizardPrefill['legal_data'],
  null
>;

/**
 * Cobertura de `deriveSatisfiedSteps.legal_data` — la regla de completitud que
 * gobierna el activation guard del wizard fiscal.
 *
 * Por qué existe este spec — el defecto que cierra:
 *
 * La regla original era `nit && nit_dv && fiscal_regime`. Eso hacía que el
 * activation guard marcara `legal_data` como SATISFECHO aunque
 * `legal_name` / `municipality_code` / `department` (los tres campos que el
 * resolvedor estricto exige para emitir) siguieran vacíos. El wizard cerraba,
 * el siguiente intento de emisión DIAN reventaba con
 * `No hay municipio DIAN para el NIT …` / `No hay departamento para el NIT …`,
 * y el tenant veía un error 500 en lugar de la lista de huecos que debía
 * recibir. La regla nueva espeja exactamente la salida del resolvedor estricto:
 * si `tryResolveTenantFiscalIdentity.missing` está vacío, el step está
 * satisfecho; si tiene CUALQUIER entrada, NO lo está — porque eso es lo que
 * tiraría la emisión.
 *
 * Las pruebas construyen los `sources` a mano (mismo patrón que
 * `fiscal-scope.service.spec.ts` y `fiscal-gate.service.spec.ts`) para evitar
 * levantar Prisma. `deriveSatisfiedSteps` es puro (síncrono, sin DB) y se accede
 * por `(service as any)` siguiendo la convención del repo.
 */
describe('FiscalStatusService — deriveSatisfiedSteps.legal_data', () => {
  /**
   * Construye el servicio con Prisma, resolver, EventEmitter y FiscalScope
   * todos mockeados. Ninguna prueba de este spec toca la red — la lógica
   * bajo prueba es pura.
   */
  const createService = () => {
    const prisma = { withoutScope: () => ({}) };
    const resolver = {
      getStatusBlock: jest.fn(),
      writeStatusBlock: jest.fn(),
    };
    const eventEmitter = {
      emit: jest.fn(),
    } as any;
    const fiscalScope = {} as any;
    return new FiscalStatusService(
      prisma as any,
      resolver as any,
      eventEmitter,
      fiscalScope,
    );
  };

  /** Cast a `any` para acceder al método privado puro bajo prueba. */
  const callDerive = (
    service: FiscalStatusService,
    sources: {
      legal_data: FiscalWizardPrefill['legal_data'];
      legal_data_missing: ('legal_name' | 'municipality_code' | 'department')[];
      dian_config?: FiscalWizardPrefill['dian_config'];
      resolution?: FiscalWizardPrefill['resolution'];
      puc?: FiscalWizardPrefill['puc'];
      accounting_period?: FiscalWizardPrefill['accounting_period'];
      default_taxes?: FiscalWizardPrefill['default_taxes'];
      accounting_mappings?: FiscalWizardPrefill['accounting_mappings'];
      initial_inventory?: FiscalWizardPrefill['initial_inventory'];
      payroll_config?: FiscalWizardPrefill['payroll_config'];
    },
  ) => (service as any).deriveSatisfiedSteps(sources);

  /**
   * Prefill mínimo: solo los campos que el predicate `legal_data` lee. Los
   * otros campos del `sources` se quedan `undefined` (la rama no los lee).
   * El tenant que ya pasó el wizard tendrá NIT real, DV derivado y
   * `tax_regime` poblado — los demás campos del prefill son ortogonales al
   * predicate y los omitimos para mantener el spec enfocado.
   */
  const legalDataSatisfiedByOldRule = (): LegalPrefillNonNull => ({
    organization_id: 1,
    legal_name: 'Empresa Demo SAS',
    tax_id: '900123456',
    nit: '900123456',
    nit_dv: '8',
    nit_type: 'NIT',
    person_type: 'JURIDICA',
    fiscal_address: null,
    fiscal_regime: 'COMUN',
    ciiu: null,
    tax_responsibilities: ['O-13'],
    tax_scheme: null,
  });

  // -----------------------------------------------------------------------
  // CASO A — el defecto que cerró este cambio
  // -----------------------------------------------------------------------
  describe('A — el predicate viejo etiquetaba SATISFECHO aunque la emisión reventaría', () => {
    /**
     * Tenant con `nit + nit_dv + tax_regime` pero SIN `legal_name`,
     * `municipality_code` ni `department`. Bajo la regla vieja esto devolvía
     * `legal_data` ∈ satisfied — el wizard finalizaba — y la siguiente
     * emisión tiraba `No hay razón social para el NIT …` /
     * `No hay municipio DIAN para el NIT …` /
     * `No hay departamento para el NIT …`. Bajo la regla nueva
     * (`legal_data_missing.length === 0`) el step queda NO satisfecho y el
     * activation guard devuelve la lista de huecos en `missing_steps`.
     */
    it('A1. tenant con nit+nit_dv+tax_regime pero municipality_code y department vacíos → legal_data NO satisfecho', () => {
      const service = createService();
      const sources = {
        legal_data: legalDataSatisfiedByOldRule(),
        // El strict resolver habría tirado por `municipality_code` y
        // `department`. Replicamos su `missing` verbatim.
        legal_data_missing: ['municipality_code', 'department'] as Array<
          'legal_name' | 'municipality_code' | 'department'
        >,
      };

      const satisfied = callDerive(service, sources);
      expect(satisfied.has('legal_data')).toBe(false);
    });

    /**
     * Mismo escenario pero el `missing` solo trae `legal_name` (caso orgánico:
     * el tenant guardó NIT y DV pero no subió razón social). La regla nueva
     * sigue marcando NO satisfecho.
     */
    it('A2. tenant sin legal_name → legal_data NO satisfecho', () => {
      const service = createService();
      const sources = {
        legal_data: legalDataSatisfiedByOldRule(),
        legal_data_missing: ['legal_name'] as Array<
          'legal_name' | 'municipality_code' | 'department'
        >,
      };

      const satisfied = callDerive(service, sources);
      expect(satisfied.has('legal_data')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // CASO B — el camino feliz exacto del strict resolver
  // -----------------------------------------------------------------------
  describe('B — completitud estricta (lo que el strict resolver aceptaría)', () => {
    /**
     * Tenant con NIT, DV, tax_regime, Y un resolvedor estricto que pasó (los
     * tres campos obligatorios resueltos). La pre-condición exacta que la
     * emisión exige para NO tirar. Esta es la definición operativa de
     * `legal_data satisfecho` a partir de este cambio.
     */
    it('B1. nit+nit_dv+tax_regime + resolver estricto completo → legal_data SATISFECHO', () => {
      const service = createService();
      const sources = {
        legal_data: legalDataSatisfiedByOldRule(),
        // `missing` vacío ⇒ `resolveTenantFiscalIdentity` no habría tirado.
        legal_data_missing: [] as Array<
          'legal_name' | 'municipality_code' | 'department'
        >,
      };

      const satisfied = callDerive(service, sources);
      expect(satisfied.has('legal_data')).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // CASO C — guardia por campo faltante (espejo del strict resolver)
  // -----------------------------------------------------------------------
  describe('C — un solo campo del strict resolver faltante ya marca el step como NO satisfecho', () => {
    it('C1. falta municipality_code → legal_data NO satisfecho (caso prod defect)', () => {
      const service = createService();
      const sources = {
        legal_data: legalDataSatisfiedByOldRule(),
        legal_data_missing: ['municipality_code'] as Array<
          'legal_name' | 'municipality_code' | 'department'
        >,
      };

      const satisfied = callDerive(service, sources);
      expect(satisfied.has('legal_data')).toBe(false);
    });

    it('C2. falta department → legal_data NO satisfecho (caso prod defect)', () => {
      const service = createService();
      const sources = {
        legal_data: legalDataSatisfiedByOldRule(),
        legal_data_missing: ['department'] as Array<
          'legal_name' | 'municipality_code' | 'department'
        >,
      };

      const satisfied = callDerive(service, sources);
      expect(satisfied.has('legal_data')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // CASO D — guardias explícitos que la regla vieja ya cubría
  // -----------------------------------------------------------------------
  describe('D — los tres chequeos que la regla vieja ya hacía se mantienen', () => {
    /**
     * Aunque `missing` esté vacío, sin un NIT el step NO puede estar
     * satisfecho: la emisión ni siquiera llega al chequeo de identidad. Esta
     * guarda explícita evita un regresión silenciosa si `missing` alguna
     * vez se computa incorrectamente.
     */
    it('D1. sin nit → legal_data NO satisfecho aunque missing esté vacío', () => {
      const service = createService();
      const prefill = legalDataSatisfiedByOldRule();
      const sources = {
        legal_data: {
          organization_id: prefill.organization_id,
          legal_name: prefill.legal_name,
          tax_id: prefill.tax_id,
          nit: null,
          nit_dv: prefill.nit_dv,
          nit_type: prefill.nit_type,
          person_type: prefill.person_type,
          fiscal_address: prefill.fiscal_address,
          fiscal_regime: prefill.fiscal_regime,
          ciiu: prefill.ciiu,
          tax_responsibilities: prefill.tax_responsibilities,
          tax_scheme: prefill.tax_scheme,
        },
        legal_data_missing: [] as Array<
          'legal_name' | 'municipality_code' | 'department'
        >,
      };

      const satisfied = callDerive(service, sources);
      expect(satisfied.has('legal_data')).toBe(false);
    });

    it('D2. sin nit_dv → legal_data NO satisfecho', () => {
      const service = createService();
      const prefill = legalDataSatisfiedByOldRule();
      const sources = {
        legal_data: {
          organization_id: prefill.organization_id,
          legal_name: prefill.legal_name,
          tax_id: prefill.tax_id,
          nit: prefill.nit,
          nit_dv: null,
          nit_type: prefill.nit_type,
          person_type: prefill.person_type,
          fiscal_address: prefill.fiscal_address,
          fiscal_regime: prefill.fiscal_regime,
          ciiu: prefill.ciiu,
          tax_responsibilities: prefill.tax_responsibilities,
          tax_scheme: prefill.tax_scheme,
        },
        legal_data_missing: [] as Array<
          'legal_name' | 'municipality_code' | 'department'
        >,
      };

      const satisfied = callDerive(service, sources);
      expect(satisfied.has('legal_data')).toBe(false);
    });

    /**
     * `tax_regime` no vive en `missing` (vive en `isVatResponsible` para la
     * proyección DIAN), pero la regla original lo exigía y el comentario en
     * la implementación lo sigue marcando como guardia explícita. Si un
     * tenant tiene identidad completa sin régimen, la proyección DIAN
     * queda con tax_regime='49' (no responsable) sin que se sepa si fue
     * elección o silencio — por eso se mantiene como guardia separada.
     */
    it('D3. sin fiscal_regime → legal_data NO satisfecho aunque la identidad esté completa', () => {
      const service = createService();
      const prefill = legalDataSatisfiedByOldRule();
      const sources = {
        legal_data: {
          organization_id: prefill.organization_id,
          legal_name: prefill.legal_name,
          tax_id: prefill.tax_id,
          nit: prefill.nit,
          nit_dv: prefill.nit_dv,
          nit_type: prefill.nit_type,
          person_type: prefill.person_type,
          fiscal_address: prefill.fiscal_address,
          fiscal_regime: null,
          ciiu: prefill.ciiu,
          tax_responsibilities: prefill.tax_responsibilities,
          tax_scheme: prefill.tax_scheme,
        },
        legal_data_missing: [] as Array<
          'legal_name' | 'municipality_code' | 'department'
        >,
      };

      const satisfied = callDerive(service, sources);
      expect(satisfied.has('legal_data')).toBe(false);
    });

    it('D4. legal_data === null → legal_data NO satisfecho (tenant sin settings fiscales en absoluto)', () => {
      const service = createService();
      const sources = {
        legal_data: null,
        legal_data_missing: [] as Array<
          'legal_name' | 'municipality_code' | 'department'
        >,
      };

      const satisfied = callDerive(service, sources);
      expect(satisfied.has('legal_data')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // CASO E — los OTROS steps quedan ortogonales al cambio
  // -----------------------------------------------------------------------
  describe('E — el cambio en legal_data NO afecta a los otros steps', () => {
    /**
     * Aunque `legal_data` esté NO satisfecho (faltan campos del strict
     * resolver), si DIAN config tiene cert vigente y PUC existe, esos dos
     * steps DEBEN quedar satisfechos. Esto evita que la corrección del
     * bug expanda falsamente la superficie de insatisfacción.
     */
    it('E1. dian_config con cert vigente y puc.exists=true → esos pasos SATISFECHOS aunque legal_data falte', () => {
      const service = createService();
      const sources = {
        legal_data: legalDataSatisfiedByOldRule(),
        legal_data_missing: ['municipality_code'] as Array<
          'legal_name' | 'municipality_code' | 'department'
        >,
        dian_config: {
          id: 1,
          name: 'Configuración principal',
          nit: '900123456',
          nit_type: 'NIT',
          nit_dv: '8',
          environment: 'production',
          operation_mode: 'standard',
          enablement_status: 'enabled',
          configuration_type: 'production',
          is_default: true,
          has_certificate: true,
          certificate_expiry: new Date(
            Date.now() + 365 * 24 * 60 * 60 * 1000,
          ).toISOString(),
          software_id: null,
          test_set_id: null,
          has_software_pin: false,
          inherited_certificate: false,
          inherited_from: null,
        },
        puc: { exists: true, total_accounts: 100, postable_accounts: 80 },
      };

      const satisfied = callDerive(service, sources);
      expect(satisfied.has('legal_data')).toBe(false);
      expect(satisfied.has('dian_config')).toBe(true);
      expect(satisfied.has('puc')).toBe(true);
    });
  });
});
