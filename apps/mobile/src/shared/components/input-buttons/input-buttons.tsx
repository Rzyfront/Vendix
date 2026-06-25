import { Pressable, Text, View, StyleSheet, type ViewStyle } from 'react-native';
import { colors, colorScales, spacing, borderRadius, typography } from '@/shared/theme';
import { Icon } from '@/shared/components/icon/icon';

export interface InputButtonsOption<T = string | number> {
  label: string;
  value: T;
  icon?: string;
}

interface InputButtonsProps<T = string | number> {
  value: T | null | undefined;
  onChange: (value: T) => void;
  options: InputButtonsOption<T>[];
  fullWidth?: boolean;
  label?: string;
  disabled?: boolean;
  style?: ViewStyle;
}

export function InputButtons<T = string | number>({
  value,
  onChange,
  options,
  fullWidth = false,
  label,
  disabled = false,
  style,
}: InputButtonsProps<T>) {
  return (
    <View style={style}>
      {label && <Text style={styles.label}>{label}</Text>}
      <View
        style={[
          styles.row,
          fullWidth && styles.rowFullWidth,
        ]}
      >
        {options.map((opt) => {
          const isSelected = opt.value === value;
          return (
            <Pressable
              key={String(opt.value)}
              onPress={() => !disabled && onChange(opt.value)}
              disabled={disabled}
              style={({ pressed }) => [
                styles.pill,
                fullWidth && styles.pillFlex,
                isSelected && styles.pillSelected,
                pressed && !isSelected && styles.pillPressed,
                disabled && styles.disabled,
              ]}
            >
              {opt.icon && (
                <Icon
                  name={opt.icon}
                  size={16}
                  color={isSelected ? colors.background : colors.text.secondary}
                  style={{ marginRight: spacing[1] }}
                />
              )}
              <Text
                style={[
                  styles.pillText,
                  isSelected && styles.pillTextSelected,
                ]}
              >
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: typography.fontSize.sm,
    fontWeight: '500',
    color: colors.text.secondary,
    marginBottom: spacing[2],
  },
  row: {
    flexDirection: 'row',
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: borderRadius.full,
    padding: spacing[1],
    gap: spacing[1],
  },
  rowFullWidth: {
    width: '100%',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[4],
    borderRadius: borderRadius.full,
  },
  pillFlex: {
    flex: 1,
  },
  pillSelected: {
    backgroundColor: colors.primary,
  },
  pillPressed: {
    backgroundColor: colorScales.gray[100],
  },
  pillText: {
    fontSize: typography.fontSize.sm,
    fontWeight: '500',
    color: colors.text.secondary,
  },
  pillTextSelected: {
    color: colors.background,
  },
  disabled: {
    opacity: 0.5,
  },
});

export type { InputButtonsProps };