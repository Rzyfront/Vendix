/**
 * AnuncioProductsModal — Modal centered-card para elegir productos del anuncio.
 *
 * Replica `app-modal size="lg"` del web
 * (`anuncio-create-wizard-page.component.ts:761-915`).
 *
 * En el MVP, se listan hasta 80 productos activos del store y el usuario
 * toggle-selecciona los que quiere incluir. La búsqueda es client-side
 * (el backend no soporta búsqueda server-side eficiente en este endpoint
 * específico para este flow; la UI lo hace local).
 *
 * Anatomía (Web Visual Pattern):
 *  - Centered card `lg` (maxWidth 640)
 *  - Header: "Agregar productos" + subtitle
 *  - Body: SearchBar (debounceMs 300) + lista scroll max-h 360px
 *  - Footer: outline + primary "Listo" right-aligned
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Modal as RNModal,
  Pressable,
  View,
  Text,
  StyleSheet,
  FlatList,
  Image,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';

import { ProductService } from '@/features/store/services/product.service';
import type { Product } from '@/features/store/types/product.types';

import { Button } from '@/shared/components/button/button';
import { Icon } from '@/shared/components/icon/icon';
import { SearchBar } from '@/shared/components/search-bar/search-bar';
import { Spinner } from '@/shared/components/spinner/spinner';
import { EmptyState } from '@/shared/components/empty-state/empty-state';

import { toastError } from '@/shared/components/toast/toast.store';

import { ANUNCIO_LABELS } from '@/features/store/constants/anuncio-labels';

import { colors, colorScales, spacing, borderRadius, typography } from '@/shared/theme';

export interface AnuncioSelectedProduct {
  id: number;
  name: string;
  sku?: string | null;
  image_url?: string | null;
  product_type?: 'physical' | 'service' | string | null;
}

export interface AnuncioProductsModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: (selected: AnuncioSelectedProduct[]) => void;
  initialSelected?: AnuncioSelectedProduct[];
}

const PRODUCT_LIST_LIMIT = 80;

function toSelected(product: Product): AnuncioSelectedProduct {
  return {
    id: product.id,
    name: product.name,
    sku: product.sku,
    image_url: product.image_url,
    product_type: product.product_type,
  };
}

export function AnuncioProductsModal({
  visible,
  onClose,
  onConfirm,
  initialSelected = [],
}: AnuncioProductsModalProps) {
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(
    new Set(initialSelected.map((p) => p.id)),
  );

  // Reset selection when modal opens
  useEffect(() => {
    if (visible) {
      setSelectedIds(new Set(initialSelected.map((p) => p.id)));
    }
  }, [visible, initialSelected]);

  const { data, isLoading, isError, refetch, error } = useQuery({
    queryKey: ['anuncio-products-picker', visible],
    queryFn: () => ProductService.list({ limit: PRODUCT_LIST_LIMIT }),
    enabled: visible,
  });

  const allProducts = useMemo<Product[]>(() => {
    const raw: unknown = data;
    if (Array.isArray(raw)) return raw as Product[];
    if (raw && typeof raw === 'object' && Array.isArray((raw as { data?: unknown }).data)) {
      return (raw as { data: Product[] }).data;
    }
    if (
      raw &&
      typeof raw === 'object' &&
      Array.isArray((raw as { data?: { data?: unknown } }).data?.data)
    ) {
      return (raw as { data: { data: Product[] } }).data.data;
    }
    return [];
  }, [data]);

  const products = useMemo<Product[]>(() => {
    if (!search.trim()) return allProducts;
    const q = search.toLowerCase();
    return allProducts.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.sku || '').toLowerCase().includes(q),
    );
  }, [allProducts, search]);

  const toggle = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleConfirm = useCallback(() => {
    const selected = allProducts
      .filter((p) => selectedIds.has(p.id))
      .map(toSelected);
    onConfirm(selected);
  }, [allProducts, selectedIds, onConfirm]);

  const errorMessage = (() => {
    const e = error as { response?: { data?: { message?: string } }; message?: string } | null;
    return e?.response?.data?.message || e?.message || ANUNCIO_LABELS.toastErrLoad;
  })();

  return (
    <RNModal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.cardWrapper} onPress={(e) => e.stopPropagation()}>
          <View style={styles.card}>
            <View style={styles.header}>
              <View style={styles.headerText}>
                <Text style={styles.title}>{ANUNCIO_LABELS.modalProductsTitle}</Text>
                <Text style={styles.subtitle}>{ANUNCIO_LABELS.modalProductsSubtitle}</Text>
              </View>
              <Pressable style={styles.closeButton} onPress={onClose}>
                <Icon name="x" size={18} color={colorScales.gray[700]} />
              </Pressable>
            </View>

            <View style={styles.subheader}>
              <View style={styles.subheaderRow}>
                <View style={styles.flex1}>
                  <Text style={styles.subheaderTitle}>
                    {ANUNCIO_LABELS.modalProductsAndServices}
                  </Text>
                  <Text style={styles.subheaderSubtitle}>
                    {ANUNCIO_LABELS.modalProductsSubtitle}
                  </Text>
                </View>
                <View style={styles.countBadge}>
                  <Text style={styles.countBadgeText}>
                    {selectedIds.size} {ANUNCIO_LABELS.chosen}
                  </Text>
                </View>
              </View>
              <View style={styles.searchWrap}>
                <SearchBar
                  value={search}
                  onChangeText={setSearch}
                  placeholder={ANUNCIO_LABELS.ctaSearchProducts}
                  debounceMs={300}
                />
              </View>
            </View>

            <View style={styles.body}>
              {isLoading ? (
                <View style={styles.center}>
                  <Spinner />
                  <View style={styles.loadingRow}>
                    <Icon name="loader-2" size={16} color={colorScales.gray[500]} />
                    <Text style={styles.loadingText}>
                      {ANUNCIO_LABELS.loadingProducts}
                    </Text>
                  </View>
                </View>
              ) : isError ? (
                <EmptyState
                  icon="triangle-alert"
                  title={ANUNCIO_LABELS.emptyNoProductsLoad}
                  description={errorMessage}
                  actionLabel={ANUNCIO_LABELS.ctaRefresh}
                  onAction={() => void refetch()}
                />
              ) : products.length === 0 ? (
                <EmptyState
                  icon="search-x"
                  title={ANUNCIO_LABELS.emptyNoProducts}
                  description={ANUNCIO_LABELS.emptyNoProductsDesc}
                />
              ) : (
                <FlatList
                  data={products}
                  keyExtractor={(item) => String(item.id)}
                  style={styles.list}
                  contentContainerStyle={styles.listContent}
                  renderItem={({ item }) => {
                    const isSelected = selectedIds.has(item.id);
                    return (
                      <Pressable
                        onPress={() => toggle(item.id)}
                        style={({ pressed }) => [
                          styles.productRow,
                          isSelected && styles.productRowSelected,
                          pressed && styles.productRowPressed,
                        ]}
                      >
                        <View style={styles.productAvatar}>
                          {item.image_url ? (
                            <Image
                              source={{ uri: item.image_url }}
                              style={styles.productImage}
                              resizeMode="cover"
                            />
                          ) : (
                            <Icon name="image" size={16} color={colorScales.gray[500]} />
                          )}
                        </View>
                        <View style={styles.flex1}>
                          <Text style={styles.productName} numberOfLines={1}>
                            {item.name}
                          </Text>
                          <Text style={styles.productMeta} numberOfLines={1}>
                            {item.sku ||
                              (item.product_type === 'service' ? 'Servicio' : 'Producto')}
                          </Text>
                        </View>
                        {isSelected ? (
                          <View style={styles.checkIcon}>
                            <Icon name="check" size={14} color={colors.card} />
                          </View>
                        ) : null}
                      </Pressable>
                    );
                  }}
                />
              )}
            </View>

            <View style={styles.footer}>
              <Button
                variant="primary"
                size="md"
                onPress={handleConfirm}
                title={ANUNCIO_LABELS.ctaListo}
              />
            </View>
          </View>
        </Pressable>
      </Pressable>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing[4],
  },
  cardWrapper: {
    width: '100%',
    maxWidth: 640,
    maxHeight: '90%',
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[4],
  },
  headerText: {
    flex: 1,
    gap: spacing[1],
  },
  title: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold as any,
    color: colors.text.primary,
  },
  subtitle: {
    fontSize: typography.fontSize.sm,
    color: colors.text.secondary,
  },
  closeButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.full,
  },
  subheader: {
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[3],
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.cardBorder,
    gap: spacing[3],
  },
  subheaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[3],
  },
  subheaderTitle: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold as any,
    color: colors.text.primary,
  },
  subheaderSubtitle: {
    fontSize: typography.fontSize.sm,
    color: colors.text.secondary,
    marginTop: 2,
  },
  countBadge: {
    backgroundColor: colorScales.gray[100],
    borderRadius: 999,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
  },
  countBadgeText: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold as any,
    color: colors.text.secondary,
  },
  searchWrap: {},
  body: {
    minHeight: 220,
    maxHeight: 400,
    padding: spacing[3],
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  loadingText: {
    fontSize: typography.fontSize.sm,
    color: colors.text.secondary,
  },
  list: {
    flex: 1,
  },
  listContent: {
    gap: spacing[2],
  },
  productRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[3],
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.card,
  },
  productRowSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  productRowPressed: {
    opacity: 0.7,
  },
  productAvatar: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.md,
    backgroundColor: colorScales.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  productImage: {
    width: '100%',
    height: '100%',
  },
  productName: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold as any,
    color: colors.text.primary,
  },
  productMeta: {
    fontSize: typography.fontSize.xs,
    color: colors.text.secondary,
    marginTop: 2,
  },
  checkIcon: {
    width: 28,
    height: 28,
    borderRadius: 999,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex1: {
    flex: 1,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing[2],
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
  },
});
