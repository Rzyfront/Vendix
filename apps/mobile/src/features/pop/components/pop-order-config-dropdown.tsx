import React, { useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  StyleSheet,
  Dimensions,
  Animated,
  useWindowDimensions,
} from 'react-native';
import { Icon } from '@/shared/components/icon/icon';
import {
  borderRadius,
  colorScales,
  colors,
  shadows,
  spacing,
  typography,
} from '@/shared/theme';

interface PopOrderConfigDropdownProps {
  /** Proveedor + bodega seleccionados => resumen colapsado. */
  isConfigured: boolean;
  supplierName?: string;
  locationName?: string;
  /** Cadenas ya formateadas (la web usa `dd/mm`). Vacío = no mostrar la fila. */
  orderDateLabel?: string;
  expectedDateLabel?: string;
  shippingLabel?: string;
  /** Tap en "Configurar compra" / "Editar configuración". */
  onEdit: () => void;
}

/**
 * `PopOrderConfigDropdown` — variante responsive (móvil/tablet) del resumen
 * de configuración de la orden de compra. Réplica 1:1 del componente web
 * `app-pop-order-config-dropdown` en apps/frontend.
 *
 *  - Sin configurar → botón ámbar "Sin configurar / Configurar compra".
 *  - Configurado → píldora primaria (truck + proveedor + chevron) que abre
 *    un panel anclado a la derecha con el detalle y un botón "Editar
 *    configuración".
 *  - Tap-fuera cierra el panel.
 */
export default function PopOrderConfigDropdown({
  isConfigured,
  supplierName,
  locationName,
  orderDateLabel,
  expectedDateLabel,
  shippingLabel,
  onEdit,
}: PopOrderConfigDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [panelPos, setPanelPos] = useState({ top: 0, right: 0 });
  const triggerRef = useRef<View>(null);
  const { width: screenW } = useWindowDimensions();

  // Threshold para colapsar "Sin configurar / Configurar compra" → solo
  // "Sin configurar" cuando el ancho no admite el botón completo junto al
  // título del card. Mismo corte que usa web internamente para responsive.
  const COMPACT_THRESHOLD = 480;
  const isCompact = screenW < COMPACT_THRESHOLD;

  const handleOpen = useCallback(() => {
    triggerRef.current?.measureInWindow((x, y, width, btnHeight) => {
      setPanelPos({
        top: y + btnHeight + 8,
        right: screenW - x - width,
      });
      setIsOpen(true);
    });
  }, [screenW]);

  const handleClose = useCallback(() => setIsOpen(false), []);

  const handleEdit = useCallback(() => {
    setIsOpen(false);
    onEdit();
  }, [onEdit]);

  if (!isConfigured) {
    return (
      <TouchableOpacity
        style={styles.warningButton}
        onPress={onEdit}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel="Configurar orden de compra"
      >
        <Icon name="settings" size={16} color={colorScales.amber[700]} />
        {isCompact ? (
          <Text style={styles.warningButtonLabel} numberOfLines={1}>
            Sin configurar
          </Text>
        ) : (
          <Text
            style={styles.warningButtonLabel}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            Sin configurar{' '}
            <Text style={styles.warningButtonUnderline}>Configurar compra</Text>
          </Text>
        )}
      </TouchableOpacity>
    );
  }

  return (
    <View ref={triggerRef}>
      <TouchableOpacity
        style={styles.pillTrigger}
        onPress={isOpen ? handleClose : handleOpen}
        activeOpacity={0.9}
        accessibilityRole="button"
        accessibilityLabel="Ver configuración de la orden"
      >
        <Icon name="truck" size={15} color={colors.primary} style={styles.pillIconFixed} />
        <Text style={styles.pillSupplierName} numberOfLines={1}>
          {supplierName || 'Proveedor'}
        </Text>
        <Animated.View style={{ transform: [{ rotate: isOpen ? '180deg' : '0deg' }] }}>
          <Icon name="chevron-down" size={16} color={colorScales.gray[500]} />
        </Animated.View>
      </TouchableOpacity>

      <Modal
        visible={isOpen}
        transparent
        animationType="fade"
        onRequestClose={handleClose}
      >
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={handleClose}
        >
          <View style={[styles.panel, { top: panelPos.top, right: panelPos.right }]}>
            <TouchableOpacity activeOpacity={1} onPress={(e) => e.stopPropagation()}>
              <View style={styles.panelBody}>
                <ConfigRow
                  iconName="truck"
                  iconColor={colors.primary}
                  label="Proveedor:"
                  value={supplierName || '—'}
                />
                <ConfigRow
                  iconName="warehouse"
                  iconColor={colorScales.green[600]}
                  label="Bodega:"
                  value={locationName || '—'}
                />
                {!!orderDateLabel && (
                  <ConfigRow
                    iconName="calendar"
                    iconColor={colorScales.gray[500]}
                    label="Fecha orden:"
                    value={orderDateLabel}
                  />
                )}
                {!!expectedDateLabel && (
                  <ConfigRow
                    iconName="calendar"
                    iconColor={colorScales.amber[600]}
                    label="Fecha entrega:"
                    value={expectedDateLabel}
                  />
                )}
                {!!shippingLabel && (
                  <ConfigRow
                    iconName="package"
                    iconColor={colorScales.gray[500]}
                    label="Envío:"
                    value={shippingLabel}
                  />
                )}
              </View>
              <View style={styles.panelFooter}>
                <TouchableOpacity
                  style={styles.editButton}
                  onPress={handleEdit}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel="Editar configuración de compra"
                >
                  <Icon name="edit" size={15} color={colors.primary} />
                  <Text style={styles.editButtonText}>Editar configuración</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

interface ConfigRowProps {
  iconName: 'truck' | 'warehouse' | 'calendar' | 'package';
  iconColor: string;
  label: string;
  value: string;
}

function ConfigRow({ iconName, iconColor, label, value }: ConfigRowProps) {
  return (
    <View style={styles.row}>
      <Icon name={iconName} size={15} color={iconColor} style={styles.rowIconFixed} />
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // ─── Estado "sin configurar" ────────────────────────────────────────────
  warningButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    backgroundColor: colorScales.amber[50],
    borderWidth: 1,
    borderColor: colorScales.amber[200],
    borderRadius: borderRadius.xl,
    minHeight: 44,
    justifyContent: 'center',
    flexShrink: 1,
    maxWidth: '70%',
    minWidth: 0,
  },
  warningButtonLabel: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.medium as any,
    color: colorScales.amber[700],
    flexShrink: 1,
  },
  warningButtonUnderline: {
    fontWeight: typography.fontWeight.semibold as any,
    textDecorationLine: 'underline',
    textDecorationStyle: 'solid',
    textDecorationColor: colorScales.amber[400],
  },

  // ─── Píldora "configurado" ──────────────────────────────────────────────
  pillTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: 180,
    paddingHorizontal: 10,
    paddingVertical: spacing[2],
    backgroundColor: `${colors.primary}0D`, // primary/5 (≈8% opacity)
    borderWidth: 1,
    borderColor: `${colors.primary}33`, // primary/20 (≈20% opacity)
    borderRadius: borderRadius.xl,
    minHeight: 40,
  },
  pillIconFixed: { flexShrink: 0 },
  pillSupplierName: {
    flexShrink: 1,
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold as any,
    color: colors.text?.primary ?? colorScales.gray[900],
  },

  // ─── Panel flotante ─────────────────────────────────────────────────────
  backdrop: {
    flex: 1,
  },
  panel: {
    position: 'absolute',
    minWidth: 250,
    maxWidth: Math.min(Dimensions.get('window').width - 32, 320),
    backgroundColor: colors.card,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    ...shadows.lg,
    overflow: 'hidden',
  },
  panelBody: {
    padding: spacing[3],
    gap: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rowIconFixed: { flexShrink: 0 },
  rowLabel: {
    fontSize: 11,
    color: colorScales.gray[500],
  },
  rowValue: {
    flexShrink: 1,
    marginLeft: 'auto',
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.medium as any,
    color: colors.text?.primary ?? colorScales.gray[900],
  },
  panelFooter: {
    padding: spacing[2],
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
  },
  editButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    width: '100%',
    minHeight: 38,
    borderRadius: borderRadius.lg,
    backgroundColor: `${colors.primary}1A`, // primary/10 (≈10% opacity)
  },
  editButtonText: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold as any,
    color: colors.primary,
  },
});