import { useCallback, useState } from 'react';
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

type FilterChip = { label: string; value: OrderState | 'all' };

const FILTER_CHIPS: FilterChip[] = [
  { label: 'Todas', value: 'all' },
  { label: 'Pendientes', value: 'pending_payment' },
  { label: 'Procesando', value: 'processing' },
  { label: 'Enviadas', value: 'shipped' },
  { label: 'Entregadas', value: 'delivered' },
  { label: 'Canceladas', value: 'cancelled' },
];

function channelLabel(channel?: OrderChannel | null): string {
  switch (channel) {
    case 'pos':
      return 'POS';
    case 'ecommerce':
      return 'Ecommerce';
    case 'agent':
      return 'Agente';
    case 'whatsapp':
      return 'WhatsApp';
    case 'marketplace':
      return 'Marketplace';
    default:
      return 'Manual';
  }
}

function channelIcon(channel?: OrderChannel | null): string {
  switch (channel) {
    case 'pos':
      return 'shopping-bag';
    case 'ecommerce':
      return 'shopping-cart';
    case 'whatsapp':
      return 'phone';
    case 'marketplace':
      return 'store';
    default:
      return 'file-text';
  }
}

function customerName(order: Order): string {
  if (!order.customer) return 'Cliente no registrado';
  return `${order.customer.first_name || ''} ${order.customer.last_name || ''}`.trim() || order.customer.email;
}

const OrderCard = ({ order, onPress }: { order: Order; onPress: () => void }) => {
  const badgeVariant = STATE_VARIANT_MAP[ORDER_STATE_COLORS[order.state]] ?? 'default';
  const paid = Number(order.total_paid ?? 0);
  const remaining = Number(order.remaining_balance ?? 0);
  const paymentValue =
    remaining > 0
      ? `Saldo ${formatCurrency(remaining)}`
      : paid > 0
        ? 'Pagada'
        : 'Pendiente';

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
  const [activeFilter, setActiveFilter] = useState<OrderState | 'all'>('all');

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
    queryKey: ['orders', search, activeFilter],
    queryFn: ({ pageParam = 1 }) =>
      OrderService.list({
        page: pageParam,
        limit: 20,
        search: search || undefined,
        status: activeFilter === 'all' ? undefined : activeFilter,
      }),
    getNextPageParam,
    initialPageParam: 1,
  });

  const orders = data?.pages.flatMap((page) => page.data) ?? [];

  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

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
            <StatsGrid
              items={[
                { label: 'Total Órdenes', value: stats?.total_orders ?? 0, icon: 'clipboard-list' },
                { label: 'Ingresos', value: formatCurrency(stats?.total_revenue ?? 0), icon: 'dollar-sign' },
              ]}
            />

            <View style={styles.searchWrap}>
              <SearchBar
                value={search}
                onChangeText={setSearch}
                onClear={() => setSearch('')}
                placeholder="Buscar órdenes..."
              />
            </View>

            <FlatList
              horizontal
              showsHorizontalScrollIndicator={false}
              data={FILTER_CHIPS}
              keyExtractor={(item) => item.value}
              contentContainerStyle={styles.filterList}
              renderItem={({ item }) => {
                const active = activeFilter === item.value;
                return (
                  <Pressable
                    onPress={() => setActiveFilter(item.value)}
                    style={[styles.filterChip, active ? styles.filterChipActive : styles.filterChipInactive]}
                  >
                    <Text style={active ? styles.filterTextActive : styles.filterTextInactive}>
                      {item.label}
                    </Text>
                  </Pressable>
                );
              }}
            />
          </View>
        }
        ListEmptyComponent={
          ordersLoading ? (
            <Spinner />
          ) : (
            <EmptyState title="Sin órdenes" description="No se encontraron órdenes" icon="clipboard-list" />
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
    backgroundColor: colorScales.gray[50],
  },
  searchWrap: {
    marginBottom: spacing[3],
  },
  filterList: {
    paddingBottom: spacing[4],
    gap: spacing[2],
  },
  filterChip: {
    minHeight: 36,
    paddingHorizontal: spacing[4],
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  filterChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterChipInactive: {
    backgroundColor: colors.background,
    borderColor: colorScales.gray[200],
  },
  filterTextActive: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colors.background,
  },
  filterTextInactive: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[700],
  },
  listContent: {
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[6],
  },
  separator: {
    height: spacing[3],
  },
});
