import { useState, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  Modal,
  ScrollView,
  StyleSheet,
  Dimensions,
  type View as ViewType,
} from 'react-native';
import { Icon } from '@/shared/components/icon/icon';
import { DatePickerField } from '@/shared/components/date-picker-field/date-picker-field';
import { colors, colorScales, spacing, borderRadius, typography, shadows } from '@/shared/theme';

// ─────────────────────────────────────────────
// Tipos — paridad con web (DateRangeFilter en
// apps/frontend/src/app/private/modules/store/analytics/interfaces/analytics.interface.ts)
// ─────────────────────────────────────────────

export type DatePreset =
  | 'today'
  | 'yesterday'
  | 'thisWeek'
  | 'lastWeek'
  | 'thisMonth'
  | 'lastMonth'
  | 'thisYear'
  | 'lastYear'
  | 'custom';

export interface DateRangeFilterValue {
  start_date: string; // YYYY-MM-DD
  end_date: string;   // YYYY-MM-DD
  preset: DatePreset;
}

interface DateRangeFilterProps {
  value: DateRangeFilterValue;
  onChange: (value: DateRangeFilterValue) => void;
  /**
   * Muestra el date input inline (al lado del selector de preset).
   * Default `true`. Pasar `false` cuando la pantalla ya tiene sus propios
   * DatePickerField para DESDE/HASTA y solo quiere el selector de período.
   */
  showDateInput?: boolean;
}

const PRESETS: { value: DatePreset; label: string }[] = [
  { value: 'today', label: 'Hoy' },
  { value: 'yesterday', label: 'Ayer' },
  { value: 'thisWeek', label: 'Esta Semana' },
  { value: 'lastWeek', label: 'Semana Pasada' },
  { value: 'thisMonth', label: 'Este Mes' },
  { value: 'lastMonth', label: 'Mes Pasado' },
  { value: 'thisYear', label: 'Este Año' },
  { value: 'lastYear', label: 'Año Pasado' },
];

// ── Layout tokens (paridad con options-dropdown) ─────────────────────────
const SCREEN_WIDTH = Dimensions.get('window').width;
const SCREEN_MARGIN = 12;
const POPOVER_WIDTH = Math.min(220, SCREEN_WIDTH - SCREEN_MARGIN * 2);
const POPOVER_GAP = 4;

const styles = StyleSheet.create({
  // Container — paridad web: flex row (sm:flex-row items-center gap-3).
  // Sin `flex: 1` (que estiraría verticalmente dentro del column flex del padre):
  // usamos width 100% para que ocupe todo el ancho del periodField.
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    width: '100%',
    flexWrap: 'wrap',
  },
  // Selector pill — web parity: app-selector size="sm"  →  h-8 rounded-md border
  selector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    height: 36,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.card,
    minWidth: 110,
    flexShrink: 1,
    flexGrow: 1,
  },
  selectorPressed: { opacity: 0.85 },
  selectorText: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    color: colors.text.primary,
    fontWeight: typography.fontWeight.medium,
  },
  // Annotation 1: badge "Hoy 28/06" cuando preset=thisMonth.
  todayBadge: {
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: borderRadius.full,
    backgroundColor: colorScales.green[50],
    borderWidth: 1,
    borderColor: colorScales.green[200],
  },
  todayBadgeText: {
    fontSize: 10,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.green[700],
  },
  // Date input wrapper — envuelve el DatePickerField reutilizable.
  // flexBasis + flexGrow (sin `flex: 1`) para que tome el resto del row en horizontal
  // sin estirarse verticalmente dentro del column flex del padre.
  dateInput: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 130,
    minWidth: 110,
  },
  // Popover (NO fullScreen modal — transparente, posicionado bajo el trigger)
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.30)',
  },
  popover: {
    position: 'absolute',
    width: POPOVER_WIDTH,
    backgroundColor: colors.card,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    overflow: 'hidden',
    ...shadows.lg,
  },
  popoverHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  popoverTitle: {
    fontSize: 11,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[500],
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  popoverList: {
    paddingVertical: spacing[1],
    maxHeight: 320,
  },
  presetItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
    gap: spacing[2],
  },
  presetItemPressed: {
    backgroundColor: colorScales.gray[50],
  },
  presetItemActive: {
    backgroundColor: colors.primaryLight,
  },
  presetItemLabel: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    color: colors.text.primary,
    fontWeight: typography.fontWeight.medium,
  },
  presetItemLabelActive: {
    color: colors.primary,
    fontWeight: typography.fontWeight.semibold,
  },
});

function presetLabel(preset: DatePreset): string {
  return PRESETS.find((p) => p.value === preset)?.label ?? 'Personalizado';
}

function presetToDateRange(preset: DatePreset): DateRangeFilterValue | null {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const toIso = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  };

  let start: Date;
  let end: Date;

  switch (preset) {
    case 'today':
      start = today; end = today; break;
    case 'yesterday': {
      start = new Date(today); start.setDate(start.getDate() - 1); end = start; break;
    }
    case 'thisWeek': {
      start = new Date(today); start.setDate(start.getDate() - start.getDay()); end = today; break;
    }
    case 'lastWeek': {
      start = new Date(today); start.setDate(start.getDate() - start.getDay() - 7);
      end = new Date(start); end.setDate(end.getDate() + 6); break;
    }
    case 'thisMonth':
      start = new Date(today.getFullYear(), today.getMonth(), 1); end = today; break;
    case 'lastMonth':
      start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      end = new Date(today.getFullYear(), today.getMonth(), 0); break;
    case 'thisYear':
      start = new Date(today.getFullYear(), 0, 1); end = today; break;
    case 'lastYear':
      start = new Date(today.getFullYear() - 1, 0, 1);
      end = new Date(today.getFullYear() - 1, 11, 31); break;
    default:
      return null;
  }

  return { start_date: toIso(start), end_date: toIso(end), preset };
}

interface TriggerPos { x: number; y: number; width: number; height: number; }

export function DateRangeFilter({ value, onChange, showDateInput = true }: DateRangeFilterProps) {
  const [open, setOpen] = useState(false);
  const [triggerPos, setTriggerPos] = useState<TriggerPos | null>(null);
  const triggerRef = useRef<ViewType>(null);

  const onOpen = useCallback(() => {
    if (open) { setOpen(false); return; }
    triggerRef.current?.measureInWindow((x, y, width, height) => {
      setTriggerPos({ x, y, width, height });
      setOpen(true);
    });
  }, [open]);

  const onClose = useCallback(() => setOpen(false), []);

  // Dropdown positioning — paridad con options-dropdown
  const popoverPos = useMemo(() => {
    if (!open || !triggerPos) return null;
    let left = triggerPos.x;
    if (left + POPOVER_WIDTH > SCREEN_WIDTH - SCREEN_MARGIN) {
      left = SCREEN_WIDTH - POPOVER_WIDTH - SCREEN_MARGIN;
    }
    if (left < SCREEN_MARGIN) left = SCREEN_MARGIN;
    const top = triggerPos.y + triggerPos.height + POPOVER_GAP;
    return { top, left };
  }, [open, triggerPos]);

  const onPresetSelect = useCallback(
    (preset: DatePreset) => {
      const range = presetToDateRange(preset);
      if (range) {
        onChange(range);
        setOpen(false);
      }
    },
    [onChange],
  );

  const onDateChange = useCallback(
    (date: string) => {
      // Web parity: web input.date define start_date=end_date=date y preserva el preset.
      onChange({
        start_date: date,
        end_date: date,
        preset: value.preset === 'custom' ? value.preset : value.preset,
      });
    },
    [onChange, value.preset],
  );

  // Annotation 1 (web parity): el pill muestra el NOMBRE del preset (no el rango
  // completo, eso ya lo refleja el date input). Cuando el preset es `thisMonth`,
  // además se agrega un badge "Hoy dd/mm" porque end_date = hoy (la persona
  // eligió "este mes, hasta hoy").
  const presetName = presetLabel(value.preset);
  const todayLabel = useMemo(() => {
    if (value.preset !== 'thisMonth') return null;
    const t = new Date();
    const dd = String(t.getDate()).padStart(2, '0');
    const mm = String(t.getMonth() + 1).padStart(2, '0');
    return `Hoy ${dd}/${mm}`;
  }, [value.preset]);

  return (
    <View style={styles.container}>
      {/* Preset selector — abre popover (NO fullScreen modal) */}
      <Pressable
        ref={triggerRef}
        onPress={onOpen}
        hitSlop={4}
        accessibilityLabel="Selector de período"
        style={({ pressed }) => [styles.selector, pressed && styles.selectorPressed]}
      >
        <Icon name="calendar" size={14} color={colors.text.secondary} />
        <Text style={styles.selectorText} numberOfLines={1}>
          {presetName}
        </Text>
        {todayLabel && (
          <View style={styles.todayBadge}>
            <Text style={styles.todayBadgeText}>{todayLabel}</Text>
          </View>
        )}
        <Icon name="chevron-down" size={12} color={colors.text.secondary} />
      </Pressable>

      {/* Date input — paridad web: <app-input type="date">.
          Usa DatePickerField reutilizable (pill + popover con presets + date input).
          Oculto cuando showDateInput={false} (la pantalla ya tiene sus propios
          DatePickerField para DESDE/HASTA). */}
      {showDateInput && (
        <View style={styles.dateInput}>
          <DatePickerField
            value={value.start_date}
            onChange={onDateChange}
            accessibilityLabel="Fecha desde (selector de período)"
          />
        </View>
      )}

      {/* Popover — transparente sobre el contenido, NO modal fullScreen */}
      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={onClose}
        statusBarTranslucent
      >
        <Pressable style={styles.backdrop} onPress={onClose}>
          {popoverPos && (
            <Pressable
              style={[styles.popover, { top: popoverPos.top, left: popoverPos.left }]}
              onPress={(e) => e.stopPropagation?.()}
            >
              <View style={styles.popoverHeader}>
                <Text style={styles.popoverTitle}>Período predefinido</Text>
              </View>
              <ScrollView style={styles.popoverList} showsVerticalScrollIndicator={false}>
                {PRESETS.map((p) => {
                  const active = value.preset === p.value;
                  return (
                    <Pressable
                      key={p.value}
                      onPress={() => onPresetSelect(p.value)}
                      style={({ pressed }) => [
                        styles.presetItem,
                        pressed && styles.presetItemPressed,
                        active && styles.presetItemActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.presetItemLabel,
                          active && styles.presetItemLabelActive,
                        ]}
                        numberOfLines={1}
                      >
                        {p.label}
                      </Text>
                      {active && <Icon name="check" size={14} color={colors.primary} />}
                    </Pressable>
                  );
                })}
              </ScrollView>
            </Pressable>
          )}
        </Pressable>
      </Modal>
    </View>
  );
}
