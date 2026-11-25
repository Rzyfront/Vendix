import type { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { ErrorCodes, VendixHttpException } from '../../../../common/errors';

/**
 * QUI-1060 F2: bajar la duración de un plan no puede dejar actividades del
 * itinerario en días que ya no existen. Se rechaza con un mensaje claro; nunca se
 * borran en silencio. Función suelta para que la edición del producto la use sin
 * depender del módulo de reservas.
 */
export async function assertPlanDurationKeepsActivities(
  prisma: Pick<StorePrismaService, 'service_plan_activities'>,
  productId: number,
  durationDays: number,
): Promise<void> {
  const outside = await prisma.service_plan_activities.count({
    where: { product_id: productId, day_number: { gt: durationDays } },
  });
  if (outside > 0) {
    throw new VendixHttpException(
      ErrorCodes.SERVICE_PLAN_023,
      `El itinerario tiene ${outside === 1 ? '1 actividad' : `${outside} actividades`} después del día ${durationDays}: muévelas o elimínalas antes de acortar el plan.`,
    );
  }
}
