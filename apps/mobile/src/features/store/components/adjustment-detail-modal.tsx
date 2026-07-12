import React from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { Modal } from '@/shared/components/modal/modal';
import { Button } from '@/shared/components/button/button';
import { colors, spacing, borderRadius, typography, colorScales } from '@/shared/theme';
import { formatDate } from '@/shared/utils/date';
import { ADJUSTMENT_TYPE_LABELS } from '@/features/store/types';
import type { StockAdjustment } from '@/features/store/types';

interface AdjustmentDetailModalProps {
  adjustment: StockAdjustment | null;
  onClose: () => void;
  onApprove: (adjustment: StockAdjustment) => void;
  onDelete: (adjustment: StockAdjustment) => void;
  isSubmitting: boolean;
}

export default function AdjustmentDetailModal({
  adjustment,
  onClose,
  onApprove,
  onDelete,
  isSubmitting,
}: AdjustmentDetailModalProps) {
  if (!adjustment) return null;

  const typeLabel = ADJUSTMENT_TYPE_LABELS[adjustment.adjustment_type] ?? 'Ajuste';
  const dateLabel = formatDate(adjustment.created_at);
  const quantityChange = Number(adjustment.quantity_change ?? 0);

  return (
    <Modal visible={!!adjustment} onClose={onClose} title="Detalle del Ajuste">
      <ScrollView style={styles.container}>
        <View style={styles.section}>
          <Text style={styles.label}>Producto</Text>
          <Text style={styles.value}>{adjustment.products?.name || adjustment.description || '—'}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Tipo</Text>
          <Text style={styles.value}>{typeLabel}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Cantidad</Text>
          <Text style={styles.value}>{quantityChange}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Fecha</Text>
          <Text style={styles.value}>{dateLabel}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Ubicación</Text>
          <Text style={styles.value}>{adjustment.inventory_locations?.name || '—'}</Text>
        </View>

        {adjustment.description && (
          <View style={styles.section}>
            <Text style={styles.label}>Descripción</Text>
            <Text style={styles.value}>{adjustment.description}</Text>
          </View>
        )}

        <View style={styles.actions}>
          <Button
            title="Aprobar"
            onPress={() => onApprove(adjustment)}
            loading={isSubmitting}
            variant="primary"
          />
          <Button
            title="Eliminar"
            onPress={() => onDelete(adjustment)}
            loading={isSubmitting}
            variant="destructive"
          />
        </View>
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing[4],
  },
  section: {
    marginBottom: spacing[4],
  },
  label: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold as any,
    color: colors.text.secondary,
    marginBottom: spacing[1],
    textTransform: 'uppercase' as any,
    letterSpacing: 0.5,
  },
  value: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.medium as any,
    color: colors.text.primary,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing[3],
    marginTop: spacing[4],
  },
});
