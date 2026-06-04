import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as XLSX from 'xlsx';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

interface ImportedItem {
  name: string;
  sku: string;
  quantity: number;
  unit_cost: number;
  cost_price: number;
  base_price: number;
  status: 'ready' | 'warning' | 'error';
  warnings: string[];
  errors: string[];
}

interface AnalysisResult {
  total: number;
  valid: number;
  warnings: number;
  errors: number;
  items: ImportedItem[];
}

interface PopBulkModalProps {
  visible: boolean;
  onClose: () => void;
  onDataLoaded?: (items: ImportedItem[]) => void;
}

export default function PopBulkModal({ visible, onClose, onDataLoaded }: PopBulkModalProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [selectedFile, setSelectedFile] = useState<{ name: string; size: number } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [importedItems, setImportedItems] = useState<ImportedItem[]>([]);

  useEffect(() => {
    if (visible) {
      setCurrentStep(0);
      setSelectedFile(null);
      setIsProcessing(false);
      setAnalysisResult(null);
      setImportedItems([]);
    }
  }, [visible]);

  const steps = [
    { label: 'Preparar', icon: 'file-text-outline' },
    { label: 'Revisar', icon: 'search-outline' },
    { label: 'Confirmar', icon: 'checkmark-circle-outline' },
  ];

  const downloadTemplate = async (type: 'quick' | 'complete') => {
    try {
      const wb = XLSX.utils.book_new();
      const headers = type === 'quick'
        ? ['Nombre', 'SKU', 'Tipo', 'Precio Venta', 'Precio Compra', 'Cantidad Inicial']
        : ['Nombre', 'SKU', 'Tipo', 'Precio Venta', 'Precio Compra', 'Cantidad Inicial', 'Descripción', 'Marca', 'Categorías', 'Estado', 'Disponible Ecommerce', 'Peso'];
      const examples = type === 'quick'
        ? [['Camiseta Básica Blanca', 'CAM-BAS-BLA-001', 'Producto', '15000', '8000', '50']]
        : [['Camiseta Básica Blanca', 'CAM-BAS-BLA-001', 'Producto', '15000', '8000', '50', 'Camiseta 100% algodón', 'Marca Ejemplo', 'Ropa/Camisetas', 'Nuevo', 'Sí', '0.2']];

      const ws = XLSX.utils.aoa_to_sheet([headers, ...examples]);
      ws['!cols'] = headers.map(() => ({ wch: 20 }));
      XLSX.utils.book_append_sheet(wb, ws, 'Productos');

      const wbout = XLSX.write(wb, { type: 'binary', bookType: 'xlsx' });
      const base64 = btoa(wbout);
      const uri = FileSystem.cacheDirectory + `plantilla-pedido-${type}.xlsx`;
      await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          dialogTitle: `Plantilla ${type === 'quick' ? 'Rápida' : 'Completa'}`,
        });
      }
    } catch (err) {
      console.error('Error generating template:', err);
    }
  };

  const handlePickFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-excel',
          'text/csv',
        ],
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) return;

      const file = result.assets[0];
      setSelectedFile({ name: file.name, size: file.size ?? 0 });
    } catch (err) {
      console.error('Error picking file:', err);
    }
  };

  const handleAnalyzeFile = () => {
    if (!selectedFile) return;
    setIsProcessing(true);
    setCurrentStep(1);

    setTimeout(() => {
      const mockItems: ImportedItem[] = [
        {
          name: 'Camiseta Básica Blanca', sku: 'CAM-BAS-BLA-001', quantity: 50, unit_cost: 8000, cost_price: 8000, base_price: 15000,
          status: 'ready', warnings: [], errors: [],
        },
        {
          name: 'Pantalón Jean Clásico', sku: 'PAN-JEA-CLA-032', quantity: 30, unit_cost: 22000, cost_price: 22000, base_price: 45000,
          status: 'ready', warnings: [], errors: [],
        },
        {
          name: 'Producto existente duplicado', sku: 'DUP-001', quantity: 5, unit_cost: 0, cost_price: 0, base_price: 0,
          status: 'warning', warnings: ['Precio de compra no especificado', 'Producto duplicado en catálogo'], errors: [],
        },
        {
          name: '', sku: '', quantity: 0, unit_cost: 0, cost_price: 0, base_price: 0,
          status: 'error', warnings: [], errors: ['Falta nombre y SKU'],
        },
      ];

      const result: AnalysisResult = {
        total: mockItems.length,
        valid: mockItems.filter((i) => i.status === 'ready').length,
        warnings: mockItems.filter((i) => i.status === 'warning').length,
        errors: mockItems.filter((i) => i.status === 'error').length,
        items: mockItems,
      };

      setAnalysisResult(result);
      setIsProcessing(false);
    }, 1500);
  };

  const handleConfirmImport = () => {
    if (!analysisResult) return;
    const valid = analysisResult.items.filter((i) => i.status !== 'error');
    setImportedItems(valid);
    setCurrentStep(2);
    if (onDataLoaded) onDataLoaded(valid);
  };

  const handleClose = () => {
    onClose();
  };

  const totalValid = analysisResult ? analysisResult.items.filter((i) => i.status !== 'error').length : 0;

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <View style={styles.modal}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTitle}>
              <Ionicons name="cloud-upload-outline" size={22} color="#22C55E" />
              <Text style={styles.title}>Carga Masiva al Pedido</Text>
            </View>
            <TouchableOpacity onPress={handleClose}>
              <Ionicons name="close" size={22} color="#6b7280" />
            </TouchableOpacity>
          </View>

          {/* Steps indicator */}
          <View style={styles.stepsRow}>
            {steps.map((s, idx) => (
              <React.Fragment key={s.label}>
                <View style={styles.stepItem}>
                  <View style={[styles.stepCircle, idx <= currentStep && styles.stepCircleActive, idx < currentStep && styles.stepCircleDone]}>
                    {idx < currentStep ? (
                      <Ionicons name="checkmark" size={12} color="#fff" />
                    ) : (
                      <Text style={[styles.stepNumber, idx === currentStep && styles.stepNumberActive]}>{idx + 1}</Text>
                    )}
                  </View>
                  <Text style={[styles.stepLabel, idx <= currentStep && styles.stepLabelActive]}>{s.label}</Text>
                </View>
                {idx < steps.length - 1 && <View style={[styles.stepLine, idx < currentStep && styles.stepLineDone]} />}
              </React.Fragment>
            ))}
          </View>

          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled">
            {/* STEP 0: Preparar */}
            {currentStep === 0 && (
              <View style={styles.stepContainer}>
                {/* Info banner */}
                <View style={styles.infoBanner}>
                  <Ionicons name="information-circle" size={16} color="#2563eb" />
                  <View style={styles.infoBannerText}>
                    <Text style={styles.infoBannerTitle}>Prepara tu archivo</Text>
                    <Text style={styles.infoBannerDesc}>
                      Descarga la plantilla, completa los datos de tus productos y sube el archivo. Formatos: .xlsx, .xls, .csv · Máx. 1000 productos.
                    </Text>
                  </View>
                </View>

                {/* Template download cards */}
                <Text style={styles.sectionLabel}>1. Descarga una plantilla</Text>
                <View style={styles.templateRow}>
                  <TouchableOpacity style={styles.templateCard} onPress={() => downloadTemplate('quick')} activeOpacity={0.7}>
                    <View style={[styles.templateIconWrap, { backgroundColor: '#e0e7ff' }]}>
                      <Ionicons name="checkmark-circle" size={18} color="#4f46e5" />
                    </View>
                    <View style={styles.templateText}>
                      <Text style={[styles.templateTitle, { color: '#1e1b4b' }]}>Plantilla Rápida</Text>
                      <Text style={[styles.templateDesc, { color: '#4338ca' }]}>Solo campos indispensables</Text>
                    </View>
                    <View style={[styles.downloadBtn, { backgroundColor: '#e0e7ff' }]}>
                      <Ionicons name="download-outline" size={14} color="#4f46e5" />
                    </View>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.templateCard, { borderColor: '#bbf7d0' }]} onPress={() => downloadTemplate('complete')} activeOpacity={0.7}>
                    <View style={[styles.templateIconWrap, { backgroundColor: '#dcfce7' }]}>
                      <Ionicons name="document-text" size={18} color="#16a34a" />
                    </View>
                    <View style={styles.templateText}>
                      <Text style={[styles.templateTitle, { color: '#14532d' }]}>Plantilla Completa</Text>
                      <Text style={[styles.templateDesc, { color: '#16a34a' }]}>Todos los datos disponibles</Text>
                    </View>
                    <View style={[styles.downloadBtn, { backgroundColor: '#dcfce7' }]}>
                      <Ionicons name="download-outline" size={14} color="#16a34a" />
                    </View>
                  </TouchableOpacity>
                </View>

                {/* Warning banner */}
                <View style={styles.warningBanner}>
                  <Ionicons name="alert-triangle" size={14} color="#d97706" />
                  <Text style={styles.warningText}>
                    <Text style={{ fontWeight: '600' }}>Importante:</Text> Los productos nuevos no existentes en el catálogo se crearán automáticamente al confirmar la orden.
                  </Text>
                </View>

                {/* File upload */}
                <Text style={styles.sectionLabel}>2. Sube tu archivo</Text>
                <TouchableOpacity style={styles.dropZone} onPress={handlePickFile} activeOpacity={0.7}>
                  {selectedFile ? (
                    <>
                      <Ionicons name="document-text-outline" size={36} color="#22C55E" />
                      <Text style={styles.fileName}>{selectedFile.name}</Text>
                      <Text style={styles.fileSize}>{formatFileSize(selectedFile.size)}</Text>
                    </>
                  ) : (
                    <>
                      <Ionicons name="cloud-upload-outline" size={36} color="#9ca3af" />
                      <Text style={styles.dropTitle}>Arrastra tu archivo Excel aquí</Text>
                      <Text style={styles.dropDesc}>o haz clic para seleccionar · .xlsx, .xls, .csv · Máximo 5 MB</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            )}

            {/* STEP 1: Revisar */}
            {currentStep === 1 && (
              <View style={styles.stepContainer}>
                {isProcessing ? (
                  <View style={styles.loadingState}>
                    <ActivityIndicator size="large" color="#22C55E" />
                    <Text style={styles.loadingText}>Procesando archivo...</Text>
                    <Text style={styles.loadingSubtext}>Verificando productos y datos</Text>
                  </View>
                ) : analysisResult && (
                  <>
                    {/* Stats cards */}
                    <View style={styles.statsRow}>
                      <View style={[styles.statCard, { backgroundColor: '#eff6ff', borderColor: '#bfdbfe' }]}>
                        <Text style={[styles.statValue, { color: '#2563eb' }]}>{analysisResult.total}</Text>
                        <Text style={[styles.statLabel, { color: '#2563eb' }]}>Total</Text>
                      </View>
                      <View style={[styles.statCard, { backgroundColor: '#f0fdf4', borderColor: '#bbf7d0' }]}>
                        <Text style={[styles.statValue, { color: '#16a34a' }]}>{analysisResult.valid}</Text>
                        <Text style={[styles.statLabel, { color: '#16a34a' }]}>Listos</Text>
                      </View>
                      <View style={[styles.statCard, { backgroundColor: '#fffbeb', borderColor: '#fde68a' }]}>
                        <Text style={[styles.statValue, { color: '#d97706' }]}>{analysisResult.warnings}</Text>
                        <Text style={[styles.statLabel, { color: '#d97706' }]}>Advertencias</Text>
                      </View>
                      <View style={[styles.statCard, { backgroundColor: '#fef2f2', borderColor: '#fecaca' }]}>
                        <Text style={[styles.statValue, { color: '#dc2626' }]}>{analysisResult.errors}</Text>
                        <Text style={[styles.statLabel, { color: '#dc2626' }]}>Errores</Text>
                      </View>
                    </View>

                    {/* Item list */}
                    <View style={styles.itemList}>
                      {analysisResult.items.map((item, idx) => (
                        <View key={idx} style={styles.itemCard}>
                          <View style={styles.itemHeader}>
                            <Text style={styles.itemName} numberOfLines={1}>{item.name || '—'}</Text>
                            <View style={[
                              styles.statusBadge,
                              item.status === 'ready' && { backgroundColor: '#dcfce7' },
                              item.status === 'warning' && { backgroundColor: '#fef3c7' },
                              item.status === 'error' && { backgroundColor: '#fecaca' },
                            ]}>
                              <Text style={[
                                styles.statusText,
                                item.status === 'ready' && { color: '#16a34a' },
                                item.status === 'warning' && { color: '#d97706' },
                                item.status === 'error' && { color: '#dc2626' },
                              ]}>
                                {item.status === 'ready' ? 'Listo' : item.status === 'warning' ? 'Advertencia' : 'Error'}
                              </Text>
                            </View>
                          </View>
                          <Text style={styles.itemSku}>{item.sku || '—'}</Text>
                          <View style={styles.itemDetailsRow}>
                            <Text style={styles.itemDetail}>Cant: {item.quantity}</Text>
                            <Text style={styles.itemDetail}>Compra: ${Number(item.cost_price || 0).toLocaleString()}</Text>
                            <Text style={styles.itemDetail}>Venta: ${Number(item.base_price || 0).toLocaleString()}</Text>
                          </View>
                          {(item.warnings.length > 0 || item.errors.length > 0) && (
                            <View style={styles.issuesList}>
                              {item.warnings.map((w, wi) => (
                                <View key={wi} style={styles.issueRow}>
                                  <Ionicons name="alert-triangle" size={12} color="#d97706" />
                                  <Text style={styles.issueWarning}>{w}</Text>
                                </View>
                              ))}
                              {item.errors.map((e, ei) => (
                                <View key={ei} style={styles.issueRow}>
                                  <Ionicons name="close-circle" size={12} color="#dc2626" />
                                  <Text style={styles.issueError}>{e}</Text>
                                </View>
                              ))}
                            </View>
                          )}
                        </View>
                      ))}
                    </View>
                  </>
                )}
              </View>
            )}

            {/* STEP 2: Confirmar */}
            {currentStep === 2 && (
              <View style={styles.stepContainer}>
                {/* Success banner */}
                <View style={styles.successBanner}>
                  <Ionicons name="checkmark-circle" size={24} color="#16a34a" />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.successTitle}>Productos importados al pedido</Text>
                    <Text style={styles.successDesc}>
                      Se agregaron {importedItems.length} productos al pedido de compra.
                    </Text>
                  </View>
                </View>

                {/* Catalog notice */}
                <View style={styles.catalogNotice}>
                  <Ionicons name="cube-outline" size={20} color="#16a34a" />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.catalogTitle}>Productos nuevos serán creados en el catálogo</Text>
                    <Text style={styles.catalogDesc}>
                      Los productos que no existan en el catálogo se crearán automáticamente. Los productos existentes recibirán stock con costo trazable y respaldo contable.
                    </Text>
                  </View>
                </View>

                {/* Imported items summary */}
                <View style={styles.importSummary}>
                  <View style={styles.importHeader}>
                    <Ionicons name="list-outline" size={16} color="#374151" />
                    <Text style={styles.importHeaderText}>Productos Importados</Text>
                  </View>
                  <ScrollView style={styles.importList} nestedScrollEnabled>
                    {importedItems.map((item, idx) => (
                      <View key={idx} style={styles.importRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.importRowName} numberOfLines={1}>{item.name || '—'}</Text>
                          <Text style={styles.importRowSku}>{item.sku}</Text>
                        </View>
                        <Text style={styles.importRowQty}>{item.quantity}</Text>
                        <Text style={styles.importRowPrice}>${Number(item.cost_price || 0).toLocaleString()}</Text>
                      </View>
                    ))}
                  </ScrollView>
                </View>
              </View>
            )}
          </ScrollView>

          {/* Footer */}
          <View style={styles.footer}>
            {(currentStep === 0) && (
              <>
                <TouchableOpacity style={styles.cancelBtn} onPress={handleClose}>
                  <Text style={styles.cancelText}>Cancelar</Text>
                </TouchableOpacity>
                {selectedFile && (
                  <TouchableOpacity style={styles.primaryBtn} onPress={handleAnalyzeFile}>
                    <Ionicons name="search-outline" size={16} color="#fff" />
                    <Text style={styles.primaryBtnText}>Analizar Archivo</Text>
                  </TouchableOpacity>
                )}
              </>
            )}
            {(currentStep === 1 && !isProcessing) && (
              <>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setCurrentStep(0)}>
                  <Ionicons name="arrow-back" size={16} color="#374151" />
                  <Text style={styles.cancelText}>Atrás</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.cancelBtn} onPress={handleClose}>
                  <Text style={styles.cancelText}>Cancelar</Text>
                </TouchableOpacity>
                {analysisResult && totalValid > 0 && (
                  <TouchableOpacity style={styles.primaryBtn} onPress={handleConfirmImport}>
                    <Ionicons name="cube-outline" size={16} color="#fff" />
                    <Text style={styles.primaryBtnText}>Agregar al pedido ({totalValid})</Text>
                  </TouchableOpacity>
                )}
              </>
            )}
            {(currentStep === 2) && (
              <TouchableOpacity style={styles.cancelBtn} onPress={handleClose}>
                <Text style={styles.cancelText}>Cerrar</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modal: { backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '92%' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#e5e7eb' },
  headerTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 16, fontWeight: '700', color: '#111827' },

  // Steps
  stepsRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#f9fafb', borderBottomWidth: 1, borderBottomColor: '#e5e7eb' },
  stepItem: { alignItems: 'center', gap: 4 },
  stepCircle: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#e5e7eb', alignItems: 'center', justifyContent: 'center' },
  stepCircleActive: { backgroundColor: '#22C55E' },
  stepCircleDone: { backgroundColor: '#22C55E' },
  stepNumber: { fontSize: 10, fontWeight: '700', color: '#9ca3af' },
  stepNumberActive: { color: '#fff' },
  stepLabel: { fontSize: 9, fontWeight: '600', color: '#9ca3af' },
  stepLabelActive: { color: '#22C55E' },
  stepLine: { flex: 1, height: 2, backgroundColor: '#e5e7eb', marginHorizontal: 4, marginTop: -10 },
  stepLineDone: { backgroundColor: '#22C55E' },

  body: { paddingHorizontal: 16 },
  bodyContent: { paddingTop: 16, paddingBottom: 24 },

  stepContainer: { gap: 12 },

  // Info banner
  infoBanner: { flexDirection: 'row', gap: 8, backgroundColor: '#eff6ff', borderRadius: 10, borderWidth: 1, borderColor: '#bfdbfe', padding: 10, alignItems: 'flex-start' },
  infoBannerText: { flex: 1 },
  infoBannerTitle: { fontSize: 11, fontWeight: '700', color: '#1e40af' },
  infoBannerDesc: { fontSize: 10, color: '#1e3a8a', marginTop: 2, lineHeight: 14 },

  sectionLabel: { fontSize: 11, fontWeight: '600', color: '#374151', marginTop: 2 },

  // Template cards
  templateRow: { flexDirection: 'row', gap: 8 },
  templateCard: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: '#c7d2fe', backgroundColor: '#eef2ff', borderRadius: 8, padding: 10 },
  templateIconWrap: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  templateText: { flex: 1 },
  templateTitle: { fontSize: 10, fontWeight: '700' },
  templateDesc: { fontSize: 8, marginTop: 1 },
  downloadBtn: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },

  // Warning banner
  warningBanner: { flexDirection: 'row', gap: 8, backgroundColor: '#fffbeb', borderRadius: 8, borderWidth: 1, borderColor: '#fde68a', padding: 10, alignItems: 'flex-start' },
  warningText: { fontSize: 10, color: '#92400e', flex: 1, lineHeight: 14 },

  // Drop zone
  dropZone: { borderWidth: 2, borderStyle: 'dashed', borderColor: '#d1d5db', borderRadius: 10, paddingVertical: 24, paddingHorizontal: 16, alignItems: 'center', gap: 6, backgroundColor: '#fff' },
  dropTitle: { fontSize: 13, fontWeight: '600', color: '#111827', textAlign: 'center' },
  dropDesc: { fontSize: 11, color: '#6b7280', textAlign: 'center' },
  fileName: { fontSize: 13, fontWeight: '600', color: '#111827', textAlign: 'center' },
  fileSize: { fontSize: 11, color: '#6b7280' },

  // Loading
  loadingState: { alignItems: 'center', justifyContent: 'center', paddingVertical: 48, gap: 8 },
  loadingText: { fontSize: 14, fontWeight: '600', color: '#111827' },
  loadingSubtext: { fontSize: 11, color: '#6b7280' },

  // Stats
  statsRow: { flexDirection: 'row', gap: 6 },
  statCard: { flex: 1, borderRadius: 8, padding: 10, alignItems: 'center', borderWidth: 1 },
  statValue: { fontSize: 18, fontWeight: '800' },
  statLabel: { fontSize: 8, fontWeight: '700', marginTop: 2, textTransform: 'uppercase' },

  // Item list
  itemList: { gap: 8 },
  itemCard: { backgroundColor: '#fff', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#e5e7eb', gap: 6 },
  itemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  itemName: { fontSize: 12, fontWeight: '600', color: '#111827', flex: 1, marginRight: 8 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  statusText: { fontSize: 9, fontWeight: '700' },
  itemSku: { fontSize: 10, color: '#6b7280', fontFamily: 'monospace' },
  itemDetailsRow: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  itemDetail: { fontSize: 10, color: '#374151' },
  issuesList: { borderTopWidth: 1, borderTopColor: '#f3f4f6', paddingTop: 6, gap: 3 },
  issueRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 4 },
  issueWarning: { fontSize: 10, color: '#92400e', flex: 1 },
  issueError: { fontSize: 10, color: '#dc2626', flex: 1 },

  // Success
  successBanner: { flexDirection: 'row', gap: 10, backgroundColor: '#f0fdf4', borderRadius: 10, borderWidth: 1, borderColor: '#bbf7d0', padding: 12, alignItems: 'flex-start' },
  successTitle: { fontSize: 12, fontWeight: '700', color: '#14532d' },
  successDesc: { fontSize: 10, color: '#166534', marginTop: 2 },

  catalogNotice: { flexDirection: 'row', gap: 10, backgroundColor: '#f0fdf4', borderRadius: 8, borderWidth: 1, borderColor: '#86efac', padding: 12, alignItems: 'flex-start' },
  catalogTitle: { fontSize: 11, fontWeight: '700', color: '#14532d' },
  catalogDesc: { fontSize: 10, color: '#166534', marginTop: 2, lineHeight: 14 },

  importSummary: { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, overflow: 'hidden' },
  importHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#f9fafb', paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#e5e7eb' },
  importHeaderText: { fontSize: 11, fontWeight: '600', color: '#374151' },
  importList: { maxHeight: 200 },
  importRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f3f4f6', gap: 8 },
  importRowName: { fontSize: 11, fontWeight: '500', color: '#111827' },
  importRowSku: { fontSize: 9, color: '#6b7280', fontFamily: 'monospace', marginTop: 1 },
  importRowQty: { fontSize: 11, fontWeight: '600', color: '#374151', minWidth: 30, textAlign: 'right' },
  importRowPrice: { fontSize: 11, fontWeight: '600', color: '#374151', minWidth: 60, textAlign: 'right' },

  // Footer
  footer: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#e5e7eb', backgroundColor: '#f9fafb', flexWrap: 'wrap' },
  cancelBtn: { flexDirection: 'row', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: '#d1d5db', alignItems: 'center', gap: 4, backgroundColor: '#fff' },
  cancelText: { fontSize: 12, fontWeight: '700', color: '#374151' },
  primaryBtn: { flex: 1, flexDirection: 'row', paddingVertical: 10, borderRadius: 10, backgroundColor: '#22C55E', alignItems: 'center', justifyContent: 'center', gap: 6, minWidth: 120 },
  primaryBtnText: { fontSize: 12, fontWeight: '700', color: '#fff' },
});
