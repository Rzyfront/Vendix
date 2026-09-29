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
      } as any,
      availabilityService: {
        isSlotAvailable: jest.fn(),
        getAvailableSlots: jest.fn(),
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
    it('expone exactamente los 5 tools del dominio reservations', () => {
      const { tools } = buildTools();
      expect(tools.map((tool) => tool.name)).toEqual([
        'list_bookings',
        'get_booking',
        'check_booking_availability',
        'manage_bookings',
        'transition_booking',
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
      for (const name of ['manage_bookings', 'transition_booking']) {
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
});
