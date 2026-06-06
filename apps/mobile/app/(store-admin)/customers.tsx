import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { CustomerService } from '@/features/store/services/customer.service';
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
      style={{ marginHorizontal: spacing[4] }}
    />
  );
};

const CustomerStatsGrid = ({ stats }: { stats: CustomerStats | undefined }) => (
  <StatsGrid
    items={[
      { label: 'Total Clientes', value: String(stats?.total_customers ?? 0), icon: 'users', trend: { value: 12, positive: true } },
      { label: 'Activos', value: String(stats?.active_customers ?? 0), icon: 'user-check', trend: { value: 5, positive: true } },
      { label: 'Nuevos (este mes)', value: String(stats?.new_customers_this_month ?? 0), icon: 'user-plus', trend: { value: 8, positive: true } },
      { label: 'Ingresos', value: formatCurrency(stats?.total_revenue ?? 0), icon: 'dollar-sign', trend: { value: 15, positive: true } },
    ]}
  />
);

export default function CustomersScreen() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState<CustomerState | undefined>();
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);
  const [page, setPage] = useState(1);
  const storeId = useTenantStore((s) => s.storeId);

  const { data: stats } = useQuery({
    queryKey: ['customer-stats', storeId],
    queryFn: () => CustomerService.stats(Number(storeId)),
    enabled: !!storeId,
  });

  const {
    data: pageData,
    isLoading: customersLoading,
    isError,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ['customers', search, stateFilter, page],
    queryFn: () =>
      CustomerService.list({
        page,
        limit: 10,
        search: search || undefined,
        state: stateFilter,
      }),
  });

  const customers = pageData?.data ?? [];
  const pagination = pageData?.pagination;
  const totalPages = pagination?.totalPages ?? 1;

  const handleSearch = useCallback((text: string) => {
    setSearch(text);
    setPage(1);
  }, []);

  const renderCustomer = useCallback(
    ({ item }: { item: Customer }) => (
      <CustomerCard
        customer={item}
        onPress={() => router.push(`/(store-admin)/customers/${item.id}` as never)}
      />
    ),
    [router],
  );

  const paginationRange = useMemo(() => {
    const range: (number | 'dots')[] = [];
    const delta = 1;
    const left = Math.max(2, page - delta);
    const right = Math.min(totalPages - 1, page + delta);

    range.push(1);
    if (left > 2) range.push('dots');
    for (let i = left; i <= right; i++) range.push(i);
    if (right < totalPages - 1) range.push('dots');
    if (totalPages > 1) range.push(totalPages);

    return range;
  }, [page, totalPages]);

  if (customersLoading && !pageData) {
    return (
      <View style={styles.loader}>
        <Spinner />
      </View>
    );
  }

  if (isError && !pageData) {
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
          <View style={styles.headerSection}>
            <CustomerStatsGrid stats={stats} />
            <Text style={styles.title}>Todos los Clientes ({pagination?.total ?? 0})</Text>
            <View style={styles.searchRow}>
              <SearchBar
                value={search}
                onChangeText={handleSearch}
                onClear={() => handleSearch('')}
                placeholder="Buscar clientes..."
                style={styles.searchBar}
              />
              <Pressable
                onPress={() => router.push('/(store-admin)/customers/create' as never)}
                style={styles.searchActionBtn}
              >
                <Icon name="plus" size={18} color={colors.primary} />
              </Pressable>
              <Pressable
                onPress={() => setShowFilterDropdown((p) => !p)}
                style={styles.searchFilterBtn}
              >
                <Icon name="filter" size={18} color={colors.primary} />
              </Pressable>
            </View>
            {showFilterDropdown && (
              <View style={styles.filterDropdown}>
                {STATE_FILTERS.map((f) => (
                  <Pressable
                    key={f.label}
                    onPress={() => {
                      setStateFilter(f.value);
                      setShowFilterDropdown(false);
                      setPage(1);
                    }}
                    style={[
                      styles.filterOption,
                      f.value === stateFilter && styles.filterOptionActive,
                    ]}
                  >
                    <Icon
                      name="check"
                      size={14}
                      color={f.value === stateFilter ? colors.primary : 'transparent'}
                    />
                    <Text style={styles.filterOptionText}>{f.label}</Text>
                  </Pressable>
                ))}
              </View>
            )}
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
        ListFooterComponent={
          totalPages > 1 ? (
            <View style={styles.pagination}>
              <Pressable
                onPress={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                style={[styles.pageBtn, page <= 1 && styles.pageBtnDisabled]}
              >
                <Icon name="chevron-left" size={16} color={page <= 1 ? colorScales.gray[300] : colorScales.gray[600]} />
              </Pressable>
              {paginationRange.map((item, idx) =>
                item === 'dots' ? (
                  <Text key={`dots-${idx}`} style={styles.pageDots}>...</Text>
                ) : (
                  <Pressable
                    key={item}
                    onPress={() => setPage(item)}
                    style={[styles.pageNumBtn, page === item && styles.pageNumBtnActive]}
                  >
                    <Text style={[styles.pageNumText, page === item && styles.pageNumTextActive]}>
                      {item}
                    </Text>
                  </Pressable>
                ),
              )}
              <Pressable
                onPress={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                style={[styles.pageBtn, page >= totalPages && styles.pageBtnDisabled]}
              >
                <Icon name="chevron-right" size={16} color={page >= totalPages ? colorScales.gray[300] : colorScales.gray[600]} />
              </Pressable>
            </View>
          ) : null
        }
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
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
  headerSection: {
    backgroundColor: 'transparent',
  },
  loader: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colorScales.gray[50],
  },
  title: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
    marginBottom: spacing[4],
    marginTop: spacing[2],
    paddingHorizontal: spacing[4],
  },
  searchRow: {
    flexDirection: 'row',
    gap: spacing[2],
    marginBottom: spacing[5],
    paddingHorizontal: spacing[4],
  },
  searchBar: {
    flex: 1,
    height: 44,
    backgroundColor: colors.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  searchActionBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.background,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  searchFilterBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.background,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  filterDropdown: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: borderRadius.lg,
    marginBottom: spacing[3],
    ...shadows.md,
  },
  filterOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
  },
  filterOptionActive: {
    backgroundColor: colorScales.gray[50],
  },
  filterOptionText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colorScales.gray[800],
  },
  listContent: {
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
  pagination: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1],
    paddingVertical: spacing[4],
  },
  pageBtn: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
  },
  pageBtnDisabled: {
    opacity: 0.4,
  },
  pageNumBtn: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  pageNumBtnActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  pageNumText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colorScales.gray[700],
  },
  pageNumTextActive: {
    color: colors.background,
  },
  pageDots: {
    width: 36,
    textAlign: 'center',
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[400],
  },
});
