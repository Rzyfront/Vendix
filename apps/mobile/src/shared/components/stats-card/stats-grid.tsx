import { type ReactNode } from 'react';
import { ScrollView, View, StyleSheet, type ViewStyle } from 'react-native';
import { spacing } from '@/shared/theme';
import { StatsCard } from './stats-card';

export interface StatsGridItem {
  label: string;
  value: string | number;
  icon?: ReactNode | string;
  description?: string;
  /** Highlighted secondary text rendered with brand color (emerald by default). */
  smallText?: string;
  smallTextColor?: string;
  iconBg?: string;
  iconColor?: string;
  trend?: { value: number; positive: boolean };
  /** Render the card without background, border, or shadow. */
  bare?: boolean;
}

interface StatsGridProps {
  items: StatsGridItem[];
  style?: ViewStyle;
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'transparent',
    paddingTop: spacing[3],
    paddingBottom: spacing[1],
  },
  scrollContent: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 12,
  },
  item: {
    // Width is auto so the card sizes itself by content while the parent
    // ScrollView enables horizontal overflow when needed. Replaces the
    // previous fixed CARD_WIDTH (150) that was narrower than the inner
    // StatsCard (160), causing visible misalignment.
  },
});

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
              smallText={item.smallText}
              smallTextColor={item.smallTextColor}
              iconBg={item.iconBg}
              iconColor={item.iconColor}
              trend={item.trend}
              bare={item.bare}
            />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
