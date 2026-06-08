import React from 'react';
import { View, Text, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { colors, colorScales, spacing, typography, borderRadius } from '@/shared/theme';

interface OrgSectionHeaderProps {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function OrgSectionHeader({ title, subtitle, action, style }: OrgSectionHeaderProps) {
  return (
    <View style={[styles.container, style]}>
      <View style={styles.textGroup}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {action ? <View>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[1],
    marginBottom: spacing[3],
  },
  textGroup: {
    flex: 1,
  },
  title: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
  },
  subtitle: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
    marginTop: 2,
  },
});
