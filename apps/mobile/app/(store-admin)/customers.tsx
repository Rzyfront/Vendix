import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { CustomerService } from '@/features/store/services/customer.service';
import { getNextPageParam } from '@/core/api/pagination';
import { useTenantStore } from '@/core/store/tenant.store';
import type { Customer, CustomerState, CustomerStats } from '@/features/store/types';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { Icon } from '@/shared/components/icon/icon';
import { RecordCard } from '@/shared/components/record-card/record-card';
import { SearchBar } from '@/shared/components/search-bar/search-bar';
import { Spinner } from '@/shared/components/spinner/spinner';
import { StatsGrid } from '@/shared/components/stats-card/stats-grid';
import { formatCurrency } from '@/shared/utils/currency';
import { formatRelative } from '@/shared/utils/date';
import { borderRadius, colorScales, colors, shadows, spacing, typography } from '@/shared/theme';

const STATE_FILTERS: { label: string; value?: CustomerState }[] = [
  { label: 'Todos' },
  { label: 'Activos', value: 'active' },
  { label: 'Inactivos', value: 'inactive' },
];

function customerName(customer: Customer): string {
  return `${customer.first_name || ''} ${customer.last_name || ''}`.trim() || 'Cliente sin nombre';
}

const CustomerCard = ({ customer, onPress }: { customer: Customer; onPress: () => void }) => {
  const fullName = customerName(customer);
  const orders = Number(customer.total_orders ?? 0);

  return (
    <RecordCard
      title={fullName}
      subtitle={customer.email || customer.document_number || 'Sin correo registrado'}
      media={{ avatarName: fullName }}
      badges={[
        {
          label: customer.state === 'active' ? 'Activo' : 'Inactivo',
          variant: customer.state === 'active' ? 'success' : 'warning',
        },
      ]}
      details={[
        { label: 'Teléfono', value: customer.phone || 'Sin teléfono', icon: 'phone' },
        { label: 'Órdenes', value: orders, icon: 'shopping-bag' },
        {
          label: 'Última compra',
          value: customer.last_purchase_at ? formatRelative(customer.last_purchase_at) : 'Sin compras',
          icon: 'calendar',
        },
        {
          label: 'Documento',
          value: customer.document_number || 'No registrado',
          icon: 'file-text',
        },
      ]}
      footerLabel="Total gastado"
      footerValue={formatCurrency(customer.total_spent ?? 0)}
      footerTone="success"
      onPress={onPress}
    />
  );
};

const CustomerStatsGrid = ({ stats }: { stats: CustomerStats | undefined }) => (
  <StatsGrid
    items={[
      { label: 'Total Clientes', value: String(stats?.total ?? 0), icon: 'users' },
      { label: 'Ingresos', value: formatCurrency(stats?.totalRevenue ?? 0), icon: 'dollar-sign' },
    ]}
  />
);

const FilterChips = ({
  activeFilter,
  onSelect,
}: {
  activeFilter?: CustomerState;
  onSelect: (value?: CustomerState) => void;
}) => (
  <FlatList
    horizontal
    showsHorizontalScrollIndicator={false}
    data={STATE_FILTERS}
    keyExtractor={(item) => item.label}
    contentContainerStyle={styles.filterList}
    renderItem={({ item }) => {
      const isActive = item.value === activeFilter;
      return (
        <Pressable
          onPress={() => onSelect(item.value)}
          style={[styles.filterChip, isActive ? styles.filterChipActive : styles.filterChipInactive]}
        >
          <Text style={isActive ? styles.filterTextActive : styles.filterTextInactive}>
            {item.label}
          </Text>
        </Pressable>
      );
    }}
  />
);

export default function CustomersScreen() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState<CustomerState | undefined>();
  const storeId = useTenantStore((s) => s.storeId);

  const { data: stats } = useQuery({
    queryKey: ['customer-stats', storeId],
    queryFn: () => CustomerService.stats(Number(storeId)),
    enabled: !!storeId,
  });

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading: customersLoading,
    isError,
    refetch,
    isRefetching,
  } = useInfiniteQuery({
    queryKey: ['customers', search, stateFilter],
    queryFn: ({ pageParam = 1 }) =>
      CustomerService.list({
        page: pageParam,
        limit: 20,
        search: search || undefined,
        state: stateFilter,
      }),
    getNextPageParam,
    initialPageParam: 1,
  });

  const customers = data?.pages.flatMap((page) => page.data) ?? [];

  const handleSearch = useCallback((text: string) => {
    setSearch(text);
  }, []);

  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const renderCustomer = useCallback(
    ({ item }: { item: Customer }) => (
      <CustomerCard
        customer={item}
        onPress={() => router.push(`/(store-admin)/customers/${item.id}` as never)}
      />
    ),
    [router],
  );

  const renderFooter = useCallback(() => {
    if (!isFetchingNextPage) return null;
    return <Spinner />;
  }, [isFetchingNextPage]);

  if (customersLoading && !data) {
    return (
      <View style={styles.loader}>
        <Spinner />
      </View>
    );
  }

  if (isError && !data) {
    return (
      <View style={styles.root}>
        <EmptyState
          title="No se pudieron cargar los clientes"
          description="Revisa tu sesión o conexión e intenta de nuevo."
          actionLabel="Reintentar"
          onAction={() => refetch()}
          icon="users"
        />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <FlatList
        data={customers}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderCustomer}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListHeaderComponent={
          <View>
            <CustomerStatsGrid stats={stats} />
            <View style={styles.searchWrap}>
              <SearchBar
                value={search}
                onChangeText={handleSearch}
                onClear={() => handleSearch('')}
                placeholder="Buscar clientes..."
              />
            </View>
            <FilterChips activeFilter={stateFilter} onSelect={setStateFilter} />
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            title="Sin clientes"
            description="Aún no tienes clientes registrados"
            actionLabel="Crear cliente"
            onAction={() => router.push('/(store-admin)/customers/create' as never)}
            icon="users"
          />
        }
        ListFooterComponent={renderFooter}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.3}
        contentContainerStyle={styles.listContent}
      />

      <Pressable
        onPress={() => router.push('/(store-admin)/customers/create' as never)}
        style={styles.fab}
      >
        <Icon name="plus" size={24} color={colors.background} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colorScales.gray[50],
  },
  loader: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
    paddingBottom: spacing[24],
  },
  separator: {
    height: spacing[3],
  },
  fab: {
    position: 'absolute',
    bottom: spacing[6],
    right: spacing[6],
    width: 56,
    height: 56,
    borderRadius: borderRadius.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.lg,
  },
});
