import { type ReactNode } from 'react';
import { View, StyleSheet, type ViewStyle } from 'react-native';
import { spacing } from '@/shared/theme';
import { StatsCard } from './stats-card';

export interface StatsGridItem {
  label: string;
  value: string | number;
  icon?: ReactNode | string;
  trend?: { value: number; positive: boolean };
}

interface StatsGridProps {
  items: StatsGridItem[];
  style?: ViewStyle;
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: spacing[2],
    paddingTop: spacing[3],
    paddingBottom: spacing[2],
  },
  item: {
    flex: 1,
    minWidth: 0,
  },
});

export function StatsGrid({ items, style }: StatsGridProps) {
  return (
    <View style={[styles.container, style]}>
      {items.map((item, index) => (
        <View key={`${item.label}-${index}`} style={styles.item}>
          <StatsCard
            label={item.label}
            value={item.value}
            icon={item.icon}
            trend={item.trend}
          />
        </View>
      ))}
    </View>
  );
}
