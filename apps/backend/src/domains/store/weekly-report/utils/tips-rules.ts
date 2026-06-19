import { WeeklyMetricSet, WeeklyTip, WeeklyTier } from '../types';

/**
 * Selección de tips por reglas deterministas.
 *
 * Por qué reglas y no IA:
 *   - El plan lo justifica: la BD de dev tiene 0 configs de IA y los
 *     ejemplos de consejos pedidos son textos fijos por escenario.
 *   - Cero costo, cero dependencia, cero flakiness.
 *
 * Reglas (en orden de evaluación, máx 3 tips):
 *   1. Si total_orders == 0  → "record_every_sale"
 *   2. Si inventory.purchase_orders == 0  → "register_purchases"
 *   3. Si channel_breakdown ecommerce == 0  → "evaluate_ecommerce"
 *   4. Si channel_breakdown ecommerce < 20% del total (y total>0)  → "low_online_channel"
 *   5. Si inventory.purchase_orders == 0 y orders > 0  → "no_inventory_movements"
 *   6. Si tier == STELLAR o ABOVE  → "keep_momentum"
 *   7. Si tier == BELOW y hay ecommerce > 0  → "invite_to_online_store"
 *   8. Si tier == ZERO  → "invite_to_online_store" (ancla de esperanza)
 *
 * Las primeras 4 son universales; las últimas son de cierre motivacional.
 */
const MAX_TIPS = 3;

export function selectTips(
  metrics: WeeklyMetricSet,
  tier: WeeklyTier,
): WeeklyTip[] {
  const out: WeeklyTip[] = [];
  const hasActivity = metrics.total_orders > 0;

  const onlineChannel = metrics.channel_breakdown.find(
    (c) => c.channel === 'ecommerce',
  );
  const onlineShare = onlineChannel?.percentage ?? 0;
  const totalRevenue = metrics.total_revenue;

  if (metrics.total_orders === 0) {
    out.push({
      key: 'record_every_sale',
      title: 'Registra cada venta',
      body:
        'Esta semana no se registraron ventas finalizadas. Empezar a registrar cada venta, incluso las pequeñas, te permite entender tu negocio y tomar mejores decisiones.',
      cta: { label: 'Ir al POS', route: '/admin/pos' },
    });
  }

  if (metrics.inventory.purchase_orders === 0 && hasActivity) {
    out.push({
      key: 'register_purchases',
      title: 'Registra tus compras de inventario',
      body:
        'No registramos órdenes de compra esta semana. Cargar las compras mantiene tu stock al día y mejora el cálculo de tu rentabilidad.',
      cta: { label: 'Ir a Compras', route: '/admin/inventory/purchases' },
    });
  }

  if (
    !onlineChannel &&
    totalRevenue > 0 &&
    out.length < MAX_TIPS
  ) {
    out.push({
      key: 'evaluate_ecommerce',
      title: 'Activa tu tienda online',
      body:
        'Aún no tienes ventas por tu tienda online. Tener un canal ecommerce te permite vender 24/7 y llegar a más clientes sin costo extra.',
      cta: { label: 'Configurar ecommerce', route: '/admin/ecommerce' },
    });
  } else if (
    onlineChannel &&
    onlineShare < 20 &&
    totalRevenue > 0 &&
    out.length < MAX_TIPS
  ) {
    out.push({
      key: 'low_online_channel',
      title: 'Dales más empuje a tus ventas online',
      body: `Solo el ${onlineShare.toFixed(
        0,
      )}% de tus ingresos viene de la tienda online. Promociona tus productos en redes o WhatsApp para activar ese canal.`,
      cta: { label: 'Ver mi tienda', route: '/admin/ecommerce' },
    });
  }

  if (
    metrics.inventory.purchase_orders === 0 &&
    hasActivity &&
    out.length < MAX_TIPS
  ) {
    out.push({
      key: 'no_inventory_movements',
      title: '¿Moviste inventario esta semana?',
      body:
        'Si compraste mercancía o hiciste ajustes, regístralo para que tu stock y costos reflejen la realidad.',
      cta: { label: 'Ajustar inventario', route: '/admin/inventory' },
    });
  }

  if (
    (tier === 'STELLAR' || tier === 'ABOVE') &&
    out.length < MAX_TIPS
  ) {
    out.push({
      key: 'keep_momentum',
      title: '¡Mantén el ritmo!',
      body:
        'Vas por encima de tu promedio. Considera premiar a tus clientes con una promoción o ampliar tu catálogo de productos estrella.',
      cta: { label: 'Crear promoción', route: '/admin/promotions' },
    });
  }

  if (
    (tier === 'BELOW' || tier === 'ZERO') &&
    onlineChannel &&
    onlineShare < 50 &&
    out.length < MAX_TIPS
  ) {
    out.push({
      key: 'invite_to_online_store',
      title: 'Invita clientes a tu tienda online',
      body:
        'Comparte el link de tu tienda online con tu base de clientes por WhatsApp para que puedan volver a comprarte fácilmente.',
      cta: { label: 'Copiar link', route: '/admin/ecommerce' },
    });
  } else if (tier === 'ZERO' && out.length < MAX_TIPS) {
    out.push({
      key: 'invite_to_online_store',
      title: 'Empieza por tu tienda online',
      body:
        'Una buena forma de darle impulso a la próxima semana es tener tu catálogo online listo. Configúralo en minutos.',
      cta: { label: 'Configurar ecommerce', route: '/admin/ecommerce' },
    });
  }

  return out.slice(0, MAX_TIPS);
}
