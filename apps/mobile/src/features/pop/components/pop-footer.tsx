import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { PopCartSummary } from '../types';

interface PopFooterProps {
  summary: PopCartSummary;
  itemCount: number;
  onOpenCart: () => void;
  isLoading?: boolean;
}

export default function PopFooter({
  summary,
  itemCount,
  onOpenCart,
  isLoading,
}: PopFooterProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      <View style={styles.left}>
        <View style={styles.cartIcon}>
          <Ionicons name="cart-outline" size={20} color="#22C55E" />
          {itemCount > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{itemCount}</Text>
            </View>
          )}
        </View>
        <View style={styles.info}>
          <Text style={styles.title}>Orden de Compra</Text>
          {itemCount > 0 && (
            <Text style={styles.count}>
              {itemCount} {itemCount === 1 ? 'producto' : 'productos'}
            </Text>
          )}
        </View>
      </View>
      {itemCount > 0 && (
        <View style={styles.right}>
          <Text style={styles.total}>${summary.total.toLocaleString()}</Text>
          <TouchableOpacity style={styles.btn} onPress={onOpenCart} disabled={isLoading}>
            <Text style={styles.btnText}>
              {isLoading ? 'Cargando...' : 'Ver orden'}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  cartIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#dcfce7',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#22C55E',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
  },
  info: {},
  title: {
    fontSize: 13,
    fontWeight: '600',
    color: '#111827',
  },
  count: {
    fontSize: 11,
    color: '#6b7280',
    marginTop: 1,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  total: {
    fontSize: 15,
    fontWeight: '700',
    color: '#22C55E',
  },
  btn: {
    backgroundColor: '#22C55E',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  btnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
  },
});
