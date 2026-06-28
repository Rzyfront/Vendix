import {
  TIER_TONE,
  WeeklyMetricSet,
  WeeklySlide,
  WeeklyTier,
  WeeklyTip,
} from '../types';

interface BuildSlidesInput {
  tier: WeeklyTier;
  metrics: WeeklyMetricSet;
  tips: WeeklyTip[];
  weekStartIso: string;
  weekEndIso: string;
  storeName: string;
}

const CHANNEL_LABELS: Record<string, string> = {
  pos: 'Punto de Venta',
  ecommerce: 'Tienda Online',
  agent: 'Agente IA',
  whatsapp: 'WhatsApp',
  marketplace: 'Marketplace',
};

export function buildSlides(input: BuildSlidesInput): WeeklySlide[] {
  const { tier, metrics, tips, weekStartIso, weekEndIso, storeName } = input;
  const tone = TIER_TONE[tier];

  const slides: WeeklySlide[] = [];

  // 1. Cover
  slides.push({
    id: 'cover',
    kind: 'cover',
    title: tone.cover_title,
    subtitle: `${storeName} · ${weekStartIso} → ${weekEndIso}`,
    payload: {
      emoji: tone.cover_emoji,
      body_voice: tone.body_voice,
      week_start: weekStartIso,
      week_end: weekEndIso,
      tier,
    },
  });

  // 2. Sales (revenue + ticket)
  // El reporte cuenta solo órdenes en estado terminal (delivered/finished),
  // por eso puede diferir del dashboard en vivo (que incluye 'shipped'). El
  // subtítulo lo deja explícito para no confundir al owner.
  slides.push({
    id: 'sales',
    kind: 'sales',
    title: 'Tus ventas de la semana',
    subtitle: 'Solo órdenes entregadas o finalizadas',
    payload: {
      total_revenue: metrics.total_revenue,
      total_orders: metrics.total_orders,
      average_ticket: metrics.average_ticket,
      tier,
    },
  });

  // 3. Orders (best day)
  slides.push({
    id: 'orders',
    kind: 'orders',
    title: 'Tus días de venta',
    payload: {
      best_day: metrics.best_day,
      total_orders: metrics.total_orders,
      tier,
    },
  });

  // 4. Top product
  slides.push({
    id: 'top_product',
    kind: 'top_product',
    title: 'Tu producto estrella',
    payload: {
      top_product: metrics.top_product,
      tier,
    },
  });

  // 5. Customers
  slides.push({
    id: 'customers',
    kind: 'customers',
    title: 'Clientes nuevos',
    payload: {
      new_customers: metrics.new_customers,
      tier,
    },
  });

  // 6. Channels
  slides.push({
    id: 'channels',
    kind: 'channels',
    title: '¿De dónde vinieron tus ventas?',
    payload: {
      channels: metrics.channel_breakdown.map((c) => ({
        ...c,
        // El servicio rellena display_name con el enum crudo ('pos', ...), así
        // que el mapa de etiquetas legibles debe tener prioridad sobre él.
        display_name: CHANNEL_LABELS[c.channel] || c.display_name || c.channel,
      })),
      tier,
    },
  });

  // 7. Inventory
  slides.push({
    id: 'inventory',
    kind: 'inventory',
    title: 'Tu inventario',
    payload: {
      purchase_orders: metrics.inventory.purchase_orders,
      total_spent: metrics.inventory.total_spent,
      items_received: metrics.inventory.items_received,
      tier,
    },
  });

  // 8. Tips
  slides.push({
    id: 'tips',
    kind: 'tips',
    title: 'Ideas para tu próxima semana',
    payload: {
      tips: tips.map((t) => ({
        key: t.key,
        title: t.title,
        body: t.body,
        cta: t.cta,
      })),
      tier,
    },
  });

  // 9. Closing
  slides.push({
    id: 'closing',
    kind: 'closing',
    title: '¡Nos vemos la próxima semana!',
    payload: {
      tier,
      emoji: tone.cover_emoji,
      body_voice: tone.body_voice,
    },
  });

  return slides;
}
