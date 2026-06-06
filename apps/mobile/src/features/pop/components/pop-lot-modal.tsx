import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { LotInfo } from '../types';

interface PopLotModalProps {
  visible: boolean;
  currentLot?: LotInfo;
  onConfirm: (lot: LotInfo) => void;
  onCancel: () => void;
}

export default function PopLotModal({ visible, currentLot, onConfirm, onCancel }: PopLotModalProps) {
  const [batchNumber, setBatchNumber] = useState('');
  const [manufacturingDate, setManufacturingDate] = useState('');
  const [expirationDate, setExpirationDate] = useState('');

  useEffect(() => {
    if (visible) {
      setBatchNumber(currentLot?.batch_number || '');
      setManufacturingDate(currentLot?.manufacturing_date || '');
      setExpirationDate(currentLot?.expiration_date || '');
    }
  }, [visible]);

  const handleConfirm = () => {
    onConfirm({
      batch_number: batchNumber.trim() || undefined,
      manufacturing_date: manufacturingDate.trim() || undefined,
      expiration_date: expirationDate.trim() || undefined,
    });
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <View style={styles.header}>
            <View style={styles.headerTitle}>
              <Ionicons name="pricetags-outline" size={22} color="#d97706" />
              <Text style={styles.title}>Información de lote</Text>
            </View>
            <TouchableOpacity onPress={onCancel}>
              <Ionicons name="close" size={22} color="#6b7280" />
            </TouchableOpacity>
          </View>

          <View style={styles.body}>
            <Text style={styles.label}>Número de lote</Text>
            <TextInput
              style={styles.input}
              value={batchNumber}
              onChangeText={setBatchNumber}
              placeholder="Ej: LOTE-001"
              placeholderTextColor="#9ca3af"
            />
            <Text style={[styles.label, { marginTop: 14 }]}>Fecha de fabricación</Text>
            <TextInput
              style={styles.input}
              value={manufacturingDate}
              onChangeText={setManufacturingDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor="#9ca3af"
            />
            <Text style={[styles.label, { marginTop: 14 }]}>Fecha de vencimiento</Text>
            <TextInput
              style={styles.input}
              value={expirationDate}
              onChangeText={setExpirationDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor="#9ca3af"
            />
          </View>

          <View style={styles.footer}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onCancel}>
              <Text style={styles.cancelText}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.confirmBtn} onPress={handleConfirm}>
              <Ionicons name="checkmark" size={16} color="#fff" />
              <Text style={styles.confirmText}>Guardar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', paddingHorizontal: 30 },
  modal: { backgroundColor: '#fff', borderRadius: 16 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#e5e7eb' },
  headerTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 16, fontWeight: '700', color: '#111827' },
  body: { padding: 20 },
  label: { fontSize: 13, fontWeight: '700', color: '#6b7280', marginBottom: 8 },
  input: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: '#111827' },
  footer: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#e5e7eb' },
  cancelBtn: { flex: 1, paddingVertical: 12, borderRadius: 8, borderWidth: 1, borderColor: '#d1d5db', alignItems: 'center' },
  cancelText: { fontSize: 14, fontWeight: '600', color: '#374151' },
  confirmBtn: { flex: 1, flexDirection: 'row', paddingVertical: 12, borderRadius: 8, backgroundColor: '#d97706', alignItems: 'center', justifyContent: 'center', gap: 6 },
  confirmText: { fontSize: 14, fontWeight: '700', color: '#fff' },
});
