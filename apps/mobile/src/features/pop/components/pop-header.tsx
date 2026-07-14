import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Icon } from '@/shared/components/icon/icon';
import { borderRadius, colorScales, colors, shadows, spacing, typography } from '@/shared/theme';
import type { PopSupplier, PopLocation, ShippingMethod } from '../types';
import { SHIPPING_METHOD_LABELS } from '../constants';
import PopOrderConfigDropdown from './pop-order-config-dropdown';
import PopOrderConfigModal from './pop-order-config-modal';

interface PopHeaderProps {
  // Config (controlada por el padre, típicamente el cart state).
  supplierName?: string;
  locationName?: string;
  orderDate: string;
  expectedDate?: string;
  shippingMethod?: ShippingMethod;
  // IDs opcionales — se usan para isConfigured (réplica web: !!supplierId && !!locationId).
  selectedSupplierId?: number;
  selectedLocationId?: number;
  // Catálogos.
  suppliers: PopSupplier[];
  locations: PopLocation[];
  // Modal de configuración — controlado por el padre (pop.tsx).
  configModalOpen: boolean;
  onConfigModalOpenChange: (open: boolean) => void;
  // Cambios.
  onSupplierChange: (id?: number, name?: string) => void;
  onLocationChange: (id?: number, name?: string) => void;
  onOrderDateChange: (date: string) => void;
  onExpectedDateChange: (date?: string) => void;
  onShippingMethodChange: (method?: ShippingMethod) => void;
  // Quick-add de catálogo.
  onQuickAddSupplier?: () => void;
  onQuickAddLocation?: () => void;
  // Branding (opcional).
  title?: string;
  badge?: string;
  icon?: string;
}

/**
 * `PopHeader` — barra superior del flujo POP (compra).
 *
 * Réplica 1:1 del web `app-pop-header` + `app-pop-order-config-dropdown` +
 * `app-pop-order-config-modal` en apps/frontend. El componente solo renderiza
 * el título y el dropdown de configuración; el modal se renderiza fuera del
 * header (en el consumidor, `pop.tsx`) para mantener el árbol de modales
 * plano.
 */
export default function PopHeader({
  supplierName,
  locationName,
  orderDate,
  expectedDate,
  shippingMethod,
  selectedSupplierId,
  selectedLocationId,
  suppliers,
  locations,
  configModalOpen,
  onConfigModalOpenChange,
  onSupplierChange,
  onLocationChange,
  onOrderDateChange,
  onExpectedDateChange,
  onShippingMethodChange,
  onQuickAddSupplier,
  onQuickAddLocation,
  title = 'POP',
  badge = 'Compra',
  icon = 'shopping-bag',
}: PopHeaderProps) {
  // Réplica exacta del computed del web:
  //   isConfigured = !!selectedSupplierId && !!selectedLocationId
  const isConfigured =
    !!selectedSupplierId && !!selectedLocationId;

  // Etiqueta legible del método de envío para el panel del dropdown
  // (réplica del computed `shippingLabel` del web).
  const shippingLabel = shippingMethod
    ? SHIPPING_METHOD_LABELS[shippingMethod]
    : '';

  // Etiquetas dd/mm simples, igual que el web (`orderDateLabel`/`expectedDateLabel`
  // son strings pre-formateadas que el padre pasa).
  const orderDateLabel = orderDate ? orderDate.slice(5) : '';
  const expectedDateLabel = expectedDate ? expectedDate.slice(5) : '';

  // El modal vive fuera del header (el consumidor lo renderiza) — este
  // componente solo dispara la apertura/cierre.
  const openConfig = () => onConfigModalOpenChange(true);
  const closeConfig = () => onConfigModalOpenChange(false);

  return (
    <View style={styles.container}>
      <View style={styles.topRow}>
        <View style={styles.titleRow}>
          <Icon name={icon} size={20} color={colorScales.gray[400]} />
          <View style={styles.titleBlock}>
            <View style={styles.titleBadgeRow}>
              <Text style={styles.title}>{title}</Text>
              {badge && (
                <View style={styles.badge}>
                  <Icon name="shopping-bag" size={10} color={colors.primary} />
                  <Text style={styles.badgeText}>{badge}</Text>
                </View>
              )}
            </View>
          </View>
        </View>
        <PopOrderConfigDropdown
          isConfigured={isConfigured}
          supplierName={supplierName}
          locationName={locationName}
          orderDateLabel={orderDateLabel}
          expectedDateLabel={expectedDateLabel}
          shippingLabel={shippingLabel}
          onEdit={openConfig}
        />
      </View>

      {/* El modal de configuración se renderiza aquí (dentro del header)
          pero el parent controla su apertura con `configModalOpen` /
          `onConfigModalOpenChange`. React Native Modal sale a root nativo,
          así que vive aquí sin afectar el layout del header. */}
      <PopOrderConfigModal
        visible={configModalOpen}
        onClose={closeConfig}
        suppliers={suppliers}
        locations={locations}
        selectedSupplierId={selectedSupplierId}
        selectedLocationId={selectedLocationId}
        orderDate={orderDate}
        expectedDate={expectedDate}
        shippingMethod={shippingMethod}
        minExpectedDate={orderDate}
        onSupplierChange={onSupplierChange}
        onLocationChange={onLocationChange}
        onOrderDateChange={onOrderDateChange}
        onExpectedDateChange={onExpectedDateChange}
        onShippingMethodChange={onShippingMethodChange}
        onOpenSupplierModal={onQuickAddSupplier}
        onOpenWarehouseModal={onQuickAddLocation}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 6,
    backgroundColor: colors.card,
    borderTopLeftRadius: borderRadius.lg,
    borderTopRightRadius: borderRadius.lg,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: colorScales.gray[200],
    borderBottomWidth: 0,
    ...shadows.sm,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexShrink: 1,
    minWidth: 0,
  },
  titleBlock: {},
  titleBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  title: {
    fontSize: typography.fontSize.sm,
    fontWeight: '800',
    color: colorScales.gray[900],
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colorScales.green[50],
    borderWidth: 1,
    borderColor: colorScales.green[100],
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: borderRadius.md,
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: colors.primary,
  },
});