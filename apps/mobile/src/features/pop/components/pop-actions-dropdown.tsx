import React, { useState, useRef, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Icon } from '@/shared/components/icon/icon';
import { colors } from '@/shared/theme/colors';

interface PopActionsDropdownProps {
  onScanInvoice: () => void;
  onNewProduct: () => void;
  onBulkUpload: () => void;
}

export default function PopActionsDropdown({
  onScanInvoice,
  onNewProduct,
  onBulkUpload,
}: PopActionsDropdownProps) {
  const [visible, setVisible] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 });
  const triggerRef = useRef<View>(null);
  const screenW = Dimensions.get('window').width;

  const actions = [
    { key: 'scan', label: 'Escanear factura', icon: 'scan-outline' as const, primary: true, onPress: onScanInvoice },
    { key: 'new', label: 'Nuevo producto', icon: 'add-outline' as const, primary: false, onPress: onNewProduct },
    { key: 'bulk', label: 'Carga masiva', icon: 'cloud-upload-outline' as const, primary: false, onPress: onBulkUpload },
  ];

  const handleOpen = useCallback(() => {
    triggerRef.current?.measureInWindow((x, y, width, btnHeight) => {
      setMenuPos({ top: y + btnHeight + 4, right: screenW - x - width });
      setVisible(true);
    });
  }, [screenW]);

  return (
    <View ref={triggerRef}>
      <TouchableOpacity style={styles.trigger} onPress={handleOpen}>
        <Icon name="package-plus" size={20} color={colors.primary} />
      </TouchableOpacity>

      <Modal visible={visible} transparent animationType="none" onRequestClose={() => setVisible(false)}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setVisible(false)}>
          <View style={[styles.positioner, { top: menuPos.top }]}>
            <View style={[styles.arrow, { marginLeft: Math.max(screenW - menuPos.right - menuPos.right / 2, 14) }]} />
            <View style={styles.menu}>
              <View style={styles.menuHeader}>
                <Text style={styles.menuHeaderTitle}>Acciones</Text>
              </View>
              <View style={styles.menuItems}>
                {actions.map((a) => (
                  <TouchableOpacity
                    key={a.key}
                    style={[styles.menuItem, a.primary && styles.menuItemPrimary]}
                    onPress={() => { setVisible(false); a.onPress(); }}
                  >
                    <Ionicons name={a.icon} size={18} color={a.primary ? colors.primary : '#374151'} />
                    <Text style={[styles.menuItemText, a.primary && styles.menuItemTextPrimary]}>{a.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  trigger: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.primary,
  },
  backdrop: { flex: 1 },
  positioner: { position: 'absolute', right: 16, alignItems: 'flex-end' },
  arrow: {
    width: 0, height: 0, borderLeftWidth: 8, borderRightWidth: 8, borderBottomWidth: 8,
    borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: '#fff',
    marginBottom: -1,
  },
  menu: {
    backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e5e7eb',
    width: 220, shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 16, elevation: 12,
  },
  menuHeader: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#e5e7eb' },
  menuHeaderTitle: { fontSize: 13, fontWeight: '700', color: '#111827' },
  menuItems: { paddingVertical: 4 },
  menuItem: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 10 },
  menuItemPrimary: { backgroundColor: '#f0fdf4' },
  menuItemText: { fontSize: 14, color: '#374151', fontWeight: '500' },
  menuItemTextPrimary: { color: colors.primary, fontWeight: '600' },
});
