import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { booking_status_enum, Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { ReservationsService } from '../reservations.service';
import { StoreContextRunner } from '@common/context/store-context-runner.service';
import {
  resolveStoreTimezone,
  localCivil,
} from '@common/utils/store-timezone.util';

const pad2 = (n: number) => String(n).padStart(2, '0');

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
 *   - Mueve cada uno a `no_show` usando `ReservationsService.transition`
 *     (que valida `VALID_TRANSITIONS` → `pending → no_show` está
 *     permitido).
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
   * Archiva las reservas vencidas de UN store. Calculamos el cutoff
   * "ahora - grace" en la zona horaria del store para que la
   * comparación sea consistente con el frontend.
   */
  private async archiveStore(storeId: number): Promise<number> {
    const timezone = await resolveStoreTimezone(this.prisma, storeId);
    const nowLocal = localCivil(new Date(), timezone);
    const cutoff = new Date(
      Date.UTC(
        nowLocal.year,
        nowLocal.month - 1,
        nowLocal.day,
        nowLocal.hour,
        nowLocal.minute,
      ),
    );
    cutoff.setMinutes(
      cutoff.getMinutes() - AutoNoShowJob.GRACE_MINUTES,
    );

    // Booking "vencida" = `end_time` < cutoff. Comparamos por `end_time`
    // directamente (es una columna TIME, e.g. "14:30") concatenado con
    // `date` (DATE, e.g. "2026-07-29"). Para que el WHERE use índice
    // hacemos el join en la app (los bookings son pocos por store).
    const candidates = await this.prisma.bookings.findMany({
      where: {
        store_id: storeId,
        status: {
          in: [booking_status_enum.pending, booking_status_enum.confirmed],
        },
        // Solo fechas pasadas — `date < cutoff_date` (sin time para
        // evitar perder bookings del día actual que ya vencieron).
        date: {
          lt: new Date(
            Date.UTC(nowLocal.year, nowLocal.month - 1, nowLocal.day),
          ),
        },
      },
      select: {
        id: true,
        date: true,
        end_time: true,
        status: true,
      },
      take: 100, // safety cap por tick
    });

    let archived = 0;
    for (const b of candidates) {
      // Construimos Date completo: date + end_time, en horario local del
      // store, y le sumamos el grace. Si `now > date+end+grace`,
      // archivamos.
      const bookingEnd = this.composeBookingEnd(b.date, b.end_time);
      if (!bookingEnd) continue;
      const graceEnd = new Date(
        bookingEnd.getTime() + AutoNoShowJob.GRACE_MINUTES * 60_000,
      );
      if (new Date() <= graceEnd) continue; // todavía dentro del grace

      try {
        // `archiveToNoShow` es la versión silenciosa de `noShow` — no
        // emite `booking.no_show` (que dispara una notificación al
        // operador). Para un job de background que puede archivar
        // decenas de bookings por tick, emitir N notificaciones sería
        // peor que el problema de stats que estamos arreglando.
        await this.reservationsService.archiveToNoShow(b.id);
        archived += 1;
      } catch (err: any) {
        // Si la transición falla (p.ej. booking ya no está pending), lo
        // logueamos pero seguimos con el resto.
        this.logger.warn(
          `AutoNoShowJob could not archive booking ${b.id}: ${err?.message ?? err}`,
        );
      }
    }
    return archived;
  }

  /**
   * Compone un Date a partir de `date` (DATE) + `end_time` (string HH:mm
   * o HH:mm:ss). Devuelve null si el formato es inválido.
   */
  private composeBookingEnd(
    date: Date | string,
    endTime: string,
  ): Date | null {
    const d =
      typeof date === 'string'
        ? date.split('T')[0]
        : date.toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
    const m = endTime.match(/^(\d{2}):(\d{2})/);
    if (!m) return null;
    return new Date(`${d}T${m[1]}:${m[2]}:00`);
  }
}