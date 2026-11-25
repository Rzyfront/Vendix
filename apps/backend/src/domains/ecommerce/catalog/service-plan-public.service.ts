import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EcommercePrismaService } from '../../../prisma/services/ecommerce-prisma.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { localDateString, resolveStoreTimezone } from '@common/utils/store-timezone.util';
import { ErrorCodes, VendixHttpException } from '../../../common/errors';
import { isPlanProduct } from '../../store/reservations/service-plans/service-plan-pricing.util';
import {
  buildPublicItinerary,
  type PlanActivitySource,
  type PublicItineraryDay,
} from '../../store/reservations/service-plans/service-plan-itinerary.util';

/** Evento abierto y futuro tal como lo ve el cliente: fecha, cupos y precio, nada interno. */
export interface PublicPlanDeparture {
  departure_date: string;
  seats_available: number;
  /** Precio especial del paquete en ese evento; null = rige el precio por grupo. */
  price: number | null;
}

/** Ficha pública de un plan (QUI-1060 F2). Sin costos, responsables ni contactos. */
export interface PublicServicePlan {
  product_id: number;
  duration_days: number;
  duration_nights: number | null;
  departure_mode: 'fixed' | 'on_demand' | 'both';
  min_pax: number | null;
  max_pax: number | null;
  includes: string | null;
  excludes: string | null;
  recommendations: string | null;
  pax_prices: { min_pax: number; max_pax: number; price: number }[];
  departures: PublicPlanDeparture[];
  itinerary: PublicItineraryDay[];
}

/**
 * Lee la ficha pública de un plan de la tienda resuelta por el dominio. Usa el
 * cliente de ecommerce (filtra por `store_id` del dominio) y las mismas reglas de
 * visibilidad que el detalle del catálogo: un producto que la tienda no publica
 * no existe para el público.
 */
@Injectable()
export class ServicePlanPublicService {
  constructor(
    private readonly prisma: EcommercePrismaService,
    private readonly storePrisma: StorePrismaService,
  ) {}

  async getPublicPlan(productId: number): Promise<PublicServicePlan> {
    const product = await this.prisma.products.findFirst({
      where: {
        id: productId,
        state: 'active',
        available_for_ecommerce: true,
        is_sellable: true,
        product_type: 'service',
        // store_id lo aplica EcommercePrismaService desde el dominio.
      },
      select: {
        id: true,
        service_pricing_type: true,
        plan_duration_days: true,
        plan_duration_nights: true,
        plan_departure_mode: true,
        plan_min_pax: true,
        plan_max_pax: true,
        plan_includes: true,
        plan_excludes: true,
        plan_recommendations: true,
      },
    });
    if (!product || !isPlanProduct(product)) throw new VendixHttpException(ErrorCodes.PROD_FIND_001);

    const mode = (product.plan_departure_mode ?? 'on_demand') as PublicServicePlan['departure_mode'];
    const days = product.plan_duration_days as number;
    const today = await this.storeToday();

    const [tiers, departures, activities] = await Promise.all([
      this.prisma.service_plan_pax_prices.findMany({
        where: { product_id: product.id },
        orderBy: { min_pax: 'asc' },
        select: { min_pax: true, max_pax: true, price: true },
      }),
      mode === 'on_demand'
        ? Promise.resolve([])
        : this.prisma.service_plan_departures.findMany({
            where: {
              product_id: product.id,
              status: 'open',
              departure_date: { gte: new Date(`${today}T00:00:00.000Z`) },
            },
            orderBy: [{ departure_date: 'asc' }, { id: 'asc' }],
            select: { departure_date: true, capacity: true, seats_sold: true, price_override: true },
          }),
      this.prisma.service_plan_activities.findMany({
        where: { product_id: product.id, is_public: true },
        select: {
          id: true,
          day_number: true,
          sort_order: true,
          start_time: true,
          title: true,
          description: true,
          is_public: true,
        },
      }),
    ]);

    type DepartureRead = {
      departure_date: Date;
      capacity: number;
      seats_sold: number;
      price_override: Prisma.Decimal | null;
    };

    return {
      product_id: product.id,
      duration_days: days,
      duration_nights: product.plan_duration_nights,
      departure_mode: mode,
      min_pax: product.plan_min_pax,
      max_pax: product.plan_max_pax,
      includes: product.plan_includes,
      excludes: product.plan_excludes,
      recommendations: product.plan_recommendations,
      pax_prices: (tiers as { min_pax: number; max_pax: number; price: Prisma.Decimal }[]).map((t) => ({
        min_pax: t.min_pax,
        max_pax: t.max_pax,
        price: Number(t.price),
      })),
      departures: (departures as DepartureRead[])
        .map((d) => ({
          departure_date: d.departure_date.toISOString().slice(0, 10),
          seats_available: Math.max(d.capacity - d.seats_sold, 0),
          price: d.price_override != null ? Number(d.price_override) : null,
        }))
        .filter((d) => d.departure_date >= today && d.seats_available > 0),
      itinerary: buildPublicItinerary(activities as PlanActivitySource[], days),
    };
  }

  /** Hoy (`YYYY-MM-DD`) en la zona horaria de la tienda del dominio. */
  private async storeToday(): Promise<string> {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    const tz = await resolveStoreTimezone(this.storePrisma, storeId);
    return localDateString(new Date(), tz);
  }
}
