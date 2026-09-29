import { booking_status_enum, order_channel_enum } from '@prisma/client';
import {
  createReservationsTools,
  ReservationsToolDeps,
} from './reservations.tools';
import { RegisteredTool } from '../interfaces/tool.interface';

/**
 * T4 — Spec de contrato de la familia reservations (O-46..O-50). Copia el
 * patrón canónico fijado en `products.tools.spec.ts`: (a) validación
 * happy/sad sin tocar deps en sad, (b) snapshot JSON exacto con `toEqual`,
 * (c) forma `{error, next_step}`, (d) permiso, (e) requiresConfirmation +
 * `preview` en los writes.
 *
 * Los estados salen del enum Prisma generado: la spec pinnea el formato del
 * mensaje sin copiar la lista a mano.
 */
describe('reservations.tools · contrato T4', () => {
  const STORE_ID = 7;

  const BOOKING_STATUSES = Object.values(booking_status_enum);
  const CHANNEL = Object.values(order_channel_enum)[0];

  function baseDeps() {
    return {
      reservationsService: {
        findAll: jest.fn(),
        findOne: jest.fn(),
        create: jest.fn(),
        confirm: jest.fn(),
        start: jest.fn(),
        cancel: jest.fn(),
        complete: jest.fn(),
        noShow: jest.fn(),
        checkIn: jest.fn(),
        reschedule: jest.fn(),
        approveRescheduleRequest: jest.fn(),
        rejectRescheduleRequest: jest.fn(),
        getRescheduleRequestForAgent: jest.fn(),
      } as any,
      availabilityService: {
        isSlotAvailable: jest.fn(),
        getAvailableSlots: jest.fn(),
      } as any,
      providersService: {
        findOne: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        assignService: jest.fn(),
        removeService: jest.fn(),
      } as any,
      providerScheduleService: {
        upsertSchedule: jest.fn(),
        createException: jest.fn(),
        deleteException: jest.fn(),
      } as any,
      businessHoursService: {
        upsertAll: jest.fn(),
      } as any,
    } satisfies ReservationsToolDeps;
  }

  function buildTools(deps = baseDeps()) {
    return { deps, tools: createReservationsTools(deps) };
  }

  function getHandler(tools: RegisteredTool[], name: string) {
    const tool = tools.find((registered) => registered.name === name);
    if (!tool?.handler) throw new Error(`${name} sin handler`);
    return tool.handler;
  }

  function getPreview(tools: RegisteredTool[], name: string) {
    const tool = tools.find((registered) => registered.name === name);
    if (!tool?.preview) throw new Error(`${name} sin preview`);
    return tool.preview;
  }

  const run = async (
    tools: RegisteredTool[],
    name: string,
    args: Record<string, any>,
    context: Record<string, any> = { store_id: STORE_ID, user_id: 9 },
  ) => JSON.parse(await getHandler(tools, name)(args, context as any));

  const preview = async (
    tools: RegisteredTool[],
    name: string,
    args: Record<string, any>,
    context: Record<string, any> = { store_id: STORE_ID, user_id: 9 },
  ) => getPreview(tools, name)(args, context as any);

  const BOOKING_ROW = {
    id: 81,
    booking_number: 'RSV-081',
    status: 'pending',
    channel: CHANNEL,
    date: '2026-10-05',
    start_time: '10:00',
    end_time: '11:00',
    notes: null,
    created_at: new Date('2026-09-20T10:00:00.000Z'),
    customer_id: 501,
    customer: {
      id: 501,
      first_name: 'Marcela',
      last_name: 'Ríos',
      email: 'marcela@example.com',
      phone: '3001234567',
    },
    product_id: 21,
    product: {
      id: 21,
      name: 'Corte de cabello',
      service_duration_minutes: 60,
    },
    product_variants: null,
    provider: { id: 3, display_name: 'Andrés', employee: null },
    order: null,
  };

  const COMPACT_BOOKING = {
    booking_id: 81,
    numero: 'RSV-081',
    cliente: 'Marcela Ríos',
    customer_id: 501,
    servicio: 'Corte de cabello',
    product_id: 21,
    fecha: '2026-10-05',
    inicio: '10:00',
    fin: '11:00',
    estado: 'pending',
    proveedor: 'Andrés',
  };

  // ─── (d)+(e) Registro: permisos, categoría y forma ────────────────────
  describe('registro', () => {
    it('expone exactamente los 7 tools del dominio reservations', () => {
      const { tools } = buildTools();
      expect(tools.map((tool) => tool.name)).toEqual([
        'list_bookings',
        'get_booking',
        'check_booking_availability',
        'manage_bookings',
        'transition_booking',
        'reschedule_booking',
        'manage_booking_providers',
      ]);
      for (const tool of tools) {
        expect(tool.domain).toBe('reservations');
        expect(tool.version).toBe('1');
        expect(tool.description.length).toBeGreaterThan(20);
      }
    });

    it('cada tool declara su permiso dueño', () => {
      const { tools } = buildTools();
      const byName = new Map(tools.map((tool) => [tool.name, tool]));
      expect(byName.get('list_bookings')!.requiredPermissions).toEqual([
        'store:reservations:read',
      ]);
      expect(byName.get('get_booking')!.requiredPermissions).toEqual([
        'store:reservations:read',
      ]);
      expect(
        byName.get('check_booking_availability')!.requiredPermissions,
      ).toEqual(['store:reservations:read']);
      expect(byName.get('manage_bookings')!.requiredPermissions).toEqual([
        'store:reservations:create',
      ]);
      expect(byName.get('transition_booking')!.requiredPermissions).toEqual([
        'store:reservations:update',
      ]);
      expect(byName.get('reschedule_booking')!.requiredPermissions).toEqual([
        'store:reservations:update',
      ]);
      expect(
        byName.get('manage_booking_providers')!.requiredPermissions,
      ).toEqual(['store:reservations:update', 'store:business_hours:write']);
    });

    it('reads readOnly y writes con confirmación+preview', () => {
      const { tools } = buildTools();
      const byName = new Map(tools.map((tool) => [tool.name, tool]));
      for (const name of [
        'list_bookings',
        'get_booking',
        'check_booking_availability',
      ]) {
        const tool = byName.get(name)!;
        expect(tool.readOnly).toBe(true);
        expect(tool.requiresConfirmation ?? false).toBe(false);
        expect(tool.preview).toBeUndefined();
      }
      for (const name of [
        'manage_bookings',
        'transition_booking',
        'reschedule_booking',
        'manage_booking_providers',
      ]) {
        const tool = byName.get(name)!;
        expect(tool.readOnly ?? false).toBe(false);
        expect(tool.requiresConfirmation).toBe(true);
        expect(typeof tool.preview).toBe('function');
      }
      for (const tool of tools) {
        expect(tool.clientSide ?? false).toBe(false);
        expect(typeof tool.handler).toBe('function');
      }
    });

    it('declara requeridos y enums (los de reservas salen del schema Prisma)', () => {
      const { tools } = buildTools();
      const byName = new Map(tools.map((tool) => [tool.name, tool]));
      expect(
        byName.get('list_bookings')!.parameters.required ?? [],
      ).toEqual([]);
      expect(byName.get('get_booking')!.parameters.required).toEqual([
        'booking_id',
      ]);
      expect(
        byName.get('check_booking_availability')!.parameters.required,
      ).toEqual(['product_id', 'date_from']);
      expect(byName.get('manage_bookings')!.parameters.required).toEqual([
        'action',
        'product_id',
        'date',
        'start_time',
        'end_time',
      ]);
      expect(byName.get('transition_booking')!.parameters.required).toEqual([
        'booking_id',
        'action',
      ]);
      expect(
        byName.get('list_bookings')!.parameters.properties.status.enum,
      ).toEqual(BOOKING_STATUSES);
      expect(
        byName.get('transition_booking')!.parameters.properties.action.enum,
      ).toEqual([
        'confirm',
        'start',
        'cancel',
        'complete',
        'no_show',
        'check_in',
      ]);
      expect(byName.get('reschedule_booking')!.parameters.required).toEqual([
        'action',
      ]);
      expect(
        byName.get('reschedule_booking')!.parameters.properties.action.enum,
      ).toEqual(['reschedule', 'approve', 'reject']);
      expect(
        byName.get('manage_booking_providers')!.parameters.required,
      ).toEqual(['action']);
      expect(
        byName.get('manage_booking_providers')!.parameters.properties.action
          .enum,
      ).toEqual([
        'create',
        'update',
        'assign_service',
        'remove_service',
        'set_schedule',
        'add_exception',
        'remove_exception',
        'set_business_hours',
      ]);
    });
  });

  // ─── O-46 list_bookings ────────────────────────────────────────────────
  describe('list_bookings', () => {
    it('(b) happy: snapshot exacto de página + query mínima al service', async () => {
      const { deps, tools } = buildTools();
      deps.reservationsService.findAll.mockResolvedValue({
        data: [BOOKING_ROW],
        pagination: { total: 1, page: 1, limit: 10, totalPages: 1 },
      });

      const answer = await run(tools, 'list_bookings', {});

      expect(answer).toEqual({
        paginacion: {
          total_reservas: 1,
          pagina: 1,
          por_pagina: 10,
          total_paginas: 1,
          hay_mas: false,
        },
        mostrando: 1,
        data: [COMPACT_BOOKING],
      });
      expect(deps.reservationsService.findAll).toHaveBeenCalledWith({
        page: 1,
        limit: 10,
      });
    });

    it('(b) happy: filtros viajan tipados al service', async () => {
      const { deps, tools } = buildTools();
      deps.reservationsService.findAll.mockResolvedValue({
        data: [],
        pagination: { total: 0, page: 1, limit: 10, totalPages: 0 },
      });

      await run(tools, 'list_bookings', {
        status: BOOKING_STATUSES[0],
        customer_id: 501,
        date_from: '2026-10-01',
        date_to: '2026-10-31',
      });

      expect(deps.reservationsService.findAll).toHaveBeenCalledWith({
        page: 1,
        limit: 10,
        status: BOOKING_STATUSES[0],
        customer_id: 501,
        date_from: '2026-10-01',
        date_to: '2026-10-31',
      });
    });

    it('(a) sad: estado inexistente → error con los valores válidos', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(tools, 'list_bookings', {
        status: 'inventado',
      });

      expect(answer).toEqual({
        error: `status "inventado" no existe. Valores válidos: ${BOOKING_STATUSES.join(', ')}.`,
      });
      expect(deps.reservationsService.findAll).not.toHaveBeenCalled();
    });

    it('(a) sad: rango invertido → error exacto', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(tools, 'list_bookings', {
        date_from: '2026-10-31',
        date_to: '2026-10-01',
      });

      expect(answer.error).toContain('rango está invertido');
      expect(deps.reservationsService.findAll).not.toHaveBeenCalled();
    });
  });

  // ─── O-47 get_booking ─────────────────────────────────────────────────
  describe('get_booking', () => {
    it('(b) happy: snapshot exacto del detalle', async () => {
      const { deps, tools } = buildTools();
      deps.reservationsService.findOne.mockResolvedValue(BOOKING_ROW);

      const answer = await run(tools, 'get_booking', { booking_id: 81 });

      expect(answer).toEqual({
        reserva: {
          booking_id: 81,
          numero: 'RSV-081',
          estado: 'pending',
          canal: CHANNEL,
          fecha: '2026-10-05',
          inicio: '10:00',
          fin: '11:00',
          notas: null,
          creada: '2026-09-20T10:00:00.000Z',
        },
        cliente: {
          customer_id: 501,
          nombre: 'Marcela Ríos',
          email: 'marcela@example.com',
          telefono: '3001234567',
        },
        servicio: {
          product_id: 21,
          nombre: 'Corte de cabello',
          duracion_minutos: 60,
          variante: null,
          variant_sku: null,
        },
        proveedor: { provider_id: 3, nombre: 'Andrés' },
        orden_vinculada: null,
      });
    });

    it('(a) sad: booking_id inválido → error sin llamar al service', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(tools, 'get_booking', { booking_id: -1 });

      expect(answer.error).toContain('booking_id inválido');
      expect(deps.reservationsService.findOne).not.toHaveBeenCalled();
    });

    it('(c) el service lanza → {error, next_step}', async () => {
      const { deps, tools } = buildTools();
      deps.reservationsService.findOne.mockRejectedValue(
        new Error('Reserva no encontrada'),
      );

      const answer = await run(tools, 'get_booking', { booking_id: 404 });

      expect(answer.error).toContain('Reserva no encontrada');
      expect(answer.next_step).toContain('list_bookings');
    });
  });

  // ─── O-48 check_booking_availability ────────────────────────────────────
  describe('check_booking_availability', () => {
    it('(b) happy: slot libre no pide alternativas', async () => {
      const { deps, tools } = buildTools();
      deps.availabilityService.isSlotAvailable.mockResolvedValue(true);

      const answer = await run(tools, 'check_booking_availability', {
        product_id: 21,
        date_from: '2026-10-05',
        start_time: '10:00',
        end_time: '11:00',
      });

      expect(answer).toEqual({
        disponible: true,
        slot: { fecha: '2026-10-05', inicio: '10:00', fin: '11:00' },
        next_step:
          'El slot está libre: puedes proponer la reserva con manage_bookings.',
      });
      expect(deps.availabilityService.isSlotAvailable).toHaveBeenCalledWith(
        21,
        '2026-10-05',
        '10:00',
        '11:00',
        undefined,
      );
      expect(
        deps.availabilityService.getAvailableSlots,
      ).not.toHaveBeenCalled();
    });

    it('(b) slot ocupado → alternativas del mismo día', async () => {
      const { deps, tools } = buildTools();
      deps.availabilityService.isSlotAvailable.mockResolvedValue(false);
      deps.availabilityService.getAvailableSlots.mockResolvedValue([
        {
          date: '2026-10-05',
          start_time: '11:00',
          end_time: '12:00',
          total_available: 2,
        },
      ]);

      const answer = await run(tools, 'check_booking_availability', {
        product_id: 21,
        date_from: '2026-10-05',
        start_time: '10:00',
        end_time: '11:00',
      });

      expect(answer.disponible).toBe(false);
      expect(answer.alternativas).toEqual([
        {
          fecha: '2026-10-05',
          inicio: '11:00',
          fin: '12:00',
          proveedores_disponibles: 2,
        },
      ]);
      expect(answer.next_step).toContain('alternativas');
    });

    it('(b) rango lista slots y trunca a 30 con nota', async () => {
      const { deps, tools } = buildTools();
      const slots = Array.from({ length: 31 }, (_, index) => ({
        date: '2026-10-05',
        start_time: `0${8 + Math.floor(index / 2)}:${index % 2 === 0 ? '00' : '30'}`,
        end_time: 'x',
        total_available: 1,
      }));
      deps.availabilityService.getAvailableSlots.mockResolvedValue(slots);

      const answer = await run(tools, 'check_booking_availability', {
        product_id: 21,
        date_from: '2026-10-05',
        date_to: '2026-10-06',
      });

      expect(answer.slots_libres).toBe(31);
      expect(answer.mostrando).toBe(30);
      expect(answer.slots).toHaveLength(30);
      expect(answer.nota).toContain('acota el rango');
      expect(
        deps.availabilityService.isSlotAvailable,
      ).not.toHaveBeenCalled();
    });

    it('(a) sad: start_time sin end_time → error', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(tools, 'check_booking_availability', {
        product_id: 21,
        date_from: '2026-10-05',
        start_time: '10:00',
      });

      expect(answer.error).toContain('en pareja');
      expect(
        deps.availabilityService.isSlotAvailable,
      ).not.toHaveBeenCalled();
      expect(
        deps.availabilityService.getAvailableSlots,
      ).not.toHaveBeenCalled();
    });
  });

  // ─── O-49 manage_bookings ──────────────────────────────────────────────
  describe('manage_bookings', () => {
    const ARGS = {
      action: 'create',
      product_id: 21,
      date: '2026-10-05',
      start_time: '10:00',
      end_time: '11:00',
      customer_id: 501,
    };

    it('(b) happy: crea con slot re-verificado', async () => {
      const { deps, tools } = buildTools();
      deps.availabilityService.isSlotAvailable.mockResolvedValue(true);
      deps.reservationsService.create.mockResolvedValue({
        id: 81,
        booking_number: 'RSV-081',
        status: 'pending',
        date: '2026-10-05',
        start_time: '10:00',
        end_time: '11:00',
      });

      const answer = await run(tools, 'manage_bookings', ARGS);

      expect(answer.reserva_creada).toEqual({
        booking_id: 81,
        numero: 'RSV-081',
        estado: 'pending',
        fecha: '2026-10-05',
        inicio: '10:00',
        fin: '11:00',
      });
      expect(answer.next_step).toContain('transition_booking');
      expect(deps.availabilityService.isSlotAvailable).toHaveBeenCalledWith(
        21,
        '2026-10-05',
        '10:00',
        '11:00',
        undefined,
      );
      const [dto] = deps.reservationsService.create.mock.calls[0];
      expect(dto.skip_availability_check).toBeUndefined();
    });

    it('(e) preview ok: sujeto humano fecha+hora', async () => {
      const { deps, tools } = buildTools();
      deps.availabilityService.isSlotAvailable.mockResolvedValue(true);

      const result = await preview(tools, 'manage_bookings', ARGS);

      expect(result.status).toBe('ok');
      expect(result.target).toBe('Nueva reserva 2026-10-05 10:00–11:00');
      expect(result.domain).toBe('reservations');
      expect(result.changes).toContainEqual({
        field: 'cliente',
        label: 'Cliente',
        from: null,
        to: 'Cliente #501',
      });
      expect(deps.reservationsService.create).not.toHaveBeenCalled();
    });

    it('(a) sad: preview en slot ocupado cita alternativas', async () => {
      const { deps, tools } = buildTools();
      deps.availabilityService.isSlotAvailable.mockResolvedValue(false);
      deps.availabilityService.getAvailableSlots.mockResolvedValue([
        {
          date: '2026-10-05',
          start_time: '11:00',
          end_time: '12:00',
          total_available: 1,
        },
      ]);

      const result = await preview(tools, 'manage_bookings', ARGS);

      expect(result.status).toBe('error');
      expect(result.message).toContain('ocupado');
      expect(result.message).toContain('11:00–12:00');
      expect(deps.reservationsService.create).not.toHaveBeenCalled();
    });

    it('(c) carrera: el slot se ocupa entre preview y apply → {error, alternativas, next_step}', async () => {
      const { deps, tools } = buildTools();
      deps.availabilityService.isSlotAvailable.mockResolvedValue(false);
      deps.availabilityService.getAvailableSlots.mockResolvedValue([
        {
          date: '2026-10-05',
          start_time: '11:00',
          end_time: '12:00',
          total_available: 1,
        },
      ]);

      const answer = await run(tools, 'manage_bookings', ARGS);

      expect(answer.error).toContain('se ocupó antes de aplicar');
      expect(answer.alternativas).toEqual([
        {
          fecha: '2026-10-05',
          inicio: '11:00',
          fin: '12:00',
          proveedores_disponibles: 1,
        },
      ]);
      expect(answer.next_step).toContain('check_booking_availability');
      expect(deps.reservationsService.create).not.toHaveBeenCalled();
    });

    it('(a) sad: hora inválida → error de DTO sin verificar slot', async () => {
      const { deps, tools } = buildTools();

      const result = await preview(tools, 'manage_bookings', {
        ...ARGS,
        start_time: '25:00',
      });

      expect(result.status).toBe('error');
      expect(result.message).toContain('validación');
      expect(
        deps.availabilityService.isSlotAvailable,
      ).not.toHaveBeenCalled();
    });
  });

  // ─── O-50 transition_booking ───────────────────────────────────────────
  describe('transition_booking', () => {
    it('(b) happy: confirma y devuelve antes/después', async () => {
      const { deps, tools } = buildTools();
      deps.reservationsService.findOne.mockResolvedValue(BOOKING_ROW);
      deps.reservationsService.confirm.mockResolvedValue({
        ...BOOKING_ROW,
        status: 'confirmed',
      });

      const answer = await run(tools, 'transition_booking', {
        booking_id: 81,
        action: 'confirm',
      });

      expect(answer).toEqual({
        transicion: {
          booking_id: 81,
          numero: 'RSV-081',
          estado_anterior: 'pending',
          estado: 'confirmed',
        },
      });
      expect(deps.reservationsService.confirm).toHaveBeenCalledWith(81);
    });

    it('(b) happy: check_in va como staff', async () => {
      const { deps, tools } = buildTools();
      deps.reservationsService.findOne.mockResolvedValue(BOOKING_ROW);
      deps.reservationsService.checkIn.mockResolvedValue({
        ...BOOKING_ROW,
        status: 'in_progress',
      });

      await run(tools, 'transition_booking', {
        booking_id: 81,
        action: 'check_in',
      });

      expect(deps.reservationsService.checkIn).toHaveBeenCalledWith(
        81,
        'staff',
      );
    });

    it('(e) preview ok: sujeto humano + de→a', async () => {
      const { deps, tools } = buildTools();
      deps.reservationsService.findOne.mockResolvedValue(BOOKING_ROW);

      const result = await preview(tools, 'transition_booking', {
        booking_id: 81,
        action: 'confirm',
      });

      expect(result.status).toBe('ok');
      expect(result.target).toContain('RSV-081');
      expect(result.target).toContain('Corte de cabello');
      expect(result.target).toContain('Marcela Ríos');
      expect(result.changes).toEqual([
        {
          field: 'transicion',
          label: 'Transición',
          from: 'pending',
          to: 'confirm',
        },
      ]);
    });

    it('(e) preview cancel advierte el cierre', async () => {
      const { deps, tools } = buildTools();
      deps.reservationsService.findOne.mockResolvedValue(BOOKING_ROW);

      const result = await preview(tools, 'transition_booking', {
        booking_id: 81,
        action: 'cancel',
      });

      expect(result.status).toBe('warning');
      expect(result.message).toContain('cierra la reserva');
    });

    it('(a) sad: acción inexistente → error con válidos', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(tools, 'transition_booking', {
        booking_id: 81,
        action: 'volar',
      });

      expect(answer.error).toContain('no existe');
      expect(deps.reservationsService.findOne).not.toHaveBeenCalled();
      expect(deps.reservationsService.confirm).not.toHaveBeenCalled();
    });

    it('(c) el service lanza → {error, next_step}', async () => {
      const { deps, tools } = buildTools();
      deps.reservationsService.findOne.mockResolvedValue(BOOKING_ROW);
      deps.reservationsService.start.mockRejectedValue(
        new Error('Solo se puede iniciar desde confirmed'),
      );

      const answer = await run(tools, 'transition_booking', {
        booking_id: 81,
        action: 'start',
      });

      expect(answer.error).toContain('desde confirmed');
      expect(answer.next_step).toContain('get_booking');
    });
  });

  // ─── O-51 reschedule_booking ───────────────────────────────────────────
  describe('reschedule_booking', () => {
    const MOVE_ARGS = {
      action: 'reschedule',
      booking_id: 81,
      date: '2026-10-06',
      start_time: '11:00',
      end_time: '12:00',
    };
    const REQUEST_ROW = {
      id: 5,
      booking_id: 81,
      status: 'pending',
      requested_date: '2026-10-06',
      requested_start_time: '11:00',
      requested_end_time: '12:00',
      booking: {
        id: 81,
        booking_number: 'RSV-081',
        date: '2026-10-05',
        start_time: '10:00',
        end_time: '11:00',
        customer: { first_name: 'Marcela', last_name: 'Ríos' },
        product: { name: 'Corte de cabello' },
      },
    };

    it('(b) happy: mueve directo con slot re-verificado (excluye la propia)', async () => {
      const { deps, tools } = buildTools();
      deps.reservationsService.findOne.mockResolvedValue(BOOKING_ROW);
      deps.availabilityService.isSlotAvailable.mockResolvedValue(true);
      deps.reservationsService.reschedule.mockResolvedValue({
        ...BOOKING_ROW,
        date: '2026-10-06',
        start_time: '11:00',
        end_time: '12:00',
      });

      const answer = await run(tools, 'reschedule_booking', MOVE_ARGS);

      expect(answer).toEqual({
        reprogramacion: {
          booking_id: 81,
          numero: 'RSV-081',
          horario_anterior: '2026-10-05 10:00–11:00',
          horario: '2026-10-06 11:00–12:00',
          estado: 'pending',
        },
      });
      expect(deps.availabilityService.isSlotAvailable).toHaveBeenCalledWith(
        21,
        '2026-10-06',
        '11:00',
        '12:00',
        undefined,
        81,
      );
    });

    it('(b) tienda con aprobación: reporta solicitud creada, no movimiento', async () => {
      const { deps, tools } = buildTools();
      deps.reservationsService.findOne.mockResolvedValue(BOOKING_ROW);
      deps.availabilityService.isSlotAvailable.mockResolvedValue(true);
      deps.reservationsService.reschedule.mockResolvedValue(BOOKING_ROW);

      const answer = await run(tools, 'reschedule_booking', MOVE_ARGS);

      expect(answer.solicitud_creada).toEqual({
        booking_id: 81,
        numero: 'RSV-081',
        horario_actual: '2026-10-05 10:00–11:00',
        horario_solicitado: '2026-10-06 11:00–12:00',
      });
      expect(answer.nota).toContain('NO se movió');
      expect(answer.nota).toContain('approve');
    });

    it('(e) preview ok: sujeto humano servicio+cliente+horario', async () => {
      const { deps, tools } = buildTools();
      deps.reservationsService.findOne.mockResolvedValue(BOOKING_ROW);
      deps.availabilityService.isSlotAvailable.mockResolvedValue(true);

      const result = await preview(tools, 'reschedule_booking', MOVE_ARGS);

      expect(result.status).toBe('ok');
      expect(result.target).toContain('Corte de cabello');
      expect(result.target).toContain('Marcela Ríos');
      expect(result.changes).toEqual([
        {
          field: 'horario',
          label: 'Horario',
          from: '2026-10-05 10:00–11:00',
          to: '2026-10-06 11:00–12:00',
        },
      ]);
      expect(result.domain).toBe('reservations');
      expect(deps.reservationsService.reschedule).not.toHaveBeenCalled();
    });

    it('(a) sad: reserva completada → error sin verificar slot', async () => {
      const { deps, tools } = buildTools();
      deps.reservationsService.findOne.mockResolvedValue({
        ...BOOKING_ROW,
        status: 'completed',
      });

      const result = await preview(tools, 'reschedule_booking', MOVE_ARGS);

      expect(result.status).toBe('error');
      expect(result.message).toContain("'completed'");
      expect(
        deps.availabilityService.isSlotAvailable,
      ).not.toHaveBeenCalled();
      expect(deps.reservationsService.reschedule).not.toHaveBeenCalled();
    });

    it('(c) carrera: el slot se ocupa entre preview y apply → {error, alternativas, next_step}', async () => {
      const { deps, tools } = buildTools();
      deps.reservationsService.findOne.mockResolvedValue(BOOKING_ROW);
      deps.availabilityService.isSlotAvailable.mockResolvedValue(false);
      deps.availabilityService.getAvailableSlots.mockResolvedValue([
        {
          date: '2026-10-06',
          start_time: '12:00',
          end_time: '13:00',
          total_available: 1,
        },
      ]);

      const answer = await run(tools, 'reschedule_booking', MOVE_ARGS);

      expect(answer.error).toContain('se ocupó antes de aplicar');
      expect(answer.alternativas).toEqual([
        {
          fecha: '2026-10-06',
          inicio: '12:00',
          fin: '13:00',
          proveedores_disponibles: 1,
        },
      ]);
      expect(answer.next_step).toContain('check_booking_availability');
      expect(deps.reservationsService.reschedule).not.toHaveBeenCalled();
    });

    it('(b) happy: approve mueve la cita y audita al usuario', async () => {
      const { deps, tools } = buildTools();
      deps.reservationsService.getRescheduleRequestForAgent.mockResolvedValue(
        REQUEST_ROW,
      );
      deps.reservationsService.approveRescheduleRequest.mockResolvedValue({});

      const answer = await run(tools, 'reschedule_booking', {
        action: 'approve',
        request_id: 5,
      });

      expect(answer).toEqual({
        decision: {
          request_id: 5,
          resultado: 'approved',
          booking_id: 81,
          horario_aplicado: '2026-10-06 11:00–12:00',
        },
        nota: expect.stringContaining('aprobada'),
      });
      expect(
        deps.reservationsService.approveRescheduleRequest,
      ).toHaveBeenCalledWith(5, { decidedByUserId: 9 });
    });

    it('(e) preview reject: warning con motivo que recibe el cliente', async () => {
      const { deps, tools } = buildTools();
      deps.reservationsService.getRescheduleRequestForAgent.mockResolvedValue(
        REQUEST_ROW,
      );

      const result = await preview(tools, 'reschedule_booking', {
        action: 'reject',
        request_id: 5,
        decision_reason: 'Ese día cerramos por inventario',
      });

      expect(result.status).toBe('warning');
      expect(result.target).toContain('Corte de cabello');
      expect(result.target).toContain('Marcela Ríos');
      expect(result.changes).toContainEqual({
        field: 'motivo',
        label: 'Motivo (lo recibe el cliente)',
        from: null,
        to: 'Ese día cerramos por inventario',
      });
      expect(
        deps.reservationsService.rejectRescheduleRequest,
      ).not.toHaveBeenCalled();
    });

    it('(a) sad: reject sin motivo → error de DTO sin leer la solicitud', async () => {
      const { deps, tools } = buildTools();

      const result = await preview(tools, 'reschedule_booking', {
        action: 'reject',
        request_id: 5,
      });

      expect(result.status).toBe('error');
      expect(result.message).toContain('validación');
      expect(
        deps.reservationsService.getRescheduleRequestForAgent,
      ).not.toHaveBeenCalled();
    });

    it('(a) sad: decidir solicitud ya decidida → error', async () => {
      const { deps, tools } = buildTools();
      deps.reservationsService.getRescheduleRequestForAgent.mockResolvedValue({
        ...REQUEST_ROW,
        status: 'approved',
      });

      const answer = await run(tools, 'reschedule_booking', {
        action: 'approve',
        request_id: 5,
      });

      expect(answer.error).toContain("'approved'");
      expect(
        deps.reservationsService.approveRescheduleRequest,
      ).not.toHaveBeenCalled();
    });
  });

  // ─── O-52 manage_booking_providers ─────────────────────────────────────
  describe('manage_booking_providers', () => {
    const PROVIDER_ROW = {
      id: 3,
      display_name: 'Andrés',
      is_active: true,
      sort_order: 1,
    };

    it('(b) happy: create da de alta y sugiere siguientes pasos', async () => {
      const { deps, tools } = buildTools();
      deps.providersService.create.mockResolvedValue({
        id: 4,
        display_name: 'Lucía',
      });

      const answer = await run(tools, 'manage_booking_providers', {
        action: 'create',
        employee_id: 12,
        display_name: 'Lucía',
      });

      expect(answer.proveedor_creado).toEqual({
        provider_id: 4,
        nombre: 'Lucía',
      });
      expect(answer.next_step).toContain('assign_service');
      expect(deps.providersService.create).toHaveBeenCalledWith(
        expect.objectContaining({ employee_id: 12, display_name: 'Lucía' }),
      );
    });

    it('(e) preview update: de→a con sujeto humano', async () => {
      const { deps, tools } = buildTools();
      deps.providersService.findOne.mockResolvedValue(PROVIDER_ROW);

      const result = await preview(tools, 'manage_booking_providers', {
        action: 'update',
        provider_id: 3,
        is_active: false,
      });

      expect(result.status).toBe('ok');
      expect(result.target).toContain('Andrés');
      expect(result.changes).toEqual([
        { field: 'is_active', label: 'Activo', from: true, to: false },
      ]);
      expect(result.domain).toBe('reservations');
      expect(deps.providersService.update).not.toHaveBeenCalled();
    });

    it('(b) happy: assign_service vincula proveedor↔servicio', async () => {
      const { deps, tools } = buildTools();
      deps.providersService.findOne.mockResolvedValue(PROVIDER_ROW);
      deps.providersService.assignService.mockResolvedValue({});

      const answer = await run(tools, 'manage_booking_providers', {
        action: 'assign_service',
        provider_id: 3,
        product_id: 21,
      });

      expect(answer.asignacion).toEqual({
        provider_id: 3,
        proveedor: 'Andrés',
        product_id: 21,
      });
      expect(deps.providersService.assignService).toHaveBeenCalledWith(3, 21);
    });

    it('(e) preview remove_service: warning que cita disponibilidad', async () => {
      const { deps, tools } = buildTools();
      deps.providersService.findOne.mockResolvedValue(PROVIDER_ROW);

      const result = await preview(tools, 'manage_booking_providers', {
        action: 'remove_service',
        provider_id: 3,
        product_id: 21,
      });

      expect(result.status).toBe('warning');
      expect(result.target).toContain('Andrés');
      expect(result.message).toContain('disponibilidad');
      expect(deps.providersService.removeService).not.toHaveBeenCalled();
    });

    it('(b) happy: set_schedule reemplaza con días legibles', async () => {
      const { deps, tools } = buildTools();
      deps.providersService.findOne.mockResolvedValue(PROVIDER_ROW);
      deps.providerScheduleService.upsertSchedule.mockResolvedValue([]);

      const schedule = [
        { day_of_week: 1, start_time: '08:00', end_time: '17:00' },
        { day_of_week: 2, start_time: '08:00', end_time: '12:00' },
      ];
      const result = await preview(tools, 'manage_booking_providers', {
        action: 'set_schedule',
        provider_id: 3,
        schedule,
      });

      expect(result.status).toBe('ok');
      expect(result.changes[0].to).toContain('lunes 08:00–17:00');
      expect(
        deps.providerScheduleService.upsertSchedule,
      ).not.toHaveBeenCalled();

      const answer = await run(tools, 'manage_booking_providers', {
        action: 'set_schedule',
        provider_id: 3,
        schedule,
      });

      expect(answer.horario).toEqual({
        provider_id: 3,
        proveedor: 'Andrés',
        bloques: 2,
      });
      expect(
        deps.providerScheduleService.upsertSchedule,
      ).toHaveBeenCalledWith(3, expect.arrayContaining([expect.anything()]));
    });

    it('(a) sad: add_exception sin fecha → error de DTO', async () => {
      const { deps, tools } = buildTools();
      deps.providersService.findOne.mockResolvedValue(PROVIDER_ROW);

      const result = await preview(tools, 'manage_booking_providers', {
        action: 'add_exception',
        provider_id: 3,
        exception: { reason: 'vacaciones' },
      });

      expect(result.status).toBe('error');
      expect(result.message).toContain('validación');
      expect(
        deps.providerScheduleService.createException,
      ).not.toHaveBeenCalled();
    });

    it('(e) preview set_business_hours: warning que lista días desactivados', async () => {
      const { deps, tools } = buildTools();

      const result = await preview(tools, 'manage_booking_providers', {
        action: 'set_business_hours',
        business_hours: [
          { day_of_week: 1, start_time: '08:00', end_time: '18:00' },
        ],
      });

      expect(result.status).toBe('warning');
      expect(result.message).toContain('DESACTIVAN');
      expect(result.message).toContain('domingo');
      expect(result.changes).toEqual([
        { field: 'dia_1', label: 'lunes', from: 'actual', to: '08:00–18:00' },
      ]);
      expect(deps.businessHoursService.upsertAll).not.toHaveBeenCalled();
    });

    it('(b) happy: set_business_hours aplica al store del contexto', async () => {
      const { deps, tools } = buildTools();
      deps.businessHoursService.upsertAll.mockResolvedValue([]);

      const answer = await run(tools, 'manage_booking_providers', {
        action: 'set_business_hours',
        business_hours: [
          { day_of_week: 1, start_time: '08:00', end_time: '18:00' },
        ],
      });

      expect(answer.calendario_maestro).toEqual({ dias_definidos: 1 });
      expect(deps.businessHoursService.upsertAll).toHaveBeenCalledWith(
        STORE_ID,
        expect.objectContaining({ items: expect.any(Array) }),
      );
    });

    it('(a) sad: business_hours con fin<=inicio → error con día legible', async () => {
      const { deps, tools } = buildTools();

      const result = await preview(tools, 'manage_booking_providers', {
        action: 'set_business_hours',
        business_hours: [
          { day_of_week: 1, start_time: '18:00', end_time: '08:00' },
        ],
      });

      expect(result.status).toBe('error');
      expect(result.message).toContain('lunes');
      expect(deps.businessHoursService.upsertAll).not.toHaveBeenCalled();
    });

    it('(c) proveedor inexistente → {error, next_step}', async () => {
      const { deps, tools } = buildTools();
      deps.providersService.findOne.mockRejectedValue(
        new Error('Proveedor no encontrado'),
      );

      const answer = await run(tools, 'manage_booking_providers', {
        action: 'update',
        provider_id: 404,
        bio: 'nuevo',
      });

      expect(answer.error).toContain('Proveedor no encontrado');
      expect(answer.next_step).toContain('proveedor');
      expect(deps.providersService.update).not.toHaveBeenCalled();
    });
  });
});
