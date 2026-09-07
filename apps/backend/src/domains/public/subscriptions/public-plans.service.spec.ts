import { PublicPlansService } from './public-plans.service';

describe('PublicPlansService', () => {
  let service: PublicPlansService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      subscription_plans: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    service = new PublicPlansService(prisma);
  });

  /**
   * Shape of one `subscription_plans` row as returned by the whitelisted
   * `select` in findAll(). Overrides drive each case.
   */
  function planRow(overrides: Partial<any> = {}) {
    return {
      id: 1,
      code: 'pro',
      name: 'Pro',
      description: null,
      plan_type: 'base',
      billing_cycle: 'monthly',
      base_price: 99000,
      currency: 'COP',
      is_popular: false,
      is_promotional: false,
      sort_order: 0,
      ai_feature_flags: {},
      feature_matrix: [],
      details_md: null,
      plan_group_code: 'pro',
      ...overrides,
    };
  }

  async function featuresOf(feature_matrix: unknown) {
    prisma.subscription_plans.findMany.mockResolvedValue([
      planRow({ feature_matrix }),
    ]);
    const [plan] = await service.findAll();
    return plan.features;
  }

  describe('select / public shape', () => {
    it('asks Postgres for details_md and plan_group_code', async () => {
      await service.findAll();
      const args = prisma.subscription_plans.findMany.mock.calls[0][0];
      expect(args.select.details_md).toBe(true);
      expect(args.select.plan_group_code).toBe(true);
      // Sensitive billing internals stay out of the whitelist.
      expect(args.select.promo_rules).toBeUndefined();
      expect(args.select.max_partner_margin_pct).toBeUndefined();
      expect(args.select.resellable).toBeUndefined();
    });

    it('exposes details_md and plan_group_code on each plan', async () => {
      prisma.subscription_plans.findMany.mockResolvedValue([
        planRow({
          details_md: '## Incluye\n- POS',
          plan_group_code: 'pro-group',
        }),
      ]);

      const [plan] = await service.findAll();

      expect(plan.details_md).toBe('## Incluye\n- POS');
      expect(plan.plan_group_code).toBe('pro-group');
    });

    it('keeps only the public AI feature keys', async () => {
      prisma.subscription_plans.findMany.mockResolvedValue([
        planRow({
          ai_feature_flags: {
            text_generation: true,
            cost_multiplier: 3,
            internal_debug: true,
          },
        }),
      ]);

      const [plan] = await service.findAll();

      expect(plan.ai_features).toEqual({ text_generation: true });
    });
  });

  describe('parseFeatureMatrix — canonical ARRAY shape', () => {
    it('passes value and is_limited through untouched', async () => {
      const features = await featuresOf([
        {
          key: 'usuarios',
          label: 'Usuarios del equipo',
          enabled: true,
          is_limited: true,
          value: '1 usuario',
        },
        { key: 'api', label: 'API pública', enabled: false },
      ]);

      expect(features).toEqual([
        {
          key: 'usuarios',
          label: 'Usuarios del equipo',
          enabled: true,
          value: '1 usuario',
          is_limited: true,
          limit: null,
          unit: null,
        },
        {
          key: 'api',
          label: 'API pública',
          enabled: false,
          value: null,
          is_limited: false,
          limit: null,
          unit: null,
        },
      ]);
    });

    it('drops items whose resolved label is empty', async () => {
      const features = await featuresOf([
        { key: 'pos', label: 'POS', enabled: true },
        { key: 'vacio', label: '   ', enabled: true },
        { key: '', label: '', enabled: true },
      ]);

      expect(features.map((f) => f.key)).toEqual(['pos']);
    });

    it('deduplicates by key — the first occurrence wins', async () => {
      const features = await featuresOf([
        { key: 'pos', label: 'POS original', enabled: true },
        { key: 'pos', label: 'POS duplicado', enabled: false },
      ]);

      expect(features).toHaveLength(1);
      expect(features[0].label).toBe('POS original');
      expect(features[0].enabled).toBe(true);
    });

    it('derives a stable key from the index when the item has none', async () => {
      const features = await featuresOf([
        { label: 'Primer ítem', enabled: true },
        { key: '', label: 'Segundo ítem', enabled: true },
      ]);

      expect(features.map((f) => f.key)).toEqual(['item-1', 'item-2']);
    });

    it('falls back to the key as label and defaults enabled to true', async () => {
      const features = await featuresOf([{ key: 'soporte' }]);

      expect(features).toEqual([
        {
          key: 'soporte',
          label: 'soporte',
          enabled: true,
          value: null,
          is_limited: false,
          limit: null,
          unit: null,
        },
      ]);
    });
  });

  describe('parseFeatureMatrix — legacy OBJECT shape', () => {
    it('renders { max: n } as limited, with the cap embedded in the label only', async () => {
      const features = await featuresOf({ stores: { max: 3 } });

      expect(features).toEqual([
        {
          key: 'stores',
          label: 'Hasta 3 Sucursales / Tiendas',
          enabled: true,
          // null on purpose: the legacy label already reads "Hasta 3 ...", so
          // emitting the cap again would print the number twice on the card.
          value: null,
          is_limited: true,
          limit: 3,
          unit: null,
        },
      ]);
    });

    it('renders { max: null } as unlimited, not limited', async () => {
      const features = await featuresOf({ stores: { max: null } });

      expect(features).toEqual([
        {
          key: 'stores',
          label: 'Sucursales / Tiendas Ilimitadas',
          enabled: true,
          value: null,
          is_limited: false,
          limit: null,
          unit: null,
        },
      ]);
    });

    it('renders { channel } support without value or limited flag', async () => {
      const features = await featuresOf({ support: { channel: 'priority' } });

      expect(features).toEqual([
        {
          key: 'support',
          label: 'Soporte Prioritario WhatsApp',
          enabled: true,
          value: null,
          is_limited: false,
          limit: null,
          unit: null,
        },
      ]);
    });

    it('keeps boolean flags as enabled/disabled plain items', async () => {
      const features = await featuresOf({ pos: true, ecommerce: false });

      expect(features).toEqual([
        {
          key: 'pos',
          label: 'Punto de Venta POS (Online/Offline)',
          enabled: true,
          value: null,
          is_limited: false,
          limit: null,
          unit: null,
        },
        {
          key: 'ecommerce',
          label: 'Tienda Online & Pedidos WhatsApp',
          enabled: false,
          value: null,
          is_limited: false,
          limit: null,
          unit: null,
        },
      ]);
    });

    it('filters cost_*, partner_* and internal_* keys', async () => {
      const features = await featuresOf({
        pos: true,
        cost_multiplier: 3,
        partner_margin: 0.2,
        internal_notes: 'no publicar',
      });

      expect(features.map((f) => f.key)).toEqual(['pos']);
    });
  });

  describe('parseFeatureMatrix — empty inputs', () => {
    it('returns [] for null / undefined feature_matrix', async () => {
      expect(await featuresOf(null)).toEqual([]);
      expect(await featuresOf(undefined)).toEqual([]);
    });
  });
});
