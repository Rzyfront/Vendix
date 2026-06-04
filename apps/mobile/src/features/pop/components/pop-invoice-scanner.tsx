import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  ScrollView,
  StyleSheet,
  Image,
  Alert,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';

export interface ScannedItem {
  name: string;
  sku: string;
  quantity: number;
  unit_cost: number;
  description?: string;
}

export interface ScanResult {
  supplier_name?: string;
  invoice_number?: string;
  items: ScannedItem[];
}

interface PopInvoiceScannerProps {
  visible: boolean;
  onClose: () => void;
  onScanComplete?: (data: ScanResult) => void;
}

export default function PopInvoiceScanner({ visible, onClose, onScanComplete }: PopInvoiceScannerProps) {
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [scannedItems, setScannedItems] = useState<ScannedItem[]>([]);
  const [supplierName, setSupplierName] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');

  const reset = useCallback(() => {
    setImageUri(null);
    setAnalyzing(false);
    setScannedItems([]);
    setSupplierName('');
    setInvoiceNumber('');
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const handleTakePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permiso requerido', 'Se necesita acceso a la cámara para escanear facturas.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    });
    if (!result.canceled && result.assets?.length > 0) {
      setImageUri(result.assets[0].uri);
      startAnalysis();
    }
  };

  const handlePickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permiso requerido', 'Se necesita acceso a la galería para seleccionar facturas.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    });
    if (!result.canceled && result.assets?.length > 0) {
      setImageUri(result.assets[0].uri);
      startAnalysis();
    }
  };

  const startAnalysis = () => {
    setAnalyzing(true);
    // Simulate AI analysis delay
    setTimeout(() => {
      const mockItems: ScannedItem[] = [
        { name: 'Producto detectado 1', sku: 'DET-001', quantity: 10, unit_cost: 5000 },
        { name: 'Producto detectado 2', sku: 'DET-002', quantity: 5, unit_cost: 8500 },
        { name: 'Producto detectado 3', sku: 'DET-003', quantity: 20, unit_cost: 3200 },
      ];
      setScannedItems(mockItems);
      setSupplierName('Proveedor detectado');
      setInvoiceNumber('F001-001');
      setAnalyzing(false);
    }, 2500);
  };

  const handleItemChange = (index: number, field: keyof ScannedItem, value: string | number) => {
    setScannedItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item))
    );
  };

  const handleRemoveItem = (index: number) => {
    setScannedItems((prev) => prev.filter((_, i) => i !== index));
  };

  const handleConfirm = () => {
    if (scannedItems.length === 0) {
      Alert.alert('Sin productos', 'No hay productos para agregar.');
      return;
    }
    onScanComplete?.({
      supplier_name: supplierName || undefined,
      invoice_number: invoiceNumber || undefined,
      items: scannedItems,
    });
    reset();
  };

  const subtotal = scannedItems.reduce((sum, item) => sum + item.quantity * item.unit_cost, 0);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <View style={styles.header}>
            <View style={styles.headerTitle}>
              <Ionicons name="scan-outline" size={22} color="#22C55E" />
              <Text style={styles.title}>Escanear factura</Text>
            </View>
            <TouchableOpacity onPress={handleClose}>
              <Ionicons name="close" size={22} color="#6b7280" />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body}>
            {/* Image preview */}
            {imageUri && (
              <View style={styles.imageSection}>
                <Image source={{ uri: imageUri }} style={styles.previewImage} />
              </View>
            )}

            {/* Step 1: Capture */}
            {!imageUri && !analyzing && scannedItems.length === 0 && (
              <View style={styles.stepContent}>
                <View style={styles.scannerPlaceholder}>
                  <Ionicons name="camera-outline" size={48} color="#22C55E" />
                  <Text style={styles.scannerHint}>Toma una foto de la factura</Text>
                </View>
                <TouchableOpacity style={styles.actionBtn} onPress={handleTakePhoto}>
                  <Ionicons name="camera" size={18} color="#fff" />
                  <Text style={styles.actionBtnText}>Tomar foto</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.secondaryAction} onPress={handlePickImage}>
                  <Ionicons name="image-outline" size={18} color="#22C55E" />
                  <Text style={styles.secondaryActionText}>Seleccionar de galería</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Step 2: Analyzing */}
            {analyzing && (
              <View style={styles.analyzingBox}>
                <Ionicons name="sync" size={36} color="#22C55E" />
                <Text style={styles.analyzingText}>Analizando factura...</Text>
                <Text style={styles.analyzingSubtext}>Extrayendo productos con IA</Text>
              </View>
            )}

            {/* Step 3: Review results */}
            {!analyzing && scannedItems.length > 0 && (
              <View style={styles.reviewSection}>
                {/* Supplier and invoice info */}
                <View style={styles.infoCard}>
                  <View style={styles.infoRow}>
                    <Ionicons name="business-outline" size={16} color="#059669" />
                    <View style={styles.infoRowText}>
                      <Text style={styles.infoLabel}>Proveedor</Text>
                      <TextInput
                        style={styles.infoValueInput}
                        value={supplierName}
                        onChangeText={setSupplierName}
                      />
                    </View>
                  </View>
                  <View style={styles.infoDivider} />
                  <View style={styles.infoRow}>
                    <Ionicons name="document-text-outline" size={16} color="#059669" />
                    <View style={styles.infoRowText}>
                      <Text style={styles.infoLabel}>Factura</Text>
                      <TextInput
                        style={styles.infoValueInput}
                        value={invoiceNumber}
                        onChangeText={setInvoiceNumber}
                      />
                    </View>
                  </View>
                </View>

                {/* Items header */}
                <View style={styles.itemsHeader}>
                  <Text style={styles.itemsHeaderTitle}>
                    Productos detectados ({scannedItems.length})
                  </Text>
                </View>

                {/* Items list */}
                {scannedItems.map((item, idx) => (
                  <View key={idx} style={styles.itemCard}>
                    <View style={styles.itemCardHeader}>
                      <TextInput
                        style={styles.itemNameInput}
                        value={item.name}
                        onChangeText={(v) => handleItemChange(idx, 'name', v)}
                      />
                      <TouchableOpacity onPress={() => handleRemoveItem(idx)}>
                        <Ionicons name="close-circle" size={20} color="#ef4444" />
                      </TouchableOpacity>
                    </View>
                    <TextInput
                      style={styles.itemSkuInput}
                      value={item.sku}
                      onChangeText={(v) => handleItemChange(idx, 'sku', v)}
                      placeholder="SKU"
                    />
                    <View style={styles.itemFieldsRow}>
                      <View style={styles.itemField}>
                        <Text style={styles.itemFieldLabel}>Cantidad</Text>
                        <TextInput
                          style={styles.itemFieldInput}
                          value={String(item.quantity)}
                          onChangeText={(v) => handleItemChange(idx, 'quantity', Number(v) || 0)}
                          keyboardType="numeric"
                        />
                      </View>
                      <View style={styles.itemField}>
                        <Text style={styles.itemFieldLabel}>Costo Unit.</Text>
                        <TextInput
                          style={styles.itemFieldInput}
                          value={String(item.unit_cost)}
                          onChangeText={(v) => handleItemChange(idx, 'unit_cost', Number(v) || 0)}
                          keyboardType="numeric"
                        />
                      </View>
                      <View style={styles.itemField}>
                        <Text style={styles.itemFieldLabel}>Subtotal</Text>
                        <Text style={styles.itemSubtotal}>
                          ${(item.quantity * item.unit_cost).toLocaleString()}
                        </Text>
                      </View>
                    </View>
                  </View>
                ))}

                {/* Totals */}
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>Total productos</Text>
                  <Text style={styles.totalValue}>${subtotal.toLocaleString()}</Text>
                </View>
              </View>
            )}
          </ScrollView>

          {/* Footer with actions */}
          {scannedItems.length > 0 && !analyzing && (
            <View style={styles.footer}>
              <TouchableOpacity style={styles.cancelBtn} onPress={handleClose}>
                <Text style={styles.cancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmBtn} onPress={handleConfirm}>
                <Ionicons name="cart" size={16} color="#fff" />
                <Text style={styles.confirmText}>Agregar ({scannedItems.length})</Text>
              </TouchableOpacity>
            </View>
          )}

          {imageUri && !analyzing && scannedItems.length === 0 && (
            <View style={styles.footer}>
              <TouchableOpacity style={styles.cancelBtn} onPress={handleClose}>
                <Text style={styles.cancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.retryBtn} onPress={startAnalysis}>
                <Ionicons name="refresh" size={16} color="#22C55E" />
                <Text style={styles.retryText}>Reintentar análisis</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modal: { backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '90%' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#e5e7eb' },
  headerTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 16, fontWeight: '700', color: '#111827' },
  body: { padding: 16 },
  footer: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#e5e7eb' },
  cancelBtn: { flex: 1, paddingVertical: 12, borderRadius: 8, borderWidth: 1, borderColor: '#d1d5db', alignItems: 'center' },
  cancelText: { fontSize: 14, fontWeight: '600', color: '#374151' },
  retryBtn: { flex: 1, flexDirection: 'row', paddingVertical: 12, borderRadius: 8, borderWidth: 1, borderColor: '#22C55E', alignItems: 'center', justifyContent: 'center', gap: 6 },
  retryText: { fontSize: 14, fontWeight: '600', color: '#22C55E' },
  confirmBtn: { flex: 1, flexDirection: 'row', paddingVertical: 12, borderRadius: 8, backgroundColor: '#22C55E', alignItems: 'center', justifyContent: 'center', gap: 6 },
  confirmText: { fontSize: 14, fontWeight: '700', color: '#fff' },

  stepContent: { alignItems: 'center', gap: 16, paddingVertical: 8 },
  scannerPlaceholder: { width: '100%', height: 200, backgroundColor: '#f3f4f6', borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#d1d5db', borderStyle: 'dashed' },
  scannerHint: { fontSize: 14, color: '#6b7280', marginTop: 12 },
  actionBtn: { flexDirection: 'row', backgroundColor: '#22C55E', paddingHorizontal: 24, paddingVertical: 14, borderRadius: 10, alignItems: 'center', gap: 8, alignSelf: 'stretch', justifyContent: 'center' },
  actionBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  secondaryAction: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8 },
  secondaryActionText: { fontSize: 13, fontWeight: '600', color: '#22C55E' },

  imageSection: { marginBottom: 16 },
  previewImage: { width: '100%', height: 180, borderRadius: 10, resizeMode: 'cover' },

  analyzingBox: { alignItems: 'center', paddingVertical: 40, gap: 10 },
  analyzingText: { fontSize: 16, fontWeight: '700', color: '#374151' },
  analyzingSubtext: { fontSize: 13, color: '#6b7280' },

  reviewSection: { gap: 12 },
  infoCard: { backgroundColor: '#f0fdf4', borderRadius: 10, borderWidth: 1, borderColor: '#bbf7d0', padding: 12, gap: 10 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  infoRowText: { flex: 1 },
  infoLabel: { fontSize: 10, fontWeight: '600', color: '#16a34a', textTransform: 'uppercase' },
  infoValueInput: { fontSize: 14, fontWeight: '600', color: '#111827', paddingVertical: 2, paddingHorizontal: 0 },
  infoDivider: { height: 1, backgroundColor: '#bbf7d0' },

  itemsHeader: { marginTop: 4 },
  itemsHeaderTitle: { fontSize: 12, fontWeight: '700', color: '#374151' },

  itemCard: { backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#e5e7eb', padding: 12, gap: 8 },
  itemCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  itemNameInput: { flex: 1, fontSize: 13, fontWeight: '700', color: '#111827', paddingVertical: 2, paddingHorizontal: 0 },
  itemSkuInput: { fontSize: 11, color: '#6b7280', fontFamily: 'monospace', paddingVertical: 2, paddingHorizontal: 0 },
  itemFieldsRow: { flexDirection: 'row', gap: 8 },
  itemField: { flex: 1 },
  itemFieldLabel: { fontSize: 9, fontWeight: '600', color: '#6b7280', textTransform: 'uppercase', marginBottom: 2 },
  itemFieldInput: { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 6, fontSize: 13, fontWeight: '600', color: '#111827', textAlign: 'center' },
  itemSubtotal: { fontSize: 13, fontWeight: '700', color: '#059669', textAlign: 'center', paddingVertical: 6 },

  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#e5e7eb', marginTop: 4 },
  totalLabel: { fontSize: 14, fontWeight: '700', color: '#374151' },
  totalValue: { fontSize: 18, fontWeight: '800', color: '#059669' },
});
