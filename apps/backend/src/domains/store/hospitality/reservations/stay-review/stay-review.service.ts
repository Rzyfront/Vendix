import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { localDateString, resolveStoreTimezone } from '@common/utils/store-timezone.util';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { LodgingPrecheckinService } from '../precheckin/precheckin.service';
import { StayReviewSubmitDto } from './stay-review.dto';
import { STAY_REVIEW_PATH, STAY_REVIEW_SOURCE, stayReviewOpen } from './stay-review';

const REVIEW_SELECT = { rating: true, comment: true, created_at: true } as const;

/**
 * Hospitality Suite (H8.5) — after check-out the guest rates the stay
 * privately (1-5 stars and a comment) from the link in the thank-you email,
 * so the hotel spots a problem before it reaches an OTA. The rating is an
 * `order_reviews` row on the folio order: it shows in Clientes → Reseñas and
 * in the reservation. The link token is the reservation's guest token (H8.1)
 * and the store comes from the storefront host (scoped Prisma).
 */
@Injectable()
export class LodgingStayReviewService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly precheckin: LodgingPrecheckinService,
  ) {}

  /** Thank-you email: the rating link of a checked-out stay with a folio; null when it does not apply. */
  async linkFor(reservationId: number): Promise<string | null> {
    const reservation = await this.prisma.lodging_reservations.findFirst({
      where: { id: reservationId },
      select: {
        id: true,
        status: true,
        departure_date: true,
        precheckin_token: true,
        folio: { select: { order: { select: { order_review: { select: { id: true } } } } } },
      },
    });
    if (!reservation?.folio || reservation.folio.order.order_review) return null;
    if (!stayReviewOpen(reservation, await this.storeToday())) return null;
    return this.precheckin.guestUrl(reservation, STAY_REVIEW_PATH);
  }

  /** Guest: what the rating page shows (no personal data). */
  async findByToken(token: string) {
    const reservation = await this.findOpenByToken(token);
    const store = await this.prisma.stores.findFirst({
      where: { id: this.requireStoreId() },
      select: { name: true },
    });
    return {
      store_name: store?.name ?? '',
      reservation_number: reservation.reservation_number,
      arrival_date: reservation.arrival_date.toISOString().slice(0, 10),
      departure_date: reservation.departure_date.toISOString().slice(0, 10),
      review: reservation.folio.order.order_review,
    };
  }

  /** Guest: saves the rating once per stay. */
  async submit(token: string, dto: StayReviewSubmitDto) {
    const reservation = await this.findOpenByToken(token);
    if (reservation.folio.order.order_review) {
      throw new VendixHttpException(ErrorCodes.LODGING_STAY_REVIEW_DUP_001);
    }
    const order = reservation.folio.order;
    try {
      return await this.prisma.order_reviews.create({
        data: {
          store_id: this.requireStoreId(),
          order_id: order.id,
          customer_id: order.customer_id,
          rating: dto.rating,
          comment: dto.comment ?? null,
          source: STAY_REVIEW_SOURCE,
        },
        select: REVIEW_SELECT,
      });
    } catch (err: unknown) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new VendixHttpException(ErrorCodes.LODGING_STAY_REVIEW_DUP_001);
      }
      throw err;
    }
  }

  private async findOpenByToken(token: string) {
    const reservation = token
      ? await this.prisma.lodging_reservations.findFirst({
          where: { precheckin_token: token },
          select: {
            status: true,
            reservation_number: true,
            arrival_date: true,
            departure_date: true,
            folio: {
              select: {
                order: {
                  select: { id: true, customer_id: true, order_review: { select: REVIEW_SELECT } },
                },
              },
            },
          },
        })
      : null;
    if (!reservation?.folio) throw new VendixHttpException(ErrorCodes.LODGING_STAY_REVIEW_FIND_001);
    if (!stayReviewOpen(reservation, await this.storeToday())) {
      throw new VendixHttpException(ErrorCodes.LODGING_STAY_REVIEW_CLOSED_001);
    }
    return { ...reservation, folio: reservation.folio };
  }

  private async storeToday(): Promise<string> {
    return localDateString(new Date(), await resolveStoreTimezone(this.prisma, this.requireStoreId()));
  }

  private requireStoreId(): number {
    const store_id = RequestContextService.getContext()?.store_id;
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    return store_id;
  }
}
