import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
  Text,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  SearchBar,
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
import { BulkUploadModal } from '@/features/store/components/bulk-upload-modal';
import { BulkImageUploadModal } from '@/features/store/components/bulk-image-upload-modal';
import { ProductQuickCreateModal } from '@/features/store/components/product-quick-create-modal';
import { downloadCurrentProducts } from '@/features/store/utils/xlsx';
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
  const [actionsOpen, setActionsOpen] = useState(false);
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [bulkUploadOpen, setBulkUploadOpen] = useState(false);
  const [bulkImageOpen, setBulkImageOpen] = useState(false);

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

  async function downloadCurrentProductsTemplate() {
    try {
      const res = await ProductService.list({ page: 1, limit: 1000, include_variants: false });
      const allProducts: Product[] = res.data ?? [];
      await downloadCurrentProducts(allProducts);
      toastSuccess(`Plantilla con ${allProducts.length} productos descargada`);
    } catch (err) {
      toastError('No se pudo generar la plantilla');
    }
  }

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
      <View style={{ paddingTop: spacing[4], paddingHorizontal: spacing[4], gap: spacing[2] }}>
        <StatsGrid
          items={[
            { label: 'Productos totales', value: stats?.total_products ?? 0, description: 'Catálogo completo', icon: <Icon name="package" size={14} color={colors.primary} />, iconBg: colors.primaryLight, iconColor: colors.primary },
            { label: 'Productos activos', value: stats?.active_products ?? 0, description: 'Disponibles para venta', icon: <Icon name="check-circle" size={14} color={colors.success} />, iconBg: '#DCFCE7', iconColor: colors.success },
            { label: 'Categorías', value: stats?.categories_count ?? 0, description: 'En uso', icon: <Icon name="tag" size={14} color={colors.text.secondary} />, iconBg: colorScales.gray[100], iconColor: colors.text.secondary },
            { label: 'Marcas', value: stats?.brands_count ?? 0, description: 'Registradas', icon: <Icon name="building-2" size={14} color={colors.warning} />, iconBg: '#FEF3C7', iconColor: colors.warning },
          ]}
        />

        {/* Header: "Productos (N)" label */}
        <View style={{ marginTop: spacing[2] }}>
          <Text style={{ fontSize: typography.fontSize.lg, fontWeight: '700', color: colors.text.primary }}>
            Productos ({total})
          </Text>
        </View>

        {/* Search row: SearchBar + Actions (+) + Filtros */}
        <View style={{ flexDirection: 'row', gap: spacing[2], alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <SearchBar
              placeholder="Buscar productos..."
              value={search}
              onChangeText={handleSearch}
              debounceMs={400}
              style={{
                backgroundColor: colors.inputBg,
                borderWidth: 1,
                borderColor: colorScales.gray[200],
                height: 40,
              }}
            />
          </View>
          {/* + Acciones — mismo estilo que en inventario/movimientos: 40x40, blanco, borde verde 1.5px */}
          <View style={styles.actionsBtnContainer}>
            <Pressable
              onPress={() => setActionsOpen(true)}
              hitSlop={6}
              style={({ pressed }) => [
                {
                  width: 40,
                  height: 40,
                  borderRadius: borderRadius.lg,
                  backgroundColor: colors.background,
                  borderWidth: 1.5,
                  borderColor: colors.primary,
                  alignItems: 'center',
                  justifyContent: 'center',
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 1 },
                  shadowOpacity: 0.04,
                  shadowRadius: 3,
                  elevation: 1,
                },
                pressed && { opacity: 0.7 },
              ]}
            >
              <Icon name="plus" size={20} color={colors.primary} />
            </Pressable>
            {/* Popover anclado debajo del + (mismo nivel que el botón) */}
            {actionsOpen && (
              <>
                <Pressable
                  style={styles.popoverBackdrop}
                  onPress={() => setActionsOpen(false)}
                />
                <View style={styles.actionsPopoverAnchor}>
                  <View style={styles.popover}>
                    <View style={styles.popoverHeader}>
                      <Text style={styles.popoverTitle}>Acciones</Text>
                    </View>
                    <ActionItem
                      icon="plus"
                      label="Nuevo producto"
                      primary
                      onPress={() => { setActionsOpen(false); setQuickCreateOpen(true); }}
                    />
                    <ActionItem
                      icon="upload"
                      label="Carga masiva"
                      onPress={() => { setActionsOpen(false); setBulkUploadOpen(true); }}
                    />
                    <ActionItem
                      icon="image"
                      label="Carga de imágenes"
                      onPress={() => { setActionsOpen(false); setBulkImageOpen(true); }}
                    />
                    <ActionItem
                      icon="file-spreadsheet"
                      label="Descargar plantilla de productos actuales"
                      onPress={() => { setActionsOpen(false); downloadCurrentProductsTemplate(); }}
                      isLast
                    />
                  </View>
                </View>
              </>
            )}
          </View>
          {/* Filtros — popover anclado al botón (estilo transfers.tsx) */}
          <View style={styles.filtersBtnContainer}>
            <Pressable
              onPress={() => setFiltersOpen(!filtersOpen)}
              hitSlop={6}
              style={({ pressed }) => [
                {
                  width: 40,
                  height: 40,
                  borderRadius: borderRadius.lg,
                  backgroundColor: colors.background,
                  borderWidth: 1.5,
                  borderColor: colors.primary,
                  alignItems: 'center',
                  justifyContent: 'center',
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 1 },
                  shadowOpacity: 0.04,
                  shadowRadius: 3,
                  elevation: 1,
                },
                pressed && { opacity: 0.7 },
              ]}
            >
              <Icon name="filter" size={18} color={colors.primary} />
            </Pressable>

            {filtersOpen && (
              <>
                <Pressable
                  style={styles.popoverBackdrop}
                  onPress={() => setFiltersOpen(false)}
                />
                <View style={styles.filtersPopoverAnchor}>
                  <View style={styles.filterPopup}>
                    <View style={styles.filterPopupHeader}>
                      <Text style={styles.filterPopupTitle}>Filtros</Text>
                    </View>
                    <View style={styles.filterPopupBody}>
                      <FilterSelect
                        label="Estado"
                        value={stateFilter ?? 'all'}
                        options={[
                          { label: 'Todos', value: 'all' },
                          { label: 'Activos', value: 'active' },
                          { label: 'Inactivos', value: 'inactive' },
                          { label: 'Archivados', value: 'archived' },
                        ]}
                        onChange={(v) => { setStateFilter(v === 'all' ? undefined : (v as ProductState)); setPage(1); }}
                      />
                      <FilterSelect
                        label="Tipo"
                        value={typeFilter ?? 'all'}
                        options={[
                          { label: 'Todos', value: 'all' },
                          { label: 'Físico', value: 'physical' },
                          { label: 'Servicio', value: 'service' },
                        ]}
                        onChange={(v) => { setTypeFilter(v === 'all' ? undefined : (v as ProductType)); setPage(1); }}
                      />
                      <FilterSelect
                        label="Categoría"
                        value={categoryFilter ? String(categoryFilter) : 'all'}
                        options={[
                          { label: 'Todas', value: 'all' },
                          ...categories.slice(0, 8).map((c) => ({ label: c.name, value: String(c.id) })),
                        ]}
                        onChange={(v) => { setCategoryFilter(v === 'all' ? undefined : Number(v)); setPage(1); }}
                      />
                      <FilterSelect
                        label="Marca"
                        value={brandFilter ? String(brandFilter) : 'all'}
                        options={[
                          { label: 'Todas', value: 'all' },
                          ...brands.slice(0, 8).map((b) => ({ label: b.name, value: String(b.id) })),
                        ]}
                        onChange={(v) => { setBrandFilter(v === 'all' ? undefined : Number(v)); setPage(1); }}
                      />
                    </View>
                  </View>
                </View>
              </>
            )}
          </View>
        </View>
      </View>

      {/* Filtros removidos — el usuario quiere solo la lista del popover de acciones */}

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
        <Fab icon="plus" accessibilityLabel="Nuevo producto" onPress={() => setQuickCreateOpen(true)} />
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

      {/* Actions popover — único, renderizado dentro del actionsBtnContainer (línea ~222) */}

      {/* Actions popover — único, renderizado dentro del actionsBtnContainer (línea ~222) */}

      {/* Filtros removidos — ahora es un popover anclado al botón (renderizado dentro del filtersBtnContainer) */}

      {/* Bulk upload modal (Carga masiva) */}
      <BulkUploadModal visible={bulkUploadOpen} onClose={() => setBulkUploadOpen(false)} />
      <BulkImageUploadModal visible={bulkImageOpen} onClose={() => setBulkImageOpen(false)} />

      {/* Quick-create modal — se abre desde + Acciones → Nuevo producto o desde el FAB */}
      <ProductQuickCreateModal
        visible={quickCreateOpen}
        onClose={() => setQuickCreateOpen(false)}
        onCreated={(productId) => {
          queryClient.invalidateQueries({ queryKey: ['products'] });
          queryClient.invalidateQueries({ queryKey: ['product-stats'] });
          router.push(`/(store-admin)/products/${productId}/edit`);
        }}
      />
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

interface FilterSelectProps {
  label: string;
  value: string;
  options: { label: string; value: string }[];
  onChange: (value: string) => void;
}

function FilterSelect({ label, value, options, onChange }: FilterSelectProps) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  return (
    <View style={{ marginBottom: spacing[2] }}>
      <Text style={{ fontSize: 10, fontWeight: '700', color: colorScales.gray[700], textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing[1] }}>
        {label}
      </Text>
      <Pressable
        onPress={() => setOpen(!open)}
        style={({ pressed }) => [
          {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingVertical: spacing[2.5],
            paddingHorizontal: spacing[3],
            borderRadius: borderRadius.lg,
            borderWidth: 1,
            borderColor: colorScales.gray[300],
            backgroundColor: colors.background,
          },
          pressed && { opacity: 0.7 },
        ]}
      >
        <Text style={{ fontSize: typography.fontSize.sm, fontWeight: '500', color: colorScales.gray[800], flex: 1 }}>
          {selected?.label ?? 'Todos'}
        </Text>
        <Icon
          name={open ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={colorScales.gray[500]}
        />
      </Pressable>
      {open && (
        <View style={{ borderWidth: 1, borderColor: colorScales.gray[200], borderRadius: borderRadius.lg, backgroundColor: colors.background, overflow: 'hidden', marginTop: spacing[1] }}>
          {options.map((opt, index) => {
            const isActive = opt.value === value;
            return (
              <Pressable
                key={`${label}-${opt.value}`}
                onPress={() => { onChange(opt.value); setOpen(false); }}
                style={({ pressed }) => [
                  {
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingVertical: spacing[2.5],
                    paddingHorizontal: spacing[3],
                    borderBottomWidth: index < options.length - 1 ? 1 : 0,
                    borderBottomColor: colorScales.gray[100],
                    backgroundColor: isActive ? colorScales.green[50] : 'transparent',
                  },
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Text style={{ fontSize: typography.fontSize.sm, color: colorScales.gray[700], fontWeight: isActive ? '700' : '500' }}>
                  {opt.label}
                </Text>
                {isActive && <Icon name="check" size={16} color={colors.primary} />}
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

interface ActionItemProps {
  icon: string;
  label: string;
  description?: string;
  onPress: () => void;
  isLast?: boolean;
  primary?: boolean;
}

function ActionItem({ icon, label, description, onPress, isLast, primary }: ActionItemProps) {
  return (
    <>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          {
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing[2],
            paddingVertical: spacing[2.5],
            paddingHorizontal: spacing[3],
          },
          pressed && { backgroundColor: colorScales.gray[50] },
        ]}
      >
        <View
          style={{
            width: 28,
            height: 28,
            borderRadius: 6,
            backgroundColor: primary ? colors.primaryLight : colorScales.gray[100],
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name={icon} size={18} color={primary ? colors.primary : colorScales.gray[500]} />
        </View>
        <View style={{ flex: 1 }}>
          <Text
            style={{
              fontSize: typography.fontSize.sm,
              fontWeight: primary ? typography.fontWeight.bold : typography.fontWeight.medium,
              color: primary ? colors.primary : colorScales.gray[700],
              fontFamily: typography.fontFamily,
            }}
            numberOfLines={2}
          >
            {label}
          </Text>
          {description && (
            <Text
              style={{ fontSize: typography.fontSize.xs, color: colors.text.secondary, marginTop: 2, fontFamily: typography.fontFamily }}
              numberOfLines={2}
            >
              {description}
            </Text>
          )}
        </View>
      </Pressable>
      {!isLast && <View style={{ height: 1, backgroundColor: colorScales.gray[100] }} />}
    </>
  );
}

const styles = StyleSheet.create({
  popoverBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.15)',
    zIndex: 90,
  },
  actionsBtnContainer: {
    position: 'relative',
  },
  actionsPopoverAnchor: {
    position: 'absolute',
    top: 48,
    right: 0,
    zIndex: 100,
  },
  filtersBtnContainer: {
    position: 'relative',
  },
  filtersPopoverAnchor: {
    position: 'absolute',
    top: 48,
    right: 0,
    zIndex: 100,
  },
  popover: {
    minWidth: 240,
    backgroundColor: colors.background,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    paddingVertical: spacing[1],
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 8,
  },
  popoverHeader: {
    paddingHorizontal: spacing[3],
    paddingTop: spacing[2],
    paddingBottom: spacing[1],
  },
  popoverTitle: {
    fontSize: typography.fontSize.xs,
    fontWeight: '700',
    color: colors.text.muted,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  filterPopupHeader: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
    paddingBottom: spacing[2],
  },
  filterPopupTitle: {
    fontSize: typography.fontSize.base,
    fontWeight: '700' as any,
    color: colorScales.gray[900],
  },
  filterPopupBody: {
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[3],
    gap: spacing[2],
  },
  filterPopup: {
    width: 240,
    backgroundColor: colors.background,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    paddingVertical: spacing[1],
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 8,
  },
});