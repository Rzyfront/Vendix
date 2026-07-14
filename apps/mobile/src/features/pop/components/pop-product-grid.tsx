import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  StyleSheet,
  useWindowDimensions,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { PopProduct } from '../types';
import PopActionsDropdown from './pop-actions-dropdown';
import { Icon } from '@/shared/components/icon/icon';
import { borderRadius, colorScales, colors, shadows, spacing, typography } from '@/shared/theme';

interface PopProductGridProps {
  products: PopProduct[];
  loading?: boolean;
  onSelectProduct: (product: PopProduct) => void;
  onScanInvoice: () => void;
  onNewProduct: () => void;
  onBulkUpload: () => void;
  locationName?: string;
}

const CARD_GAP = 8;
// Layout responsive: 2 columnas en mobile (<600px), 3 en tablet+.
// Usamos flexBasis con porcentaje compensado para el gap (mimic CSS grid).
// El cálculo se hace dentro del componente con useWindowDimensions() para
// que se actualice ante rotaciones o cambios de layout.
const TABLET_BREAKPOINT = 600;   // px — a partir de aquí usamos 3 columnas

// Porcentajes compensados para el gap entre cards (8px).
// 2 cols: 50% - 4px ≈ 48% (deja 4% libre + 8px gap → 2 cards + gap caben en 100%+).
// 3 cols: 33.33% - 5.33px ≈ 31% (deja ~7% libre + 16px gap → 3 cards + 2 gaps caben).
// Esto evita los problemas de box-sizing en RN Web donde border/padding se suman al width.
const CARD_WIDTH_2COL = '48%';
const CARD_WIDTH_3COL = '31%';

export default function PopProductGrid({
  products,
  loading,
  onSelectProduct,
  onScanInvoice,
  onNewProduct,
  onBulkUpload,
  locationName,
}: PopProductGridProps) {
  const { width: SCREEN_WIDTH } = useWindowDimensions();
  // 2 columnas en mobile portrait, 3 en tablet+ / mobile landscape.
  const NUM_COLUMNS = SCREEN_WIDTH >= TABLET_BREAKPOINT ? 3 : 2;
  const CARD_WIDTH = NUM_COLUMNS === 3 ? CARD_WIDTH_3COL : CARD_WIDTH_2COL;
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return products;
    const q = search.toLowerCase();
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.sku?.toLowerCase().includes(q) ||
        // `p.code` puede ser undefined si el backend no lo devuelve
        // (p.ej. productos prebulk sin persistir). Optional chaining evita
        // crash en `undefined.toLowerCase()`.
        (typeof p.code === 'string' && p.code.toLowerCase().includes(q))
    );
  }, [products, search]);

  function renderProduct(item: PopProduct) {
    const stock = item.total_stock_available ?? item.stock ?? 0;
    const isWeight = item.pricing_type === 'weight';

    return (
      <TouchableOpacity
        key={item.id}
        style={[styles.card, { width: CARD_WIDTH }]}
        onPress={() => onSelectProduct(item)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`Agregar ${item.name}`}
        accessibilityHint="Abre el detalle del producto para anadirlo al carrito"
      >
        <View style={styles.imageWrap}>
          {item.image_url ? (
            <Image source={{ uri: item.image_url }} style={styles.image} />
          ) : (
            <View style={styles.imagePlaceholder}>
              <Ionicons name="image-outline" size={28} color="#86efac" />
            </View>
          )}
          <View
            style={[
              styles.stockBadge,
              stock <= 0
                ? styles.stockBgError
                : stock <= 10
                ? styles.stockBgWarning
                : styles.stockBgSuccess,
            ]}
          >
            <Text
              style={[
                styles.stockBadgeText,
                stock <= 0
                  ? styles.stockTextError
                  : stock <= 10
                  ? styles.stockTextWarning
                  : styles.stockTextSuccess,
              ]}
            >
              {stock}
            </Text>
          </View>
        </View>
        <View style={styles.cardBody}>
          <Text style={styles.productName} numberOfLines={2}>{item.name}</Text>
          <View style={styles.skuRow}>
            {item.sku ? (
              <Text style={styles.sku} numberOfLines={1}>{item.sku}</Text>
            ) : null}
            {isWeight && (
              <View style={styles.pesoBadge}>
                <Text style={styles.pesoBadgeText}>Peso</Text>
              </View>
            )}
          </View>
          <View style={styles.cardFooter}>
            <Text style={styles.price}>
              ${Number(item.cost_price ?? item.cost ?? 0).toLocaleString()}
            </Text>
            <View style={styles.addBtn}>
              <Ionicons name="add" size={14} color="#22C55E" />
            </View>
          </View>
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.container}>
      {/* Sticky products header */}
      <View style={styles.stickyHeader}>
        <View style={styles.searchRow}>
          <View style={styles.searchBox}>
            <Ionicons name="search" size={16} color="#9ca3af" style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              value={search}
              onChangeText={setSearch}
              placeholder="Buscar productos..."
              placeholderTextColor="#9ca3af"
            />
            {search ? (
              <TouchableOpacity onPress={() => setSearch('')}>
                <Ionicons name="close-circle" size={16} color="#9ca3af" />
              </TouchableOpacity>
            ) : null}
          </View>
          <PopActionsDropdown
            onScanInvoice={onScanInvoice}
            onNewProduct={onNewProduct}
            onBulkUpload={onBulkUpload}
          />
        </View>
      </View>

      {/* Product grid */}
      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator size="large" color="#22C55E" />
          <Text style={styles.centerText}>Cargando productos...</Text>
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.centerState}>
          <View style={styles.emptyIcon}>
            <Ionicons name="cube-outline" size={32} color="#9ca3af" />
          </View>
          <Text style={styles.centerTitle}>No se encontraron productos</Text>
          <Text style={styles.centerHint}>Intenta buscar con otros términos</Text>
        </View>
      ) : (
        <View style={styles.grid}>
          {filtered.map((item) => renderProduct(item))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Contenedor principal — color card (blanco puro) con espacio lateral
  container: {
    flex: 1,
    marginHorizontal: 6,
    backgroundColor: colors.card,
    borderBottomLeftRadius: borderRadius.lg,
    borderBottomRightRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    ...shadows.sm,
  },
  stickyHeader: {
    paddingHorizontal: 6,
    paddingTop: 6,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[200],
    backgroundColor: colors.card,
  },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3],
    height: 44,
  },
  searchIcon: { marginRight: spacing[2] },
  searchInput: {
    flex: 1,
    color: colorScales.gray[900],
    fontSize: typography.fontSize.base,
    fontFamily: typography.fontFamily,
    paddingVertical: 0,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-start', gap: CARD_GAP, padding: 12, paddingBottom: 24 },
  card: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.lg,
    marginBottom: spacing[2],
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    overflow: 'hidden',
    ...shadows.sm,
  },
  imageWrap: { aspectRatio: 1, backgroundColor: colorScales.gray[100], position: 'relative' },
  image: { width: '100%', height: '100%', resizeMode: 'cover' },
  imagePlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colorScales.gray[100] },
  stockBadge: { position: 'absolute', top: 6, right: 6, paddingHorizontal: 6, paddingVertical: 2, borderRadius: borderRadius.md, borderWidth: 1 },
  stockBgSuccess: { backgroundColor: colorScales.green[50], borderColor: colorScales.green[200] },
  stockBgWarning: { backgroundColor: colorScales.amber[50], borderColor: colorScales.amber[200] },
  stockBgError: { backgroundColor: colorScales.red[50], borderColor: colorScales.red[200] },
  stockBadgeText: { fontSize: 10, fontWeight: '800' },
  stockTextSuccess: { color: colorScales.green[800] },
  stockTextWarning: { color: colorScales.amber[800] },
  stockTextError: { color: colorScales.red[700] },
  cardBody: { padding: spacing[2.5] },
  productName: { fontSize: 12, fontWeight: '600', color: colorScales.gray[900], minHeight: 30, lineHeight: 15 },
  skuRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2, marginBottom: 6 },
  sku: { fontSize: 10, color: colorScales.gray[500], fontFamily: 'monospace', flex: 1 },
  pesoBadge: { backgroundColor: colorScales.blue[50], paddingHorizontal: 4, paddingVertical: 1, borderRadius: 3 },
  pesoBadgeText: { fontSize: 9, fontWeight: '700', color: colorScales.blue[700] },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  price: { fontSize: 13, fontWeight: '700', color: colorScales.green[700] },
  addBtn: { width: 24, height: 24, borderRadius: 12, backgroundColor: colorScales.green[100], alignItems: 'center', justifyContent: 'center' },
  centerState: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },
  centerText: { fontSize: 13, color: colorScales.gray[500], marginTop: spacing[2] },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: colorScales.gray[100], alignItems: 'center', justifyContent: 'center', marginBottom: spacing[3] },
  centerTitle: { fontSize: 15, fontWeight: '700', color: colorScales.gray[900], marginBottom: spacing[1.5] },
  centerHint: { fontSize: 13, color: colorScales.gray[500] },
});
