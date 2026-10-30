import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { booking_status_enum } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { ReservationsService } from '../reservations.service';
import { StoreContextRunner } from '@common/context/store-context-runner.service';
import {
  dateOnlyString,
  localDateString,
  resolveStoreTimezone,
  zonedWallClockToUtc,
} from '@common/utils/store-timezone.util';

/**
 * Auto-archiva bookings pre-servicio que ya pasaron su `end_time` sin
 * haber sido atendidos: `pending` o `confirmed` → `no_show`.
 *
 * Sin este job, una reserva de las 9:00 AM que nadie atiende sigue
 * contando en `pending_count` para siempre (y mostrándose como VENCIDA
 * en el calendario) — distorsionando el conteo de "Pendientes" en el
 * panel del operador y disparando estadísticas infladas de no-show
 * acumuladas.
 *
 * Estrategia:
 *   - Cada 5 minutos busca bookings `pending` o `confirmed` cuyo
 *     `end_time + grace` ya pasó (grace = 2h, alineado con el umbral
 *     frontend de `isBookingExpired` para VENCIDA).
 *   - Mueve cada uno a `no_show` con `ReservationsService.archiveToNoShow`
 *     (única vía que permite `pending → no_show`; el endpoint manual no).
 *     Un hold del ecommerce vencido (`pending` + `expires_at` pasado) se
 *     cierra como `cancelled` (`archiveExpiredHold`).
 *   - Idempotente: si otro worker ya movió la booking, `transition`
 *     no-op sobre el mismo estado.
 *
 * Timezone: usamos `resolveStoreTimezone` para comparar end_time con
 * "ahora en horario del store" — un booking a las 9:00 PM hora de
 * Bogotá ya es "vencido" aunque UTC siga marcando 02:00 AM del día
 * siguiente.
 */
@Injectable()
export class AutoNoShowJob {
  private readonly logger = new Logger(AutoNoShowJob.name);
  private isRunning = false;

  /** Grace period en minutos entre `end_time` y el archivado. */
  private static readonly GRACE_MINUTES = 120;
  /** Página de candidatas por consulta. */
  private static readonly PAGE_SIZE = 100;
  /** Tope de páginas por store y tick (≤ 1000 reservas revisadas). */
  private static readonly MAX_PAGES_PER_TICK = 10;

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly reservationsService: ReservationsService,
    private readonly storeContextRunner: StoreContextRunner,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async archive(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('AutoNoShowJob already running, skipping tick');
      return;
    }
    this.isRunning = true;
    try {
      const stores = await this.prisma.stores.findMany({
        where: { is_active: true },
        select: { id: true },
      });

      let totalArchived = 0;
      for (const store of stores) {
        try {
          const archived = await this.storeContextRunner.runInStoreContext(
            store.id,
            () => this.archiveStore(store.id),
          );
          totalArchived += archived;
        } catch (err: any) {
          this.logger.error(
            `AutoNoShowJob store ${store.id} failed: ${err?.message ?? err}`,
          );
        }
      }

      if (totalArchived > 0) {
        this.logger.log(
          `AutoNoShowJob: archived ${totalArchived} overdue booking(s) → no_show`,
        );
      }
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Archiva las reservas vencidas de UN store (QUI-966 S11).
   *
   * Vencida = `date + end_time + grace` ya pasó, con `date`/`end_time`
   * interpretados en la zona horaria del store (incluye las de HOY). Se
   * pagina por `id` ascendente con cursor, así las reservas que no se pueden
   * archivar (o las de hoy aún dentro de la gracia) no vuelven a copar el
   * cupo y todas las vencidas se procesan; el total por tick está acotado.
   */
  private async archiveStore(storeId: number): Promise<number> {
    const timezone = await resolveStoreTimezone(this.prisma, storeId);
    const now = new Date();
    const today = localDateString(now, timezone);

    let archived = 0;
    let cursor = 0;
    for (let page = 0; page < AutoNoShowJob.MAX_PAGES_PER_TICK; page++) {
      const candidates = await this.prisma.bookings.findMany({
        where: {
          store_id: storeId,
          status: {
            in: [booking_status_enum.pending, booking_status_enum.confirmed],
          },
          // Hasta HOY inclusive (día del store); la hora se filtra abajo.
          // `bookings.date` es @db.Date guardado como medianoche UTC.
          date: { lte: new Date(`${today}T00:00:00.000Z`) },
          id: { gt: cursor },
        },
        select: {
          id: true,
          date: true,
          end_time: true,
          status: true,
          expires_at: true,
        },
        orderBy: { id: 'asc' },
        take: AutoNoShowJob.PAGE_SIZE,
      });
      if (candidates.length === 0) break;
      cursor = candidates[candidates.length - 1].id;

      for (const b of candidates) {
        const bookingEnd = this.composeBookingEnd(b.date, b.end_time, timezone);
        if (!bookingEnd) continue;
        const graceEnd = new Date(
          bookingEnd.getTime() + AutoNoShowJob.GRACE_MINUTES * 60_000,
        );
        if (now <= graceEnd) continue; // todavía dentro del grace

        try {
          if (
            b.status === booking_status_enum.pending &&
            b.expires_at &&
            new Date(b.expires_at) < now
          ) {
            // Hold del ecommerce que nunca se confirmó: no fue una cita,
            // se cierra como cancelada (no cuenta como ausencia).
            await this.reservationsService.archiveExpiredHold(b.id);
          } else {
            // `archiveToNoShow` es la versión silenciosa de `noShow` — no
            // emite `booking.no_show` (notificación al operador por cada
            // booking archivada).
            await this.reservationsService.archiveToNoShow(b.id);
          }
          archived += 1;
        } catch (err: any) {
          // Si la transición falla (p.ej. ya cambió de estado), seguimos.
          this.logger.warn(
            `AutoNoShowJob could not archive booking ${b.id}: ${err?.message ?? err}`,
          );
        }
      }
      if (candidates.length < AutoNoShowJob.PAGE_SIZE) break;
    }
    return archived;
  }

  /**
   * Instante UTC de `date` (DATE, medianoche UTC) + `end_time` (HH:mm o
   * HH:mm:ss) como hora de pared del store. Devuelve null si el formato es
   * inválido.
   */
  private composeBookingEnd(
    date: Date | string,
    endTime: string,
    timezone: string,
  ): Date | null {
    const d =
      typeof date === 'string' ? date.split('T')[0] : dateOnlyString(date);
    const dm = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!dm) return null;
    const m = endTime.match(/^(\d{2}):(\d{2})/);
    if (!m) return null;
    return zonedWallClockToUtc(
      Number(dm[1]),
      Number(dm[2]),
      Number(dm[3]),
      Number(m[1]),
      Number(m[2]),
      0,
      0,
      timezone,
    );
  }
}
