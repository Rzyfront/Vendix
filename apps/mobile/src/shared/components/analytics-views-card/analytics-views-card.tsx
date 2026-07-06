import { useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Icon } from '@/shared/components/icon/icon';
import { toastError } from '@/shared/components/toast/toast.store';
import { colors, colorScales, spacing, borderRadius, typography, breakpoints } from '@/shared/theme';
import type { SalesView } from '@/features/store/data/sales-views';

// ─────────────────────────────────────────────
// AnalyticsViewsCard — paridad con web
//
// Replica el bloque "Vistas de Ventas" usado al final de cada vista
// de analytics de ventas (paridad con apps/frontend sales-by-product.component.ts
// → <app-card> con grid grid-cols-2 md:grid-cols-4 de <app-analytics-card>).
//
// Responsive:
//   - Móvil (<768):  2 columnas (md:grid-cols-2 default)
//   - Tablet+ (≥768): 4 columnas (md:grid-cols-4)
//
// Cada card replica apps/frontend analytics-card.component.html:
//   .analytics-card (flex column, gap-2, p-3, rounded-xl, min-h 120)
//   ├ .card-icon (36×36, rounded-lg, bg del color, fg del color)
//   ├ .card-content (title sm semibold + description xs secondary, line-clamp 2)
//   └ .card-badge (pill 10px uppercase, color del card)
// ─────────────────────────────────────────────

interface AnalyticsViewsCardProps {
  /** Lista de vistas a mostrar (típicamente `getQuickLinks(excludeKey)`). */
  views: SalesView[];
  /**
   * Callback cuando el usuario toca una vista disponible.
   * Si se omite, se hace `router.push(view.route)` por defecto.
   * Útil para wiring personalizado (e.g. analytics, deep links).
   */
  onPressView?: (view: SalesView) => void;
  /** Título del card. Default "Vistas de Ventas". */
  title?: string;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: spacing[4],
    marginBottom: spacing[6],
  },
  title: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
    marginBottom: spacing[3],
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  gridItem: {
    // width se setea inline según numColumns (responsive).
    padding: spacing[1.5], // 6px → 12px gap efectivo entre cards (gap-3 web).
  },
  // AnalyticsCard — paridad 1:1 con apps/frontend analytics-card.component.scss
  // (flex column, gap-2, p-3, border, rounded-xl, min-height 120).
  viewCard: {
    flexDirection: 'column',
    gap: spacing[2],
    padding: spacing[3],
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: borderRadius.lg, // 12px (rounded-xl web)
    minHeight: 120,
    overflow: 'hidden',
  },
  viewCardPressed: {
    opacity: 0.85,
  },
  viewCardIcon: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.md, // 8px (rounded-lg web)
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewCardContent: {
    flex: 1,
    minWidth: 0,
  },
  viewCardTitle: {
    fontSize: typography.fontSize.sm, // 14px (--fs-sm web)
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[900],
    lineHeight: 18,
  },
  viewCardDescription: {
    fontSize: typography.fontSize.xs, // 12px (--fs-xs web)
    color: colorScales.gray[500],
    lineHeight: 16,
    marginTop: spacing[1],
  },
  viewCardBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: borderRadius.full,
  },
  viewCardBadgeText: {
    fontSize: 10,
    fontWeight: typography.fontWeight.medium,
    letterSpacing: 0.2,
    textTransform: 'uppercase',
  },
});

const RESPONSIVE_BREAKPOINT = breakpoints.md; // tailwind `md` (paridad web)

export function AnalyticsViewsCard({
  views,
  onPressView,
  title = 'Vistas de Ventas',
}: AnalyticsViewsCardProps) {
  const router = useRouter();
  const { width } = useWindowDimensions();
  // Paridad con web `grid-cols-2 md:grid-cols-4`:
  //   - móvil (<768):  2 columnas
  //   - tablet+ (≥768): 4 columnas
  const numColumns = width >= RESPONSIVE_BREAKPOINT ? 4 : 2;
  const itemWidth = `${100 / numColumns}%` as const;

  const handlePress = useCallback(
    (view: SalesView) => {
      if (onPressView) {
        onPressView(view);
        return;
      }
      if (!view.available) {
        toastError(`Próximamente: ${view.title} estará disponible`);
        return;
      }
      router.push(view.route as any);
    },
    [onPressView, router],
  );

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.grid}>
        {views.map((view) => (
          <View key={view.key} style={[styles.gridItem, { width: itemWidth }]}>
            <AnalyticsViewCard view={view} onPress={() => handlePress(view)} />
          </View>
        ))}
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────
// AnalyticsViewCard — interno, no exportado.
// Equivalente mobile de <app-analytics-card [view]="view">.
// ─────────────────────────────────────────────

function AnalyticsViewCard({
  view,
  onPress,
}: {
  view: SalesView;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Ir a ${view.title}`}
      style={({ pressed }) => [
        styles.viewCard,
        pressed && styles.viewCardPressed,
        // Hover effect paridad: en web el border-color cambia al color del card.
        pressed && { borderColor: view.color.fg },
      ]}
    >
      <View style={[styles.viewCardIcon, { backgroundColor: view.color.bg }]}>
        <Icon name={view.icon as any} size={20} color={view.color.fg} />
      </View>
      <View style={styles.viewCardContent}>
        <Text style={styles.viewCardTitle} numberOfLines={2}>
          {view.title}
        </Text>
        <Text style={styles.viewCardDescription} numberOfLines={2}>
          {view.description}
        </Text>
      </View>
      <View style={[styles.viewCardBadge, { backgroundColor: view.color.bg }]}>
        <Text style={[styles.viewCardBadgeText, { color: view.color.fg }]}>
          Ventas
        </Text>
      </View>
    </Pressable>
  );
}
