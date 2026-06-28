import { type ReactNode } from 'react';
import { ScrollView, View, StyleSheet, type ViewStyle } from 'react-native';
import { spacing } from '@/shared/theme';
import { StatsCard } from './stats-card';

export interface StatsGridItem {
  label: string;
  value: string | number;
  icon?: ReactNode | string;
  description?: string;
<<<<<<< HEAD
  descriptionColor?: string;
  iconBg?: string;
  iconColor?: string;
  trend?: { value: number; positive: boolean };
  /** When true, renders a skeleton placeholder instead of value. */
  loading?: boolean;
=======
  /** Highlighted secondary text rendered with brand color (emerald by default). */
  smallText?: string;
  smallTextColor?: string;
  iconBg?: string;
  iconColor?: string;
  trend?: { value: number; positive: boolean };
  /** Render the card without background, border, or shadow. */
  bare?: boolean;
>>>>>>> origin/dev
}

interface StatsGridProps {
  items: StatsGridItem[];
  style?: ViewStyle;
}

<<<<<<< HEAD
const CARD_WIDTH = 160;

=======
>>>>>>> origin/dev
const styles = StyleSheet.create({
  container: {
    backgroundColor: 'transparent',
    paddingTop: spacing[1],
    paddingBottom: spacing[1],
  },
  scrollContent: {
    flexDirection: 'row',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
  },
  item: {
    // Width is auto so the card sizes itself by content while the parent
    // ScrollView enables horizontal overflow when needed. Replaces the
    // previous fixed CARD_WIDTH (150) that was narrower than the inner
    // StatsCard (160), causing visible misalignment.
  },
});

/**
 * Stats grid mobile-first, espejo del patrón canónico del dashboard ORG_ADMIN.
 *
 * Renderiza un scroll horizontal de tarjetas de 160px (mismo tamaño, padding y
 * posicionamiento del ícono que la tarjeta del dashboard.tsx).
 *
 * Cada tarjeta entra con un fade-in + slide-up escalonado (40ms entre cards).
 * Esto da vida al dashboard sin saturar — los primeros 8 cards terminan en
 * ~320ms, suficientemente rápido para no sentirse lento.
 */
export function StatsGrid({ items, style }: StatsGridProps) {
  return (
    <View style={[styles.container, style]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {items.map((item, index) => (
          <View key={`${item.label}-${index}`} style={styles.item}>
            <StatsCard
              label={item.label}
              value={item.value}
              icon={item.icon}
              description={item.description}
<<<<<<< HEAD
              descriptionColor={item.descriptionColor}
              iconBg={item.iconBg}
              iconColor={item.iconColor}
              trend={item.trend}
              loading={item.loading}
              enterIndex={index}
=======
              smallText={item.smallText}
              smallTextColor={item.smallTextColor}
              iconBg={item.iconBg}
              iconColor={item.iconColor}
              trend={item.trend}
              bare={item.bare}
>>>>>>> origin/dev
            />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
