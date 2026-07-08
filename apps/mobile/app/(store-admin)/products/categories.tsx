import { useState } from 'react';
import { ActivityIndicator, View, FlatList, Text, RefreshControl, Pressable } from 'react-native';
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
import { CategoryService } from '@/features/store/services/category.service';
import { useCan } from '@/core/auth/use-permissions';
import type {
  ProductCategory,
  CategoryQuery,
  CategoryState,
} from '@/features/store/types';
import { colors, colorScales, spacing, borderRadius, typography } from '@/shared/theme';

const PAGE_SIZE = 20;

export default function CategoriesListScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const canCreate = useCan('store:categories:create');
  const canDelete = useCan('store:categories:delete');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [stateFilter, setStateFilter] = useState<CategoryState | undefined>(undefined);
  const [featuredFilter, setFeaturedFilter] = useState<boolean | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<ProductCategory | null>(null);
  const [forceConfirm, setForceConfirm] = useState<{ category: ProductCategory; productCount: number } | null>(null);

  const query: CategoryQuery = {
    page,
    limit: PAGE_SIZE,
    search: debouncedSearch || undefined,
    state: stateFilter,
    is_featured: featuredFilter,
  };

  const { data, isLoading, isFetching, refetch, isError } = useQuery({
    queryKey: ['categories', query],
    queryFn: () => CategoryService.list(query),
  });

  const { data: stats } = useQuery({
    queryKey: ['categories-stats'],
    queryFn: () => CategoryService.stats(),
  });

  const categories = data?.data ?? [];
  const total = data?.pagination?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const deleteMutation = useMutation({
    mutationFn: ({ id, force = false }) =>
      CategoryService.delete(id, force),
    onSuccess: () => {
      toastSuccess('Categoría eliminada');
      queryClient.invalidateQueries({ queryKey: ['categories'] });
      queryClient.invalidateQueries({ queryKey: ['categories-stats'] });
      queryClient.invalidateQueries({ queryKey: ['product-categories'] });
      setDeleteTarget(null);
      setForceConfirm(null);
    },
    onError: (err, vars) => {
      const data = err?.response?.data;
      const code = data?.error?.code ?? data?.code;
      if (code === 'CAT_DELETE_HAS_PRODUCTS' && !vars.force && deleteTarget) {
        const productCount = data?.error?.details?.product_count ?? data?.details?.product_count ?? 0;
        setForceConfirm({ category: deleteTarget, productCount });
        setDeleteTarget(null);
        return;
      }
      toastError('No se pudo eliminar la categoría');
      setForceConfirm(null);
    },
  });

  const toggleFeaturedMutation = useMutation({
    mutationFn: ({ id, is_featured }) =>
      CategoryService.update(id, { is_featured }),
    onSuccess: (_data, vars) => {
      toastSuccess(vars.is_featured ? 'Categoría destacada' : 'Categoría quitada de destacados');
      queryClient.invalidateQueries({ queryKey: ['categories'] });
      queryClient.invalidateQueries({ queryKey: ['categories-stats'] });
    },
    onError: () => {
      toastError('No se pudo cambiar el destaque');
    },
  });

  function handleSearch(value: string) {
    setSearch(value);
    setPage(1);
    setTimeout(() => setDebouncedSearch(value), 400);
  }

  const filtersActive = (stateFilter ? 1 : 0) + (featuredFilter !== undefined ? 1 : 0);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <StickyHeader
        title="Categorías"
        subtitle={`${total} categoría${total === 1 ? '' : 's'} registrada${total === 1 ? '' : 's'}`}
      />

      <View style={{ paddingHorizontal: spacing[4], paddingTop: spacing[3], gap: spacing[3] }}>
        <StatsGrid
          items={[
            { label: 'Total Categorías', value: stats?.total ?? 0, icon: <Icon name="layers" size={14} color={colors.primary} />, iconBg: colors.primaryLight, iconColor: colors.primary },
            { label: 'Activas', value: stats?.active ?? 0, icon: <Icon name="check-circle" size={14} color={colors.success} />, iconBg: '#DCFCE7', iconColor: colors.success },
            { label: 'Inactivas', value: stats?.inactive ?? 0, icon: <Icon name="x-circle" size={14} color={colors.text.muted} />, iconBg: colorScales.gray[100], iconColor: colors.text.secondary },
            { label: 'Destacadas', value: stats?.featured ?? 0, icon: <Icon name="star" size={14} color={colors.warning} />, iconBg: '#FEF3C7', iconColor: colors.warning },
          ]}
        />

        <View style={{ flexDirection: 'row', gap: spacing[2], alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <SearchBar
              placeholder="Buscar categorías..."
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
                !stateVal || stateVal === 'all' ? undefined : (stateVal as CategoryState),
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
                label: 'Nueva Categoría',
                icon: 'plus',
                onPress: () => router.push('/(store-admin)/products/categories/create'),
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
            title="Error al cargar categorías"
            description="No pudimos obtener las categorías. Verifica tu conexión."
            actionLabel="Reintentar"
            onAction={() => refetch()}
          />
        </View>
      ) : categories.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing[4] }}>
          <EmptyState
            icon="layers"
            title={filtersActive > 0 ? 'Sin resultados' : 'Aún no tienes categorías'}
            description={
              filtersActive > 0
                ? 'Probá ajustar los filtros.'
                : 'Creá tu primera categoría para empezar a clasificar productos.'
            }
            actionLabel={filtersActive > 0 ? 'Limpiar filtros' : 'Crear primera categoría'}
            onAction={() => {
              if (filtersActive > 0) {
                setStateFilter(undefined);
                setFeaturedFilter(undefined);
              } else {
                router.push('/(store-admin)/products/categories/create');
              }
            }}
          />
        </View>
      ) : (
        <FlatList
          data={categories}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ paddingHorizontal: spacing[4], paddingTop: spacing[2], paddingBottom: 96 }}
          ItemSeparatorComponent={() => <View style={{ height: spacing[2] }} />}
          refreshControl={
            <RefreshControl refreshing={isFetching} onRefresh={() => refetch()} tintColor={colors.primary} />
          }
          renderItem={({ item }) => (
            <CategoryCard
              category={item}
              onPress={() => router.push(`/(store-admin)/products/categories/${item.id}`)}
              onLongPress={canDelete ? () => setDeleteTarget(item) : undefined}
              onToggleFeatured={() =>
                toggleFeaturedMutation.mutate({
                  id: item.id,
                  is_featured: !item.is_featured,
                })
              }
              isTogglingFeatured={
                toggleFeaturedMutation.isPending &&
                toggleFeaturedMutation.variables?.id === item.id
              }
            />
          )}
          ListFooterComponent={
            <View style={{ paddingTop: spacing[4] }}>
              <Pagination
                page={page}
                totalPages={totalPages}
                onPageChange={setPage}
                info={`Mostrando ${categories.length} de ${total}`}
              />
            </View>
          }
        />
      )}

      {canCreate && (
        <Fab icon="plus" accessibilityLabel="Nueva categoría" onPress={() => router.push('/(store-admin)/products/categories/create')} />
      )}

      <ConfirmDialog
        visible={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() =>
          deleteTarget &&
          deleteMutation.mutate({ id: deleteTarget.id, force: false })
        }
        title="Eliminar Categoría"
        message={`¿Eliminar "${deleteTarget?.name}"? Los productos que la usen quedarán sin categoría asignada.`}
        confirmLabel="Eliminar"
        destructive
        loading={deleteMutation.isPending}
      />

      <ConfirmDialog
        visible={!!forceConfirm}
        onClose={() => setForceConfirm(null)}
        onConfirm={() =>
          forceConfirm &&
          deleteMutation.mutate({
            id: forceConfirm.category.id,
            force: true,
          })
        }
        title="Categoría con productos asignados"
        message={
          forceConfirm
            ? `"${forceConfirm.category.name}" tiene ${forceConfirm.productCount} producto(s) asociado(s). Al forzar la eliminación, esos productos quedarán sin categoría asignada. ¿Continuar?`
            : ''
        }
        confirmLabel="Forzar eliminación"
        destructive
        loading={deleteMutation?.isPending}
      />
    </View>
  );
}

function CategoryCard({
  category,
  onPress,
  onLongPress,
  onToggleFeatured,
  isTogglingFeatured,
}: {
  category: ProductCategory;
  onPress: () => void;
  onLongPress?: () => void;
  onToggleFeatured?: () => void;
  isTogglingFeatured?: boolean;
}) {
  const stateVariant = category.state === 'active' ? 'success' : 'default';
  const stateLabel = category.state === 'active' ? 'Activa' : 'Inactiva';

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
        {category.image_url ? (
          <Text style={{ fontSize: 24 }}>📚</Text>
        ) : (
          <Icon name="layers" size={22} color={colors.text.muted} />
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
            {category.name}
          </Text>
          {category.is_featured && (
            <Badge label="Destacada" variant="warning" size="xs" badgeStyle="outline" />
          )}
          <Badge label={stateLabel} variant={stateVariant as any} size="xs" />
        </View>
        {category.slug && (
          <Text style={{ fontSize: typography.fontSize.sm, color: colors.text.secondary }} numberOfLines={1}>
            /{category.slug}
          </Text>
        )}
        {category.description && (
          <Text style={{ fontSize: typography.fontSize.sm, color: colors.text.muted }} numberOfLines={1}>
            {category.description}
          </Text>
        )}
      </View>
      {onToggleFeatured ? (
        <Pressable
          onPress={(e) => {
            e.stopPropagation?.();
            onToggleFeatured();
          }}
          hitSlop={8}
          disabled={isTogglingFeatured}
          style={({ pressed }) => [
            {
              width: 36,
              height: 36,
              borderRadius: 18,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: category.is_featured ? '#FEF3C7' : 'transparent',
            },
            pressed && { opacity: 0.6 },
          ]}
          accessibilityLabel={category.is_featured ? 'Quitar destaque' : 'Destacar'}
        >
          <Icon
            name="star"
            size={18}
            color={category.is_featured ? colors.warning : colors.text.muted}
            fill={category.is_featured ? colors.warning : 'transparent'}
          />
        </Pressable>
      ) : null}
      <Icon name="chevron-right" size={18} color={colors.text.muted} />
    </Pressable>
  );
}