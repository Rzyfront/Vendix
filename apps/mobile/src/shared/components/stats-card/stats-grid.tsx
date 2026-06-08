import { type ReactNode } from 'react';
import { ScrollView, View, StyleSheet, type ViewStyle } from 'react-native';
import { spacing } from '@/shared/theme';
import { StatsCard } from './stats-card';

export interface StatsGridItem {
  label: string;
  value: string | number;
  icon?: ReactNode | string;
  description?: string;
  iconBg?: string;
  iconColor?: string;
  trend?: { value: number; positive: boolean };
}

interface StatsGridProps {
  items: StatsGridItem[];
  style?: ViewStyle;
}

const CARD_WIDTH = 150;

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
    width: CARD_WIDTH,
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
              iconBg={item.iconBg}
              iconColor={item.iconColor}
              trend={item.trend}
            />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
