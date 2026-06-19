import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { Prisma, dispatch_route_status_enum } from '@prisma/client';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import {
  CreateDispatchRouteDto,
  UpdateDispatchRouteDto,
  DispatchRouteQueryDto,
} from './dto';
import { RouteNumberGenerator } from './utils/route-number-generator';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';

const DISPATCH_ROUTE_INCLUDE = {
  vehicle: true,
  driver_user: {
    select: { id: true, first_name: true, last_name: true, document_number: true },
  },
  dispatched_by_user: {
    select: { id: true, first_name: true, last_name: true },
  },
  closed_by_user: {
    select: { id: true, first_name: true, last_name: true },
  },
  voided_by_user: {
    select: { id: true, first_name: true, last_name: true },
  },
  origin_location: {
    select: { id: true, name: true, code: true },
  },
  stops: {
    orderBy: { stop_sequence: 'asc' as const },
    include: {
      dispatch_note: {
        select: {
          id: true,
          dispatch_number: true,
          customer_id: true,
          customer_name: true,
          grand_total: true,
          status: true,
          sales_order_id: true,
          sales_order: { select: { id: true, order_number: true, status: true } },
        },
      },
      settled_by_user: {
        select: { id: true, first_name: true, last_name: true },
      },
    },
  },
};

@Injectable()
export class DispatchRoutesService {
  private readonly logger = new Logger(DispatchRoutesService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly routeNumberGenerator: RouteNumberGenerator,
  ) {}

  private getStoreId(): number {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    return store_id;
  }

  async create(dto: CreateDispatchRouteDto) {
    const store_id = this.getStoreId();
    const user_id = RequestContextService.getContext()?.user_id;

    // Validate driver: si es externo, requiere nombre + cédula; si es interno, FK users.
    // Es mutuamente excluyente: no se permite mandar ambos (driver_user_id y external_*).
    if (dto.driver_user_id && (dto.external_driver_name || dto.external_driver_id_number)) {
      throw new BadRequestException(
        'Conductor interno y externo son mutuamente excluyentes',
      );
    }
    if (dto.is_primary_driver_external) {
      if (!dto.external_driver_name || !dto.external_driver_id_number) {
        throw new BadRequestException(
          'Conductor externo requiere external_driver_name y external_driver_id_number',
        );
      }
    } else {
      if (!dto.driver_user_id) {
        throw new BadRequestException(
          'Conductor interno requiere driver_user_id',
        );
      }
    }

    // Validate that all dispatch_notes exist, belong to this store, and are not already in another route
    const note_ids = dto.stops.map((s) => s.dispatch_note_id);
    const unique_note_ids = Array.from(new Set(note_ids));
    if (unique_note_ids.length !== note_ids.length) {
      throw new BadRequestException(
        'Hay dispatch_note_id duplicados en la planilla',
      );
    }

    const existing_notes = await this.prisma.dispatch_notes.findMany({
      where: { id: { in: unique_note_ids }, store_id },
      select: {
        id: true,
        store_id: true,
        status: true,
        sales_order_id: true,
        grand_total: true,
        invoice: { select: { id: true, status: true, payment_date: true } },
      },
    });
    if (existing_notes.length !== unique_note_ids.length) {
      throw new BadRequestException(
        'Una o más remisiones no existen o no pertenecen a la tienda',
      );
    }

    // Check whether the dispatch_notes are already in an active (non-released) stop.
    // Allow reuse if the existing stop is 'released' OR the parent route is still 'draft'.
    const existing_stops = await this.prisma.dispatch_route_stops.findMany({
      where: { dispatch_note_id: { in: unique_note_ids } },
      include: { route: { select: { status: true } } },
    });
    const blocking = existing_stops.filter(
      (s) => s.status !== 'released' && s.route.status !== 'draft',
    );
    if (blocking.length > 0) {
      throw new BadRequestException(
        `Las remisiones ${blocking.map((s) => s.dispatch_note_id).join(', ')} ya pertenecen a una planilla activa o cerrada`,
      );
    }

    // Validate vehicle
    if (dto.vehicle_id) {
      const vehicle = await this.prisma.vehicles.findFirst({
        where: { id: dto.vehicle_id, store_id },
      });
      if (!vehicle) {
        throw new BadRequestException('Vehículo no encontrado en la tienda');
      }
    }

    // Generate route_number
    let route_number: string;
    let attempts = 0;
    while (true) {
      try {
        route_number = await this.routeNumberGenerator.generateNextNumber(store_id);
        // Calculate totals from stops
        const stops_data = dto.stops.map((stop, idx) => {
          const note = existing_notes.find((n) => n.id === stop.dispatch_note_id)!;
          const is_prepaid = !!(note.invoice && note.invoice.payment_date);
          return {
            dispatch_note_id: stop.dispatch_note_id,
            stop_sequence: stop.stop_sequence ?? idx + 1,
            is_extra_route: stop.is_extra_route ?? false,
            is_prepaid,
            // Prepaid stops do NOT contribute to total_to_collect
            collected_amount: 0,
            anticipo_amount: 0,
            change_amount: 0,
            withholding_amount: 0,
            credit_amount: 0,
            notes: null,
          };
        });

        const total_to_collect = stops_data
          .filter((s) => !s.is_prepaid)
          .reduce(
            (sum, s) => sum + Number(existing_notes.find((n) => n.id === s.dispatch_note_id)?.grand_total || 0),
            0,
          );

        const total_prepaid = stops_data
          .filter((s) => s.is_prepaid)
          .reduce(
            (sum, s) => sum + Number(existing_notes.find((n) => n.id === s.dispatch_note_id)?.grand_total || 0),
            0,
          );

        const created = await this.prisma.dispatch_routes.create({
          data: {
            store_id,
            route_number,
            route_code: dto.route_code,
            status: 'draft',
            vehicle_id: dto.vehicle_id,
            driver_user_id: dto.driver_user_id,
            external_driver_name: dto.external_driver_name,
            external_driver_id_number: dto.external_driver_id_number,
            is_primary_driver_external: dto.is_primary_driver_external ?? false,
            assistants: dto.assistants as any,
            origin_location_id: dto.origin_location_id,
            planned_date: new Date(dto.planned_date),
            currency: dto.currency || 'COP',
            notes: dto.notes,
            total_to_collect,
            total_prepaid,
            created_by_user_id: user_id,
            updated_at: new Date(),
            stops: {
              create: stops_data,
            },
          },
          include: DISPATCH_ROUTE_INCLUDE,
        });
        return created;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002' &&
          (error.meta?.target as string[])?.includes('route_number')
        ) {
          attempts++;
          if (attempts >= 3) {
            throw new ConflictException(
              'No se pudo generar un número de planilla único',
            );
          }
          continue;
        }
        throw error;
      }
    }
  }

  async findAll(query: DispatchRouteQueryDto) {
    const store_id = this.getStoreId();
    const {
      page = 1,
      limit = 10,
      search,
      status,
      vehicle_id,
      driver_user_id,
      date_from,
      date_to,
      sort_by,
      sort_order,
    } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.dispatch_routesWhereInput = {
      store_id,
      ...(search && {
        OR: [
          { route_number: { contains: search, mode: 'insensitive' as any } },
          { route_code: { contains: search, mode: 'insensitive' as any } },
          { external_driver_name: { contains: search, mode: 'insensitive' as any } },
        ],
      }),
      ...(status && { status }),
      ...(vehicle_id && { vehicle_id }),
      ...(driver_user_id && { driver_user_id }),
      ...(date_from && date_to && {
        planned_date: { gte: new Date(date_from), lte: new Date(date_to) },
      }),
    };

    const orderBy: any = {};
    if (sort_by) {
      orderBy[sort_by] = sort_order === 'desc' ? 'desc' : 'asc';
    } else {
      orderBy.created_at = 'desc';
    }

    const [data, total] = await Promise.all([
      this.prisma.dispatch_routes.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          vehicle: { select: { id: true, plate: true, type: true } },
          driver_user: {
            select: { id: true, first_name: true, last_name: true },
          },
          _count: { select: { stops: true } },
        },
      }),
      this.prisma.dispatch_routes.count({ where }),
    ]);

    return {
      data,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: number) {
    const store_id = this.getStoreId();
    const route = await this.prisma.dispatch_routes.findFirst({
      where: { id, store_id },
      include: DISPATCH_ROUTE_INCLUDE,
    });
    if (!route) throw new NotFoundException(`Planilla #${id} no encontrada`);
    return route;
  }

  async update(id: number, dto: UpdateDispatchRouteDto) {
    const store_id = this.getStoreId();
    const route = await this.prisma.dispatch_routes.findFirst({
      where: { id, store_id },
    });
    if (!route) throw new NotFoundException(`Planilla #${id} no encontrada`);

    if (route.status !== 'draft') {
      throw new BadRequestException(
        'Solo se pueden editar planillas en estado borrador',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // Update stops if provided
      if (dto.stops) {
        for (const stop_update of dto.stops) {
          // We need to identify the stop. Since update.dto doesn't include id,
          // we only support stop_sequence changes by matching on sequence.
          // For simplicity, the controller passes full DTO with stop_id implicitly
          // via the included dispatch_note. We'll skip sequence updates here and
          // expose a separate method if needed. For now: support add/remove via
          // dedicated endpoint, not via update.
        }
      }

      return tx.dispatch_routes.update({
        where: { id },
        data: {
          route_code: dto.route_code,
          vehicle_id: dto.vehicle_id,
          driver_user_id: dto.driver_user_id,
          external_driver_name: dto.external_driver_name,
          external_driver_id_number: dto.external_driver_id_number,
          is_primary_driver_external: dto.is_primary_driver_external,
          assistants: dto.assistants as any,
          origin_location_id: dto.origin_location_id,
          planned_date: dto.planned_date ? new Date(dto.planned_date) : undefined,
          currency: dto.currency,
          notes: dto.notes,
          updated_at: new Date(),
        },
        include: DISPATCH_ROUTE_INCLUDE,
      });
    });
  }

  async remove(id: number) {
    const store_id = this.getStoreId();
    const route = await this.prisma.dispatch_routes.findFirst({
      where: { id, store_id },
    });
    if (!route) throw new NotFoundException(`Planilla #${id} no encontrada`);
    if (route.status !== 'draft') {
      throw new BadRequestException(
        'Solo se pueden eliminar planillas en estado borrador',
      );
    }
    // Free dispatch_notes by deleting the route (cascade deletes stops,
    // and the UNIQUE on dispatch_note_id is removed)
    await this.prisma.dispatch_routes.delete({ where: { id } });
    return { id, deleted: true };
  }

  async getStats() {
    const store_id = this.getStoreId();
    const [total, draft, dispatched, in_transit, closed, voided, totals] = await Promise.all([
      this.prisma.dispatch_routes.count({ where: { store_id } }),
      this.prisma.dispatch_routes.count({ where: { store_id, status: 'draft' } }),
      this.prisma.dispatch_routes.count({ where: { store_id, status: 'dispatched' } }),
      this.prisma.dispatch_routes.count({ where: { store_id, status: 'in_transit' } }),
      this.prisma.dispatch_routes.count({ where: { store_id, status: 'closed' } }),
      this.prisma.dispatch_routes.count({ where: { store_id, status: 'voided' } }),
      this.prisma.dispatch_routes.aggregate({
        where: { store_id, status: { in: ['closed', 'in_transit', 'settling'] } },
        _sum: { total_to_collect: true, total_collected: true, cash_variance: true },
      }),
    ]);
    return {
      total,
      draft,
      dispatched,
      in_transit,
      closed,
      voided,
      total_to_collect: Number(totals._sum.total_to_collect || 0),
      total_collected: Number(totals._sum.total_collected || 0),
      total_cash_variance: Number(totals._sum.cash_variance || 0),
    };
  }
}
