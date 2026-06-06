import React from 'react';
import { View, Text, StyleSheet, type StyleProp, type ViewStyle, type TextStyle } from 'react-native';
import { Icon } from '@/shared/components/icon/icon';
import { colors, colorScales, spacing, typography } from '@/shared/theme';

interface OrgDetailRowProps {
  label: string;
  value?: string | number | null;
  icon?: string;
  valueColor?: string;
  monospace?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  valueStyle?: StyleProp<TextStyle>;
}

export function OrgDetailRow({
  label,
  value,
  icon,
  valueColor,
  monospace,
  style,
  textStyle,
  valueStyle,
}: OrgDetailRowProps) {
  return (
    <View style={[styles.row, style]}>
      <View style={styles.labelGroup}>
        {icon ? <Icon name={icon} size={14} color={colorScales.gray[500]} style={styles.icon} /> : null}
        <Text style={[styles.label, textStyle]}>{label}</Text>
      </View>
      <Text
        style={[
          styles.value,
          valueColor ? { color: valueColor } : null,
          monospace ? styles.mono : null,
          valueStyle,
        ]}
        numberOfLines={2}
      >
        {value ?? '—'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing[2],
  },
  labelGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
  },
  icon: {
    marginRight: spacing[2],
  },
  label: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
  },
  value: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colorScales.gray[900],
    textAlign: 'right',
    flexShrink: 1,
    marginLeft: spacing[4],
  },
  mono: {
    fontFamily: 'Menlo',
  },
});
