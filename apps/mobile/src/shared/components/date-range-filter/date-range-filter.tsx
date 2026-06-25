import { useState, useCallback } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { Modal } from '@/shared/components/modal/modal';
import { Icon } from '@/shared/components/icon/icon';
import { colors, spacing, borderRadius, typography, colorScales } from '@/shared/theme';

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

const styles = StyleSheet.create({
  // Trigger — web parity: input-style pill, sm size
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    height: 36,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.card,
  },
  triggerLabel: {
    fontSize: typography.fontSize.sm,
    color: colors.text.primary,
    fontWeight: typography.fontWeight.medium,
  },
  // Modal body
  sectionTitle: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[900],
    paddingHorizontal: spacing[4],
    paddingTop: spacing[4],
    paddingBottom: spacing[2],
  },
  presetGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[2],
    paddingHorizontal: spacing[4],
  },
  presetChip: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.card,
  },
  presetChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  presetChipText: {
    fontSize: typography.fontSize.sm,
    color: colors.text.primary,
    fontWeight: typography.fontWeight.medium,
  },
  presetChipTextActive: {
    color: colors.background,
  },
  dateRow: {
    flexDirection: 'row',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingTop: spacing[2],
  },
  dateField: {
    flex: 1,
  },
  dateLabel: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
    marginBottom: spacing[1],
    fontWeight: typography.fontWeight.medium,
  },
  dateInput: {
    height: 40,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing[3],
    backgroundColor: colors.inputBg,
    fontSize: typography.fontSize.sm,
    color: colors.text.primary,
  },
  footer: {
    flexDirection: 'row',
    gap: spacing[2],
  },
  applyButton: {
    flex: 1,
    height: 44,
    borderRadius: borderRadius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  applyButtonText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colors.background,
  },
});

function fmtDate(iso: string): string {
  // YYYY-MM-DD → DD/MM/YYYY (corto, mobile-friendly)
  if (!iso || iso.length < 10) return iso;
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

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

export function DateRangeFilter({ value, onChange }: DateRangeFilterProps) {
  const [open, setOpen] = useState(false);
  const [draftPreset, setDraftPreset] = useState<DatePreset>(value.preset);
  const [draftStart, setDraftStart] = useState<string>(value.start_date);
  const [draftEnd, setDraftEnd] = useState<string>(value.end_date);

  const openModal = useCallback(() => {
    setDraftPreset(value.preset);
    setDraftStart(value.start_date);
    setDraftEnd(value.end_date);
    setOpen(true);
  }, [value]);

  const onPresetSelect = useCallback((preset: DatePreset) => {
    setDraftPreset(preset);
    const range = presetToDateRange(preset);
    if (range) {
      setDraftStart(range.start_date);
      setDraftEnd(range.end_date);
    }
  }, []);

  const onApply = useCallback(() => {
    onChange({
      start_date: draftStart,
      end_date: draftEnd || draftStart,
      preset: draftPreset,
    });
    setOpen(false);
  }, [draftPreset, draftStart, draftEnd, onChange]);

  const triggerLabel =
    value.preset === 'custom' || value.start_date !== value.end_date
      ? `${fmtDate(value.start_date)} → ${fmtDate(value.end_date)}`
      : presetLabel(value.preset);

  return (
    <>
      <Pressable
        style={({ pressed }) => [styles.trigger, pressed && { opacity: 0.7 }]}
        onPress={openModal}
        hitSlop={4}
      >
        <Icon name="calendar" size={14} color={colors.text.secondary} />
        <Text style={styles.triggerLabel} numberOfLines={1}>
          {triggerLabel}
        </Text>
        <Icon name="chevron-down" size={12} color={colors.text.secondary} />
      </Pressable>

      <Modal
        visible={open}
        onClose={() => setOpen(false)}
        title="Seleccionar período"
        showFooter
        footer={
          <View style={styles.footer}>
            <Pressable style={styles.applyButton} onPress={onApply}>
              <Text style={styles.applyButtonText}>Aplicar</Text>
            </Pressable>
          </View>
        }
      >
        <Text style={styles.sectionTitle}>Período predefinido</Text>
        <View style={styles.presetGrid}>
          {PRESETS.map((p) => {
            const active = draftPreset === p.value;
            return (
              <Pressable
                key={p.value}
                style={[styles.presetChip, active && styles.presetChipActive]}
                onPress={() => onPresetSelect(p.value)}
              >
                <Text style={[styles.presetChipText, active && styles.presetChipTextActive]}>
                  {p.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.sectionTitle}>Rango personalizado</Text>
        <View style={styles.dateRow}>
          <View style={styles.dateField}>
            <Text style={styles.dateLabel}>Desde</Text>
            {/* @ts-expect-error — RN Web supports type="date" on TextInput via inputMode */}
            <TextInput
              value={draftStart}
              onChangeText={(v) => { setDraftStart(v); setDraftPreset('custom'); }}
              placeholder="YYYY-MM-DD"
              style={styles.dateInput}
            />
          </View>
          <View style={styles.dateField}>
            <Text style={styles.dateLabel}>Hasta</Text>
            {/* @ts-expect-error — RN Web supports type="date" on TextInput via inputMode */}
            <TextInput
              value={draftEnd}
              onChangeText={(v) => { setDraftEnd(v); setDraftPreset('custom'); }}
              placeholder="YYYY-MM-DD"
              style={styles.dateInput}
            />
          </View>
        </View>
      </Modal>
    </>
  );
}
