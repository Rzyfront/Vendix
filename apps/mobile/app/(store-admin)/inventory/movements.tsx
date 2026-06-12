import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, FlatList, RefreshControl, Pressable, Modal, ScrollView, StyleSheet, TextInput, Dimensions,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { InventoryService } from '@/features/store/services/inventory.service';
import type { StockMovement, MovementType } from '@/features/store/types';
import { MOVEMENT_TYPE_LABELS, MOVEMENT_INBOUND_TYPES, MOVEMENT_OUTBOUND_TYPES } from '@/features/store/types';
import { useTenantStore } from '@/core/store/tenant.store';
import { Spinner } from '@/shared/components/spinner/spinner';
import { Icon } from '@/shared/components/icon/icon';
import { StatsGrid } from '@/shared/components/stats-card/stats-grid';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { formatDate } from '@/shared/utils/date';
import { borderRadius, colorScales, colors, shadows, spacing, typography } from '@/shared/theme';

const TYPE_VARIANT: Record<MovementType, 'success' | 'error' | 'info' | 'warning' | 'default'> = {
  stock_in: 'success',
  stock_out: 'error',
  transfer: 'warning',
  adjustment: 'info',
  sale: 'error',
  return: 'success',
  damage: 'error',
  expiration: 'error',
};

const TYPE_ICON: Record<MovementType, string> = {
  stock_in: 'trending-down',
  stock_out: 'trending-up',
  transfer: 'truck',
  adjustment: 'edit-2',
  sale: 'shopping-bag',
  return: 'rotate-ccw',
  damage: 'alert-triangle',
  expiration: 'clock',
};

type FilterOption = { label: string; value: MovementType | 'all' };

const FILTER_OPTIONS: FilterOption[] = [
  { label: 'Todos los tipos', value: 'all' },
  { label: 'Entrada', value: 'stock_in' },
  { label: 'Salida', value: 'stock_out' },
  { label: 'Venta', value: 'sale' },
  { label: 'Transferencia', value: 'transfer' },
  { label: 'Ajuste', value: 'adjustment' },
  { label: 'Devolución', value: 'return' },
  { label: 'Daño', value: 'damage' },
  { label: 'Vencido', value: 'expiration' },
];

function signFor(item: StockMovement): '+' | '-' | '' {
  if (MOVEMENT_INBOUND_TYPES.has(item.movement_type)) return '+';
  if (MOVEMENT_OUTBOUND_TYPES.has(item.movement_type)) return '-';
  if (item.movement_type === 'adjustment') return item.quantity < 0 ? '-' : '+';
  return '';
}

function quantityToneFor(item: StockMovement): 'success' | 'error' | 'default' {
  if (MOVEMENT_INBOUND_TYPES.has(item.movement_type)) return 'success';
  if (MOVEMENT_OUTBOUND_TYPES.has(item.movement_type)) return 'error';
  if (item.movement_type === 'adjustment') return item.quantity < 0 ? 'error' : 'success';
  return 'default';
}

function quantityColorFor(item: StockMovement): string {
  const tone = quantityToneFor(item);
  if (tone === 'success') return colorScales.green[700];
  if (tone === 'error') return colorScales.red[700];
  return colorScales.gray[700];
}

const TYPE_DETAIL_CONFIG: Record<MovementType, { icon: string; bg: string; border: string; text: string }> = {
  stock_in:    { icon: 'trending-down', bg: colorScales.green[50], border: colorScales.green[200], text: colorScales.green[700] },
  stock_out:   { icon: 'trending-up',   bg: colorScales.red[50],   border: colorScales.red[200],   text: colorScales.red[700] },
  transfer:    { icon: 'truck',         bg: colorScales.amber[50], border: colorScales.amber[200], text: colorScales.amber[700] },
  adjustment:  { icon: 'edit-2',        bg: colorScales.blue[50],  border: colorScales.blue[200],  text: colorScales.blue[700] },
  sale:        { icon: 'shopping-bag', bg: colorScales.amber[50], border: colorScales.amber[200], text: colorScales.amber[700] },
  return:      { icon: 'rotate-ccw',    bg: colorScales.blue[50],  border: colorScales.blue[200],  text: colorScales.blue[700] },
  damage:      { icon: 'alert-triangle', bg: colorScales.red[50],  border: colorScales.red[200],   text: colorScales.red[700] },
  expiration:  { icon: 'clock',         bg: colorScales.gray[100], border: colorScales.gray[200], text: colorScales.gray[600] },
};

const SOURCE_ORDER_LABELS: Record<string, string> = {
  purchase: 'Orden de Compra',
  sale: 'Orden de Venta',
  transfer: 'Transferencia',
  return: 'Devolución',
};

function MovementDetailModal({
  movement,
  onClose,
}: {
  movement: StockMovement | null;
  onClose: () => void;
}) {
  if (!movement) return null;
  const cfg = TYPE_DETAIL_CONFIG[movement.movement_type] ?? TYPE_DETAIL_CONFIG.expiration;
  const typeLabel = MOVEMENT_TYPE_LABELS[movement.movement_type] ?? movement.movement_type;
  const sign = signFor(movement);
  const absQty = Math.abs(movement.quantity);
  const isInbound = sign === '+';

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.detailOverlay}>
        <View style={styles.detailModal}>
          {/* Header */}
          <View style={styles.detailHeader}>
            <Text style={styles.detailTitle}>Detalle del Movimiento</Text>
            <Pressable onPress={onClose} hitSlop={8} style={styles.detailCloseBtn}>
              <Ionicons name="close" size={22} color={colorScales.gray[500]} />
            </Pressable>
          </View>

          <ScrollView style={styles.detailBody} contentContainerStyle={styles.detailBodyContent} showsVerticalScrollIndicator={false}>
            {/* Tipo */}
            <View style={[styles.detailTypeCard, { backgroundColor: cfg.bg, borderColor: cfg.border }]}>
              <View style={[styles.detailTypeIcon, { backgroundColor: colors.background, borderColor: cfg.border }]}>
                <Icon name={cfg.icon} size={24} color={cfg.text} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.detailTypeLabel}>Tipo de Movimiento</Text>
                <Text style={[styles.detailTypeValue, { color: cfg.text }]}>{typeLabel}</Text>
              </View>
            </View>

            {/* Producto */}
            <View style={styles.detailSection}>
              <View style={styles.detailSectionHeader}>
                <Icon name="package" size={16} color={colorScales.gray[500]} />
                <Text style={styles.detailSectionTitle}>Producto</Text>
              </View>
              <View style={styles.detailInfoCard}>
                <Text style={styles.detailInfoPrimary}>{movement.product_name || 'Producto desconocido'}</Text>
                {movement.product_id ? <Text style={styles.detailInfoSecondary}>ID: {movement.product_id}</Text> : null}
              </View>
            </View>

            {/* Ubicaciones */}
            {(movement.location_name || movement.store_name) && (
              <View style={styles.detailSection}>
                <View style={styles.detailSectionHeader}>
                  <Icon name="map-pin" size={16} color={colorScales.gray[500]} />
                  <Text style={styles.detailSectionTitle}>Ubicaciones</Text>
                </View>
                <View style={styles.detailInfoCard}>
                  {movement.store_name ? (
                    <View style={styles.detailInfoRow}>
                      <Text style={styles.detailInfoLabel}>Tienda</Text>
                      <Text style={styles.detailInfoPrimary}>{movement.store_name}</Text>
                    </View>
                  ) : null}
                  {movement.location_name ? (
                    <View style={styles.detailInfoRow}>
                      <Text style={styles.detailInfoLabel}>Ubicación</Text>
                      <Text style={styles.detailInfoPrimary}>{movement.location_name}</Text>
                    </View>
                  ) : null}
                </View>
              </View>
            )}

            {/* Cantidad */}
            <View style={styles.detailSection}>
              <View style={styles.detailSectionHeader}>
                <Icon name="hash" size={16} color={colorScales.gray[500]} />
                <Text style={styles.detailSectionTitle}>Cantidad</Text>
              </View>
              <View style={[styles.detailQuantityCard, { backgroundColor: isInbound ? colorScales.green[50] : colorScales.red[50], borderColor: isInbound ? colorScales.green[200] : colorScales.red[200] }]}>
                <Text style={[styles.detailQuantityValue, { color: isInbound ? colorScales.green[700] : colorScales.red[700] }]}>
                  {sign}
                  {absQty}
                </Text>
                <Text style={styles.detailQuantityUnit}>unidades</Text>
              </View>
            </View>

            {/* Auditoría */}
            <View style={styles.detailSection}>
              <View style={styles.detailSectionHeader}>
                <Icon name="users" size={16} color={colorScales.gray[500]} />
                <Text style={styles.detailSectionTitle}>Auditoría</Text>
              </View>
              <View style={styles.detailInfoCard}>
                <View style={styles.detailAuditRow}>
                  <View style={styles.detailAuditIcon}>
                    <Icon name="user" size={16} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.detailInfoLabel}>Registrado por</Text>
                    <Text style={styles.detailInfoPrimary}>{movement.user_name || 'Sistema'}</Text>
                    <Text style={styles.detailInfoSecondary}>{formatDate(movement.created_at)}</Text>
                  </View>
                </View>
              </View>
            </View>

            {/* Notas */}
            {movement.notes ? (
              <View style={styles.detailSection}>
                <View style={styles.detailSectionHeader}>
                  <Icon name="file-text" size={16} color={colorScales.gray[500]} />
                  <Text style={styles.detailSectionTitle}>Notas</Text>
                </View>
                <View style={styles.detailInfoCard}>
                  <Text style={styles.detailInfoPrimary}>{movement.notes}</Text>
                </View>
              </View>
            ) : null}
          </ScrollView>

          {/* Footer */}
          <View style={styles.detailFooter}>
            <Pressable style={styles.detailCancelBtn} onPress={onClose}>
              <Text style={styles.detailCancelBtnText}>Cerrar</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const MovementCard = ({
  item,
  onPress,
  onShowDetail,
}: {
  item: StockMovement;
  onPress?: () => void;
  onShowDetail: (movement: StockMovement) => void;
}) => {
  const variant = TYPE_VARIANT[item.movement_type] ?? 'default';
  const label = MOVEMENT_TYPE_LABELS[item.movement_type] ?? item.movement_type;
  const sign = signFor(item);
  const absQty = Math.abs(item.quantity);

  return (
    <View style={styles.movementCard}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {item.product_name || 'Producto sin nombre'}
        </Text>
        <View style={[styles.typeBadge, { backgroundColor: variant === 'success' ? colorScales.green[50] : variant === 'error' ? colorScales.red[50] : variant === 'warning' ? colorScales.amber[50] : colorScales.blue[50] }]}>
          <Text style={[styles.typeBadgeText, { color: variant === 'success' ? colorScales.green[700] : variant === 'error' ? colorScales.red[700] : variant === 'warning' ? colorScales.amber[700] : colorScales.blue[700] }]}>
            {label.toUpperCase()}
          </Text>
        </View>
      </View>

      <View style={styles.cardGrid}>
        <View style={styles.cardGridItem}>
          <Text style={styles.cardGridLabel}>FECHA</Text>
          <Text style={styles.cardGridValue}>{formatDate(item.created_at)}</Text>
        </View>
        <View style={styles.cardGridItem}>
          <Text style={styles.cardGridLabel}>UBICACIÓN</Text>
          <Text style={styles.cardGridValue} numberOfLines={1}>
            {item.location_name || '—'}
          </Text>
        </View>
      </View>

      <View style={styles.cardFooter}>
        <View style={styles.cardFooterLeft}>
          <Text style={styles.cardFooterLabel}>CANTIDAD</Text>
          <Text style={[styles.cardFooterValue, { color: quantityColorFor(item) }]}>
            {sign}
            {absQty}
          </Text>
        </View>
        <View style={styles.cardFooterActions}>
          <Icon name="map-pin" size={16} color={colorScales.gray[500]} />
          <Pressable
            onPress={() => onShowDetail(item)}
            hitSlop={6}
            style={styles.eyeBtn}
          >
            <Icon name="eye" size={16} color={colors.primary} />
          </Pressable>
        </View>
      </View>
    </View>
  );
};

export default function MovementsScreen() {
  const router = useRouter();
  const currentStoreId = useTenantStore((s) => s.storeId);
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<MovementType | 'all'>('all');
  const [showFilterOptions, setShowFilterOptions] = useState(false);
  const [showFilterTypeList, setShowFilterTypeList] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [detailMovement, setDetailMovement] = useState<StockMovement | null>(null);
  const actionsBtnRef = useRef<View>(null);
  const filterBtnRef = useRef<View>(null);
  const [actionsPos, setActionsPos] = useState({ top: 0, right: 0 });
  const [filterPos, setFilterPos] = useState({ top: 0, right: 0 });
  const screenW = Dimensions.get('window').width;

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['movements', search, activeFilter],
    queryFn: () =>
      InventoryService.getMovements({
        search: search || undefined,
        movement_type: activeFilter === 'all' ? undefined : activeFilter,
      }),
  });

  const allMovements: StockMovement[] = data?.data ?? [];

  // Filtro client-side por tienda (mismo workaround que en adjustments)
  const movements = currentStoreId
    ? allMovements.filter((m) => m.store_id === Number(currentStoreId))
    : allMovements;

  // Totales para las stats cards
  const totals = {
    total: movements.length,
    inbound: movements.filter((m) => MOVEMENT_INBOUND_TYPES.has(m.movement_type)).length,
    outbound: movements.filter((m) => MOVEMENT_OUTBOUND_TYPES.has(m.movement_type)).length,
    adjustments: movements.filter((m) => m.movement_type === 'adjustment').length,
  };

  const handleRefresh = useCallback(() => refetch(), [refetch]);

  const handleProductPress = useCallback((item: StockMovement) => {
    if (item.product_id) {
      router.push(`/(store-admin)/inventory/stock-detail?productId=${item.product_id}` as never);
    }
  }, [router]);

  // Al pulsar el ícono de ojo en una card → abre directamente el modal de detalle
  // (Sin popup menu intermedio, según feedback del usuario)
  const handleShowCardActions = useCallback((movement: StockMovement) => {
    setDetailMovement(movement);
  }, []);

  const openActions = useCallback(() => {
    actionsBtnRef.current?.measureInWindow((x, y, w, h) => {
      setActionsPos({ top: y + h + 6, right: screenW - x - w });
      setShowActions(true);
    });
  }, [screenW]);

  const openFilters = useCallback(() => {
    filterBtnRef.current?.measureInWindow((x, y, w, h) => {
      setFilterPos({ top: y + h + 6, right: screenW - x - w });
      setShowFilterOptions(true);
      setShowFilterTypeList(false);
    });
  }, [screenW]);

  return (
    <View style={styles.screen}>
      {/* Stats: ancho completo de la pantalla (fuera del card) — alineado con la web */}
      <StatsGrid
        style={styles.statsWrap}
        items={[
          {
            label: 'Total',
            value: totals.total,
            icon: <Icon name="activity" size={14} color={colorScales.blue[600]} />,
            description: 'Movimientos',
          },
          {
            label: 'Entradas',
            value: totals.inbound,
            icon: <Icon name="trending-down" size={14} color={colorScales.green[600]} />,
            description: 'Ingresos',
          },
          {
            label: 'Salidas',
            value: totals.outbound,
            icon: <Icon name="trending-up" size={14} color={colorScales.red[600]} />,
            description: 'Egresos',
          },
          {
            label: 'Ajustes',
            value: totals.adjustments,
            icon: <Icon name="edit-2" size={14} color={colorScales.amber[600]} />,
            description: 'Modificaciones',
          },
        ]}
      />

      {/* Card contenedor: título + búsqueda + filtros + cards de movimientos */}
      <View style={styles.cardContainer}>
        <FlatList
          data={movements}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => (
            <MovementCard
              item={item}
              onPress={() => handleProductPress(item)}
              onShowDetail={setDetailMovement}
            />
          )}
          ListHeaderComponent={
            <View>
              <View style={styles.titleRow}>
                <Text style={styles.listTitle}>Movimientos ({movements.length})</Text>
              </View>
              <View style={styles.searchRow}>
                <View style={styles.searchInputWrap}>
                  <Ionicons name="search-outline" size={16} color={colorScales.gray[400]} style={styles.searchIcon} />
                  <TextInput
                    style={styles.searchInputField}
                    value={search}
                    onChangeText={setSearch}
                    placeholder="Buscar movimiento..."
                    placeholderTextColor={colorScales.gray[400]}
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="search"
                  />
                  {search.length > 0 && (
                    <Pressable onPress={() => setSearch('')} hitSlop={8}>
                      <Ionicons name="close" size={16} color={colorScales.gray[400]} />
                    </Pressable>
                  )}
                </View>
                <Pressable ref={actionsBtnRef} style={styles.iconBtn} onPress={openActions} hitSlop={6}>
                  <Icon name="plus" size={20} color={colors.primary} />
                </Pressable>
                <Pressable ref={filterBtnRef} style={styles.iconBtn} onPress={openFilters} hitSlop={6}>
                  <Icon name="filter" size={18} color={colors.primary} />
                </Pressable>
              </View>
            </View>
          }
          ListEmptyComponent={
            isLoading ? (
              <Spinner />
            ) : (
              <EmptyState title="Sin movimientos" description="No se encontraron movimientos de stock" />
            )
          }
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={handleRefresh} />}
          onEndReached={() => { /* server paginates by limit; hook would need cursor */ }}
          onEndReachedThreshold={0.3}
          contentContainerStyle={styles.listContent}
        />
      </View>

      {/* Dropdown de acciones (Refrescar) */}
      <Modal visible={showActions} transparent animationType="fade" onRequestClose={() => setShowActions(false)}>
        <Pressable style={styles.dropdownBackdrop} onPress={() => setShowActions(false)} />
        <View style={[styles.dropdownPositioner, { top: actionsPos.top, right: actionsPos.right }]}>
          <View style={[styles.dropdownArrow, { marginRight: 14 }]} />
          <View style={styles.dropdown}>
            <Pressable style={styles.dropdownItem} onPress={() => { setShowActions(false); handleRefresh(); }}>
              <View style={styles.dropdownIconWrap}>
                <Ionicons name="sync-outline" size={18} color={colorScales.gray[500]} />
              </View>
              <Text style={styles.dropdownItemText}>Refrescar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Dropdown de filtro por tipo — estilo web (popup con Filtros + Tipo + dropdown) */}
      <Modal visible={showFilterOptions} transparent animationType="fade" onRequestClose={() => { setShowFilterOptions(false); setShowFilterTypeList(false); }}>
        <Pressable style={styles.dropdownBackdrop} onPress={() => { setShowFilterOptions(false); setShowFilterTypeList(false); }} />
        <View style={[styles.dropdownPositioner, { top: filterPos.top, right: filterPos.right }]}>
          <View style={[styles.dropdownArrow, { marginRight: Math.max(filterPos.right, 14) }]} />
          <View style={styles.filterPopup}>
            <View style={styles.filterPopupHeader}>
              <Text style={styles.filterPopupTitle}>Filtros</Text>
            </View>
            <View style={styles.filterPopupBody}>
              <Text style={styles.filterPopupLabel}>Tipo</Text>
              <Pressable
                style={styles.filterPopupSelect}
                onPress={() => setShowFilterTypeList(!showFilterTypeList)}
              >
                <Text style={styles.filterPopupSelectText}>
                  {FILTER_OPTIONS.find((o) => o.value === activeFilter)?.label ?? 'Todos los tipos'}
                </Text>
                <Ionicons name={showFilterTypeList ? 'chevron-up' : 'chevron-down'} size={16} color={colorScales.gray[500]} />
              </Pressable>
              {showFilterTypeList && (
                <View style={styles.filterPopupOptionsList}>
                  {FILTER_OPTIONS.map((opt) => (
                    <Pressable
                      key={opt.value}
                      style={[styles.filterPopupOption, activeFilter === opt.value && styles.filterPopupOptionActive]}
                      onPress={() => { setActiveFilter(opt.value); setShowFilterOptions(false); setShowFilterTypeList(false); }}
                    >
                      <Text style={[styles.filterPopupOptionText, activeFilter === opt.value && styles.filterPopupOptionTextActive]}>
                        {opt.label}
                      </Text>
                      {activeFilter === opt.value && <Ionicons name="checkmark" size={16} color={colors.primary} />}
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal de detalle del movimiento (estilo web) — se abre al pulsar el ojo */}
      <MovementDetailModal
        movement={detailMovement}
        onClose={() => setDetailMovement(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colorScales.gray[50] },
  /* Card contenedor — mismo estilo que adjustments/transfers */
  cardContainer: {
    flex: 1,
    marginHorizontal: spacing[3],
    marginBottom: spacing[3],
    backgroundColor: colors.background,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  statsWrap: {},
  titleRow: { paddingHorizontal: spacing[4], paddingTop: spacing[4], paddingBottom: spacing[2] },
  listTitle: { fontSize: typography.fontSize.base, fontWeight: '700' as any, color: colorScales.gray[900] },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingHorizontal: spacing[4], paddingBottom: spacing[3] },
  searchInputWrap: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    backgroundColor: colorScales.gray[50],
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3], paddingVertical: spacing[2],
    borderWidth: 1, borderColor: colorScales.gray[200], minHeight: 40,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 3, elevation: 1,
  },
  searchIcon: { marginRight: spacing[2] },
  searchInputField: {
    flex: 1, fontSize: typography.fontSize.sm, fontFamily: typography.fontFamily,
    color: colorScales.gray[900], padding: 0, height: '100%',
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: borderRadius.lg,
    backgroundColor: colors.background, borderWidth: 1.5, borderColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 3, elevation: 1,
  },
  separator: { height: spacing[3] },
  listContent: { paddingBottom: spacing[6] },

  /* Movement card — mismo estilo que AdjustmentCard */
  movementCard: {
    marginHorizontal: spacing[3],
    marginBottom: spacing[3],
    backgroundColor: colors.background,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    overflow: 'hidden',
    padding: spacing[4],
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing[2], marginBottom: spacing[3] },
  cardTitle: { flex: 1, fontSize: typography.fontSize.base, fontWeight: '700' as any, color: colorScales.gray[900] },
  typeBadge: { paddingHorizontal: spacing[2.5], paddingVertical: 3, borderRadius: borderRadius.full, borderWidth: 1, borderColor: 'transparent' },
  typeBadgeText: { fontSize: 10, fontWeight: '700' as any, textTransform: 'uppercase' as any, letterSpacing: 0.3 },
  cardGrid: { flexDirection: 'row', gap: spacing[3], marginBottom: spacing[3] },
  cardGridItem: { flex: 1, gap: 2 },
  cardGridLabel: { fontSize: 10, fontWeight: '700' as any, color: colorScales.gray[500], textTransform: 'uppercase' as any, letterSpacing: 0.5 },
  cardGridValue: { fontSize: typography.fontSize.sm, fontWeight: '600' as any, color: colorScales.gray[900] },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: spacing[3], borderTopWidth: 1, borderTopColor: colorScales.gray[100] },
  cardFooterLeft: { gap: 2 },
  cardFooterLabel: { fontSize: 10, fontWeight: '700' as any, color: colorScales.gray[500], textTransform: 'uppercase' as any, letterSpacing: 0.5 },
  cardFooterValue: { fontSize: typography.fontSize.lg, fontWeight: '800' as any },
  cardFooterActions: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  eyeBtn: { width: 32, height: 32, borderRadius: borderRadius.md, backgroundColor: colorScales.green[50], alignItems: 'center', justifyContent: 'center' },
  cardActionBtn: { width: 36, height: 36, borderRadius: borderRadius.md, backgroundColor: colorScales.green[100], alignItems: 'center', justifyContent: 'center' },

  /* Modal de detalle del movimiento (estilo web) */
  detailOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: spacing[4] },
  detailModal: {
    backgroundColor: colors.background, borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colorScales.gray[200],
    width: '100%', maxWidth: 520, maxHeight: '90%',
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 24, elevation: 8,
  },
  detailHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing[4], paddingTop: spacing[4], paddingBottom: spacing[3], borderBottomWidth: 1, borderBottomColor: colorScales.gray[100] },
  detailTitle: { fontSize: typography.fontSize.lg, fontWeight: '700' as any, color: colorScales.gray[900] },
  detailCloseBtn: { padding: spacing[1] },
  detailBody: { flexGrow: 0, flexShrink: 1, maxHeight: 500 },
  detailBodyContent: { padding: spacing[4], gap: spacing[4] },
  detailSection: { gap: spacing[2] },
  detailSectionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing[1.5] },
  detailSectionTitle: { fontSize: 11, fontWeight: '700' as any, color: colorScales.gray[500], textTransform: 'uppercase' as any, letterSpacing: 0.5 },
  detailTypeCard: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], padding: spacing[4], borderRadius: borderRadius.lg, borderWidth: 1 },
  detailTypeIcon: { width: 48, height: 48, borderRadius: borderRadius.md, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  detailTypeLabel: { fontSize: typography.fontSize.xs, color: colorScales.gray[500] },
  detailTypeValue: { fontSize: typography.fontSize.base, fontWeight: '700' as any, marginTop: 2 },
  detailInfoCard: { padding: spacing[4], borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colorScales.gray[200], backgroundColor: colors.background, gap: spacing[1] },
  detailInfoRow: { gap: 2 },
  detailInfoLabel: { fontSize: 10, fontWeight: '700' as any, color: colorScales.gray[500], textTransform: 'uppercase' as any, letterSpacing: 0.5 },
  detailInfoPrimary: { fontSize: typography.fontSize.sm, fontWeight: '600' as any, color: colorScales.gray[900] },
  detailInfoSecondary: { fontSize: typography.fontSize.xs, color: colorScales.gray[500] },
  detailQuantityCard: { paddingVertical: spacing[5], paddingHorizontal: spacing[4], borderRadius: borderRadius.lg, borderWidth: 1, alignItems: 'center', gap: spacing[1] },
  detailQuantityValue: { fontSize: typography.fontSize['2xl'], fontWeight: '800' as any },
  detailQuantityUnit: { fontSize: typography.fontSize.xs, color: colorScales.gray[500] },
  detailAuditRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2] },
  detailAuditIcon: { width: 32, height: 32, borderRadius: borderRadius.full, backgroundColor: colorScales.green[50], alignItems: 'center', justifyContent: 'center' },
  detailFooter: { paddingHorizontal: spacing[4], paddingVertical: spacing[3], borderTopWidth: 1, borderTopColor: colorScales.gray[200], backgroundColor: colorScales.gray[50] },
  detailCancelBtn: { paddingVertical: 10, borderRadius: borderRadius.full, backgroundColor: colorScales.gray[900], alignItems: 'center', justifyContent: 'center' },
  detailCancelBtnText: { fontSize: 13, fontWeight: '700' as any, color: colors.background },

  /* Dropdown de acciones */
  dropdownBackdrop: { flex: 1 },
  dropdownPositioner: { position: 'absolute', alignItems: 'flex-end' },
  dropdownArrow: {
    width: 0, height: 0, borderLeftWidth: 8, borderRightWidth: 8, borderBottomWidth: 8,
    borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: colors.background,
    marginRight: 14, marginBottom: -1,
  },
  dropdown: {
    backgroundColor: colors.background, borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colorScales.gray[200],
    minWidth: 180, ...shadows.lg,
  },
  dropdownItem: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingVertical: spacing[2.5], paddingHorizontal: spacing[3] },
  dropdownIconWrap: { width: 28, height: 28, borderRadius: 6, backgroundColor: colorScales.gray[100], alignItems: 'center', justifyContent: 'center' },
  dropdownItemText: { fontSize: typography.fontSize.sm, fontWeight: '500' as any, color: colorScales.gray[700] },
  dropdownItemPrimary: { fontSize: typography.fontSize.sm, fontWeight: '700' as any, color: colors.primary },

  /* Filter popup (estilo web) */
  filterPopup: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    width: 200,
    ...shadows.lg,
    overflow: 'hidden',
  },
  filterPopupHeader: { paddingHorizontal: spacing[4], paddingTop: spacing[3], paddingBottom: spacing[2] },
  filterPopupTitle: { fontSize: typography.fontSize.base, fontWeight: '700' as any, color: colorScales.gray[900] },
  filterPopupBody: { paddingHorizontal: spacing[4], paddingBottom: spacing[3], gap: spacing[2] },
  filterPopupLabel: { fontSize: typography.fontSize.sm, fontWeight: '600' as any, color: colorScales.gray[700] },
  filterPopupSelect: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: spacing[2.5], paddingHorizontal: spacing[3],
    borderRadius: borderRadius.lg, borderWidth: 1.5, borderColor: colors.primary,
    backgroundColor: colors.background,
  },
  filterPopupSelectText: { fontSize: typography.fontSize.sm, fontWeight: '600' as any, color: colorScales.gray[800] },
  filterPopupOptionsList: { marginTop: spacing[1], borderWidth: 1, borderColor: colorScales.gray[200], borderRadius: borderRadius.lg, backgroundColor: colors.background, overflow: 'hidden' },
  filterPopupOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing[2.5], paddingHorizontal: spacing[3], borderBottomWidth: 1, borderBottomColor: colorScales.gray[100] },
  filterPopupOptionLast: { borderBottomWidth: 0 },
  filterPopupOptionActive: { backgroundColor: colorScales.green[50] },
  filterPopupOptionText: { fontSize: typography.fontSize.sm, color: colorScales.gray[700] },
  filterPopupOptionTextActive: { fontSize: typography.fontSize.sm, fontWeight: '700' as any, color: colors.primary },
});
