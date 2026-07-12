import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Modal,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { Icon } from '@/shared/components/icon/icon';
import { borderRadius, colorScales, colors, shadows, spacing, typography } from '@/shared/theme';
import {
  LOCATION_TYPE_LABELS,
  type ConsolidatedStock,
  type LocationStock,
} from '@/features/store/types';

interface InventoryDetailModalProps {
  visible: boolean;
  /** Stock consolidado del producto. Si viene `null` se muestra el empty state. */
  consolidated: ConsolidatedStock | null;
  /** Estado de carga para mostrar spinner en el body. */
  isLoading?: boolean;
  /** Callback para refrescar manualmente desde el modal (botón Actualizar). */
  onRefresh?: () => void;
  onClose: () => void;
}

/**
 * InventoryDetailModal — popup de "Detalle de Inventario" que lista
 * las existencias del producto en TODAS las bodegas.
 *
 * Espejo del popup web móvil (mismo título y mismas cards por bodega).
 * Stats globales arriba (TOTAL EN SISTEMA / TOTAL DISPONIBLE / TOTAL
 * RESERVADO) y luego una card por bodega con su nombre, tipo, badge
 * de stock disponible y métricas Físico / Reservado / Reorden.
 *
 * Se abre directamente desde el botón "Ver detalle completo" de
 * `product-upsert-form.tsx` (sin navegar a la pantalla `/inventory/stock-detail`),
 * y también desde la pantalla `/inventory/stock-detail` cuando el
 * usuario toca una bodega.
 */
export default function InventoryDetailModal({
  visible,
  consolidated,
  isLoading = false,
  onRefresh,
  onClose,
}: InventoryDetailModalProps) {
  const locations: LocationStock[] = consolidated?.stockByLocation ?? [];

  // Stats globales — usa los totales del backend si están, sino suma
  // las locations como fallback (defensa contra shapes incompletas).
  const totals = useMemo(() => {
    if (!consolidated) {
      return { onHand: 0, available: 0, reserved: 0 };
    }
    return {
      onHand:
        consolidated.totalOnHand ??
        locations.reduce((sum, l) => sum + Number(l.onHand ?? 0), 0),
      available:
        consolidated.totalAvailable ??
        locations.reduce((sum, l) => sum + Number(l.available ?? 0), 0),
      reserved:
        consolidated.totalReserved ??
        locations.reduce((sum, l) => sum + Number(l.reserved ?? 0), 0),
    };
  }, [consolidated, locations]);

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.modal}>
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Text style={styles.title}>Detalle de Inventario</Text>
              {consolidated?.product?.name ? (
                <Text style={styles.subtitle} numberOfLines={1}>
                  {consolidated.product.name}
                  {consolidated.product.sku ? ` · ${consolidated.product.sku}` : ''}
                </Text>
              ) : null}
            </View>
            {onRefresh ? (
              <Pressable
                onPress={onRefresh}
                hitSlop={8}
                style={styles.refreshBtn}
                accessibilityLabel="Actualizar detalle"
              >
                <Icon name="rotate-cw" size={18} color={colorScales.gray[500]} />
              </Pressable>
            ) : null}
            <Pressable onPress={onClose} hitSlop={8} style={styles.closeBtn}>
              <Icon name="x" size={20} color={colorScales.gray[500]} />
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={styles.body}
            showsVerticalScrollIndicator={false}
          >
            {isLoading ? (
              <View style={styles.loadingWrap}>
                <ActivityIndicator color={colors.primary} />
                <Text style={styles.loadingText}>Cargando existencias...</Text>
              </View>
            ) : !consolidated || locations.length === 0 ? (
              <Text style={styles.emptyText}>
                Este producto no tiene stock registrado en ninguna ubicación
              </Text>
            ) : (
              <>
                {/* Cards de stats globales — stacked vertical para matchear el popup web */}
                <View style={styles.statsStack}>
                  <View style={styles.statCard}>
                    <Text style={styles.statLabel}>Total en Sistema</Text>
                    <Text style={styles.statValue}>{Number(totals.onHand ?? 0)}</Text>
                  </View>
                  <View style={[styles.statCard, styles.statCardHighlight]}>
                    <Text style={[styles.statLabel, styles.statLabelHighlight]}>
                      Total Disponible
                    </Text>
                    <Text style={[styles.statValue, styles.statValueHighlight]}>
                      {Number(totals.available ?? 0)}
                    </Text>
                  </View>
                  <View style={styles.statCard}>
                    <Text style={styles.statLabel}>Total Reservado</Text>
                    <Text style={styles.statValue}>{Number(totals.reserved ?? 0)}</Text>
                  </View>
                </View>

                {/* Existencias por bodega — una card por location */}
                <View style={styles.section}>
                  <View style={styles.sectionHeader}>
                    <Icon
                      name="building-2"
                      size={16}
                      color={colorScales.gray[400]}
                    />
                    <Text style={styles.sectionTitle}>
                      Existencias por Bodega ({locations.length})
                    </Text>
                  </View>

                  {locations.map((location) => {
                    const available = Number(location.available ?? 0);
                    const hasStock = available > 0;
                    return (
                      <View key={String(location.locationId)} style={styles.warehouseCard}>
                        <View style={styles.warehouseHeader}>
                          <View style={styles.warehouseHeaderLeft}>
                            <Text style={styles.warehouseName} numberOfLines={1}>
                              {location.locationName}
                            </Text>
                            <Text style={styles.warehouseType}>
                              {LOCATION_TYPE_LABELS[
                                location.type as keyof typeof LOCATION_TYPE_LABELS
                              ] ?? location.type}
                            </Text>
                          </View>
                          <View
                            style={[
                              styles.warehouseBadge,
                              hasStock ? styles.warehouseBadgeOk : styles.warehouseBadgeAlert,
                            ]}
                          >
                            <Text
                              style={[
                                styles.warehouseBadgeText,
                                hasStock
                                  ? styles.warehouseBadgeTextOk
                                  : styles.warehouseBadgeTextAlert,
                              ]}
                            >
                              {`${available} disp.`}
                            </Text>
                          </View>
                        </View>
                        <View style={styles.warehouseStatsRow}>
                          <View style={styles.warehouseStat}>
                            <Text style={styles.warehouseStatLabel}>Físico:</Text>
                            <Text style={styles.warehouseStatValue}>
                              {Number(location.onHand ?? 0)}
                            </Text>
                          </View>
                          <View style={styles.warehouseStat}>
                            <Text style={styles.warehouseStatLabel}>Reservado:</Text>
                            <Text
                              style={[
                                styles.warehouseStatValue,
                                styles.warehouseStatValuePrimary,
                              ]}
                            >
                              {Number(location.reserved ?? 0)}
                            </Text>
                          </View>
                          <View style={styles.warehouseStat}>
                            <Text style={styles.warehouseStatLabel}>Reorden:</Text>
                            <Text style={styles.warehouseStatValue}>20</Text>
                          </View>
                        </View>
                      </View>
                    );
                  })}
                </View>
              </>
            )}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable
              onPress={onClose}
              style={({ pressed }) => [
                styles.primaryBtn,
                pressed && { backgroundColor: colorScales.green[700] },
              ]}
              accessibilityLabel="Cerrar detalle de inventario"
            >
              <Text style={styles.primaryBtnText}>Cerrar</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing[4],
  },
  modal: {
    backgroundColor: colors.card,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    width: '100%',
    maxWidth: 640,
    maxHeight: '92%',
    ...shadows.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[200],
  },
  headerLeft: { flex: 1, marginRight: spacing[2] },
  title: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold as any,
    color: colors.text.primary,
  },
  subtitle: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
    marginTop: 2,
  },
  refreshBtn: {
    padding: spacing[1],
  },
  closeBtn: {
    padding: spacing[1],
  },
  body: {
    padding: spacing[4],
    gap: spacing[4],
  },
  loadingWrap: {
    alignItems: 'center',
    paddingVertical: spacing[8],
    gap: spacing[2],
  },
  loadingText: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
  },
  // Cards de stats stacked vertical (full-width) para matchear el popup web
  statsStack: {
    gap: spacing[2],
  },
  statCard: {
    padding: spacing[4],
    backgroundColor: colorScales.gray[50],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
  },
  statCardHighlight: {
    backgroundColor: colorScales.green[50],
    borderColor: colorScales.green[100],
  },
  statLabel: {
    fontSize: 10,
    fontWeight: typography.fontWeight.bold as any,
    color: colorScales.gray[500],
    textTransform: 'uppercase' as any,
    letterSpacing: 0.5,
    marginBottom: spacing[1],
  },
  statLabelHighlight: {
    color: colorScales.green[600],
  },
  statValue: {
    fontSize: typography.fontSize['2xl'],
    fontWeight: typography.fontWeight.bold as any,
    color: colors.text.primary,
  },
  statValueHighlight: {
    color: colorScales.green[700],
  },
  section: {
    gap: spacing[2],
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginBottom: spacing[2],
  },
  sectionTitle: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold as any,
    color: colorScales.gray[900],
  },
  warehouseCard: {
    padding: spacing[3],
    backgroundColor: colors.card,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    marginBottom: spacing[2],
  },
  warehouseHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing[2],
  },
  warehouseHeaderLeft: { flex: 1, minWidth: 0 },
  warehouseName: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold as any,
    color: colors.text.primary,
  },
  warehouseType: {
    fontSize: 10,
    color: colorScales.gray[500],
    textTransform: 'uppercase' as any,
    marginTop: 2,
  },
  warehouseBadge: {
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: 4,
  },
  warehouseBadgeOk: {
    backgroundColor: 'rgba(46, 204, 113, 0.12)',
  },
  warehouseBadgeAlert: {
    backgroundColor: 'rgba(220, 38, 38, 0.1)',
  },
  warehouseBadgeText: {
    fontSize: 10,
    fontWeight: typography.fontWeight.bold as any,
  },
  warehouseBadgeTextOk: {
    color: colorScales.green[700],
  },
  warehouseBadgeTextAlert: {
    color: colors.error,
  },
  warehouseStatsRow: {
    flexDirection: 'row',
    gap: spacing[3],
    flexWrap: 'wrap',
  },
  warehouseStat: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  warehouseStatLabel: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
  },
  warehouseStatValue: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.medium as any,
    color: colorScales.gray[700],
    marginLeft: 4,
  },
  warehouseStatValuePrimary: {
    color: colorScales.green[600],
  },
  footer: {
    padding: spacing[4],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
    backgroundColor: 'rgba(244, 244, 244, 0.5)',
  },
  primaryBtn: {
    backgroundColor: colors.primary,
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    fontSize: 14,
    fontWeight: typography.fontWeight.semibold as any,
    color: colors.background,
  },
  emptyText: {
    textAlign: 'center' as any,
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
    padding: spacing[6],
  },
});
