import { ConflictException } from '@nestjs/common';
import { createServiceTools, ServiceToolDeps } from './services.tools';
import { RegisteredTool } from '../interfaces/tool.interface';

/**
 * Contrato de `manage_service`: validación legible sin tocar servicios en los
 * rechazos, camino feliz con servicios mockeados, permisos y confirmación.
 */
describe('services.tools · manage_service', () => {
  const STORE_ID = 7;
  const CONTEXT = { store_id: STORE_ID, user_id: 9 };

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
        replacePaxPrices: jest.fn(),
        getPlan: jest.fn(),
      } as any,
    } satisfies ServiceToolDeps;
  }

  function build(deps = baseDeps()) {
    const tools = createServiceTools(deps);
    const tool = tools.find((t) => t.name === 'manage_service') as RegisteredTool;
    return {
      deps,
      tools,
      tool,
      preview: (args: Record<string, any>) => tool.preview!(args, CONTEXT as any),
      run: async (args: Record<string, any>) =>
        JSON.parse(await tool.handler!(args, CONTEXT as any)),
    };
  }

  const SERVICE_ROW = {
    id: 21,
    name: 'Masaje relajante',
    product_type: 'service',
    requires_booking: true,
    booking_mode: 'provider_required',
    service_duration_minutes: 60,
    service_pricing_type: 'per_session',
  };

  describe('registro', () => {
    it('expone manage_service, manage_service_plan y get_service_plan', () => {
      const { tools } = build();
      expect(tools.map((t) => t.name)).toEqual([
        'manage_service',
        'manage_service_plan',
        'get_service_plan',
      ]);
    });

    it('manage_service es escritura con confirmación y permisos AND fail-closed', () => {
      const { tool } = build();
      expect(tool.requiresConfirmation).toBe(true);
      expect(tool.readOnly).toBeFalsy();
      expect(typeof tool.preview).toBe('function');
      expect(tool.domain).toBe('reservations');
      expect(tool.requiredPermissions).toEqual([
        'store:products:create',
        'store:products:update',
        'store:reservations:update',
      ]);
      expect(tool.parameters.required).toEqual(['action']);
    });
  });

  describe('validación', () => {
    it('rechaza una acción inexistente con los valores válidos', async () => {
      const { deps, preview } = build();
      const result = await preview({ action: 'delete' });
      expect(result.status).toBe('error');
      expect(result.message).toContain('create, update');
      expect(deps.productsService.create).not.toHaveBeenCalled();
    });

    it('rechaza booking_mode inválido explicando las opciones reales', async () => {
      const { deps, run } = build();
      const answer = await run({
        action: 'create',
        name: 'Tour',
        base_price: 100,
        booking_mode: 'any',
      });
      expect(answer.error).toContain('booking_mode "any" no existe');
      expect(answer.error).toContain('provider_required, free_booking');
      expect(deps.productsService.create).not.toHaveBeenCalled();
    });

    it('rechaza duración <= 0', async () => {
      const { deps, run } = build();
      const answer = await run({
        action: 'create',
        name: 'Tour',
        base_price: 100,
        duration_minutes: 0,
      });
      expect(answer.error).toContain('mayor que 0');
      expect(deps.productsService.create).not.toHaveBeenCalled();
    });

    it('rechaza create sin precio', async () => {
      const { run } = build();
      const answer = await run({ action: 'create', name: 'Tour' });
      expect(answer.error).toContain('base_price');
    });

    it('rechaza editar un producto que no es servicio', async () => {
      const { deps, preview } = build();
      deps.productsService.findOne.mockResolvedValue({
        id: 5,
        name: 'Coca Cola',
        product_type: 'physical',
      });
      const result = await preview({ action: 'update', product_id: 5, duration_minutes: 30 });
      expect(result.status).toBe('error');
      expect(result.message).toContain('no es un servicio');
      expect(result.message).toContain('update_product');
    });

    it('rechaza plan combinado con otro tipo de cobro', async () => {
      const { run } = build();
      const answer = await run({
        action: 'create',
        name: 'Tour',
        base_price: 0,
        service_pricing_type: 'per_hour',
        plan: { duration_days: 3 },
      });
      expect(answer.error).toContain('package');
    });

    it('rechaza un prestador inexistente sin escribir', async () => {
      const { deps, run } = build();
      deps.providersService.findOne.mockRejectedValue(new Error('no existe'));
      const answer = await run({
        action: 'create',
        name: 'Tour',
        base_price: 10,
        provider_ids: [99],
      });
      expect(answer.error).toContain('prestador 99');
      expect(deps.productsService.create).not.toHaveBeenCalled();
    });
  });

  describe('camino feliz', () => {
    it('create: servicio de 3 días en modo Plan con tramos y prestador', async () => {
      const { deps, preview, run } = build();
      deps.providersService.findOne.mockResolvedValue({ id: 4, display_name: 'Guía Ana' });
      deps.productsService.create.mockResolvedValue({ id: 77, name: 'Tour Eje Cafetero' });
      deps.servicePlansService.replacePaxPrices.mockResolvedValue([
        { min_pax: 1, max_pax: 4, price: 900000 },
      ]);
      const args = {
        action: 'create',
        name: 'Tour Eje Cafetero',
        base_price: 0,
        duration: 3,
        duration_unit: 'day',
        provider_ids: [4],
        plan: {
          duration_days: 3,
          duration_nights: 2,
          departure_mode: 'fixed',
          pax_prices: [{ min_pax: 1, max_pax: 4, price: 900000 }],
        },
      };

      const result = await preview(args);
      expect(result.status).toBe('ok');
      const fields = result.changes.map((c: any) => c.field);
      expect(fields).toEqual(
        expect.arrayContaining([
          'name',
          'service_duration_minutes',
          'service_pricing_type',
          'plan_duration_days',
          'plan_departure_mode',
          'pax_prices',
          'provider_ids',
        ]),
      );

      const answer = await run(args);
      expect(deps.productsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Tour Eje Cafetero',
          product_type: 'service',
          requires_booking: true,
          service_duration_minutes: 4320,
          service_duration_unit: 'day',
          service_pricing_type: 'package',
          plan_duration_days: 3,
          plan_duration_nights: 2,
          plan_departure_mode: 'fixed',
        }),
      );
      expect(deps.servicePlansService.replacePaxPrices).toHaveBeenCalledWith(77, [
        expect.objectContaining({ min_pax: 1, max_pax: 4, price: 900000 }),
      ]);
      expect(deps.providersService.assignService).toHaveBeenCalledWith(4, 77);
      expect(answer.data.product_id).toBe(77);
      expect(answer.next_step).toContain('manage_service_plan');
    });

    it('create con provider_required sin prestadores: avisa en vez de callar', async () => {
      const { preview } = build();
      const result = await preview({
        action: 'create',
        name: 'Corte',
        base_price: 30000,
        duration_minutes: 45,
      });
      expect(result.status).toBe('warning');
      expect(result.message).toContain('provider_ids');
    });

    it('update PATCH: solo cambia lo enviado y asigna idempotente', async () => {
      const { deps, preview, run } = build();
      deps.productsService.findOne.mockResolvedValue(SERVICE_ROW);
      deps.providersService.findOne.mockResolvedValue({ id: 3, display_name: 'Andrés' });
      deps.providersService.assignService.mockRejectedValue(
        new ConflictException('El proveedor ya tiene asignado este servicio'),
      );
      const args = {
        action: 'update',
        product_id: 21,
        duration_minutes: 90,
        booking_mode: 'free_booking',
        provider_ids: [3],
      };

      const result = await preview(args);
      expect(result.status).toBe('ok');
      expect(result.changes).toEqual(
        expect.arrayContaining([
          { field: 'service_duration_minutes', label: 'Duración (minutos)', from: 60, to: 90 },
          { field: 'booking_mode', label: 'Modo de reserva', from: 'provider_required', to: 'free_booking' },
        ]),
      );

      const answer = await run(args);
      expect(deps.productsService.update).toHaveBeenCalledWith(
        21,
        expect.objectContaining({ service_duration_minutes: 90, booking_mode: 'free_booking' }),
        { lean: true },
      );
      const dto = deps.productsService.update.mock.calls[0][1];
      expect(dto.name).toBeUndefined();
      expect(answer.data.prestadores).toEqual({ asignados: [], ya_asignados: [3], fallidos: [] });
    });

    it('update con un prestador ya asignado y nada más → nada que cambiar', async () => {
      const { deps, run } = build();
      deps.productsService.findOne.mockResolvedValue(SERVICE_ROW);
      deps.providersService.findOne.mockResolvedValue({ id: 3, display_name: 'Andrés' });
      deps.providersService.getProvidersForService.mockResolvedValue([{ id: 3 }]);
      const answer = await run({ action: 'update', product_id: 21, provider_ids: [3] });
      expect(answer.error).toContain('No hay nada que cambiar');
      expect(deps.productsService.update).not.toHaveBeenCalled();
    });

    it('update solo de prestadores no reescribe el producto', async () => {
      const { deps, run } = build();
      deps.productsService.findOne.mockResolvedValue(SERVICE_ROW);
      deps.providersService.findOne.mockResolvedValue({ id: 8, display_name: 'Luz' });
      deps.providersService.assignService.mockResolvedValue({});
      const answer = await run({ action: 'update', product_id: 21, provider_ids: [8] });
      expect(deps.productsService.update).not.toHaveBeenCalled();
      expect(deps.providersService.assignService).toHaveBeenCalledWith(8, 21);
      expect(answer.data.campos).toEqual(['provider_ids']);
    });

    it('duration_minutes guarda la unidad en minutos', async () => {
      const { deps, run } = build();
      deps.productsService.findOne.mockResolvedValue({ ...SERVICE_ROW, service_duration_unit: 'day' });
      await run({ action: 'update', product_id: 21, duration_minutes: 90 });
      expect(deps.productsService.update.mock.calls[0][1]).toEqual(
        expect.objectContaining({ service_duration_minutes: 90, service_duration_unit: 'minute' }),
      );
    });

    it('estación con tarifa por tiempo sin booking_mode no avisa falta de prestador', async () => {
      const { preview } = build();
      const result = await preview({
        action: 'create',
        name: 'Cancha sintética',
        base_price: 0,
        duration_minutes: 60,
        requires_station: true,
        rental_pricing_mode: 'station_rate',
      });
      expect(result.status).toBe('ok');
    });

    it('si fallan los tramos, campos no los reporta como aplicados', async () => {
      const { deps, run } = build();
      deps.productsService.create.mockResolvedValue({ id: 90 });
      deps.servicePlansService.replacePaxPrices.mockRejectedValue(new Error('Los tramos se solapan.'));
      const answer = await run({
        action: 'create',
        name: 'Tour',
        base_price: 0,
        booking_mode: 'free_booking',
        plan: { duration_days: 2, pax_prices: [{ min_pax: 1, max_pax: 4, price: 10 }] },
      });
      expect(answer.summary).toContain('Pendiente: Precios por grupo no guardados');
      expect(answer.data.campos).not.toContain('pax_prices');
    });

    it('update sin cambios reales → error legible, sin escribir', async () => {
      const { deps, run } = build();
      deps.productsService.findOne.mockResolvedValue(SERVICE_ROW);
      const answer = await run({ action: 'update', product_id: 21, duration_minutes: 60 });
      expect(answer.error).toContain('No hay nada que cambiar');
      expect(deps.productsService.update).not.toHaveBeenCalled();
    });

    it('el error del servicio vuelve como {error, next_step}', async () => {
      const { deps, run } = build();
      deps.productsService.create.mockRejectedValue(new Error('Las consultas requieren reserva previa'));
      const answer = await run({
        action: 'create',
        name: 'Consulta',
        base_price: 10,
        booking_mode: 'free_booking',
      });
      expect(answer.error).toContain('Las consultas requieren reserva previa');
      expect(answer.next_step).toBeTruthy();
    });
  });
});
