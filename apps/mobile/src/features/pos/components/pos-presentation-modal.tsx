/**
 * Selector de PRESENTACIÓN de venta (QUI-648).
 *
 * Un producto puede venderse suelto o en presentaciones (`price_tiers.kind =
 * 'sale_unit'`): "Bulto x50", "Caja x12", "Rollo". Elegir entre varias es una
 * capacidad exclusiva del POS — la tienda online usa la marcada por defecto y
 * no expone selector.
 *
 * Lo que cambia al elegir una presentación:
 *   - `quantity` de la línea cuenta PAQUETES, no unidades de stock.
 *   - `unit_price` es el precio del PAQUETE COMPLETO.
 *   - el inventario descuenta `quantity × packSize` (`stock_units_consumed`),
 *     que el backend re-resuelve desde `applied_price_tier_id`.
 *
 * La lista que recibe ya viene filtrada por `resolveSaleUnitPresentations`
 * contra `product.enabled_price_tier_ids` — el allowlist duro del par
 * (producto, presentación). Ofrecer algo fuera de esa lista haría que el
 * backend rechazara la venta con `PRICE_TIER_NOT_ALLOWED`.
 */
import React from 'react';
import { View, Text, Pressable, FlatList, StyleSheet } from 'react-native';
import { colors, colorScales, spacing, typography } from '@/shared/theme';
import { Icon } from '@/shared/components/icon/icon';
import { Spinner } from '@/shared/components/spinner/spinner';
import { formatCurrency } from '@/shared/utils/currency';
import type { Product } from '@/features/store/types';
import type { SaleUnitPresentation } from '@/features/store/pricing';

interface PosPresentationModalProps {
  visible: boolean;
  product: Product | null;
  presentations: SaleUnitPresentation[];
  loading?: boolean;
  /** `null` = vender suelto, con la aritmética por unidad de stock. */
  onSelect: (presentation: SaleUnitPresentation | null) => void;
  onClose: () => void;
}

/** Etiqueta de la unidad de stock, para que "x50" diga x50 QUÉ. */
function stockUnitLabel(product: Product | null): string {
  return product?.stock_uom?.code || 'unid';
}

/**
 * Precio del producto suelto, en la escala en la que se publica.
 * "$5.000 por metro" se muestra tal cual, no como "$5 por mm".
 */
function looseLabel(product: Product): string {
  const scale = Number(product.price_unit_quantity ?? 1);
  const price = formatCurrency(Number(product.final_price ?? product.base_price ?? 0));
  const unit = stockUnitLabel(product);
  return scale > 1 ? `${price} por ${scale} ${unit}` : `${price} por ${unit}`;
}

export function PosPresentationModal({
  visible,
  product,
  presentations,
  loading = false,
  onSelect,
  onClose,
}: PosPresentationModalProps) {
  if (!visible || !product) return null;

  const unit = stockUnitLabel(product);

  return (
    <View style={styles.backdrop} pointerEvents="auto">
      <Pressable style={styles.backdropLayer} onPress={onClose} />
      <View style={styles.content}>
        <View style={styles.header}>
          <View style={styles.flex1}>
            <Text style={styles.title}>¿En qué presentación?</Text>
            <Text style={styles.subtitle} numberOfLines={1}>
              {product.name}
            </Text>
          </View>
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.7 }]}
            accessibilityRole="button"
            accessibilityLabel="Cerrar selector de presentación"
          >
            <Icon name="x" size={18} color={colorScales.gray[500]} />
          </Pressable>
        </View>

        {loading ? (
          <View style={styles.loadingBox}>
            <Spinner />
          </View>
        ) : (
          <FlatList
            data={presentations}
            keyExtractor={(item) => String(item.tierId)}
            contentContainerStyle={styles.listContent}
            ListHeaderComponent={
              // Vender suelto es SIEMPRE una opción: la presentación es una
              // forma extra de vender el mismo producto, no un reemplazo.
              <Pressable
                onPress={() => onSelect(null)}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              >
                <View style={styles.iconBox}>
                  <Icon name="package" size={20} color={colorScales.gray[500]} />
                </View>
                <View style={styles.flex1}>
                  <Text style={styles.rowName}>Suelto</Text>
                  <Text style={styles.rowMeta}>{looseLabel(product)}</Text>
                </View>
                <Icon name="chevron-right" size={18} color={colorScales.gray[400]} />
              </Pressable>
            }
            renderItem={({ item }) => (
              <Pressable
                onPress={() => onSelect(item)}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              >
                <View style={styles.iconBox}>
                  <Icon name="boxes" size={20} color={colors.primary} />
                </View>
                <View style={styles.flex1}>
                  <View style={styles.rowTitleLine}>
                    <Text style={styles.rowName} numberOfLines={1}>
                      {item.name}
                    </Text>
                    {item.isDefault ? (
                      <Text style={styles.defaultBadge}>Predeterminada</Text>
                    ) : null}
                  </View>
                  <Text style={styles.rowMeta}>
                    {formatCurrency(item.unitPrice)}
                    {item.packSize > 1
                      ? ` · descuenta ${item.packSize} ${unit}`
                      : ''}
                  </Text>
                </View>
                <Icon name="chevron-right" size={18} color={colorScales.gray[400]} />
              </Pressable>
            )}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 50,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing[4],
  },
  backdropLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  content: {
    width: '100%',
    maxWidth: 448,
    maxHeight: '80%',
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  title: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    fontFamily: typography.fontFamily,
    color: colors.text.primary,
  },
  subtitle: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
    marginTop: 2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colorScales.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingBox: {
    paddingVertical: spacing[8],
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    gap: spacing[2],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.card,
  },
  rowPressed: {
    backgroundColor: colorScales.gray[50],
    borderColor: colors.primary,
  },
  rowTitleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: colorScales.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  rowName: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    fontFamily: typography.fontFamily,
    color: colors.text.primary,
    flexShrink: 1,
  },
  rowMeta: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
    marginTop: 2,
  },
  defaultBadge: {
    fontSize: 10,
    fontFamily: typography.fontFamily,
    fontWeight: typography.fontWeight.medium,
    color: colors.primary,
  },
});
