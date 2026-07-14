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
  ActivityIndicator,
  Pressable,
} from 'react-native';
import { apiClient, Endpoints } from '@/core/api';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { Icon } from '@/shared/components/icon/icon';
import { colors } from '@/shared/theme/colors';

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

const STEPS = [
  { label: 'Subir' },
  { label: 'Analizar' },
  { label: 'Revisar' },
];

export default function PopInvoiceScanner({ visible, onClose, onScanComplete }: PopInvoiceScannerProps) {
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [scannedItems, setScannedItems] = useState<ScannedItem[]>([]);
  const [supplierName, setSupplierName] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');

  const reset = useCallback(() => {
    setCurrentStep(1);
    setImageUri(null);
    setAnalyzing(false);
    setProcessing(false);
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
      setProcessing(true);
      setTimeout(() => setProcessing(false), 800);
    }
  };

  const handlePickImage = async () => {
    // Acepta imágenes (JPG, PNG, WebP) y PDFs — como la web
    const result = await DocumentPicker.getDocumentAsync({
      type: [
        'image/jpeg',
        'image/png',
        'image/webp',
        'application/pdf',
      ],
      copyToCacheDirectory: true,
    });
    if (!result.canceled && result.assets?.length > 0) {
      setImageUri(result.assets[0].uri);
      setProcessing(true);
      setTimeout(() => setProcessing(false), 800);
    }
  };

  const handleStartScan = async () => {
    if (!imageUri) return;
    setCurrentStep(2);
    setAnalyzing(true);
    try {
      const formData = new FormData();
      const filename = imageUri.split('/').pop() || 'invoice.jpg';
      let type = 'image/jpeg';
      if (filename.toLowerCase().endsWith('.pdf')) {
        type = 'application/pdf';
      } else if (filename.toLowerCase().endsWith('.png')) {
        type = 'image/png';
      } else if (filename.toLowerCase().endsWith('.webp')) {
        type = 'image/webp';
      }

      formData.append('file', {
        uri: imageUri,
        name: filename,
        type,
      } as any);

      const res = await apiClient.post<any>(
        `${Endpoints.STORE.PURCHASE_ORDERS.CREATE}/scan?orderType=retail`,
        formData,
        {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        }
      );

      const scanData = res.data?.data || res.data;
      if (scanData && Array.isArray(scanData.line_items)) {
        const mappedItems: ScannedItem[] = scanData.line_items.map((item: any) => ({
          name: item.description,
          sku: item.sku_if_visible || '',
          quantity: item.quantity,
          unit_cost: item.unit_price,
          description: item.description,
        }));
        setScannedItems(mappedItems);
        setSupplierName(scanData.supplier?.name || '');
        setInvoiceNumber(scanData.invoice_number || '');
        setCurrentStep(3);
      } else {
        Alert.alert('Error', 'No se pudieron extraer los productos de la factura.');
        setCurrentStep(1);
      }
    } catch (err: any) {
      console.error('Scan invoice error:', err);
      Alert.alert('Error', err?.response?.data?.message || err?.message || 'Error al procesar la factura.');
      setCurrentStep(1);
    } finally {
      setAnalyzing(false);
    }
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
  const formatCurrency = (value: number) => `$${value.toLocaleString()}`;

  const removeFile = () => {
    setImageUri(null);
    setProcessing(false);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <View style={styles.modal}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTitle}>
              <Icon name="scan-line" size={22} color={colors.primary} />
              <Text style={styles.title}>Escanear Factura de Compra</Text>
            </View>
            <TouchableOpacity onPress={handleClose}>
              <Icon name="x" size={22} color="#6b7280" />
            </TouchableOpacity>
          </View>

          <View style={styles.subheader}>
            <Text style={styles.subtitle}>Escanea una factura para agregar productos al carrito</Text>
          </View>

          {/* Steps indicator */}
          <View style={styles.stepsRow}>
            {STEPS.map((step, idx) => {
              const stepNum = idx + 1;
              const isActive = currentStep === stepNum;
              const isDone = currentStep > stepNum;
              return (
                <React.Fragment key={stepNum}>
                  <View style={styles.stepItem}>
                    <View style={[styles.stepCircle, isActive && styles.stepCircleActive, isDone && styles.stepCircleDone]}>
                      {isDone ? (
                        <Icon name="check" size={12} color="#fff" />
                      ) : (
                        <Text style={[styles.stepNum, isActive && styles.stepNumActive, isDone && styles.stepNumDone]}>
                          {stepNum}
                        </Text>
                      )}
                    </View>
                    <Text style={[styles.stepLabel, isActive && styles.stepLabelActive, isDone && styles.stepLabelDone]}>
                      {step.label}
                    </Text>
                  </View>
                  {idx < STEPS.length - 1 && (
                    <View style={[styles.stepLine, isDone && styles.stepLineDone]} />
                  )}
                </React.Fragment>
              );
            })}
          </View>

          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
            {/* Step 1: Upload */}
            {currentStep === 1 && (
              <View style={styles.step1Content}>
                {/* Camera button for mobile */}
                <TouchableOpacity style={styles.cameraBtn} onPress={handleTakePhoto}>
                  <Icon name="camera" size={24} color="#fff" />
                  <Text style={styles.cameraBtnText}>Tomar Foto</Text>
                </TouchableOpacity>

                {/* Dropzone */}
                {!imageUri ? (
                  <TouchableOpacity style={styles.dropzone} onPress={handlePickImage} activeOpacity={0.7}>
                    <View style={styles.dropzoneIconWrap}>
                      <Icon name="scan-line" size={32} color={colors.primary} />
                    </View>
                    <Text style={styles.dropzoneTitle}>Arrastra tu factura aquí</Text>
                    <Text style={styles.dropzoneSubtitle}>JPG, PNG, WebP o PDF - Max 10MB</Text>
                  </TouchableOpacity>
                ) : (
                  <View style={styles.filePreviewWrap}>
                    <Image source={{ uri: imageUri }} style={styles.previewImage} />
                    <Text style={styles.fileNameText}>Factura seleccionada</Text>
                    {!processing && (
                      <View style={styles.fileReadyRow}>
                        <Text style={styles.fileReadyText}>Archivo listo</Text>
                      </View>
                    )}
                    {processing && (
                      <View style={styles.fileReadyRow}>
                        <ActivityIndicator size="small" color={colors.primary} />
                        <Text style={styles.fileProcessingText}>Cargando archivo...</Text>
                      </View>
                    )}
                    <TouchableOpacity onPress={removeFile}>
                      <Text style={styles.changeFileText}>Cambiar archivo</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )}

            {/* Step 2: Processing */}
            {currentStep === 2 && (
              <View style={styles.step2Content}>
                {imageUri && (
                  <View style={styles.step2Preview}>
                    <Image source={{ uri: imageUri }} style={styles.step2Image} />
                  </View>
                )}
                <View style={styles.analyzingBox}>
                  <ActivityIndicator size="large" color={colors.primary} />
                  <Text style={styles.analyzingText}>Analizando factura...</Text>
                  <Text style={styles.analyzingSubtext}>
                    Extrayendo datos y buscando coincidencias con tus productos...
                  </Text>
                </View>
              </View>
            )}

            {/* Step 3: Review */}
            {currentStep === 3 && (
              <View style={styles.step3Content}>
                {/* Supplier card */}
                {supplierName && (
                  <View style={styles.supplierCard}>
                    <View style={styles.supplierCardRow}>
                      <Text style={styles.supplierCardLabel}>Proveedor</Text>
                      <View style={styles.supplierBadge}>
                        <Text style={styles.supplierBadgeText}>Encontrado</Text>
                      </View>
                    </View>
                    <Text style={styles.supplierCardName}>{supplierName}</Text>
                  </View>
                )}

                {/* Invoice header fields */}
                <View style={styles.invoiceFieldsRow}>
                  <View style={styles.invoiceField}>
                    <Text style={styles.fieldLabel}>No. Factura</Text>
                    <TextInput
                      style={styles.fieldInput}
                      value={invoiceNumber}
                      onChangeText={setInvoiceNumber}
                      placeholder="Ej: FV-001"
                      placeholderTextColor="#9ca3af"
                    />
                  </View>
                  <View style={styles.invoiceField}>
                    <Text style={styles.fieldLabel}>Fecha Factura</Text>
                    <TextInput
                      style={styles.fieldInput}
                      value=""
                      editable={false}
                      placeholder="Seleccionar fecha"
                      placeholderTextColor="#9ca3af"
                    />
                  </View>
                </View>

                {/* Items header */}
                <Text style={styles.itemsTitle}>
                  Productos ({scannedItems.length})
                </Text>

                {/* Items cards */}
                {scannedItems.map((item, idx) => (
                  <View key={idx} style={styles.itemCard}>
                    <View style={styles.itemCardHeader}>
                      <Text style={styles.itemDescription} numberOfLines={2}>{item.name}</Text>
                      <TouchableOpacity onPress={() => handleRemoveItem(idx)} hitSlop={8}>
                        <Icon name="x" size={16} color="#9ca3af" />
                      </TouchableOpacity>
                    </View>
                    <View style={styles.itemGrid3}>
                      <View>
                        <Text style={styles.itemFieldLabel}>Cant.</Text>
                        <TextInput
                          style={styles.itemFieldInput}
                          value={String(item.quantity)}
                          onChangeText={(v) => handleItemChange(idx, 'quantity', Number(v) || 0)}
                          keyboardType="numeric"
                        />
                      </View>
                      <View>
                        <Text style={styles.itemFieldLabel}>P. Unit.</Text>
                        <TextInput
                          style={styles.itemFieldInput}
                          value={String(item.unit_cost)}
                          onChangeText={(v) => handleItemChange(idx, 'unit_cost', Number(v) || 0)}
                          keyboardType="numeric"
                        />
                      </View>
                      <View>
                        <Text style={styles.itemFieldLabel}>Total</Text>
                        <Text style={styles.itemTotalValue}>{formatCurrency(item.quantity * item.unit_cost)}</Text>
                      </View>
                    </View>
                  </View>
                ))}

                {/* Totals */}
                <View style={styles.totalsCard}>
                  <View style={styles.totalRow}>
                    <Text style={styles.totalLabel}>Subtotal</Text>
                    <Text style={styles.totalValue}>{formatCurrency(subtotal)}</Text>
                  </View>
                  <View style={styles.totalRow}>
                    <Text style={styles.totalLabel}>Impuestos</Text>
                    <Text style={styles.totalValue}>$0</Text>
                  </View>
                  <View style={[styles.totalRow, styles.totalRowBorder]}>
                    <Text style={styles.totalLabelBold}>Total</Text>
                    <Text style={styles.totalValueBold}>{formatCurrency(subtotal)}</Text>
                  </View>
                </View>
              </View>
            )}
          </ScrollView>

          {/* Footer */}
          <View style={styles.footer}>
            <View style={styles.footerLeft}>
              {currentStep === 3 && (
                <TouchableOpacity style={styles.rescanBtn} onPress={reset}>
                  <Text style={styles.rescanBtnText}>Escanear otra</Text>
                </TouchableOpacity>
              )}
            </View>
            <View style={styles.footerRight}>
              <TouchableOpacity style={styles.cancelBtn} onPress={handleClose}>
                <Text style={styles.cancelBtnText}>Cancelar</Text>
              </TouchableOpacity>
              {currentStep === 1 && (
                <TouchableOpacity
                  style={[styles.primaryBtn, !imageUri && styles.primaryBtnDisabled]}
                  onPress={handleStartScan}
                  disabled={!imageUri}
                >
                  <Text style={[styles.primaryBtnText, !imageUri && styles.primaryBtnTextDisabled]}>
                    Analizar Factura
                  </Text>
                </TouchableOpacity>
              )}
              {currentStep === 3 && (
                <TouchableOpacity
                  style={styles.primaryBtn}
                  onPress={handleConfirm}
                >
                  <Text style={styles.primaryBtnText}>Agregar al Carrito</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  modal: { backgroundColor: '#fff', borderRadius: 16, width: '100%', maxWidth: 480, maxHeight: '92%', shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 24, elevation: 8 },

  /* Header */
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4 },
  headerTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 16, fontWeight: '700', color: '#111827' },
  subheader: { paddingHorizontal: 16, paddingBottom: 8 },
  subtitle: { fontSize: 12, color: '#6b7280' },

  /* Steps */
  stepsRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#e5e7eb' },
  stepItem: { alignItems: 'center', gap: 4 },
  stepCircle: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#f3f4f6', alignItems: 'center', justifyContent: 'center' },
  stepCircleActive: { backgroundColor: colors.primary },
  stepCircleDone: { backgroundColor: colors.primary },
  stepNum: { fontSize: 11, fontWeight: '700', color: '#9ca3af' },
  stepNumActive: { color: '#fff' },
  stepNumDone: { color: '#fff' },
  stepLabel: { fontSize: 10, fontWeight: '600', color: '#9ca3af' },
  stepLabelActive: { color: colors.primary },
  stepLabelDone: { color: colors.primary },
  stepLine: { flex: 1, height: 2, backgroundColor: '#e5e7eb', marginHorizontal: 6, marginBottom: 16 },
  stepLineDone: { backgroundColor: colors.primary },

  /* Body */
  body: { flexGrow: 0, flexShrink: 1, maxHeight: 480 },
  bodyContent: { padding: 16, gap: 16 },

  /* Step 1 */
  step1Content: { gap: 12 },
  cameraBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.primary, paddingVertical: 12, borderRadius: 10,
  },
  cameraBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  dropzone: {
    borderWidth: 2, borderColor: '#d1d5db', borderStyle: 'dashed', borderRadius: 12,
    paddingVertical: 32, alignItems: 'center', gap: 8,
  },
  dropzoneIconWrap: { padding: 10, backgroundColor: 'rgba(34,197,94,0.1)', borderRadius: 50 },
  dropzoneTitle: { fontSize: 14, fontWeight: '700', color: '#111827' },
  dropzoneSubtitle: { fontSize: 12, color: '#6b7280' },
  filePreviewWrap: { alignItems: 'center', gap: 8, backgroundColor: '#f0fdf4', borderRadius: 12, borderWidth: 1, borderColor: '#22C55E', padding: 16 },
  previewImage: { width: '100%', height: 140, borderRadius: 8, resizeMode: 'contain' },
  fileNameText: { fontSize: 13, fontWeight: '600', color: '#111827' },
  fileReadyRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  fileReadyText: { fontSize: 12, fontWeight: '600', color: '#059669' },
  fileProcessingText: { fontSize: 12, fontWeight: '600', color: '#6b7280' },
  changeFileText: { fontSize: 12, fontWeight: '600', color: colors.primary, textDecorationLine: 'underline' },

  /* Step 2 */
  step2Content: { gap: 16 },
  step2Preview: { borderRadius: 8, overflow: 'hidden' },
  step2Image: { width: '100%', height: 160, resizeMode: 'contain', borderRadius: 8, borderWidth: 1, borderColor: '#e5e7eb' },
  analyzingBox: { alignItems: 'center', paddingVertical: 24, gap: 10 },
  analyzingText: { fontSize: 16, fontWeight: '700', color: '#374151' },
  analyzingSubtext: { fontSize: 13, color: '#6b7280', textAlign: 'center', paddingHorizontal: 20 },

  /* Step 3 */
  step3Content: { gap: 12 },
  supplierCard: { backgroundColor: '#f9fafb', borderRadius: 10, borderWidth: 1, borderColor: '#e5e7eb', padding: 12, gap: 6 },
  supplierCardRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  supplierCardLabel: { fontSize: 13, fontWeight: '600', color: '#374151' },
  supplierBadge: { backgroundColor: '#dcfce7', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  supplierBadgeText: { fontSize: 10, fontWeight: '700', color: '#16a34a' },
  supplierCardName: { fontSize: 15, fontWeight: '600', color: '#111827' },

  invoiceFieldsRow: { flexDirection: 'row', gap: 10 },
  invoiceField: { flex: 1 },
  fieldLabel: { fontSize: 11, fontWeight: '700', color: '#6b7280', marginBottom: 4 },
  fieldInput: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, color: '#111827' },

  itemsTitle: { fontSize: 13, fontWeight: '700', color: '#374151', marginTop: 4 },

  itemCard: { backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#e5e7eb', padding: 12, gap: 8 },
  itemCardHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  itemDescription: { flex: 1, fontSize: 13, fontWeight: '600', color: '#111827' },
  itemGrid3: { flexDirection: 'row', gap: 8 },
  itemFieldLabel: { fontSize: 9, fontWeight: '600', color: '#6b7280', textTransform: 'uppercase', marginBottom: 2 },
  itemFieldInput: { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 6, fontSize: 13, fontWeight: '600', color: '#111827', textAlign: 'center' },
  itemTotalValue: { fontSize: 13, fontWeight: '700', color: '#059669', textAlign: 'center', paddingVertical: 6 },

  totalsCard: { backgroundColor: '#f9fafb', borderRadius: 10, borderWidth: 1, borderColor: '#e5e7eb', padding: 12, gap: 6 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between' },
  totalRowBorder: { borderTopWidth: 1, borderTopColor: '#e5e7eb', paddingTop: 6 },
  totalLabel: { fontSize: 13, color: '#6b7280' },
  totalValue: { fontSize: 13, fontWeight: '600', color: '#374151' },
  totalLabelBold: { fontSize: 14, fontWeight: '700', color: '#111827' },
  totalValueBold: { fontSize: 16, fontWeight: '800', color: '#059669' },

  /* Footer */
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#e5e7eb' },
  footerLeft: { flex: 1 },
  footerRight: { flexDirection: 'row', gap: 8 },
  rescanBtn: { paddingVertical: 8, paddingHorizontal: 4 },
  rescanBtnText: { fontSize: 13, fontWeight: '600', color: colors.primary },
  cancelBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8, borderWidth: 1, borderColor: '#d1d5db' },
  cancelBtnText: { fontSize: 13, fontWeight: '600', color: '#374151' },
  primaryBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8, backgroundColor: colors.primary },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryBtnText: { fontSize: 13, fontWeight: '700', color: '#fff' },
  primaryBtnTextDisabled: { color: '#fff' },
});
