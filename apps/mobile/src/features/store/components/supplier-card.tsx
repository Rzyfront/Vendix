import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Icon } from '@/shared/components/icon/icon';
import { colorScales, spacing, borderRadius, typography } from '@/shared/theme';
import type { Supplier } from '@/features/store/types';

interface SupplierCardProps {
  item: Supplier;
  onPress: () => void;
  onDelete: (item: Supplier) => void;
}

/**
 * SupplierCard — card individual de la lista de Proveedores.
 * Misma estructura visual que la web:
 *  - Fila 1: Ícono + (nombre + contacto + email/código) + badge estado
 *  - Fila 2 (footer): TELÉFONO + 2 botones (editar azul, eliminar rojo)
 */
export default function SupplierCard({ item, onPress, onDelete }: SupplierCardProps) {
  const isActive = !!item.is_active;

  return (
    <View style={styles.supplierCard}>
      {/* Fila 1: Ícono building-2 + (nombre + contacto + email/código) + badge estado */}
      <View style={styles.cardTopRow}>
        <View style={styles.cardMedia}>
          <Icon name="building-2" size={24} color={colorScales.gray[500]} />
        </View>

        <View style={styles.cardCenter}>
          <Text style={styles.cardTitle} numberOfLines={1}>{item.name}</Text>
          {item.contact_person ? (
            <Text style={styles.cardSubtitle} numberOfLines={1}>{item.contact_person}</Text>
          ) : null}

          <View style={styles.cardMetaRow}>
            <View style={styles.cardMetaItem}>
              <Icon name="hash" size={12} color={colorScales.gray[400]} />
              <Text style={styles.cardMetaValue} numberOfLines={1}>{item.code || '—'}</Text>
            </View>
            <View style={styles.cardMetaItem}>
              <Icon name="mail" size={12} color={colorScales.gray[400]} />
              <Text style={styles.cardMetaValue} numberOfLines={1}>{item.email || '—'}</Text>
            </View>
          </View>
        </View>

        <View style={[styles.cardStatusBadge, { backgroundColor: isActive ? colorScales.green[50] : colorScales.gray[100] }]}>
          <Text style={[styles.cardStatusBadgeText, { color: isActive ? colorScales.green[700] : colorScales.gray[500] }]}>
            {isActive ? 'Activo' : 'Inactivo'}
          </Text>
        </View>
      </View>

      {/* Fila 2 (footer): TELÉFONO + 2 botones directos (editar azul, eliminar rojo) */}
      <View style={styles.cardFooter}>
        <View style={styles.cardFooterLeft}>
          <View style={styles.cardFooterItem}>
            <Icon name="phone" size={12} color={colorScales.gray[400]} />
            <Text style={styles.cardFooterValue} numberOfLines={1}>{item.phone || '—'}</Text>
          </View>
        </View>
        <View style={styles.cardActions}>
          <Pressable onPress={onPress} hitSlop={6} style={styles.cardActionEdit}>
            <Icon name="edit" size={16} color={colorScales.blue[600]} />
          </Pressable>
          <Pressable onPress={() => onDelete(item)} hitSlop={6} style={styles.cardActionDelete}>
            <Icon name="trash-2" size={16} color={colorScales.red[600]} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  supplierCard: {
    marginHorizontal: spacing[3],
    marginBottom: spacing[3],
    backgroundColor: '#FFFFFF',
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  cardTopRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[3], paddingBottom: spacing[2] },
  cardMedia: {
    width: 56, height: 56, borderRadius: borderRadius.md,
    backgroundColor: colorScales.gray[100],
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colorScales.gray[200],
  },
  cardCenter: { flex: 1, gap: 2 },
  cardTitle: { fontSize: typography.fontSize.base, fontWeight: '700' as any, color: colorScales.gray[900] },
  cardSubtitle: { fontSize: 12, color: colorScales.gray[500], marginBottom: 2 },
  cardMetaRow: { flexDirection: 'row', gap: spacing[3], marginTop: 4 },
  cardMetaItem: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 },
  cardMetaValue: { fontSize: typography.fontSize.sm, fontWeight: '600' as any, color: colorScales.gray[900] },
  cardStatusBadge: {
    paddingHorizontal: spacing[2.5], paddingVertical: 3, borderRadius: borderRadius.full,
    backgroundColor: colorScales.gray[100], alignSelf: 'flex-start',
  },
  cardStatusBadgeText: { fontSize: 10, fontWeight: '700' as any, textTransform: 'uppercase' as any, letterSpacing: 0.3 },
  cardFooter: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing[4], paddingVertical: spacing[3],
    borderTopWidth: 1, borderTopColor: colorScales.gray[100],
    backgroundColor: colorScales.gray[50],
  },
  cardFooterLeft: { gap: 2 },
  cardFooterItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cardFooterValue: { fontSize: typography.fontSize.lg, fontWeight: '800' as any, color: colorScales.gray[900] },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  cardActionEdit: { width: 36, height: 36, borderRadius: borderRadius.md, backgroundColor: colorScales.blue[50], alignItems: 'center', justifyContent: 'center' },
  cardActionDelete: { width: 36, height: 36, borderRadius: borderRadius.md, backgroundColor: colorScales.red[50], alignItems: 'center', justifyContent: 'center' },
});
