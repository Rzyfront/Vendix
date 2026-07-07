import { useCallback } from 'react';
import { View, Text, FlatList, RefreshControl, Pressable, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { InventoryService } from '@/features/store/services/inventory.service';
import type { ConsolidatedStock, LocationStock } from '@/features/store/types';
import { LOCATION_TYPE_LABELS } from '@/features/store/types';
import { StatsGrid } from '@/shared/components/stats-card/stats-grid';
import { Card } from '@/shared/components/card/card';
import { Badge } from '@/shared/components/badge/badge';
import { Icon } from '@/shared/components/icon/icon';
import { Spinner } from '@/shared/components/spinner/spinner';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { formatRelative } from '@/shared/utils/date';
import { spacing, borderRadius, colorScales, typography, colors } from '@/shared/theme';
import { INVENTORY_ICONS, STAT_PALETTE } from '@/features/store/constants/inventory-icons';
import { STOCK_DETAIL_STATS } from '@/features/store/constants/inventory-labels';

const TYPE_VARIANT: Record<string, 'info' | 'success' | 'warning'> = {
  warehouse: 'info',
  store: 'success',
  production_area: 'info',
  receiving_area: 'info',
  shipping_area: 'info',
  quarantine: 'warning',
  damaged_goods: 'warning',
  virtual: 'warning',
  transit: 'warning',
};

const LocationCard = ({ item }: { item: LocationStock }) => {
  const variant = TYPE_VARIANT[item.type] ?? 'info';
  return (
    <Card style={styles.cardMargin}>
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderLeft}>
          <Text style={styles.cardTitle} numberOfLines={1}>{item.locationName}</Text>
          <Badge label={LOCATION_TYPE_LABELS[item.type] ?? item.type} variant={variant} size="sm" />
        </View>
      </View>
      <View style={styles.statsRow}>
        <View style={styles.statItem}>
          <Text style={styles.statLabel}>Disponible</Text>
          <Text style={[styles.statValue, { color: colorScales.green[600] }]}>{item.available}</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statLabel}>Reservado</Text>
          <Text style={[styles.statValue, { color: colorScales.amber[600] }]}>{item.reserved}</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statLabel}>Total</Text>
          <Text style={[styles.statValue, { color: colorScales.blue[600] }]}>{item.onHand}</Text>
        </View>
      </View>
      <Text style={styles.lastUpdated}>Actualizado: {formatRelative(item.lastUpdated)}</Text>
    </Card>
  );
};

export default function StockDetailScreen() {
  const router = useRouter();
  const { productId } = useLocalSearchParams<{ productId: string }>();

  const { data, isLoading, isRefetching, refetch, error } = useQuery({
    queryKey: ['consolidated-stock', productId],
    queryFn: () => InventoryService.getConsolidatedStock(Number(productId)),
    enabled: !!productId,
  });

  const handleRefresh = useCallback(() => refetch(), [refetch]);

  const stock = data as ConsolidatedStock | undefined;
  const locations = stock?.stockByLocation ?? [];
  const productInfo = stock?.product;

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <Spinner />
      </View>
    );
  }

  if (error || !stock) {
    return (
      <View style={styles.centered}>
        <EmptyState
          icon={<Icon name="alert-circle" size={48} color={colorScales.red[400]} />}
          title="Error al cargar"
          description={error instanceof Error ? error.message : 'No se pudo cargar el detalle de stock'}
        />
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>Volver</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={locations}
        keyExtractor={(item) => String(item.locationId)}
        renderItem={({ item }) => <LocationCard item={item} />}
        ListHeaderComponent={
          <View>
            <Pressable onPress={() => router.back()} style={styles.backRow}>
              <Icon name="arrow-left" size={18} color={colors.primary} />
              <Text style={styles.backText}>Volver</Text>
            </Pressable>

            <View style={styles.titleWrap}>
              <Text style={styles.title}>Stock por Bodega</Text>
              {productInfo && (
                <Text style={styles.subtitle}>
                  {productInfo.name}
                  {productInfo.sku ? ` · ${productInfo.sku}` : ''}
                </Text>
              )}
            </View>

            {/* UoM Headline banner — solo para ingredientes con factor de conversión */}
            {stock && (stock as any).uom_factor && (stock as any).uom_factor !== 1 ? (
              <View style={styles.uomBanner}>
                <Icon name="info" size={14} color={colors.primary} />
                <Text style={styles.uomBannerText}>
                  {`${(stock as any).sealed_qty ?? stock.totalOnHand} sellados + 1 abierto`}
                  {(stock as any).uom_open_label ? ` (${(stock as any).uom_open_label})` : ''}
                  {` · Equivale a 1 ${(stock as any).uom_stock_name ?? 'unidad'} = ${(stock as any).uom_factor} ${(stock as any).uom_purchase_name ?? 'kg'}`}
                </Text>
              </View>
            ) : null}

            <StatsGrid
              style={styles.statsWrap}
              items={[
                {
                  label: STOCK_DETAIL_STATS.available.label,
                  value: stock.totalAvailable,
                  icon: INVENTORY_ICONS.stockAvailableStat,
                  iconBg: STAT_PALETTE.green.bg,
                  iconColor: STAT_PALETTE.green.color,
                  description: STOCK_DETAIL_STATS.available.description,
                },
                {
                  label: STOCK_DETAIL_STATS.reserved.label,
                  value: stock.totalReserved,
                  icon: INVENTORY_ICONS.stockReservedStat,
                  iconBg: STAT_PALETTE.amber.bg,
                  iconColor: STAT_PALETTE.amber.color,
                  description: STOCK_DETAIL_STATS.reserved.description,
                },
                {
                  label: STOCK_DETAIL_STATS.onHand.label,
                  value: stock.totalOnHand,
                  icon: INVENTORY_ICONS.stockOnHandStat,
                  iconBg: STAT_PALETTE.blue.bg,
                  iconColor: STAT_PALETTE.blue.color,
                  description: STOCK_DETAIL_STATS.onHand.description,
                },
              ]}
            />

            {locations.length > 0 && (
              <Text style={styles.sectionTitle}>Ubicaciones</Text>
            )}
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon={<Icon name="warehouse" size={48} color={colorScales.gray[300]} />}
            title="Sin stock en ubicaciones"
            description="Este producto no tiene stock registrado en ninguna ubicación"
          />
        }
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={handleRefresh} />
        }
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colorScales.gray[50] },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colorScales.gray[50], padding: spacing[4] },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingHorizontal: spacing[4], paddingTop: spacing[2] },
  backText: { fontSize: typography.fontSize.sm, color: colors.primary, fontWeight: '500' as any },
  titleWrap: { paddingHorizontal: spacing[4], paddingVertical: spacing[3] },
  title: { fontSize: typography.fontSize.xl, fontWeight: '700' as any, color: colorScales.gray[900] },
  subtitle: { fontSize: typography.fontSize.sm, color: colorScales.gray[500], marginTop: 2 },
  uomBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingVertical: spacing[2.5],
    paddingHorizontal: spacing[3],
    marginHorizontal: spacing[4],
    marginBottom: spacing[2],
    backgroundColor: colorScales.green[50],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.green[100],
  },
  uomBannerText: {
    flex: 1,
    fontSize: 12,
    color: colorScales.green[800],
  },
  statsWrap: { paddingHorizontal: spacing[4], marginBottom: spacing[2] },
  sectionTitle: {
    fontSize: typography.fontSize.sm,
    fontWeight: '600' as any,
    color: colorScales.gray[500],
    textTransform: 'uppercase',
    letterSpacing: 1,
    paddingHorizontal: spacing[4],
    paddingTop: spacing[4],
    paddingBottom: spacing[2],
  },
  cardMargin: { marginHorizontal: spacing[4], marginBottom: spacing[3] },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardHeaderLeft: { flex: 1, gap: spacing[1] },
  cardTitle: { fontSize: typography.fontSize.base, fontWeight: '600' as any, color: colorScales.gray[900] },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing[3], paddingVertical: spacing[2], borderTopWidth: 1, borderTopColor: colorScales.gray[100] },
  statItem: { alignItems: 'center', flex: 1 },
  statLabel: { fontSize: typography.fontSize.xs, color: colorScales.gray[500], marginBottom: 2 },
  statValue: { fontSize: typography.fontSize.lg, fontWeight: '700' as any },
  lastUpdated: { fontSize: typography.fontSize.xs, color: colorScales.gray[400], marginTop: spacing[2], textAlign: 'right' },
  backBtn: { marginTop: spacing[4], paddingHorizontal: spacing[6], paddingVertical: spacing[3], backgroundColor: colors.primary, borderRadius: borderRadius.lg },
  backBtnText: { color: '#fff', fontWeight: '600' as any },
  listContent: { paddingBottom: spacing[6] },
});
