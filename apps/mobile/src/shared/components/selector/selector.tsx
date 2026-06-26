import { useRef, useState } from 'react';
import { Modal, Pressable, Text, View, StyleSheet, type ViewStyle } from 'react-native';
import { colors, colorScales, spacing, borderRadius, typography } from '@/shared/theme';
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
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef<View>(null);
  const selected = options.find((o) => o.value === value);

  function measureTrigger() {
    if (triggerRef.current) {
      triggerRef.current.measureInWindow((x, y, w, h) => {
        setPos({ top: y + h + 4, left: x, width: w });
      });
    }
    setOpen(true);
  }

  return (
    <View style={style}>
      {label && <Text style={styles.label}>{label}</Text>}
      <Pressable
        ref={triggerRef}
        onPress={() => !disabled && (open ? setOpen(false) : measureTrigger())}
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
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.text.secondary} />
      </Pressable>
      {error && <Text style={styles.errorText}>{error}</Text>}

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} />
        <View style={[styles.popover, { top: pos.top, left: pos.left, width: pos.width }]}>
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
                {opt.icon ? <Icon name={opt.icon} size={18} color={isSelected ? colors.background : colors.text.primary} /> : null}
                <Text style={[styles.optionLabel, isSelected && styles.optionLabelSelected]}>
                  {opt.label}
                </Text>
                {isSelected ? <Icon name="check" size={16} color={colors.background} /> : null}
              </Pressable>
            );
          })}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: 10,
    fontWeight: typography.fontWeight.bold,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[700],
    letterSpacing: 0.5,
    textTransform: 'uppercase',
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
    gap: spacing[2],
  },
  triggerPressed: {
    backgroundColor: colorScales.gray[50],
  },
  triggerText: {
    flex: 1,
    fontSize: typography.fontSize.sm,
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
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  popover: {
    position: 'absolute',
    backgroundColor: colors.background,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 8,
    overflow: 'hidden',
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[3],
    gap: spacing[2],
  },
  optionPressed: {
    backgroundColor: colorScales.gray[50],
  },
  optionSelected: {
    backgroundColor: colors.primary,
  },
  optionLabel: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    color: colors.text.primary,
    fontWeight: typography.fontWeight.medium,
  },
  optionLabelSelected: {
    color: colors.background,
    fontWeight: typography.fontWeight.bold,
  },
});
