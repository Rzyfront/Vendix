import { FiscalGateService } from './fiscal-gate.service';
import {
  createDefaultFiscalStatusBlock,
  FiscalArea,
  FiscalStatusBlock,
  FiscalStatusState,
} from '../interfaces/fiscal-status.interface';

/**
 * Cobertura completa de la matriz de estados que gobierna FiscalGateService.
 * La lógica que se prueba vive en `fiscal-gate.service.ts:54-155`:
 *  - isAreaEnabled: maestro (fiscal_status[area].state) o fallback legacy (module_flows).
 *  - isSubflowEnabled: AND jerárquico (maestro ∧ refinamiento granular).
 *  - Fail-closed ante excepciones de resolución de scope.
 */
describe('FiscalGateService', () => {
  /**
   * Construye un FiscalGateService con sus dos dependencias mockeadas a mano
   * (mismo estilo que fiscal-scope.service.spec.ts).
   */
  const createService = ({
    resolver,
    prismaStoreSettings = jest.fn().mockResolvedValue(null),
  }: {
    resolver: {
      getStatusBlock: jest.Mock;
    };
    prismaStoreSettings?: jest.Mock;
  }) => {
    const prisma = {
      withoutScope: () => ({
        store_settings: { findUnique: prismaStoreSettings },
      }),
    };
    return new FiscalGateService(resolver as any, prisma as any);
  };

  /** Construye un FiscalStatusBlock base con el state de un área forzado. */
  const blockWith = (
    overrides: Partial<Record<FiscalArea, FiscalStatusState>>,
  ): FiscalStatusBlock => {
    const base = createDefaultFiscalStatusBlock();
    for (const area of Object.keys(overrides) as FiscalArea[]) {
      base[area] = { ...base[area], state: overrides[area]! };
    }
    return base;
  };

  const resolverReturning = (fiscal_status: any, source_exists: boolean, store_id: number | null) => ({
    getStatusBlock: jest.fn().mockResolvedValue({
      fiscal_scope: store_id === null ? 'ORGANIZATION' : 'STORE',
      store_id,
      fiscal_status,
      source_exists,
    }),
  });

  // -----------------------------------------------------------------------
  // GRUPO A — isAreaEnabled, state materializado (source_exists=true)
  // -----------------------------------------------------------------------
  describe('A — isAreaEnabled con fiscal_status materializado', () => {
    it('A1. invoicing=ACTIVE → true', async () => {
      const resolver = resolverReturning(
        blockWith({ invoicing: 'ACTIVE' }),
        true,
        77,
      );
      const service = createService({ resolver });

      await expect(
        service.isAreaEnabled(1, 77, 'invoicing'),
      ).resolves.toBe(true);
    });

    it('A2. invoicing=LOCKED → true (LOCKED sigue operando, es histórico)', async () => {
      const resolver = resolverReturning(
        blockWith({ invoicing: 'LOCKED' }),
        true,
        77,
      );
      const service = createService({ resolver });

      await expect(
        service.isAreaEnabled(1, 77, 'invoicing'),
      ).resolves.toBe(true);
    });

    it('A3. invoicing=INACTIVE → false', async () => {
      const resolver = resolverReturning(
        blockWith({ invoicing: 'INACTIVE' }),
        true,
        77,
      );
      const service = createService({ resolver });

      await expect(
        service.isAreaEnabled(1, 77, 'invoicing'),
      ).resolves.toBe(false);
    });

    it('A4. invoicing=WIP → false (WIP no está en la whitelist ACTIVE|LOCKED)', async () => {
      const resolver = resolverReturning(
        blockWith({ invoicing: 'WIP' }),
        true,
        77,
      );
      const service = createService({ resolver });

      await expect(
        service.isAreaEnabled(1, 77, 'invoicing'),
      ).resolves.toBe(false);
    });

    it('A5. accounting=ACTIVE → true', async () => {
      const resolver = resolverReturning(
        blockWith({ accounting: 'ACTIVE' }),
        true,
        77,
      );
      const service = createService({ resolver });

      await expect(
        service.isAreaEnabled(1, 77, 'accounting'),
      ).resolves.toBe(true);
    });

    it('A6. payroll=ACTIVE → true', async () => {
      const resolver = resolverReturning(
        blockWith({ payroll: 'ACTIVE' }),
        true,
        77,
      );
      const service = createService({ resolver });

      await expect(
        service.isAreaEnabled(1, 77, 'payroll'),
      ).resolves.toBe(true);
    });

    it('A7. área sin clave en fiscal_status (undefined) → false', async () => {
      // Forzamos un block sin la clave 'payroll' para validar el fallback
      // `fiscal_status[area]?.state`. La normalización siempre rellena las
      // tres claves, por lo que un block con la clave faltante sólo se da
      // si el resolver no pasó por normalizeFiscalStatusBlock.
      const blockMissing: any = {
        invoicing: { state: 'ACTIVE' },
        accounting: { state: 'ACTIVE' },
        // payroll ausente
      };
      const resolver = resolverReturning(blockMissing, true, 77);
      const service = createService({ resolver });

      await expect(
        service.isAreaEnabled(1, 77, 'payroll'),
      ).resolves.toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // GRUPO B — isAreaEnabled, fallback legacy (source_exists=false)
  // -----------------------------------------------------------------------
  describe('B — isAreaEnabled con fallback legacy (source_exists=false)', () => {
    it('B1. module_flows[area].enabled === true → true', async () => {
      const resolver = resolverReturning(
        createDefaultFiscalStatusBlock(),
        false,
        77,
      );
      const prismaStoreSettings = jest.fn().mockResolvedValue({
        settings: { module_flows: { invoicing: { enabled: true } } },
      });
      const service = createService({ resolver, prismaStoreSettings });

      await expect(
        service.isAreaEnabled(1, 77, 'invoicing'),
      ).resolves.toBe(true);
    });

    it('B2. module_flows[area].enabled === false → false', async () => {
      const resolver = resolverReturning(
        createDefaultFiscalStatusBlock(),
        false,
        77,
      );
      const prismaStoreSettings = jest.fn().mockResolvedValue({
        settings: { module_flows: { invoicing: { enabled: false } } },
      });
      const service = createService({ resolver, prismaStoreSettings });

      await expect(
        service.isAreaEnabled(1, 77, 'invoicing'),
      ).resolves.toBe(false);
    });

    it('B3. module_flows ausente (legacy sin module_flows) → true (leniente)', async () => {
      const resolver = resolverReturning(
        createDefaultFiscalStatusBlock(),
        false,
        77,
      );
      // store_settings sin la clave module_flows
      const prismaStoreSettings = jest.fn().mockResolvedValue({
        settings: { something_else: true },
      });
      const service = createService({ resolver, prismaStoreSettings });

      await expect(
        service.isAreaEnabled(1, 77, 'invoicing'),
      ).resolves.toBe(true);
    });

    it('B4. module_flows presente, area accounting sin `accounting` key pero con `accounting_flows` → true', async () => {
      const resolver = resolverReturning(
        createDefaultFiscalStatusBlock(),
        false,
        77,
      );
      const prismaStoreSettings = jest.fn().mockResolvedValue({
        settings: {
          module_flows: {
            // No hay `accounting` key, pero sí `accounting_flows` (legacy)
            accounting_flows: { payments: true },
          },
        },
      });
      const service = createService({ resolver, prismaStoreSettings });

      await expect(
        service.isAreaEnabled(1, 77, 'accounting'),
      ).resolves.toBe(true);
    });

    it('B5. module_flows presente, area sin entry → false', async () => {
      const resolver = resolverReturning(
        createDefaultFiscalStatusBlock(),
        false,
        77,
      );
      const prismaStoreSettings = jest.fn().mockResolvedValue({
        settings: {
          module_flows: {
            invoicing: { enabled: true },
            payroll: { enabled: true },
            // sin `accounting` ni `accounting_flows`
          },
        },
      });
      const service = createService({ resolver, prismaStoreSettings });

      await expect(
        service.isAreaEnabled(1, 77, 'accounting'),
      ).resolves.toBe(false);
    });

    it('B6. resolved_store_id null (scope ORGANIZATION) → true (leniente, sin acceso a module_flows)', async () => {
      // Cuando fiscal_scope=ORGANIZATION, el resolver devuelve store_id=null.
      // El fallback legacy salta directo a `return true` (legacyAreaEnabled línea 131).
      const resolver = resolverReturning(
        createDefaultFiscalStatusBlock(),
        false,
        null,
      );
      const prismaStoreSettings = jest.fn().mockResolvedValue({
        settings: { module_flows: { accounting: { enabled: false } } },
      });
      const service = createService({ resolver, prismaStoreSettings });

      // store_id null al llamar al gate también: el resolver lo normaliza a null.
      await expect(
        service.isAreaEnabled(1, null, 'accounting'),
      ).resolves.toBe(true);
      // Y no se llega a consultar store_settings en este caso.
      expect(prismaStoreSettings).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // GRUPO C — isSubflowEnabled, AND jerárquico
  // -----------------------------------------------------------------------
  describe('C — isSubflowEnabled con AND jerárquico (maestro ∧ subflow)', () => {
    it('C1. accounting=ACTIVE + module_flows.accounting.payments undefined → true (default habilitado)', async () => {
      const resolver = resolverReturning(
        blockWith({ accounting: 'ACTIVE' }),
        true,
        77,
      );
      const prismaStoreSettings = jest.fn().mockResolvedValue({
        settings: { module_flows: { accounting: { other: true } } },
      });
      const service = createService({ resolver, prismaStoreSettings });

      await expect(
        service.isSubflowEnabled(1, 77, 'payments'),
      ).resolves.toBe(true);
    });

    it('C2. accounting=ACTIVE + module_flows.accounting.payments === false → false (subflow granular apaga)', async () => {
      const resolver = resolverReturning(
        blockWith({ accounting: 'ACTIVE' }),
        true,
        77,
      );
      const prismaStoreSettings = jest.fn().mockResolvedValue({
        settings: {
          module_flows: { accounting: { payments: false } },
        },
      });
      const service = createService({ resolver, prismaStoreSettings });

      await expect(
        service.isSubflowEnabled(1, 77, 'payments'),
      ).resolves.toBe(false);
    });

    it('C3. accounting=ACTIVE + module_flows.accounting.payments === true → true', async () => {
      const resolver = resolverReturning(
        blockWith({ accounting: 'ACTIVE' }),
        true,
        77,
      );
      const prismaStoreSettings = jest.fn().mockResolvedValue({
        settings: {
          module_flows: { accounting: { payments: true } },
        },
      });
      const service = createService({ resolver, prismaStoreSettings });

      await expect(
        service.isSubflowEnabled(1, 77, 'payments'),
      ).resolves.toBe(true);
    });

    it('C4. accounting=INACTIVE + module_flows.accounting.payments === true → false (el maestro corta)', async () => {
      const resolver = resolverReturning(
        blockWith({ accounting: 'INACTIVE' }),
        true,
        77,
      );
      const prismaStoreSettings = jest.fn().mockResolvedValue({
        settings: {
          module_flows: { accounting: { payments: true } },
        },
      });
      const service = createService({ resolver, prismaStoreSettings });

      await expect(
        service.isSubflowEnabled(1, 77, 'payments'),
      ).resolves.toBe(false);
      // El maestro corta antes, así que no se consulta module_flows.
      expect(prismaStoreSettings).not.toHaveBeenCalled();
    });

    it('C5. invoicing=ACTIVE + accounting=ACTIVE → isSubflowEnabled("invoice.accepted") → true', async () => {
      // 'invoice.accepted' no está en SUBFLOW_TO_AREA → resolveArea devuelve
      // 'accounting' (default). Para que la evaluación sea true se necesita
      // que el área maestra real (accounting) esté ACTIVE.
      const resolver = resolverReturning(
        blockWith({ invoicing: 'ACTIVE', accounting: 'ACTIVE' }),
        true,
        77,
      );
      const prismaStoreSettings = jest.fn().mockResolvedValue(null);
      const service = createService({ resolver, prismaStoreSettings });

      await expect(
        service.isSubflowEnabled(1, 77, 'invoice.accepted'),
      ).resolves.toBe(true);
    });

    it('C6. payroll=ACTIVE + accounting=ACTIVE → isSubflowEnabled("payroll.approved") → true', async () => {
      // 'payroll.approved' tampoco está en SUBFLOW_TO_AREA → area=accounting.
      const resolver = resolverReturning(
        blockWith({ payroll: 'ACTIVE', accounting: 'ACTIVE' }),
        true,
        77,
      );
      const prismaStoreSettings = jest.fn().mockResolvedValue(null);
      const service = createService({ resolver, prismaStoreSettings });

      await expect(
        service.isSubflowEnabled(1, 77, 'payroll.approved'),
      ).resolves.toBe(true);
    });

    it('C7. subflow desconocido ("foo") → resuelve a area "accounting" por default', async () => {
      // accounting=ACTIVE + sin module_flows → el subflowAllowed devuelve true.
      // Si el area resuelta fuera otra (p.ej. invoicing), con invoicing=INACTIVE
      // el resultado sería false, demostrando que el routing por default es
      // hacia accounting.
      const resolver = resolverReturning(
        blockWith({ accounting: 'ACTIVE', invoicing: 'INACTIVE' }),
        true,
        77,
      );
      const prismaStoreSettings = jest.fn().mockResolvedValue(null);
      const service = createService({ resolver, prismaStoreSettings });

      await expect(
        service.isSubflowEnabled(1, 77, 'foo'),
      ).resolves.toBe(true);
    });

    it('C7b. resolveArea retorna "invoicing" / "payroll" para sus flow keys explícitos', () => {
      const resolver = resolverReturning(
        createDefaultFiscalStatusBlock(),
        true,
        77,
      );
      const service = createService({ resolver });

      expect(service.resolveArea('invoicing')).toBe('invoicing');
      expect(service.resolveArea('payroll')).toBe('payroll');
      expect(service.resolveArea('payments')).toBe('accounting');
      expect(service.resolveArea('inventory')).toBe('accounting');
    });
  });

  // -----------------------------------------------------------------------
  // GRUPO D — fail-closed ante excepciones
  // -----------------------------------------------------------------------
  describe('D — fail-closed ante excepciones de resolución', () => {
    it('D1. resolver.getStatusBlock lanza → isAreaEnabled devuelve false', async () => {
      const resolver = {
        getStatusBlock: jest.fn().mockRejectedValue(new Error('boom')),
      };
      const service = createService({ resolver });

      await expect(
        service.isAreaEnabled(1, 77, 'accounting'),
      ).resolves.toBe(false);
    });

    it('D2. resolver.getStatusBlock lanza → isSubflowEnabled devuelve false', async () => {
      const resolver = {
        getStatusBlock: jest.fn().mockRejectedValue(new Error('boom')),
      };
      const service = createService({ resolver });

      await expect(
        service.isSubflowEnabled(1, 77, 'payments'),
      ).resolves.toBe(false);
    });

    it('D3. isAreaEnabled con store_id null (ORGANIZATION) maneja correctamente', async () => {
      // Cuando el gate recibe store_id=null, el resolver lo propaga como null
      // y el bloque fiscal_status se evalúa con normalidad (no se entra al
      // fallback legacy porque source_exists=true).
      const resolver = resolverReturning(
        blockWith({ accounting: 'ACTIVE' }),
        true,
        null,
      );
      const service = createService({ resolver });

      await expect(
        service.isAreaEnabled(1, null, 'accounting'),
      ).resolves.toBe(true);
      // Se invocó el resolver con store_id tal cual (null).
      expect(resolver.getStatusBlock).toHaveBeenCalledWith(1, null, undefined);
    });

    it('D3b. isAreaEnabled con store_id undefined → manejado como ORGANIZATION/legacy', async () => {
      // undefined cae en el camino del resolver, que lo trata como ORGANIZATION
      // cuando el fiscal_scope lo es. Forzamos source_exists=true con block ACTIVE.
      const resolver = resolverReturning(
        blockWith({ invoicing: 'ACTIVE' }),
        true,
        null,
      );
      const service = createService({ resolver });

      await expect(
        service.isAreaEnabled(1, undefined, 'invoicing'),
      ).resolves.toBe(true);
    });
  });
});
