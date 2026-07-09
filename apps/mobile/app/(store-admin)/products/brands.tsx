import { useCallback, useState } from 'react';
import { ActivityIndicator, View, FlatList, Text, RefreshControl, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import {
  StickyHeader,
  SearchBar,
  OptionsDropdown,
  StatsGrid,
  Pagination,
  Fab,
  EmptyState,
  ConfirmDialog,
  Badge,
} from '@/shared/components';
import { Icon } from '@/shared/components/icon/icon';
import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';
import { BrandService } from '@/features/store/services/brand.service';
import { useCan } from '@/core/auth/use-permissions';
import type {
  Brand,
  BrandQuery,
  BrandState,
} from '@/features/store/types';
import { colors, colorScales, spacing, borderRadius, typography } from '@/shared/theme';

const PAGE_SIZE = 20;

export default function BrandsListScreen() {
  // Safe area bottom: el FlatList debe tener paddingBottom suficiente
  // para que el último item no quede tapado por el FAB + gesture bar.
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const canCreate = useCan('store:brands:create');
  const canDelete = useCan('store:brands:delete');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [stateFilter, setStateFilter] = useState<BrandState | undefined>(undefined);
  const [featuredFilter, setFeaturedFilter] = useState<boolean | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<Brand | null>(null);

  const query: BrandQuery = {
    page,
    limit: PAGE_SIZE,
    search: debouncedSearch || undefined,
    state: stateFilter,
    is_featured: featuredFilter,
  };

  const { data, isLoading, isFetching, refetch, isError } = useQuery({
    queryKey: ['brands', query],
    queryFn: () => BrandService.list(query),
  });

  const { data: stats } = useQuery({
    queryKey: ['brands-stats'],
    queryFn: () => BrandService.stats(),
  });

  const brands = data?.data ?? [];
  const total = data?.pagination?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const deleteMutation = useMutation({
    mutationFn: (id: number) => BrandService.delete(id, true),
    onSuccess: () => {
      toastSuccess('Marca eliminada');
      queryClient.invalidateQueries({ queryKey: ['brands'] });
      queryClient.invalidateQueries({ queryKey: ['brands-stats'] });
      queryClient.invalidateQueries({ queryKey: ['product-brands'] });
      setDeleteTarget(null);
    },
    onError: () => {
      toastError('No se pudo eliminar la marca');
    },
  });

  function handleSearch(value: string) {
    setSearch(value);
    setDebouncedSearch(value);
    setPage(1);
  }

  const filtersActive = (stateFilter ? 1 : 0) + (featuredFilter !== undefined ? 1 : 0);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <StickyHeader
        title="Marcas"
        subtitle={`${total} marca${total === 1 ? '' : 's'} registrada${total === 1 ? '' : 's'}`}
      />

      <View style={{ paddingHorizontal: spacing[4], paddingTop: spacing[3], gap: spacing[3] }}>
        <StatsGrid
          items={[
            { label: 'Total Marcas', value: stats?.total ?? 0, icon: <Icon name="tag" size={14} color={colors.primary} />, iconBg: colors.primaryLight, iconColor: colors.primary },
            { label: 'Activas', value: stats?.active ?? 0, icon: <Icon name="check-circle" size={14} color={colors.success} />, iconBg: '#DCFCE7', iconColor: colors.success },
            { label: 'Inactivas', value: stats?.inactive ?? 0, icon: <Icon name="x-circle" size={14} color={colors.text.muted} />, iconBg: colorScales.gray[100], iconColor: colors.text.secondary },
            { label: 'Destacadas', value: stats?.featured ?? 0, icon: <Icon name="star" size={14} color={colors.warning} />, iconBg: '#FEF3C7', iconColor: colors.warning },
          ]}
        />

        <View style={{ flexDirection: 'row', gap: spacing[2], alignItems: 'center' }}>
          <Text style={{ fontSize: typography.fontSize.lg, fontWeight: '700', color: colors.text.primary, marginRight: spacing[2] }}>
            Marcas ({total})
          </Text>
          <View style={{ flex: 1 }}>
            <SearchBar
              placeholder="Buscar marcas..."
              value={search}
              onChangeText={handleSearch}
              debounceMs={400}
            />
          </View>
          <OptionsDropdown
            filters={[
              {
                key: 'state',
                label: 'Estado',
                type: 'select',
                options: [
                  { value: 'all', label: 'Todas' },
                  { value: 'active', label: 'Activas' },
                  { value: 'inactive', label: 'Inactivas' },
                ],
              },
              {
                key: 'featured',
                label: 'Destacadas',
                type: 'select',
                options: [
                  { value: 'all', label: 'Todas' },
                  { value: 'true', label: 'Destacadas' },
                  { value: 'false', label: 'No destacadas' },
                ],
              },
            ]}
            filterValues={{
              state: stateFilter ?? 'all',
              featured:
                featuredFilter === undefined ? 'all' : featuredFilter ? 'true' : 'false',
            }}
            onFilterChange={(values) => {
              const stateVal = values.state;
              const featuredVal = values.featured;
              setStateFilter(
                !stateVal || stateVal === 'all' ? undefined : (stateVal as BrandState),
              );
              setFeaturedFilter(
                !featuredVal || featuredVal === 'all'
                  ? undefined
                  : featuredVal === 'true',
              );
              setPage(1);
            }}
            actions={canCreate ? [
              {
                label: 'Nueva Marca',
                icon: 'plus',
                onPress: () => router.push('/(store-admin)/products/brands/create'),
              },
            ] : []}
          />
        </View>
      </View>

      {isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : isError ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing[4] }}>
          <EmptyState
            icon="alert-triangle"
            title="Error al cargar marcas"
            description="No pudimos obtener las marcas. Verifica tu conexión."
            actionLabel="Reintentar"
            onAction={() => refetch()}
          />
        </View>
      ) : brands.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing[4] }}>
          <EmptyState
            icon="tag"
            title={filtersActive > 0 ? 'Sin resultados' : 'Aún no tienes marcas'}
            description={
              filtersActive > 0
                ? 'Probá ajustar los filtros.'
                : 'Creá tu primera marca para empezar a clasificar productos.'
            }
            actionLabel={filtersActive > 0 ? 'Limpiar filtros' : 'Crear primera marca'}
            onAction={() => {
              if (filtersActive > 0) {
                setStateFilter(undefined);
                setFeaturedFilter(undefined);
              } else {
                router.push('/(store-admin)/products/brands/create');
              }
            }}
          />
        </View>
      ) : (
        <FlatList
          data={brands}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ paddingHorizontal: spacing[4], paddingTop: spacing[2], paddingBottom: insets.bottom + 96 }}
          ItemSeparatorComponent={() => <View style={{ height: spacing[2] }} />}
          refreshControl={
            <RefreshControl refreshing={isFetching} onRefresh={() => refetch()} tintColor={colors.primary} />
          }
          renderItem={({ item }) => (
            <BrandCard
              brand={item}
              onPress={() => router.push(`/(store-admin)/products/brands/${item.id}`)}
              onLongPress={canDelete ? () => setDeleteTarget(item) : undefined}
            />
          )}
          ListFooterComponent={
            <View style={{ paddingTop: spacing[4] }}>
              <Pagination
                page={page}
                totalPages={totalPages}
                onPageChange={setPage}
                info={`Mostrando ${brands.length} de ${total}`}
              />
            </View>
          }
        />
      )}

      {canCreate && (
        <Fab icon="plus" accessibilityLabel="Nueva marca" onPress={() => router.push('/(store-admin)/products/brands/create')} />
      )}

      <ConfirmDialog
        visible={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        title="Eliminar Marca"
        message={`¿Eliminar "${deleteTarget?.name}"? Los productos que la usen quedarán sin marca asignada.`}
        confirmLabel="Eliminar"
        destructive
        loading={deleteMutation?.isPending}
      />
    </View>
  );
}

function BrandCard({
  brand,
  onPress,
  onLongPress,
}: {
  brand: Brand;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const stateVariant = brand.state === 'active' ? 'success' : brand.state === 'inactive' ? 'default' : 'warning';
  const stateLabel = brand.state === 'active' ? 'Activa' : brand.state === 'inactive' ? 'Inactiva' : 'Archivada';

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        {
          backgroundColor: colors.card,
          borderRadius: borderRadius.lg,
          padding: spacing[3],
          gap: spacing[2],
          flexDirection: 'row',
          alignItems: 'center',
          borderWidth: 1,
          borderColor: colorScales.gray[200],
        },
        pressed && { opacity: 0.85 },
      ]}
    >
      <View
        style={{
          width: 48,
          height: 48,
          borderRadius: borderRadius.md,
          backgroundColor: colorScales.gray[100],
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        {brand.logo_url ? (
          <Text style={{ fontSize: 24 }}>🏷️</Text>
        ) : (
          <Icon name="tag" size={22} color={colors.text.muted} />
        )}
      </View>
      <View style={{ flex: 1, gap: spacing[1] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
          <Text
            style={{
              fontSize: typography.fontSize.base,
              fontWeight: '600',
              color: colors.text.primary,
              flex: 1,
            }}
            numberOfLines={1}
          >
            {brand.name}
          </Text>
          {brand.is_featured && (
            <Badge label="Destacada" variant="warning" size="xs" badgeStyle="outline" />
          )}
          <Badge label={stateLabel} variant={stateVariant as any} size="xs" />
        </View>
        {brand.slug && (
          <Text style={{ fontSize: typography.fontSize.sm, color: colors.text.secondary }} numberOfLines={1}>
            /{brand.slug}
          </Text>
        )}
        {brand.description && (
          <Text style={{ fontSize: typography.fontSize.sm, color: colors.text.muted }} numberOfLines={1}>
            {brand.description}
          </Text>
        )}
      </View>
      <Icon name="chevron-right" size={18} color={colors.text.muted} />
    </Pressable>
  );
}