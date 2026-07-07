import type { ReactNode } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Card } from '@/shared/components/card/card';
import { DateRangeFilter, type DateRangeFilterValue } from '@/shared/components/date-range-filter/date-range-filter';
import { DatePickerField } from '@/shared/components/date-picker-field/date-picker-field';
import { ExportButton } from '@/shared/components/export-button/export-button';
import { colors, colorScales, spacing, borderRadius, typography, shadows } from '@/shared/theme';

// ─────────────────────────────────────────────
// AnalyticsPeriodCard — paridad web
//
// Replica el bloque "Analíticas y Reportes de Ventas" usado en todas las
// vistas de analytics (sales/summary, sales/by-product, sales/by-category,
// sales/by-customer, sales/by-payment, sales/trends, etc.).
//
// Estructura (idéntica a apps/frontend/sales-by-product.component.ts):
//   ┌────────────────────────────────────────────┐
//   │  Analíticas y Reportes de Ventas          │  ← title
//   │                                            │
//   │  PERÍODO       [Selector de período]       │  ← DateRangeFilter
//   │  DESDE / HASTA [Date picker] [Date picker] │  ← 2 DatePickerField
//   │                       [↓ Exportar]         │  ← ExportButton (opcional)
//   └────────────────────────────────────────────┘
//
// Responsive:
//   - En pantallas estrechas DESDE/HASTA wrappean a 2 filas (flexWrap + minWidth 130).
//   - En pantallas anchas ambas fechas quedan lado a lado al 50%.
// ─────────────────────────────────────────────

interface AnalyticsPeriodCardProps {
  value: DateRangeFilterValue;
  onChange: (value: DateRangeFilterValue) => void;
  /**
   * Si se omite, el botón "Exportar" no se muestra (la pantalla
   * no quiere exportar todavía). Si se pasa, se renderiza alineado
   * a la derecha.
   */
  onExport?: () => void;
  /** Título del card. Default "Analíticas y Reportes de Ventas". */
  title?: string;
  /**
   * Contenido opcional adicional, renderizado ENTRE el row de DESDE/HASTA
   * y el botón de Exportar. Útil para que pantallas específicas (ej. Tendencias)
   * agreguen controles extra (Granularidad, Canal, etc.) sin perder la
   * consistencia visual de PERÍODO/DESDE/HASTA/EXPORTAR en el resto de vistas.
   */
  children?: ReactNode;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: spacing[4],
    marginBottom: spacing[4],
    ...shadows.sm,
  },
  title: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[800],
    marginBottom: spacing[3],
  },
  form: {
    gap: spacing[2.5],
  },
  field: {
    // Wrapper simple: solo `gap` interno entre label y el input.
    // NO usar `flex: 1` ni `width: '100%'`: en column flex (form) `flex: 1`
    // estiraría el item verticalmente dejando un hueco vacío; en row flex
    // (dateRow) `width: '100%'` lo estiraría verticalmente al alto del row.
    // El ancho se controla con `flex: 1` inline en dateRow.
    gap: spacing[1.5],
  },
  label: {
    fontSize: 10,
    fontWeight: typography.fontWeight.semibold as any,
    color: colorScales.gray[400],
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing[3],
    flexWrap: 'wrap',
  },
  exportRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
});

export function AnalyticsPeriodCard({
  value,
  onChange,
  onExport,
  title = 'Analíticas y Reportes de Ventas',
  children,
}: AnalyticsPeriodCardProps) {
  return (
    <Card style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.form}>
        {/* Selector de Período / Preset — sin date input inline
            (la pantalla ya tiene DatePickerField para DESDE/HASTA). */}
        <View style={styles.field}>
          <Text style={styles.label}>PERÍODO</Text>
          <DateRangeFilter
            value={value}
            onChange={onChange}
            showDateInput={false}
          />
        </View>

        {/* Fila DESDE / HASTA — cada uno es un DatePickerField (pill + popover).
            `flex: 1` inline para que cada uno ocupe el 50% del ancho dentro del
            dateRow (row flex). minWidth 130 para que en pantallas estrechas
            las dos fechas puedan wrappear a filas separadas (responsive). */}
        <View style={styles.dateRow}>
          <View style={[styles.field, { flex: 1, minWidth: 130 }]}>
            <Text style={styles.label}>DESDE</Text>
            <DatePickerField
              value={value.start_date}
              onChange={(v) => onChange({ ...value, start_date: v, preset: 'custom' })}
              accessibilityLabel="Fecha desde"
            />
          </View>
          <View style={[styles.field, { flex: 1, minWidth: 130 }]}>
            <Text style={styles.label}>HASTA</Text>
            <DatePickerField
              value={value.end_date}
              onChange={(v) => onChange({ ...value, end_date: v, preset: 'custom' })}
              accessibilityLabel="Fecha hasta"
            />
          </View>
        </View>

        {/* Sección opcional (children) — ej. Tendencias pasa el selector de
            Granularidad aquí para mantener el bloque visualmente agrupado
            con PERÍODO/DESDE/HASTA pero sin romper la consistencia entre
            vistas (el wrapper sigue siendo el mismo). */}
        {children}

        {/* Exportar — fila separada, alineado al final (full-width en mobile).
            Solo se renderiza si la pantalla pasó `onExport`. */}
        {onExport && (
          <View style={styles.exportRow}>
            <ExportButton onPress={onExport} />
          </View>
        )}
      </View>
    </Card>
  );
}
