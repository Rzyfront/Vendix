import { type ReactNode } from 'react';
import { ScrollView, View, StyleSheet, type ViewStyle } from 'react-native';
import { spacing } from '@/shared/theme';
import { StatsCard } from './stats-card';

export interface StatsGridItem {
  label: string;
  value: string | number;
  icon?: ReactNode | string;
  description?: string;
  descriptionColor?: string;
  iconBg?: string;
  iconColor?: string;
  trend?: { value: number; positive: boolean };
  /** When true, renders a skeleton placeholder instead of value. */
  loading?: boolean;
}

interface StatsGridProps {
  items: StatsGridItem[];
  style?: ViewStyle;
}

const CARD_WIDTH = 160;

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
    width: CARD_WIDTH,
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
              descriptionColor={item.descriptionColor}
              iconBg={item.iconBg}
              iconColor={item.iconColor}
              trend={item.trend}
              loading={item.loading}
              enterIndex={index}
            />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
