import { Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { ExportBookingsQueryDto } from './dto/export-bookings-query.dto';

/** Raw export row — instants and Decimals unformatted (vendix-report-xlsx R3). */
export interface BookingExportRow {
  booking_number: string;
  date: Date;
  start_time: string;
  end_time: string;
  service_name: string;
  provider_name: string;
  customer_first_name: string;
  customer_last_name: string;
  customer_phone: string;
  status: string;
  channel: string;
  order_number: string;
  total: number;
}

@Injectable()
export class ReservationsExportService {
  /**
   * Explicit dataset cap: the export reads the FULL range (never the
   * visible page) up to this many rows.
   */
  static readonly EXPORT_ROW_LIMIT = 10000;

  constructor(private readonly prisma: StorePrismaService) {}

  async getExportRows(
    query: ExportBookingsQueryDto,
  ): Promise<{ rows: BookingExportRow[]; truncated: boolean }> {
    const { status, provider_id, product_id, date_from, date_to } = query;

    const rows = await this.prisma.bookings.findMany({
      // `bookings.date` is a `@db.Date` business date (UTC midnight), so
      // the YYYY-MM-DD filters compare in the same naive space — no
      // store-TZ instant resolution applies here (date-only rule).
      where: {
        ...(status && { status }),
        ...(provider_id && { provider_id }),
        ...(product_id && { product_id }),
        ...((date_from || date_to) && {
          date: {
            ...(date_from && { gte: new Date(date_from) }),
            ...(date_to && { lte: new Date(date_to) }),
          },
        }),
      },
      select: {
        booking_number: true,
        date: true,
        start_time: true,
        end_time: true,
        status: true,
        channel: true,
        product: { select: { name: true } },
        provider: {
          select: {
            display_name: true,
            employee: { select: { first_name: true } },
          },
        },
        customer: {
          select: { first_name: true, last_name: true, phone: true },
        },
        order: { select: { order_number: true, grand_total: true } },
      },
      orderBy: [{ date: 'asc' }, { start_time: 'asc' }],
      take: ReservationsExportService.EXPORT_ROW_LIMIT + 1,
    });

    const truncated = rows.length > ReservationsExportService.EXPORT_ROW_LIMIT;
    const page = truncated
      ? rows.slice(0, ReservationsExportService.EXPORT_ROW_LIMIT)
      : rows;

    return {
      rows: page.map((b) => ({
        booking_number: b.booking_number,
        date: b.date,
        start_time: b.start_time,
        end_time: b.end_time,
        service_name: b.product?.name ?? '',
        provider_name:
          b.provider?.display_name?.trim() ||
          b.provider?.employee?.first_name?.trim() ||
          '',
        customer_first_name: b.customer?.first_name?.trim() ?? '',
        customer_last_name: b.customer?.last_name?.trim() ?? '',
        customer_phone: b.customer?.phone ?? '',
        status: b.status,
        channel: b.channel,
        order_number: b.order?.order_number ?? '',
        total: b.order?.grand_total != null ? Number(b.order.grand_total) : 0,
      })),
      truncated,
    };
  }
}
