import { useCallback, useState, useEffect } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { OrderService } from '@/features/store/services/order.service';
import { getNextPageParam } from '@/core/api/pagination';
import {
  Order,
  OrderChannel,
  OrderState,
  ORDER_STATE_COLORS,
  ORDER_STATE_LABELS,
} from '@/features/store/types';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { RecordCard } from '@/shared/components/record-card/record-card';
import { SearchBar } from '@/shared/components/search-bar/search-bar';
import { Spinner } from '@/shared/components/spinner/spinner';
import { StatsGrid } from '@/shared/components/stats-card/stats-grid';
import {
  OptionsDropdown,
  type FilterConfig,
  type DropdownAction,
  type FilterValues,
} from '@/shared/components/options-dropdown/options-dropdown';
import { Icon } from '@/shared/components/icon/icon';
import { toastError } from '@/shared/components/toast/toast.store';
import { formatCurrency } from '@/shared/utils/currency';
import { formatRelative } from '@/shared/utils/date';
import { borderRadius, colorScales, colors, spacing, typography } from '@/shared/theme';

const STATE_VARIANT_MAP: Record<string, 'default' | 'success' | 'warning' | 'error' | 'info'> = {
  default: 'default',
  warning: 'warning',
  success: 'success',
  error: 'error',
  info: 'info',
};

// ─────────────────────────────────────────────────────────────────────────────
// Filtros — paridad con web (orders-list.component.html → app-options-dropdown)
// Web tiene: Estado (single-select), Canal (single-select), Fecha (date).
// Mobile replicamos Estado + Canal como filters dentro de OptionsDropdown.
// ─────────────────────────────────────────────────────────────────────────────

const STATE_FILTER_OPTIONS = [
  { value: '', label: 'Todos los estados' },
  { value: 'pending_payment', label: 'Pendientes' },
  { value: 'processing', label: 'Procesando' },
  { value: 'shipped', label: 'Enviadas' },
  { value: 'delivered', label: 'Entregadas' },
  { value: 'cancelled', label: 'Canceladas' },
];

const CHANNEL_FILTER_OPTIONS = [
  { value: '', label: 'Todos los canales' },
  { value: 'pos', label: 'Punto de venta' },
  { value: 'ecommerce', label: 'Ecommerce' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'marketplace', label: 'Marketplace' },
];

const ORDER_FILTERS: FilterConfig[] = [
  {
    key: 'status',
    label: 'Estado',
    type: 'select',
    options: STATE_FILTER_OPTIONS,
  },
  {
    key: 'channel',
    label: 'Canal',
    type: 'select',
    options: CHANNEL_FILTER_OPTIONS,
  },
];

const ORDER_ACTIONS: DropdownAction[] = [
  { label: 'Crear Orden', icon: 'plus', action: 'create_order', variant: 'primary' },
  { label: 'Actualizar', icon: 'refresh-cw', action: 'refresh', variant: 'outline' },
];

function channelLabel(channel?: OrderChannel | null): string {
  switch (channel) {
    case 'pos': return 'Punto de venta';
    case 'ecommerce': return 'Ecommerce';
    case 'agent': return 'Agente';
    case 'whatsapp': return 'WhatsApp';
    case 'marketplace': return 'Marketplace';
    default: return 'Manual';
  }
}

function channelIcon(channel?: OrderChannel | null): string {
  switch (channel) {
    case 'pos': return 'shopping-bag';
    case 'ecommerce': return 'shopping-cart';
    case 'whatsapp': return 'phone';
    case 'marketplace': return 'store';
    default: return 'file-text';
  }
}

function customerName(order: Order): string {
  if (!order.customer) return 'Cliente no registrado';
  return `${order.customer.first_name || ''} ${order.customer.last_name || ''}`.trim() || order.customer.email;
}

function formatCount(num: number | undefined): string {
  // Web format: 1K/1M para números grandes (paridad con order-stats.component.ts).
  const n = num ?? 0;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function growthLabel(rate: number | undefined): string {
  // Web format: "+X.X%" o "-X.X%". Fallback 0.0% (backend no expone aún).
  const r = rate ?? 0;
  const sign = r >= 0 ? '+' : '';
  return `${sign}${r.toFixed(1)}%`;
}

const OrderCard = ({ order, onPress }: { order: Order; onPress: () => void }) => {
  const badgeVariant = STATE_VARIANT_MAP[ORDER_STATE_COLORS[order.state]] ?? 'default';
  const paid = Number(order.total_paid ?? 0);
  const remaining = Number(order.remaining_balance ?? 0);
  const paymentValue =
    remaining > 0 ? `Saldo ${formatCurrency(remaining)}` :
    paid > 0 ? 'Pagada' : 'Pendiente';

  return (
    <RecordCard
      title={`Orden #${order.order_number}`}
      subtitle={customerName(order)}
      eyebrow={formatRelative(order.created_at)}
      media={{ icon: channelIcon(order.channel) }}
      badges={[
        { label: ORDER_STATE_LABELS[order.state], variant: badgeVariant },
        { label: channelLabel(order.channel), variant: 'info' },
      ]}
      details={[
        { label: 'Canal', value: channelLabel(order.channel), icon: channelIcon(order.channel) },
        { label: 'Items', value: order.order_items?.length ?? '-', icon: 'package' },
        { label: 'Pago', value: paymentValue, icon: 'wallet' },
        { label: 'Fecha', value: formatRelative(order.created_at), icon: 'calendar' },
      ]}
      footerLabel="Total"
      footerValue={formatCurrency(order.grand_total)}
      footerTone="success"
      onPress={onPress}
    />
  );
};

export default function Orders() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [filterValues, setFilterValues] = useState<FilterValues>({ status: null, channel: null });
  const [missingShipping, setMissingShipping] = useState(false);

  // Filtros efectivos derivados de filterValues ('' → undefined para API).
  const status = typeof filterValues.status === 'string' && filterValues.status !== ''
    ? (filterValues.status as OrderState) : undefined;
  const channel = typeof filterValues.channel === 'string' && filterValues.channel !== ''
    ? (filterValues.channel as OrderChannel) : undefined;
  const hasActiveFilters = !!status || !!channel || !!search.trim() || missingShipping;

  const { data: stats } = useQuery({
    queryKey: ['order-stats'],
    queryFn: () => OrderService.stats(),
  });

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading: ordersLoading,
    refetch,
    isRefetching,
  } = useInfiniteQuery({
    queryKey: ['orders', search, status, channel, missingShipping],
    queryFn: ({ pageParam = 1 }) =>
      OrderService.list({
        page: pageParam,
        limit: 20,
        search: search || undefined,
        status,
        channel,
        missing_shipping_method: missingShipping || undefined,
      }),
    getNextPageParam,
    initialPageParam: 1,
  });

  const orders = data?.pages.flatMap((page) => page.data) ?? [];
  const totalItems = data?.pages[0]?.pagination?.total ?? orders.length;

  // toastError fuera del render para evitar warning React cuando algo falle.
  useEffect(() => {
    if (!ordersLoading && orders.length === 0 && hasActiveFilters) {
      // no toast — empty state lo maneja visualmente
    }
  }, [ordersLoading, orders.length, hasActiveFilters]);

  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const handleFilterChange = useCallback((values: FilterValues) => {
    setFilterValues(values);
  }, []);

  const handleClearAllFilters = useCallback(() => {
    setFilterValues({ status: null, channel: null });
    setSearch('');
    setMissingShipping(false);
  }, []);

  const handleActionClick = useCallback((actionKey: string) => {
    if (actionKey === 'create_order') {
      toastError('Crear orden — próximamente en móvil');
    } else if (actionKey === 'refresh') {
      refetch();
    }
  }, [refetch]);

  const handleCreateOrder = useCallback(() => {
    toastError('Crear orden — próximamente en móvil');
  }, []);

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const renderItem = useCallback(
    ({ item }: { item: Order }) => (
      <OrderCard
        order={item}
        onPress={() => router.push(`/(store-admin)/orders/${item.id}` as never)}
      />
    ),
    [router],
  );

  const renderFooter = useCallback(() => {
    if (!isFetchingNextPage) return null;
    return <Spinner />;
  }, [isFetchingNextPage]);

  return (
    <View style={styles.container}>
      <FlatList
        data={orders}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderItem}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListHeaderComponent={
          <View>
            {/* Stats — paridad con web order-stats.component.html (4 stats) */}
            <StatsGrid
              items={[
                {
                  label: 'Órdenes',
                  value: formatCount(stats?.total_orders),
                  icon: <Icon name="shopping-cart" size={14} color={colorScales.blue[600]} />,
                  iconBg: colorScales.blue[100],
                  iconColor: colorScales.blue[600],
                  description: `${growthLabel(stats?.ordersGrowthRate)} vs mes ant.`,
                },
                {
                  label: 'Pendientes',
                  value: formatCount(stats?.pending_orders),
                  icon: <Icon name="clock" size={14} color={colorScales.amber[600]} />,
                  iconBg: colorScales.amber[100],
                  iconColor: colorScales.amber[600],
                  description: `${growthLabel(stats?.pendingGrowthRate)} vs mes ant.`,
                },
                {
                  label: 'Completadas',
                  value: formatCount(stats?.completed_orders),
                  icon: <Icon name="check-circle" size={14} color={colorScales.emerald[600]} />,
                  iconBg: colorScales.emerald[100],
                  iconColor: colorScales.emerald[600],
                  description: `${growthLabel(stats?.completedGrowthRate)} vs mes ant.`,
                },
                {
                  label: 'Ingresos',
                  value: formatCurrency(stats?.total_revenue ?? 0),
                  icon: <Icon name="dollar-sign" size={14} color={colorScales.purple[600]} />,
                  iconBg: colorScales.purple[100],
                  iconColor: colorScales.purple[600],
                  description: `${growthLabel(stats?.revenueGrowthRate)} vs mes ant.`,
                },
              ]}
            />

            {/* Search section — paridad web (orders-list.component.html)
                Mobile layout (flex-col en web): Title arriba, search row abajo. */}
            <View style={styles.searchSection}>
              {/* Title count — paridad con orders-list.component.html línea 8-10
                  Web mobile: text-[13px] font-bold text-gray-600 tracking-wide */}
              <Text style={styles.titleCount}>
                Órdenes ({totalItems})
              </Text>

              {/* Search + OptionsDropdown + Sin envío — paridad web */}
              <View style={styles.searchRow}>
                <View style={styles.searchBar}>
                  <SearchBar
                    value={search}
                    onChangeText={setSearch}
                    onClear={() => setSearch('')}
                    placeholder="Buscar órdenes..."
                  />
                </View>

                <OptionsDropdown
                  filters={ORDER_FILTERS}
                  actions={ORDER_ACTIONS}
                  filterValues={filterValues}
                  isLoading={ordersLoading}
                  onFilterChange={handleFilterChange}
                  onActionClick={handleActionClick}
                  onClearAllFilters={handleClearAllFilters}
                />

                {/* Sin envío — toggle (paridad con orders-list.component.html línea 35) */}
                <Pressable
                  onPress={() => setMissingShipping((v) => !v)}
                  hitSlop={4}
                  style={({ pressed }) => [
                    styles.missingShippingButton,
                    missingShipping ? styles.missingShippingActive : styles.missingShippingInactive,
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <Icon name="package" size={14} color={missingShipping ? colorScales.amber[700] : colorScales.gray[500]} />
                  <Text style={[
                    styles.missingShippingText,
                    missingShipping ? styles.missingShippingTextActive : styles.missingShippingTextInactive,
                  ]}>
                    Sin envío
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        }
        ListEmptyComponent={
          ordersLoading ? (
            <View style={styles.loadingContainer}>
              <Spinner />
              <Text style={styles.loadingText}>Cargando órdenes...</Text>
            </View>
          ) : (
            <EmptyState
              icon="shopping-bag"
              title={hasActiveFilters ? 'Sin órdenes con esos filtros' : 'Sin órdenes'}
              description={
                hasActiveFilters
                  ? 'Intenta ajustar los filtros para encontrar más resultados'
                  : 'Aún no hay órdenes registradas'
              }
              actionLabel={!hasActiveFilters ? 'Crear Primera Orden' : undefined}
              onAction={!hasActiveFilters ? handleCreateOrder : undefined}
              secondaryActionLabel="Actualizar"
              onSecondaryAction={handleRefresh}
            />
          )
        }
        ListFooterComponent={renderFooter}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.3}
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  // Search section — paridad con orders-list.component.html
  // Web mobile layout: flex-col → title (top) + search row (bottom).
  searchSection: {
    gap: spacing[2],
    marginBottom: spacing[2],
  },
  // Search row — paridad con orders-list.component.html línea 13-44
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  searchBar: {
    flex: 1,
  },
  missingShippingButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1] + 1,
    paddingHorizontal: spacing[2.5],
    paddingVertical: spacing[1.5] + 1,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    minHeight: 36,
  },
  missingShippingActive: {
    backgroundColor: colorScales.amber[100],
    borderColor: colorScales.amber[300],
  },
  missingShippingInactive: {
    backgroundColor: colors.card,
    borderColor: 'transparent',
  },
  missingShippingText: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.medium,
  },
  missingShippingTextActive: {
    color: colorScales.amber[700],
  },
  missingShippingTextInactive: {
    color: colorScales.gray[500],
  },
  // Title count — paridad con orders-list.component.html línea 8-10
  // Web mobile: text-[13px] font-bold text-gray-600 tracking-wide
  titleCount: {
    fontSize: 13,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[600],
    letterSpacing: 0.5,
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[12],
    gap: spacing[2],
  },
  loadingText: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
  },
  listContent: {
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[6],
    paddingTop: spacing[2],
  },
  separator: {
    height: spacing[3],
  },
});
