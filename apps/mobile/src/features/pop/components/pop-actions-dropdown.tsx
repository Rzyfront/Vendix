import React, { useState, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

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
        <Ionicons name="cube-outline" size={16} color="#374151" />
        <Text style={styles.triggerText}>Acciones</Text>
        <Ionicons name="chevron-down" size={14} color="#6b7280" />
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#fff',
    height: 40,
  },
  triggerText: { fontSize: 13, fontWeight: '600', color: '#374151' },
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
