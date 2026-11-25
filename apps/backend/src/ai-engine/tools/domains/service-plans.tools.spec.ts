import { createServiceTools, ServiceToolDeps } from './services.tools';
import { RegisteredTool } from '../interfaces/tool.interface';

/**
 * Contrato de `manage_service_plan` y `get_service_plan`: cada acción del modo
 * Plan delega en `ServicePlansService` / `ProductsService` (mismo camino que el
 * HTTP) y rechaza en voz alta lo que el dominio no admite.
 */
describe('services.tools · manage_service_plan / get_service_plan', () => {
  const CONTEXT = { store_id: 7, user_id: 9 };

  function baseDeps() {
    return {
      productsService: {
        findOne: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      } as any,
      providersService: {
        findOne: jest.fn(),
        assignService: jest.fn(),
        getProvidersForService: jest.fn().mockResolvedValue([]),
      } as any,
      servicePlansService: {
        getPlan: jest.fn(),
        replacePaxPrices: jest.fn(),
        createDeparture: jest.fn(),
        updateDeparture: jest.fn(),
        createActivity: jest.fn(),
        updateActivity: jest.fn(),
        deleteActivity: jest.fn(),
      } as any,
    } satisfies ServiceToolDeps;
  }

  function build(deps = baseDeps()) {
    const tools = createServiceTools(deps);
    const plan = tools.find((t) => t.name === 'manage_service_plan') as RegisteredTool;
    const read = tools.find((t) => t.name === 'get_service_plan') as RegisteredTool;
    return {
      deps,
      plan,
      read,
      preview: (args: Record<string, any>) => plan.preview!(args, CONTEXT as any),
      run: async (args: Record<string, any>) =>
        JSON.parse(await plan.handler!(args, CONTEXT as any)),
      readPlan: async (args: Record<string, any>) =>
        JSON.parse(await read.handler!(args, CONTEXT as any)),
    };
  }

  const PLAN_ROW = {
    id: 77,
    name: 'Tour Eje Cafetero',
    product_type: 'service',
    service_pricing_type: 'package',
    plan_duration_days: 3,
    plan_departure_mode: 'fixed',
  };
  const SESSION_ROW = { ...PLAN_ROW, id: 21, name: 'Masaje', service_pricing_type: 'per_session', plan_duration_days: null };

  describe('registro', () => {
    it('manage_service_plan: escritura con confirmación y el permiso del HTTP', () => {
      const { plan } = build();
      expect(plan.requiresConfirmation).toBe(true);
      expect(plan.readOnly).toBeFalsy();
      expect(typeof plan.preview).toBe('function');
      expect(plan.requiredPermissions).toEqual(['store:products:update']);
      expect(plan.parameters.required).toEqual(['action', 'product_id']);
      expect(plan.parameters.properties.action.enum).toEqual([
        'set_plan',
        'add_departure',
        'update_departure',
        'remove_departure',
        'set_itinerary',
        'assign_activity_provider',
      ]);
    });

    it('get_service_plan: lectura sin confirmación con el permiso del GET', () => {
      const { read } = build();
      expect(read.readOnly).toBe(true);
      expect(read.requiresConfirmation).toBeFalsy();
      expect(read.preview).toBeUndefined();
      expect(read.requiredPermissions).toEqual(['store:products:read', 'store:reservations:read']);
    });
  });

  describe('set_plan', () => {
    it('activa el modo Plan en un servicio por sesión y guarda los tramos', async () => {
      const { deps, preview, run } = build();
      deps.productsService.findOne.mockResolvedValue(SESSION_ROW);
      deps.servicePlansService.replacePaxPrices.mockResolvedValue([]);
      const args = {
        action: 'set_plan',
        product_id: 21,
        plan: {
          duration_days: 3,
          departure_mode: 'both',
          pax_prices: [
            { min_pax: 1, max_pax: 4, price: 500 },
            { min_pax: 5, max_pax: 12, price: 400 },
          ],
        },
      };

      const result = await preview(args);
      expect(result.status).toBe('ok');
      expect(result.changes.map((c: any) => c.field)).toEqual([
        'service_pricing_type',
        'plan_duration_days',
        'plan_departure_mode',
        'pax_prices',
      ]);

      await run(args);
      expect(deps.productsService.update).toHaveBeenCalledWith(
        21,
        expect.objectContaining({
          service_pricing_type: 'package',
          plan_duration_days: 3,
          plan_departure_mode: 'both',
        }),
        { lean: true },
      );
      expect(deps.servicePlansService.replacePaxPrices).toHaveBeenCalledWith(21, [
        expect.objectContaining({ min_pax: 1, max_pax: 4, price: 500 }),
        expect.objectContaining({ min_pax: 5, max_pax: 12, price: 400 }),
      ]);
    });

    it('rechaza departure_mode inválido y tramos con mínimo mayor que máximo', async () => {
      const { deps, run } = build();
      deps.productsService.findOne.mockResolvedValue(PLAN_ROW);
      expect((await run({ action: 'set_plan', product_id: 77, plan: { departure_mode: 'weekly' } })).error).toContain(
        'fixed, on_demand, both',
      );
      expect(
        (await run({ action: 'set_plan', product_id: 77, plan: { pax_prices: [{ min_pax: 6, max_pax: 2, price: 1 }] } })).error,
      ).toContain('mínimo mayor que el máximo');
      expect(deps.productsService.update).not.toHaveBeenCalled();
    });
  });

  describe('salidas', () => {
    it('add_departure crea varias fechas con el mismo cupo y reporta las fallidas', async () => {
      const { deps, preview, run } = build();
      deps.productsService.findOne.mockResolvedValue(PLAN_ROW);
      deps.servicePlansService.createDeparture
        .mockResolvedValueOnce({ id: 1, departure_date: '2026-12-05', capacity: 12 })
        .mockRejectedValueOnce(new Error('La fecha del evento no puede estar en el pasado.'));
      const args = {
        action: 'add_departure',
        product_id: 77,
        departure_dates: ['2026-12-12', '2026-12-05'],
        capacity: 12,
      };

      const result = await preview(args);
      expect(result.status).toBe('ok');
      expect(result.changes.map((c: any) => c.label)).toEqual(['Evento 2026-12-05', 'Evento 2026-12-12']);
      expect(result.changes[0].to).toBe('cupo 12, precio por tramos');

      const answer = await run(args);
      expect(deps.servicePlansService.createDeparture).toHaveBeenNthCalledWith(
        1,
        77,
        expect.objectContaining({ departure_date: '2026-12-05', capacity: 12 }),
      );
      expect(answer.eventos_creados).toHaveLength(1);
      expect(answer.eventos_fallidos).toEqual([
        { fecha: '2026-12-12', error: 'La fecha del evento no puede estar en el pasado.' },
      ]);
    });

    it('add_departure sin cupo → error de validación legible, sin escribir', async () => {
      const { deps, run } = build();
      deps.productsService.findOne.mockResolvedValue(PLAN_ROW);
      const answer = await run({ action: 'add_departure', product_id: 77, departure_date: '2026-12-05' });
      expect(answer.error).toContain('cupo');
      expect(deps.servicePlansService.createDeparture).not.toHaveBeenCalled();
    });

    it('add_departure en un servicio que no es plan → guía a set_plan', async () => {
      const { deps, preview } = build();
      deps.productsService.findOne.mockResolvedValue(SESSION_ROW);
      const result = await preview({ action: 'add_departure', product_id: 21, departure_date: '2026-12-05', capacity: 4 });
      expect(result.status).toBe('error');
      expect(result.message).toContain('set_plan');
    });

    it('update_departure cambia cupo y precio', async () => {
      const { deps, run } = build();
      deps.productsService.findOne.mockResolvedValue(PLAN_ROW);
      deps.servicePlansService.updateDeparture.mockResolvedValue({ id: 5, capacity: 20 });
      await run({ action: 'update_departure', product_id: 77, departure_id: 5, capacity: 20, price_override: 950 });
      expect(deps.servicePlansService.updateDeparture).toHaveBeenCalledWith(
        77,
        5,
        expect.objectContaining({ capacity: 20, price_override: 950 }),
      );
    });

    it('remove_departure cancela (no borra) y avisa en el preview', async () => {
      const { deps, preview, run } = build();
      deps.productsService.findOne.mockResolvedValue(PLAN_ROW);
      deps.servicePlansService.updateDeparture.mockResolvedValue({ id: 5, status: 'cancelled' });
      const result = await preview({ action: 'remove_departure', product_id: 77, departure_id: 5 });
      expect(result.status).toBe('warning');
      expect(result.message).toContain('cancelado');
      await run({ action: 'remove_departure', product_id: 77, departure_id: 5 });
      expect(deps.servicePlansService.updateDeparture).toHaveBeenCalledWith(77, 5, expect.objectContaining({ status: 'cancelled' }));
    });
  });

  describe('itinerario', () => {
    it('set_itinerary agrega, edita y elimina con el servicio del HTTP', async () => {
      const { deps, preview, run } = build();
      deps.productsService.findOne.mockResolvedValue(PLAN_ROW);
      deps.servicePlansService.createActivity.mockResolvedValue({ id: 31 });
      deps.servicePlansService.updateActivity.mockResolvedValue({ id: 12 });
      deps.servicePlansService.deleteActivity.mockResolvedValue({ id: 13 });
      const args = {
        action: 'set_itinerary',
        product_id: 77,
        activities: [
          { day_number: 2, title: 'Caminata al Cocora', start_time: '08:00', provider_id: 4, creates_task: true },
          { activity_id: 12, title: 'Almuerzo típico' },
        ],
        remove_activity_ids: [13],
      };

      const result = await preview(args);
      expect(result.status).toBe('warning');
      expect(result.message).toContain('tarea en el CRM');
      expect(result.changes[0]).toEqual({
        field: 'actividad_nueva',
        label: 'Día 2',
        from: null,
        to: '08:00 Caminata al Cocora (crea tarea)',
      });

      const answer = await run(args);
      expect(deps.servicePlansService.createActivity).toHaveBeenCalledWith(
        77,
        expect.objectContaining({ day_number: 2, title: 'Caminata al Cocora', provider_id: 4, creates_task: true }),
      );
      expect(deps.servicePlansService.updateActivity).toHaveBeenCalledWith(77, 12, expect.objectContaining({ title: 'Almuerzo típico' }));
      expect(deps.servicePlansService.deleteActivity).toHaveBeenCalledWith(77, 13);
      expect(answer.itinerario).toHaveLength(3);
    });

    it('rechaza día fuera de la duración y campos que la actividad no tiene', async () => {
      const { deps, run } = build();
      deps.productsService.findOne.mockResolvedValue(PLAN_ROW);
      expect(
        (await run({ action: 'set_itinerary', product_id: 77, activities: [{ day_number: 5, title: 'X' }] })).error,
      ).toContain('el día 5 no existe');
      expect(
        (await run({ action: 'set_itinerary', product_id: 77, activities: [{ day_number: 1, title: 'X', duration_minutes: 90 }] }))
          .error,
      ).toContain('duration_minutes');
      expect(
        (await run({ action: 'set_itinerary', product_id: 77, activities: [{ day_number: 1, title: 'X', start_time: '25:00' }] }))
          .error,
      ).toContain('HH:mm');
      expect(deps.servicePlansService.createActivity).not.toHaveBeenCalled();
    });

    it('assign_activity_provider pone un prestador y limpia el tercero', async () => {
      const { deps, run } = build();
      deps.productsService.findOne.mockResolvedValue(PLAN_ROW);
      deps.servicePlansService.updateActivity.mockResolvedValue({ id: 12, provider_id: 4 });
      await run({ action: 'assign_activity_provider', product_id: 77, activity_id: 12, provider_id: 4 });
      expect(deps.servicePlansService.updateActivity).toHaveBeenCalledWith(
        77,
        12,
        expect.objectContaining({ provider_id: 4, supplier_id: null, supplier_name: null, supplier_contact: null }),
      );
    });

    it('set_itinerary: editar una actividad a prestador interno limpia el tercero', async () => {
      const { deps, run } = build();
      deps.productsService.findOne.mockResolvedValue(PLAN_ROW);
      deps.servicePlansService.updateActivity.mockResolvedValue({ id: 12 });
      await run({ action: 'set_itinerary', product_id: 77, activities: [{ activity_id: 12, provider_id: 4 }] });
      expect(deps.servicePlansService.updateActivity).toHaveBeenCalledWith(
        77,
        12,
        expect.objectContaining({ provider_id: 4, supplier_id: null, supplier_name: null, supplier_contact: null }),
      );
    });

    it('assign_activity_provider con solo contacto del tercero quita el prestador interno', async () => {
      const { deps, run } = build();
      deps.productsService.findOne.mockResolvedValue(PLAN_ROW);
      deps.servicePlansService.updateActivity.mockResolvedValue({ id: 12 });
      await run({ action: 'assign_activity_provider', product_id: 77, activity_id: 12, supplier_contact: '300 000 0000' });
      expect(deps.servicePlansService.updateActivity).toHaveBeenCalledWith(
        77,
        12,
        expect.objectContaining({ provider_id: null, supplier_contact: '300 000 0000' }),
      );
    });

    it('assign_activity_provider rechaza prestador y tercero a la vez', async () => {
      const { deps, run } = build();
      deps.productsService.findOne.mockResolvedValue(PLAN_ROW);
      const answer = await run({ action: 'assign_activity_provider', product_id: 77, activity_id: 12, provider_id: 4, supplier_name: 'Finca' });
      expect(answer.error).toContain('no los dos');
      expect(deps.servicePlansService.updateActivity).not.toHaveBeenCalled();
    });

    it('el error del dominio vuelve como {error, next_step}', async () => {
      const { deps, run } = build();
      deps.productsService.findOne.mockResolvedValue(PLAN_ROW);
      deps.servicePlansService.updateDeparture.mockRejectedValue(new Error('El evento tiene cupos vendidos'));
      const answer = await run({ action: 'remove_departure', product_id: 77, departure_id: 5 });
      expect(answer.error).toContain('cupos vendidos');
      expect(answer.next_step).toContain('get_service_plan');
    });
  });

  describe('get_service_plan', () => {
    it('devuelve el plan del servicio (días, salidas, tramos, actividades)', async () => {
      const { deps, readPlan } = build();
      const plan = { product_id: 77, is_plan: true, plan_duration_days: 3, departures: [], pax_prices: [], activities: [] };
      deps.servicePlansService.getPlan.mockResolvedValue(plan);
      expect(await readPlan({ product_id: 77, include_past: true })).toEqual(plan);
      expect(deps.servicePlansService.getPlan).toHaveBeenCalledWith(77, true);
    });

    it('avisa cuando el servicio no está en modo Plan', async () => {
      const { deps, readPlan } = build();
      deps.servicePlansService.getPlan.mockResolvedValue({ product_id: 21, is_plan: false });
      expect((await readPlan({ product_id: 21 })).nota).toContain('set_plan');
    });

    it('product_id inválido → {error, next_step} sin consultar', async () => {
      const { deps, readPlan } = build();
      const answer = await readPlan({ product_id: 'abc' });
      expect(answer.error).toContain('product_id inválido');
      expect(deps.servicePlansService.getPlan).not.toHaveBeenCalled();
    });
  });
});
