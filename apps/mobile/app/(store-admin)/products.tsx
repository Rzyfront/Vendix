import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  View,
  Text,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  SearchBar,
  OptionsDropdown,
  StatsGrid,
  Pagination,
  Fab,
  EmptyState,
  Badge,
  Modal,
  Button,
} from '@/shared/components';
import { Icon } from '@/shared/components/icon/icon';
import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';
import { ProductService } from '@/features/store/services/product.service';
import { useTenantStore } from '@/core/store/tenant.store';
import { useCan } from '@/core/auth/use-permissions';
import type {
  Product,
  ProductQuery,
  ProductState,
  ProductType,
  Brand,
  ProductCategory,
} from '@/features/store/types';
import { formatCurrency } from '@/shared/utils/currency';
import { colors, colorScales, spacing, borderRadius, typography } from '@/shared/theme';

const PAGE_SIZE = 20;

export default function ProductsListScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const storeId = useTenantStore((s) => s.storeId);
  const canCreate = useCan('store:products:create');
  const canDelete = useCan('store:products:delete');

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [stateFilter, setStateFilter] = useState<ProductState | undefined>(undefined);
  const [categoryFilter, setCategoryFilter] = useState<number | undefined>(undefined);
  const [brandFilter, setBrandFilter] = useState<number | undefined>(undefined);
  const [typeFilter, setTypeFilter] = useState<ProductType | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);

  const query: ProductQuery = useMemo(
    () => ({
      page,
      limit: PAGE_SIZE,
      search: debouncedSearch || undefined,
      state: stateFilter,
      category_id: categoryFilter,
      brand_id: brandFilter,
      product_type: typeFilter,
      include_variants: true,
    }),
    [page, debouncedSearch, stateFilter, categoryFilter, brandFilter, typeFilter],
  );

  const { data, isLoading, isFetching, refetch, isError } = useQuery({
    queryKey: ['products', query],
    queryFn: () => ProductService.list(query),
  });

  const { data: stats } = useQuery({
    queryKey: ['product-stats', storeId],
    queryFn: () => ProductService.stats(Number(storeId) || 0),
    enabled: !!storeId,
  });

  const { data: brandsResp } = useQuery({
    queryKey: ['product-brands-filter'],
    queryFn: () => ProductService.getBrands(),
  });

  const { data: categoriesResp } = useQuery({
    queryKey: ['product-categories-filter'],
    queryFn: () => ProductService.getCategories(),
  });

  const products = data?.data ?? [];
  const total = data?.pagination?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const brands: Brand[] = Array.isArray(brandsResp) ? brandsResp : ((brandsResp as any)?.data ?? []);
  const categories: ProductCategory[] = Array.isArray(categoriesResp) ? categoriesResp : ((categoriesResp as any)?.data ?? []);

  function handleSearch(value: string) {
    setSearch(value);
    setPage(1);
    setTimeout(() => setDebouncedSearch(value), 400);
  }

  const filtersActive =
    (stateFilter ? 1 : 0) +
    (categoryFilter ? 1 : 0) +
    (brandFilter ? 1 : 0) +
    (typeFilter ? 1 : 0);

  const toggleStateMutation = useMutation({
    mutationFn: async (product: Product) => {
      const next: ProductState = product.state === 'active' ? 'inactive' : 'active';
      return ProductService.update(product.id, { state: next });
    },
    onSuccess: (_data, product) => {
      toastSuccess(product.state === 'active' ? 'Producto desactivado' : 'Producto activado');
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['product-stats'] });
      queryClient.invalidateQueries({ queryKey: ['product', product.id] });
    },
    onError: () => {
      toastError('No se pudo cambiar el estado');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (product: Product) => ProductService.delete(product.id),
    onSuccess: (_data, product) => {
      toastSuccess('Producto eliminado');
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['product-stats'] });
      setDeleteTarget(null);
    },
    onError: () => {
      toastError('No se pudo eliminar el producto');
    },
  });

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ paddingTop: spacing[12], paddingHorizontal: spacing[4], gap: spacing[3] }}>

      <View style={{ paddingHorizontal: spacing[4], paddingTop: spacing[3], gap: spacing[2] }}>
        <StatsGrid
          items={[
            { label: 'Productos totales', value: stats?.total_products ?? 0, description: 'Catálogo completo', icon: <Icon name="package" size={14} color={colors.primary} />, iconBg: colors.primaryLight, iconColor: colors.primary },
            { label: 'Productos activos', value: stats?.active_products ?? 0, description: 'Disponibles para venta', icon: <Icon name="check-circle" size={14} color={colors.success} />, iconBg: '#DCFCE7', iconColor: colors.success },
            { label: 'Categorías', value: stats?.categories_count ?? 0, description: 'En uso', icon: <Icon name="tag" size={14} color={colors.text.secondary} />, iconBg: colorScales.gray[100], iconColor: colors.text.secondary },
            { label: 'Marcas', value: stats?.brands_count ?? 0, description: 'Registradas', icon: <Icon name="building-2" size={14} color={colors.warning} />, iconBg: '#FEF3C7', iconColor: colors.warning },
          ]}
        />

        <View style={{ flexDirection: 'row', gap: spacing[2], alignItems: 'center' }}>
          <Text style={{ fontSize: typography.fontSize.lg, fontWeight: '700', color: colors.text.primary, marginRight: spacing[2] }}>
            Productos ({total})
          </Text>
          <View style={{ flex: 1 }}>
            <SearchBar
              placeholder="Buscar productos..."
              value={search}
              onChangeText={handleSearch}
              debounceMs={400}
            />
          </View>
          <OptionsDropdown
            triggerLabel="Filtros"
            filterSections={[
              {
                label: 'Estado',
                onSelect: (value) => {
                  setStateFilter(value === 'all' ? undefined : (value as ProductState));
                  setPage(1);
                },
                options: [
                  { label: 'Todos', value: 'all', active: !stateFilter },
                  { label: 'Activos', value: 'active', active: stateFilter === 'active' },
                  { label: 'Inactivos', value: 'inactive', active: stateFilter === 'inactive' },
                  { label: 'Archivados', value: 'archived', active: stateFilter === 'archived' },
                ],
              },
              {
                label: 'Tipo',
                onSelect: (value) => {
                  setTypeFilter(value === 'all' ? undefined : (value as ProductType));
                  setPage(1);
                },
                options: [
                  { label: 'Todos', value: 'all', active: !typeFilter },
                  { label: 'Físico', value: 'physical', active: typeFilter === 'physical' },
                  { label: 'Servicio', value: 'service', active: typeFilter === 'service' },
                ],
              },
              {
                label: 'Categoría',
                onSelect: (value) => {
                  if (value === 'all') setCategoryFilter(undefined);
                  else setCategoryFilter(Number(value));
                  setPage(1);
                },
                options: [
                  { label: 'Todas', value: 'all', active: !categoryFilter },
                  ...categories.slice(0, 6).map((c) => ({
                    label: c.name,
                    value: String(c.id),
                    active: categoryFilter === c.id,
                  })),
                ],
              },
              {
                label: 'Marca',
                onSelect: (value) => {
                  if (value === 'all') setBrandFilter(undefined);
                  else setBrandFilter(Number(value));
                  setPage(1);
                },
                options: [
                  { label: 'Todas', value: 'all', active: !brandFilter },
                  ...brands.slice(0, 6).map((b) => ({
                    label: b.name,
                    value: String(b.id),
                    active: brandFilter === b.id,
                  })),
                ],
              },
            ]}
            actions={[
              { label: 'Nuevo Producto', icon: 'plus', onPress: () => router.push('/(store-admin)/products/create') },
              { label: 'Marcas', icon: 'tag', onPress: () => router.push('/(store-admin)/products/brands') },
              { label: 'Categorías', icon: 'layers', onPress: () => router.push('/(store-admin)/products/categories') },
            ]}
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
            title="Error al cargar productos"
            description="No pudimos obtener los producto. Verifica tu conexión."
            actionLabel="Reintentar"
            onAction={() => refetch()}
          />
        </View>
      ) : products.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing[4] }}>
          <EmptyState
            icon="package"
            title={filtersActive > 0 ? 'Sin resultados' : 'Aún no tienes productos'}
            description={filtersActive > 0 ? 'Probá ajustar los filtros.' : 'Creá tu primer producto para empezar a vender.'}
            actionLabel={filtersActive > 0 ? 'Limpiar filtros' : 'Crear primer producto'}
            onAction={() => {
              if (filtersActive > 0) {
                setStateFilter(undefined);
                setCategoryFilter(undefined);
                setBrandFilter(undefined);
                setTypeFilter(undefined);
              } else {
                router.push('/(store-admin)/products/create');
              }
            }}
          />
        </View>
      ) : (
        <FlatList
          data={products}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ paddingHorizontal: spacing[4], paddingTop: spacing[2], paddingBottom: 96 }}
          ItemSeparatorComponent={() => <View style={{ height: spacing[2] }} />}
          refreshControl={
            <RefreshControl refreshing={isFetching} onRefresh={() => refetch()} tintColor={colors.primary} />
          }
          renderItem={({ item }) => (
            <ProductCard
              product={item}
              onEdit={() => router.push({ pathname: '/(store-admin)/products/edit', params: { id: String(item.id) } })}
              onToggle={() => toggleStateMutation.mutate(item)}
              onMore={() => setDeleteTarget(item)}
              isToggling={toggleStateMutation.isPending && toggleStateMutation.variables?.id === item.id}
            />
          )}
          ListFooterComponent={
            <View style={{ paddingTop: spacing[4] }}>
              <Pagination
                page={page}
                totalPages={totalPages}
                onPageChange={setPage}
                info={`Mostrando ${products.length} de ${total}`}
              />
            </View>
          }
        />
      )}

      {canCreate && (
        <Fab icon="plus" accessibilityLabel="Nuevo producto" onPress={() => router.push('/(store-admin)/products/create')} />
      )}

      {/* "..." → Confirm delete modal (only Eliminar option) */}
      <Modal
        visible={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Eliminar Producto"
        showCloseButton
      >
        <View style={{ padding: spacing[4], gap: spacing[4] }}>
          {deleteTarget && (
            <>
              <Text style={{ fontSize: typography.fontSize.base, color: colors.text.secondary }}>
                ¿Eliminar "{deleteTarget.name}"? Esta acción no se puede deshacer.
              </Text>
              <View style={{ flexDirection: 'row', gap: spacing[2] }}>
                <View style={{ flex: 1 }}>
                  <Button
                    title="Cancelar"
                    variant="outline"
                    onPress={() => setDeleteTarget(null)}
                    fullWidth
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    title="Eliminar"
                    variant="primary"
                    leftIcon={<Icon name="trash-2" size={16} color={colors.background} />}
                    onPress={() => deleteMutation.mutate(deleteTarget)}
                    loading={deleteMutation.isPending}
                    fullWidth
                  />
                </View>
              </View>
            </>
          )}
        </View>
      </Modal>
      </View>
    </View>
  );
}

interface ProductCardProps {
  product: Product;
  onEdit: () => void;
  onToggle: () => void;
  onMore: () => void;
  isToggling: boolean;
}

function ProductCard({ product, onEdit, onToggle, onMore, isToggling }: ProductCardProps) {
  const stateVariant: any = product.state === 'active' ? 'success' : product.state === 'archived' ? 'warning' : 'neutral';
  const stateLabel = product.state === 'active' ? 'active' : product.state === 'archived' ? 'archivado' : 'inactive';

  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderRadius: borderRadius.lg,
        borderWidth: 1,
        borderColor: colorScales.gray[200],
        overflow: 'hidden',
      }}
    >
      {/* TOP ROW: image (left) + content-top (title + badge + SKU) */}
      <View
        style={{
          flexDirection: 'row',
          gap: spacing[3],
          padding: spacing[3],
        }}
      >
        {/* Image — 80x80 */}
        <View
          style={{
            width: 80,
            height: 80,
            borderRadius: borderRadius.md,
            backgroundColor: colorScales.gray[100],
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            flexShrink: 0,
          }}
        >
          {product.image_url ? (
            <Image source={{ uri: product.image_url }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
          ) : (
            <Icon name="package" size={30} color={colors.text.muted} />
          )}
        </View>

        {/* Content top: title + state badge + SKU */}
        <View style={{ flex: 1, justifyContent: 'flex-start' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
            <Text
              style={{ fontSize: typography.fontSize.base, fontWeight: '700', color: colors.text.primary, flex: 1 }}
              numberOfLines={1}
            >
              {product.name}
            </Text>
            <Badge label={stateLabel} variant={stateVariant} size="xs" />
          </View>

          <View style={{ marginTop: spacing[2] }}>
            <Text style={{ fontSize: 9, letterSpacing: 1, color: colors.text.muted, textTransform: 'uppercase', fontWeight: '700' }}>
              SKU
            </Text>
            <Text style={{ fontSize: typography.fontSize.sm, color: colors.text.primary, fontWeight: '500', marginTop: 2 }} numberOfLines={1}>
              {product.sku || '—'}
            </Text>
          </View>
        </View>
      </View>

      {/* FULL-WIDTH DIVIDER — traverses the entire card width (under the image) */}
      <View style={{ height: 1, backgroundColor: colorScales.gray[200] }} />

      {/* BOTTOM ROW: PRECIO (bottom-left corner) + 3 action buttons (right) */}
      <View
        style={{
          flexDirection: 'row',
          gap: spacing[3],
          padding: spacing[3],
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        {/* PRECIO block — bottom-left corner */}
        <View>
          <Text style={{ fontSize: 9, letterSpacing: 1, color: colors.text.muted, textTransform: 'uppercase', fontWeight: '700' }}>
            PRECIO
          </Text>
          <Text style={{ fontSize: typography.fontSize.lg, fontWeight: '700', color: colors.text.primary, marginTop: 2 }} numberOfLines={1}>
            {formatCurrency(product.final_price ?? product.base_price)}
          </Text>
        </View>

        {/* 3 action buttons in a horizontal row (right) */}
        <View style={{ flexDirection: 'row', gap: spacing[1] }}>
          {/* Edit (pencil) — blue */}
          <Pressable
            onPress={onEdit}
            hitSlop={6}
            style={({ pressed }) => [
              {
                width: 32,
                height: 32,
                borderRadius: borderRadius.md,
                backgroundColor: colorScales.blue[100],
                alignItems: 'center',
                justifyContent: 'center',
              },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Icon name="pencil" size={15} color={colorScales.blue[600] ?? '#2563EB'} />
          </Pressable>

          {/* Toggle state (power) — orange when active, green when inactive */}
          <Pressable
            onPress={onToggle}
            disabled={isToggling}
            hitSlop={6}
            style={({ pressed }) => [
              {
                width: 32,
                height: 32,
                borderRadius: borderRadius.md,
                backgroundColor: product.state === 'active' ? '#FFEDD5' : colorScales.green[100],
                alignItems: 'center',
                justifyContent: 'center',
              },
              pressed && { opacity: 0.7 },
              isToggling && { opacity: 0.4 },
            ]}
          >
            <Icon
              name={product.state === 'active' ? 'power' : 'zap'}
              size={15}
              color={product.state === 'active' ? '#EA580C' : colorScales.green[700] ?? '#15803D'}
            />
          </Pressable>

          {/* More "..." (3 horizontal dots) — gray → opens Eliminar confirm */}
          <Pressable
            onPress={onMore}
            hitSlop={6}
            style={({ pressed }) => [
              {
                width: 32,
                height: 32,
                borderRadius: borderRadius.md,
                backgroundColor: colorScales.gray[100],
                alignItems: 'center',
                justifyContent: 'center',
              },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Icon name="more-horizontal" size={15} color={colors.text.secondary} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}