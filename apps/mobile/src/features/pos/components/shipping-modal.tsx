import React from 'react';
import { View, Text, Pressable, FlatList, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { colors, colorScales, spacing, typography, borderRadius } from '@/shared/theme';
import { Icon } from '@/shared/components/icon/icon';
import { Spinner } from '@/shared/components/spinner/spinner';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { BottomSheet } from '@/shared/components/bottom-sheet/bottom-sheet';
import { formatCurrency } from '@/shared/utils/currency';
import { ShippingService } from '@/features/store/services';
import type { StoreShippingMethod } from '@/features/store/services';

interface ShippingModalProps {
  visible: boolean;
  onClose: () => void;
  onSelectShipping: (method: StoreShippingMethod) => void;
}

export function ShippingModal({ visible, onClose, onSelectShipping }: ShippingModalProps) {
  const { data: shippingMethods, isLoading } = useQuery({
    queryKey: ['pos-shipping-methods'],
    queryFn: () => ShippingService.list(),
    enabled: visible,
  });

  const enabledMethods = (shippingMethods || []).filter((m) => m.is_enabled);

  return (
    <BottomSheet visible={visible} onClose={onClose} snapPoint="partial">
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Método de envío</Text>
          <Pressable onPress={onClose} style={styles.closeBtn}>
            <Icon name="x" size={24} color={colorScales.gray[500]} />
          </Pressable>
        </View>

        {isLoading ? (
          <View style={styles.centerContent}>
            <Spinner />
          </View>
        ) : enabledMethods.length === 0 ? (
          <EmptyState
            title="Sin métodos de envío"
            description="No hay métodos de envío configurados"
            icon="truck"
          />
        ) : (
          <FlatList
            data={enabledMethods}
            keyExtractor={(item) => item.id.toString()}
            style={styles.list}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => onSelectShipping(item)}
                style={({ pressed }) => [
                  styles.methodRow,
                  pressed && { backgroundColor: colorScales.gray[50] },
                ]}
              >
                <View style={styles.methodIcon}>
                  <Icon name="truck" size={20} color={colors.primary} />
                </View>
                <View style={styles.methodInfo}>
                  <Text style={styles.methodName}>{item.name}</Text>
                  {item.description && (
                    <Text style={styles.methodDesc} numberOfLines={1}>
                      {item.description}
                    </Text>
                  )}
                  <Text style={styles.methodTime}>
                    {item.processing_time_days} día(s)
                  </Text>
                </View>
                <View style={styles.methodPrice}>
                  <Text style={styles.priceText}>
                    {formatCurrency(item.price)}
                  </Text>
                </View>
              </Pressable>
            )}
          />
        )}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: spacing[4],
    paddingTop: spacing[2],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing[4],
  },
  title: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  closeBtn: {
    padding: spacing[1],
  },
  centerContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[8],
  },
  list: {
    flex: 1,
  },
  methodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  methodIcon: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.lg,
    backgroundColor: colorScales.green[100],
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing[3],
  },
  methodInfo: {
    flex: 1,
    marginRight: spacing[2],
  },
  methodName: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  methodDesc: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
    marginTop: 2,
  },
  methodTime: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[400],
    marginTop: 2,
  },
  methodPrice: {
    alignItems: 'flex-end',
  },
  priceText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: colors.primary,
  },
});
