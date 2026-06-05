import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  StyleSheet,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { PopProduct } from '../types';
import PopActionsDropdown from './pop-actions-dropdown';
import { Icon } from '@/shared/components/icon/icon';
import { colors, colorScales } from '@/shared/theme/colors';

interface PopProductGridProps {
  products: PopProduct[];
  loading?: boolean;
  onSelectProduct: (product: PopProduct) => void;
  onScanInvoice: () => void;
  onNewProduct: () => void;
  onBulkUpload: () => void;
  locationName?: string;
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_GAP = 8;
const PADDING = 16;
const CARD_WIDTH = (SCREEN_WIDTH - PADDING * 2 - CARD_GAP) / 2;

export default function PopProductGrid({
  products,
  loading,
  onSelectProduct,
  onScanInvoice,
  onNewProduct,
  onBulkUpload,
  locationName,
}: PopProductGridProps) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return products;
    const q = search.toLowerCase();
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.sku?.toLowerCase().includes(q) ||
        p.code?.toLowerCase().includes(q)
    );
  }, [products, search]);

  function renderProduct(item: PopProduct) {
    const stock = item.total_stock_available ?? item.stock ?? 0;
    const isWeight = item.pricing_type === 'weight';

    return (
      <TouchableOpacity
        key={item.id}
        style={styles.card}
        onPress={() => onSelectProduct(item)}
        activeOpacity={0.7}
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
        {locationName ? (
          <View style={styles.warehouseBadge}>
            <Icon name="warehouse" size={14} color="#059669" />
            <Text style={styles.warehouseBadgeText} numberOfLines={1}>{locationName}</Text>
          </View>
        ) : null}
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
  container: { flex: 1, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e5e7eb' },
  stickyHeader: {
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8,
    borderBottomWidth: 1, borderBottomColor: '#e5e7eb',
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  searchBox: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: '#f3f4f6', borderRadius: 8, paddingHorizontal: 10, height: 36 },
  searchIcon: { marginRight: 6 },
  searchInput: { flex: 1, fontSize: 13, color: '#111827', paddingVertical: 0 },
  warehouseBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: 'rgba(5,150,105,0.1)', borderRadius: 20, alignSelf: 'flex-start' },
  warehouseBadgeText: { fontSize: 11, fontWeight: '600', color: '#059669', maxWidth: 120 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: CARD_GAP, padding: 12, paddingBottom: 24 },
  card: {
    width: CARD_WIDTH,
    backgroundColor: '#fff',
    borderRadius: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    overflow: 'hidden',
  },
  imageWrap: { aspectRatio: 1, backgroundColor: 'linear-gradient(135deg, #f9fafb, #f3f4f6)', position: 'relative' },
  image: { width: '100%', height: '100%', resizeMode: 'cover' },
  imagePlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f3f4f6' },
  stockBadge: { position: 'absolute', top: 6, right: 6, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, borderWidth: 1 },
  stockBgSuccess: { backgroundColor: '#d1fae5', borderColor: '#a7f3d0' },
  stockBgWarning: { backgroundColor: '#fef3c7', borderColor: '#fde68a' },
  stockBgError: { backgroundColor: '#fee2e2', borderColor: '#fecaca' },
  stockBadgeText: { fontSize: 10, fontWeight: '800' },
  stockTextSuccess: { color: '#065f46' },
  stockTextWarning: { color: '#92400e' },
  stockTextError: { color: '#dc2626' },
  cardBody: { padding: 10 },
  productName: { fontSize: 12, fontWeight: '600', color: '#111827', minHeight: 30, lineHeight: 15 },
  skuRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2, marginBottom: 6 },
  sku: { fontSize: 10, color: '#6b7280', fontFamily: 'monospace', flex: 1 },
  pesoBadge: { backgroundColor: '#eff6ff', paddingHorizontal: 4, paddingVertical: 1, borderRadius: 3 },
  pesoBadgeText: { fontSize: 9, fontWeight: '700', color: '#2563eb' },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  price: { fontSize: 13, fontWeight: '700', color: '#059669' },
  addBtn: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#dcfce7', alignItems: 'center', justifyContent: 'center' },
  centerState: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },
  centerText: { fontSize: 13, color: '#6b7280', marginTop: 8 },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#f3f4f6', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  centerTitle: { fontSize: 15, fontWeight: '700', color: '#111827', marginBottom: 6 },
  centerHint: { fontSize: 13, color: '#6b7280' },
});
