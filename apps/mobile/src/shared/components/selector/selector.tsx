import { useState } from 'react';
import { Pressable, Text, View, StyleSheet, ScrollView, type ViewStyle } from 'react-native';
import { colors, colorScales, spacing, borderRadius, typography } from '@/shared/theme';
import { Modal } from '@/shared/components/modal/modal';
import { Icon } from '@/shared/components/icon/icon';

export interface SelectorOption<T = string | number> {
  label: string;
  value: T;
  icon?: string;
  description?: string;
}

interface SelectorProps<T = string | number> {
  value: T | null | undefined;
  onChange: (value: T) => void;
  options: SelectorOption<T>[];
  placeholder?: string;
  label?: string;
  error?: string;
  disabled?: boolean;
  style?: ViewStyle;
}

export function Selector<T = string | number>({
  value,
  onChange,
  options,
  placeholder = 'Seleccionar…',
  label,
  error,
  disabled = false,
  style,
}: SelectorProps<T>) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    <View style={style}>
      {label && <Text style={styles.label}>{label}</Text>}
      <Pressable
        onPress={() => !disabled && setOpen(true)}
        disabled={disabled}
        style={({ pressed }) => [
          styles.trigger,
          pressed && styles.triggerPressed,
          disabled && styles.disabled,
          error && styles.errorBorder,
        ]}
      >
        {selected?.icon && (
          <Icon name={selected.icon} size={18} color={colors.text.primary} style={{ marginRight: spacing[2] }} />
        )}
        <Text
          style={[styles.triggerText, !selected && styles.placeholder]}
          numberOfLines={1}
        >
          {selected ? selected.label : placeholder}
        </Text>
        <Icon name="chevron-down" size={18} color={colors.text.secondary} />
      </Pressable>
      {error && <Text style={styles.errorText}>{error}</Text>}

      <Modal visible={open} onClose={() => setOpen(false)} title={label ?? 'Seleccionar'} showCloseButton>
        <ScrollView style={styles.list}>
          {options.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <Pressable
                key={String(opt.value)}
                onPress={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                style={({ pressed }) => [
                  styles.option,
                  pressed && styles.optionPressed,
                  isSelected && styles.optionSelected,
                ]}
              >
                {opt.icon && <Icon name={opt.icon} size={18} color={colors.text.primary} />}
                <View style={styles.optionBody}>
                  <Text style={styles.optionLabel}>{opt.label}</Text>
                  {opt.description && <Text style={styles.optionDescription}>{opt.description}</Text>}
                </View>
                {isSelected && <Icon name="check" size={18} color={colors.primary} />}
              </Pressable>
            );
          })}
        </ScrollView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: typography.fontSize.sm,
    fontWeight: '500',
    color: colors.text.secondary,
    marginBottom: spacing[1],
  },
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 40,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: 10,
    borderWidth: 0,
     
    backgroundColor: colorScales.gray[50],
  },
  triggerPressed: {
    backgroundColor: colorScales.gray[50],
  },
  triggerText: {
    flex: 1,
    fontSize: typography.fontSize.base,
    color: colors.text.primary,
  },
  placeholder: {
    color: colors.text.muted,
  },
  disabled: {
    opacity: 0.5,
  },
  errorBorder: {
    borderColor: colors.error,
  },
  errorText: {
    fontSize: typography.fontSize.xs,
    color: colors.error,
    marginTop: spacing[1],
  },
  list: {
    maxHeight: 400,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    gap: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colorScales.gray[100],
  },
  optionPressed: {
    backgroundColor: colorScales.gray[50],
  },
  optionSelected: {
    backgroundColor: colorScales.green[50] ?? '#F0FDF4',
  },
  optionBody: {
    flex: 1,
  },
  optionLabel: {
    fontSize: typography.fontSize.base,
    color: colors.text.primary,
  },
  optionDescription: {
    fontSize: typography.fontSize.sm,
    color: colors.text.secondary,
    marginTop: 2,
  },
});

export type { SelectorProps };