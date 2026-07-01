import { useRef, useState } from 'react';
import {
  Pressable,
  Text,
  View,
  Modal,
  StyleSheet,
  ScrollView,
  type ViewStyle,
} from 'react-native';
import { colors, colorScales, spacing, borderRadius, typography } from '@/shared/theme';
import { Icon } from '@/shared/components/icon/icon';

export interface MultiSelectorOption<T = string | number> {
  label: string;
  value: T;
  imageUrl?: string | null;
  icon?: string;
}

interface MultiSelectorProps<T = string | number> {
  values: T[];
  onChange: (values: T[]) => void;
  options: MultiSelectorOption<T>[];
  max?: number;
  placeholder?: string;
  label?: string;
  disabled?: boolean;
  style?: ViewStyle;
}

function arraysEqual<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((v, i) => sortedB[i] === v);
}

export function MultiSelector<T = string | number>({
  values,
  onChange,
  options,
  max,
  placeholder = 'Seleccionar…',
  label,
  disabled = false,
  style,
}: MultiSelectorProps<T>) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef<View>(null);

  function measureTrigger() {
    if (triggerRef.current) {
      triggerRef.current.measureInWindow((x, y, w, h) => {
        setPos({ top: y + h + 4, left: x, width: w });
      });
    }
    setOpen(true);
  }

  const selectedOptions = options.filter((o) => values.includes(o.value));

  function toggle(value: T) {
    const set = new Set(values);
    if (set.has(value)) {
      set.delete(value);
    } else {
      if (max && set.size >= max) return;
      set.add(value);
    }
    onChange(Array.from(set));
  }

  function clear() {
    onChange([]);
  }

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
        ]}
      >
        {selectedOptions.length === 0 ? (
          <Text style={[styles.triggerText, styles.placeholder]}>{placeholder}</Text>
        ) : (
          <View style={styles.chipsRow}>
            {selectedOptions.map((opt) => (
              <View key={String(opt.value)} style={styles.chip}>
                <Text style={styles.chipText} numberOfLines={1}>
                  {opt.label}
                </Text>
                <Pressable
                  onPress={() => toggle(opt.value)}
                  hitSlop={8}
                  style={styles.chipRemove}
                >
                  <Icon name="x" size={12} color={colorScales.gray[700]} />
                </Pressable>
              </View>
            ))}
          </View>
        )}
        <Icon name={open ? "chevron-up" : "chevron-down"} size={18} color={colors.text.secondary} />
      </Pressable>

      <Modal visible={open} animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} />
        <View style={styles.modalHeader}>
          <Text style={styles.modalHint}>
            {values.length === 0
              ? 'Toca para agregar'
              : `${values.length} seleccionado${values.length === 1 ? '' : 's'}`}
            {max ? ` (máx. ${max})` : ''}
          </Text>
          {values.length > 0 && (
            <Pressable onPress={clear} hitSlop={8}>
              <Text style={styles.clearText}>Limpiar</Text>
            </Pressable>
          )}
        </View>
        <View style={styles.list}>
          {options.map((opt) => {
            const isSelected = values.includes(opt.value);
            const isDisabled = !!max && !isSelected && values.length >= max;
            return (
              <Pressable
                key={String(opt.value)}
                onPress={() => !isDisabled && toggle(opt.value)}
                disabled={isDisabled}
                style={({ pressed }) => [
                  styles.option,
                  pressed && styles.optionPressed,
                  isSelected && styles.optionSelected,
                  isDisabled && styles.disabled,
                ]}
              >
                {opt.icon && <Icon name={opt.icon} size={18} color={colors.text.primary} />}
                <Text style={styles.optionLabel}>{opt.label}</Text>
                {isSelected && <Icon name="check" size={18} color={colors.primary} />}
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
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[300],
    backgroundColor: colorScales.gray[50],
    gap: spacing[2],
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
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  chipsRow: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[1],
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colorScales.green[50] ?? '#F0FDF4',
    borderRadius: borderRadius.full,
    paddingLeft: spacing[3],
    paddingRight: spacing[1],
    paddingVertical: spacing[1],
    gap: spacing[1],
    maxWidth: 200,
  },
  chipText: {
    fontSize: typography.fontSize.sm,
    color: colorScales.green[700] ?? '#15803D',
    flexShrink: 1,
  },
  chipRemove: {
    padding: 2,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colorScales.gray[100],
  },
  modalHint: {
    fontSize: typography.fontSize.sm,
    color: colors.text.secondary,
  },
  clearText: {
    fontSize: typography.fontSize.sm,
    color: colors.primary,
    fontWeight: '500',
  },
  list: {
    maxHeight: 400,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
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
  optionLabel: {
    flex: 1,
    fontSize: typography.fontSize.base,
    color: colors.text.primary,
  },
});

export type { MultiSelectorProps };