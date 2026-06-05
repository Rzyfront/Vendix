import React, { useState, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Icon } from '@/shared/components/icon/icon';

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
  const triggerRef = useRef<View>(null);

  const actions = [
    { key: 'scan', label: 'Escanear factura', icon: 'scan-outline' as const, primary: true, onPress: onScanInvoice },
    { key: 'new', label: 'Nuevo producto', icon: 'add-outline' as const, primary: false, onPress: onNewProduct },
    { key: 'bulk', label: 'Carga masiva', icon: 'cloud-upload-outline' as const, primary: false, onPress: onBulkUpload },
  ];

  return (
    <View ref={triggerRef}>
      <TouchableOpacity style={styles.trigger} onPress={() => setVisible(true)}>
        <Icon name="package-plus" size={20} color="#22C55E" />
      </TouchableOpacity>

      <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setVisible(false)}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setVisible(false)}>
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
                  <Ionicons name={a.icon} size={18} color={a.primary ? '#22C55E' : '#374151'} />
                  <Text style={[styles.menuItemText, a.primary && styles.menuItemTextPrimary]}>{a.label}</Text>
                </TouchableOpacity>
              ))}
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
    borderColor: '#22C55E',
  },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'center', alignItems: 'center' },
  menu: { backgroundColor: '#fff', borderRadius: 12, width: 280, maxWidth: '90%', shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 16, elevation: 12 },
  menuHeader: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#e5e7eb' },
  menuHeaderTitle: { fontSize: 13, fontWeight: '700', color: '#111827' },
  menuItems: { paddingVertical: 4 },
  menuItem: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 10 },
  menuItemPrimary: { backgroundColor: '#f0fdf4' },
  menuItemText: { fontSize: 14, color: '#374151', fontWeight: '500' },
  menuItemTextPrimary: { color: '#22C55E', fontWeight: '600' },
});
