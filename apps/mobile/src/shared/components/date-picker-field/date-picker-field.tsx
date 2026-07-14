import { useState, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  Modal,
  StyleSheet,
  useWindowDimensions,
  type View as ViewType,
} from 'react-native';
import { Icon } from '@/shared/components/icon/icon';
import { colors, colorScales, spacing, borderRadius, typography, shadows } from '@/shared/theme';

// ─────────────────────────────────────────────
// DatePickerField — pill + popover con CALENDARIO visual.
// Reutilizable para elegir UNA fecha específica
// (DESDE, HASTA, o date input dentro del DateRangeFilter).
// ─────────────────────────────────────────────

interface DatePickerFieldProps {
  value: string; // YYYY-MM-DD
  onChange: (date: string) => void;
  placeholder?: string;
  accessibilityLabel?: string;
  /** Fecha mínima seleccionable (YYYY-MM-DD). Días anteriores se ignoran al tap. */
  minimumDate?: string;
}

const POPOVER_MAX_WIDTH = 300;
const SCREEN_MARGIN = 12;
const POPOVER_GAP = 4;

const MONTHS_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];
const DAYS_ES_SHORT = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignSelf: 'stretch',
  },
  // Pill field (clickable)
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    height: 36,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colorScales.gray[50],
    paddingHorizontal: spacing[3],
    width: '100%',
  },
  fieldPressed: { opacity: 0.85 },
  fieldText: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    color: colors.text.primary,
    fontWeight: typography.fontWeight.medium,
  },
  fieldTextPlaceholder: {
    color: colors.text.muted,
  },
  // Popover (NO fullScreen modal — transparente, posicionado bajo el trigger)
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.30)',
  },
  popover: {
    position: 'absolute',
    backgroundColor: colors.card,
    borderRadius: borderRadius.lg,
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
    paddingTop: spacing[3],
    paddingBottom: spacing[2],
  },
  popoverTitle: {
    fontSize: 10,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[500],
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  // Calendar header — month/year + nav
  calendarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  calendarMonthLabel: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
  },
  calendarNavBtn: {
    width: 28,
    height: 28,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarNavBtnPressed: {
    backgroundColor: colorScales.gray[100],
  },
  calendarWeekRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing[3],
    paddingTop: spacing[2],
    paddingBottom: spacing[1],
  },
  calendarWeekCell: {
    textAlign: 'center',
    fontSize: 10,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[400],
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacing[3],
    paddingBottom: spacing[3],
  },
  calendarDay: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
    borderRadius: borderRadius.full,
  },
  calendarDayPressed: {
    backgroundColor: colorScales.gray[100],
  },
  calendarDayMuted: {
    opacity: 0.25,
  },
  calendarDayToday: {
    borderWidth: 1,
    borderColor: colorScales.gray[300],
  },
  calendarDaySelected: {
    backgroundColor: colors.primary,
  },
  calendarDayText: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.medium,
    color: colorScales.gray[700],
  },
  calendarDayTextMuted: {
    color: colorScales.gray[400],
  },
  calendarDayTextSelected: {
    color: colors.background,
    fontWeight: typography.fontWeight.bold,
  },
});

function fmtDate(iso: string): string {
  if (!iso || iso.length < 10) return iso;
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function parseIso(iso: string): Date | null {
  if (!iso || iso.length < 10) return null;
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

interface TriggerPos { x: number; y: number; width: number; height: number; }

export function DatePickerField({
  value,
  onChange,
  placeholder = 'YYYY-MM-DD',
  accessibilityLabel = 'Selector de fecha',
  minimumDate,
}: DatePickerFieldProps) {
  // useWindowDimensions es reactivo a orientation change y window resize.
  // NO usar Dimensions.get('window') — solo lee el ancho al mount.
  const { width: screenWidth } = useWindowDimensions();
  const popoverWidth = Math.min(POPOVER_MAX_WIDTH, screenWidth - SCREEN_MARGIN * 2);
  const dayCell = Math.floor((popoverWidth - spacing[3] * 2 - spacing[1] * 6) / 7);

  const [open, setOpen] = useState(false);
  const [triggerPos, setTriggerPos] = useState<TriggerPos | null>(null);
  const triggerRef = useRef<ViewType>(null);

  // El calendario abre en el mes del valor actual (o el mes actual).
  const initialDate = useMemo(() => parseIso(value) ?? new Date(), [value]);
  const [viewMonth, setViewMonth] = useState<{ year: number; month: number }>(() => ({
    year: initialDate.getFullYear(),
    month: initialDate.getMonth(),
  }));

  const today = useMemo(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  }, []);

  const onOpen = useCallback(() => {
    if (open) { setOpen(false); return; }
    const seed = parseIso(value) ?? new Date();
    setViewMonth({ year: seed.getFullYear(), month: seed.getMonth() });
    triggerRef.current?.measureInWindow((x, y, width, height) => {
      setTriggerPos({ x, y, width, height });
      setOpen(true);
    });
  }, [open, value]);

  const onClose = useCallback(() => setOpen(false), []);

  const popoverPos = useMemo(() => {
    if (!open || !triggerPos) return null;
    let left = triggerPos.x;
    if (left + popoverWidth > screenWidth - SCREEN_MARGIN) {
      left = screenWidth - popoverWidth - SCREEN_MARGIN;
    }
    if (left < SCREEN_MARGIN) left = SCREEN_MARGIN;
    const top = triggerPos.y + triggerPos.height + POPOVER_GAP;
    return { top, left };
  }, [open, triggerPos]);

  // Calendar grid — días del mes actual con offset para que la semana empiece en Domingo.
  const calendarDays = useMemo(() => {
    const firstOfMonth = new Date(viewMonth.year, viewMonth.month, 1);
    const startOffset = firstOfMonth.getDay(); // 0=Domingo
    const daysInMonth = new Date(viewMonth.year, viewMonth.month + 1, 0).getDate();
    const daysInPrev = new Date(viewMonth.year, viewMonth.month, 0).getDate();

    const cells: Array<{ date: Date; inMonth: boolean }> = [];
    // Prev month tail
    for (let i = startOffset - 1; i >= 0; i--) {
      cells.push({ date: new Date(viewMonth.year, viewMonth.month - 1, daysInPrev - i), inMonth: false });
    }
    // Current month
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ date: new Date(viewMonth.year, viewMonth.month, d), inMonth: true });
    }
    // Next month head — completar múltiplo de 7
    while (cells.length % 7 !== 0) {
      const last = cells[cells.length - 1].date;
      const next = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);
      cells.push({ date: next, inMonth: false });
    }
    return cells;
  }, [viewMonth]);

  const selectedDate = useMemo(() => parseIso(value), [value]);

  const goPrevMonth = useCallback(() => {
    setViewMonth((v) => {
      const m = v.month - 1;
      if (m < 0) return { year: v.year - 1, month: 11 };
      return { year: v.year, month: m };
    });
  }, []);

  const goNextMonth = useCallback(() => {
    setViewMonth((v) => {
      const m = v.month + 1;
      if (m > 11) return { year: v.year + 1, month: 0 };
      return { year: v.year, month: m };
    });
  }, []);

  const onDayPress = useCallback(
    (d: Date) => {
      if (minimumDate) {
        const min = parseIso(minimumDate);
        if (min && d < min) {
          return; // Día anterior al mínimo — no propagar.
        }
      }
      onChange(toIso(d));
      setOpen(false);
    },
    [onChange, minimumDate],
  );

  const displayValue = value ? fmtDate(value) : '';

  return (
    <View style={styles.wrap}>
      {/* Trigger pill */}
      <Pressable
        ref={triggerRef}
        onPress={onOpen}
        hitSlop={4}
        accessibilityLabel={accessibilityLabel}
        style={({ pressed }) => [styles.field, pressed && styles.fieldPressed]}
      >
        <Icon name="calendar" size={14} color={colorScales.gray[400]} />
        <Text
          style={[styles.fieldText, !displayValue && styles.fieldTextPlaceholder]}
          numberOfLines={1}
        >
          {displayValue || placeholder}
        </Text>
        <Icon name="chevron-down" size={12} color={colorScales.gray[400]} />
      </Pressable>

      {/* Popover */}
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
              style={[
                styles.popover,
                { top: popoverPos.top, left: popoverPos.left, width: popoverWidth },
              ]}
              onPress={(e) => e.stopPropagation?.()}
            >
              {/* Calendar header */}
              <View style={styles.popoverHeader}>
                <Text style={styles.popoverTitle}>Seleccionar fecha</Text>
              </View>

              <View style={styles.calendarHeader}>
                <Pressable
                  onPress={goPrevMonth}
                  hitSlop={8}
                  style={({ pressed }) => [styles.calendarNavBtn, pressed && styles.calendarNavBtnPressed]}
                  accessibilityLabel="Mes anterior"
                >
                  <Icon name="chevron-left" size={16} color={colorScales.gray[700]} />
                </Pressable>
                <Text style={styles.calendarMonthLabel}>
                  {MONTHS_ES[viewMonth.month]} {viewMonth.year}
                </Text>
                <Pressable
                  onPress={goNextMonth}
                  hitSlop={8}
                  style={({ pressed }) => [styles.calendarNavBtn, pressed && styles.calendarNavBtnPressed]}
                  accessibilityLabel="Mes siguiente"
                >
                  <Icon name="chevron-right" size={16} color={colorScales.gray[700]} />
                </Pressable>
              </View>

              {/* Week day labels */}
              <View style={styles.calendarWeekRow}>
                {DAYS_ES_SHORT.map((d, i) => (
                  <Text key={`${d}-${i}`} style={[styles.calendarWeekCell, { width: dayCell }]}>{d}</Text>
                ))}
              </View>

              {/* Day grid */}
              <View style={styles.calendarGrid}>
                {calendarDays.map((cell, idx) => {
                  const isSelected = selectedDate ? isSameDay(cell.date, selectedDate) : false;
                  const isToday = isSameDay(cell.date, today);
                  return (
                    <Pressable
                      key={idx}
                      onPress={() => onDayPress(cell.date)}
                      style={({ pressed }) => [
                        styles.calendarDay,
                        { width: dayCell, height: dayCell },
                        pressed && !isSelected && styles.calendarDayPressed,
                        !cell.inMonth && styles.calendarDayMuted,
                        isToday && !isSelected && styles.calendarDayToday,
                        isSelected && styles.calendarDaySelected,
                      ]}
                      accessibilityLabel={`${cell.date.getDate()} de ${MONTHS_ES[cell.date.getMonth()]}`}
                    >
                      <Text
                        style={[
                          styles.calendarDayText,
                          !cell.inMonth && styles.calendarDayTextMuted,
                          isSelected && styles.calendarDayTextSelected,
                        ]}
                      >
                        {cell.date.getDate()}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </Pressable>
          )}
        </Pressable>
      </Modal>
    </View>
  );
}
