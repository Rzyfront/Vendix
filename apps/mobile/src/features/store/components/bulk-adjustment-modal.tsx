import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Modal } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { Icon } from '@/shared/components/icon/icon';
import { Spinner } from '@/shared/components/spinner/spinner';
import { colors, colorScales, spacing, borderRadius, typography, shadows } from '@/shared/theme';
import { InventoryService } from '@/features/store/services/inventory.service';
import { ADJUSTMENT_STATS, ADJUSTMENT_TYPE_OPTIONS, LOCATION_TYPE_OPTIONS } from '@/features/store/constants/inventory-labels';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';

export interface BulkResultItem {
  row_number: number;
  sku: string;
  product_name?: string;
  status: 'success' | 'error';
  message?: string;
  quantity_change?: number;
}

export interface BulkUploadResult {
  total_processed: number;
  successful: number;
  failed: number;
  results: BulkResultItem[];
}

/**
 * BulkAdjustmentModal — wizard de 3 pasos idéntico al web:
 *  1) Configuración (ubicación + tipo + descripción)
 *  2) Subir archivo (drop zone xlsx/xls/csv)
 *  3) Resultado (Total / Exitosos / Fallidos + tabla)
 */
export default function BulkAdjustmentModal({
  visible,
  onClose,
  locations,
  onCompleted,
}: {
  visible: boolean;
  onClose: () => void;
  locations: Array<{ value: number; label: string }>;
  onCompleted?: () => void;
}) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState(1);
  const [selectedLocationId, setSelectedLocationId] = useState<number | null>(null);
  const [selectedAdjustmentType, setSelectedAdjustmentType] = useState<string>('count_variance');
  const [description, setDescription] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<{
    uri: string;
    name: string;
    size?: number;
    type?: string;
  } | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<BulkUploadResult | null>(null);
  const [showTypeDropdown, setShowTypeDropdown] = useState(false);

  const resetState = () => {
    setStep(1);
    setSelectedFile(null);
    setUploadResult(null);
    setIsUploading(false);
    setIsDownloading(false);
    setDescription('');
    setShowTypeDropdown(false);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const handleDownloadTemplate = async () => {
    setIsDownloading(true);
    try {
      const base64 = await InventoryService.downloadAdjustmentTemplate(selectedLocationId ?? undefined);
      const fileName = `plantilla_ajuste_inventario_${new Date().toISOString().split('T')[0]}.xlsx`;
      const baseDir = (FileSystem as any).documentDirectory ?? (FileSystem as any).cacheDirectory ?? '';
      const fileUri = `${baseDir}${fileName}`;
      await (FileSystem as any).writeAsStringAsync(fileUri, base64, {
        encoding: (FileSystem as any).EncodingType?.Base64 ?? 'base64',
      });
      toastSuccess(`Plantilla guardada: ${fileName}`);
      try {
        if (await (Sharing as any).isAvailableAsync()) {
          await (Sharing as any).shareAsync(fileUri, {
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            dialogTitle: 'Compartir plantilla',
            UTI: 'org.openxmlformats.spreadsheetml.sheet',
          });
        }
      } catch {
        // Sharing opcional
      }
    } catch (e: any) {
      toastError(e?.message || 'Error al descargar plantilla');
    } finally {
      setIsDownloading(false);
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
      if (!result.canceled && result.assets[0]) {
        const a = result.assets[0];
        setSelectedFile({
          uri: a.uri,
          name: a.name,
          size: a.size,
          type: a.mimeType,
        });
      }
    } catch (e: any) {
      toastError('No se pudo seleccionar el archivo');
    }
  };

  const handleUpload = async () => {
    if (!selectedFile || !selectedLocationId) return;
    setIsUploading(true);
    setStep(3);
    try {
      const res = await InventoryService.uploadBulkAdjustments(
        selectedFile,
        selectedLocationId,
        selectedAdjustmentType,
        description || undefined,
      );
      setUploadResult(res);
      queryClient.invalidateQueries({ queryKey: ['adjustments'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-stats'] });
      if (res.failed === 0) {
        toastSuccess(`${res.successful} ajustes aplicados exitosamente`);
      } else {
        toastError(`${res.successful} exitosos, ${res.failed} con errores`);
      }
      onCompleted?.();
    } catch (e: any) {
      console.error('[BulkAdjustmentModal] Upload error:', e);
      toastError(e?.message || 'Error al procesar el archivo');
      setStep(2);
    } finally {
      setIsUploading(false);
    }
  };

  const formatFileSize = (bytes: number | undefined) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const failedItems = uploadResult?.results.filter((r) => r.status === 'error') ?? [];

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={handleClose}>
      <View style={bulkStyles.overlay}>
        <View style={bulkStyles.modal}>
          {/* Header */}
          <View style={bulkStyles.header}>
            <View style={{ flex: 1 }}>
              <Text style={bulkStyles.title}>Ajuste Masivo de Inventario</Text>
              <Text style={bulkStyles.subtitle}>
                Suba un archivo Excel o CSV para ajustar el inventario de múltiples productos
              </Text>
            </View>
            <Pressable onPress={handleClose} hitSlop={8} style={bulkStyles.closeBtn}>
              <Icon name="x" size={22} color={colorScales.gray[500]} />
            </Pressable>
          </View>

          {/* Step Indicator */}
          <View style={bulkStyles.stepsRow}>
            {[1, 2, 3].map((s) => (
              <View key={s} style={bulkStyles.stepRow}>
                <View
                  style={[
                    bulkStyles.stepCircle,
                    step >= s && bulkStyles.stepCircleActive,
                  ]}
                >
                  {step > s ? (
                    <Icon name="check" size={12} color={colors.background} />
                  ) : (
                    <Text
                      style={[
                        bulkStyles.stepNum,
                        step >= s && bulkStyles.stepNumActive,
                      ]}
                    >
                      {`${s}`}
                    </Text>
                  )}
                </View>
                {s < 3 && (
                  <View
                    style={[
                      bulkStyles.stepLine,
                      step > s && bulkStyles.stepLineDone,
                    ]}
                  />
                )}
              </View>
            ))}
          </View>

          <ScrollView
            style={bulkStyles.body}
            contentContainerStyle={bulkStyles.bodyContent}
            showsVerticalScrollIndicator={false}
          >
            {/* STEP 1: Configuración */}
            {step === 1 && (
              <View style={bulkStyles.stepContent}>
                <Text style={bulkStyles.sectionTitle}>Configuración</Text>

                <View>
                  <Text style={bulkStyles.formLabel}>Ubicación / Bodega *</Text>
                  <Pressable
                    onPress={() => setShowTypeDropdown((v) => !v)}
                    style={bulkStyles.selectTrigger}
                  >
                    <Text
                      style={
                        selectedLocationId
                          ? bulkStyles.selectValue
                          : bulkStyles.selectPlaceholder
                      }
                    >
                      {selectedLocationId
                        ? locations.find((l) => l.value === selectedLocationId)?.label
                        : 'Seleccione una ubicación'}
                    </Text>
                    <Icon
                      name={showTypeDropdown ? 'chevron-up' : 'chevron-down'}
                      size={16}
                      color={colorScales.gray[500]}
                    />
                  </Pressable>
                  {showTypeDropdown && (
                    <View style={bulkStyles.selectList}>
                      {locations.length === 0 ? (
                        <Text style={bulkStyles.selectEmpty}>No hay ubicaciones registradas</Text>
                      ) : (
                        locations.map((loc) => (
                          <Pressable
                            key={loc.value}
                            onPress={() => {
                              setSelectedLocationId(loc.value);
                              setShowTypeDropdown(false);
                            }}
                            style={[
                              bulkStyles.selectOption,
                              selectedLocationId === loc.value && bulkStyles.selectOptionActive,
                            ]}
                          >
                            <Text
                              style={[
                                bulkStyles.selectOptionText,
                                selectedLocationId === loc.value && bulkStyles.selectOptionTextActive,
                              ]}
                            >
                              {`${loc.label}`}
                            </Text>
                            {selectedLocationId === loc.value && (
                              <Icon name="check" size={14} color={colors.primary} />
                            )}
                          </Pressable>
                        ))
                      )}
                    </View>
                  )}
                </View>

                <View>
                  <Text style={bulkStyles.formLabel}>Tipo de ajuste (global)</Text>
                  <View style={bulkStyles.typeGrid}>
                    {ADJUSTMENT_TYPE_OPTIONS.map((t) => (
                      <Pressable
                        key={t.value}
                        onPress={() => setSelectedAdjustmentType(t.value)}
                        style={[
                          bulkStyles.typeChip,
                          selectedAdjustmentType === t.value && bulkStyles.typeChipActive,
                        ]}
                      >
                        <Text
                          style={[
                            bulkStyles.typeChipText,
                            selectedAdjustmentType === t.value && bulkStyles.typeChipTextActive,
                          ]}
                        >
                          {`${t.label}`}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>

                <View>
                  <Text style={bulkStyles.formLabel}>Descripción general (opcional)</Text>
                  <TextInput
                    style={bulkStyles.textArea}
                    value={description}
                    onChangeText={setDescription}
                    placeholder="Ej: Conteo físico mensual de marzo"
                    placeholderTextColor={colorScales.gray[400]}
                    multiline
                    numberOfLines={2}
                  />
                </View>

                <View style={bulkStyles.templateRow}>
                  <Pressable
                    style={[
                      bulkStyles.templateBtn,
                      (!selectedLocationId || isDownloading) && bulkStyles.templateBtnDisabled,
                    ]}
                    onPress={handleDownloadTemplate}
                    disabled={!selectedLocationId || isDownloading}
                  >
                    {isDownloading ? (
                      <Spinner size="sm" />
                    ) : (
                      <Icon name="download" size={16} color={colors.primary} />
                    )}
                    <Text style={bulkStyles.templateBtnText}>
                      {isDownloading ? 'Descargando…' : 'Descargar plantilla'}
                    </Text>
                  </Pressable>
                  <Text style={bulkStyles.templateHint}>
                    La plantilla incluirá los productos con stock en la ubicación seleccionada
                  </Text>
                </View>
              </View>
            )}

            {/* STEP 2: Subir archivo */}
            {step === 2 && (
              <View style={bulkStyles.stepContent}>
                <Text style={bulkStyles.sectionTitle}>Subir archivo</Text>

                <Pressable
                  style={[
                    bulkStyles.dropZone,
                    selectedFile && bulkStyles.dropZoneActive,
                  ]}
                  onPress={handlePickFile}
                >
                  {!selectedFile ? (
                    <>
                      <Icon
                        name="upload-cloud"
                        size={40}
                        color={colorScales.gray[400]}
                        style={{ alignSelf: 'center', marginBottom: 12 }}
                      />
                      <Text style={bulkStyles.dropZonePrimary}>
                        Haga clic o arrastre un archivo aquí
                      </Text>
                      <Text style={bulkStyles.dropZoneSecondary}>
                        Formatos aceptados: Excel (.xlsx, .xls) o CSV
                      </Text>
                    </>
                  ) : (
                    <>
                      <Icon
                        name="file-spreadsheet"
                        size={40}
                        color={colors.primary}
                        style={{ alignSelf: 'center', marginBottom: 12 }}
                      />
                      <Text style={bulkStyles.fileName}>{`${selectedFile.name}`}</Text>
                      <Text style={bulkStyles.fileSize}>
                        {`${formatFileSize(selectedFile.size)}`}
                      </Text>
                      <Pressable
                        onPress={() => setSelectedFile(null)}
                        hitSlop={4}
                        style={{ marginTop: 8 }}
                      >
                        <Text style={bulkStyles.removeFileLink}>Eliminar archivo</Text>
                      </Pressable>
                    </>
                  )}
                </Pressable>
              </View>
            )}

            {/* STEP 3: Resultado */}
            {step === 3 && (
              <View style={bulkStyles.stepContent}>
                <Text style={bulkStyles.sectionTitle}>Resultado</Text>

                {isUploading ? (
                  <View style={bulkStyles.uploadingContainer}>
                    <Spinner size="lg" />
                    <Text style={bulkStyles.uploadingText}>Procesando ajustes...</Text>
                  </View>
                ) : null}

                {uploadResult && !isUploading && (
                  <>
                    <View style={bulkStyles.summaryGrid}>
                      <View style={bulkStyles.summaryCard}>
                        <Text style={bulkStyles.summaryValue}>{`${uploadResult.total_processed}`}</Text>
                        <Text style={bulkStyles.summaryLabel}>Total</Text>
                      </View>
                      <View style={[bulkStyles.summaryCard, bulkStyles.summaryCardSuccess]}>
                        <Text
                          style={[
                            bulkStyles.summaryValue,
                            { color: colorScales.green[600] },
                          ]}
                        >
                          {`${uploadResult.successful}`}
                        </Text>
                        <Text style={bulkStyles.summaryLabel}>Exitosos</Text>
                      </View>
                      <View style={[bulkStyles.summaryCard, bulkStyles.summaryCardError]}>
                        <Text
                          style={[
                            bulkStyles.summaryValue,
                            { color: colorScales.red[600] },
                          ]}
                        >
                          {`${uploadResult.failed}`}
                        </Text>
                        <Text style={bulkStyles.summaryLabel}>Fallidos</Text>
                      </View>
                    </View>

                    <View style={bulkStyles.tableContainer}>
                      <View style={bulkStyles.tableHeader}>
                        <Text style={[bulkStyles.tableCell, bulkStyles.tableCellHeader]}>Fila</Text>
                        <Text style={[bulkStyles.tableCell, bulkStyles.tableCellHeader]}>Sku</Text>
                        <Text style={[bulkStyles.tableCell, bulkStyles.tableCellHeader]}>Producto</Text>
                        <Text style={[bulkStyles.tableCell, bulkStyles.tableCellHeader, bulkStyles.tableCellCenter]}>Cambio</Text>
                        <Text style={[bulkStyles.tableCell, bulkStyles.tableCellHeader, bulkStyles.tableCellCenter]}>Estado</Text>
                      </View>
                      <ScrollView style={{ maxHeight: 240 }} nestedScrollEnabled>
                        {uploadResult.results.map((item) => (
                          <View
                            key={item.row_number}
                            style={[
                              bulkStyles.tableRow,
                              item.status === 'error' && bulkStyles.tableRowError,
                            ]}
                          >
                            <Text style={bulkStyles.tableCell}>{`${item.row_number}`}</Text>
                            <Text style={bulkStyles.tableCellMono}>{`${item.sku}`}</Text>
                            <Text style={bulkStyles.tableCell}>{`${item.product_name ?? '—'}`}</Text>
                            <View style={bulkStyles.tableCellCenter}>
                              {item.status === 'success' && item.quantity_change !== undefined ? (
                                <Text
                                  style={[
                                    bulkStyles.tableCell,
                                    {
                                      color:
                                        (item.quantity_change ?? 0) > 0
                                          ? colorScales.green[600]
                                          : (item.quantity_change ?? 0) < 0
                                            ? colorScales.red[600]
                                            : colorScales.gray[400],
                                    },
                                  ]}
                                >
                                  {`${(item.quantity_change ?? 0) > 0 ? '+' : ''}${item.quantity_change}`}
                                </Text>
                              ) : (
                                <Text style={[bulkStyles.tableCell, { color: colorScales.gray[400] }]}>—</Text>
                              )}
                            </View>
                            <View style={bulkStyles.tableCellCenter}>
                              {item.status === 'success' ? (
                                <View style={bulkStyles.badgeOk}>
                                  <Text style={bulkStyles.badgeOkText}>OK</Text>
                                </View>
                              ) : (
                                <View style={bulkStyles.badgeError}>
                                  <Text style={bulkStyles.badgeErrorText}>Error</Text>
                                </View>
                              )}
                            </View>
                          </View>
                        ))}
                      </ScrollView>
                    </View>

                    {failedItems.length > 0 && (
                      <View style={bulkStyles.errorBox}>
                        <Text style={bulkStyles.errorTitle}>Errores encontrados:</Text>
                        {failedItems.map((item) => (
                          <Text key={item.row_number} style={bulkStyles.errorLine}>
                            {`Fila ${item.row_number} (${item.sku}): ${item.message ?? 'Error desconocido'}`}
                          </Text>
                        ))}
                      </View>
                    )}
                  </>
                )}
              </View>
            )}
          </ScrollView>

          {/* Footer */}
          <View style={bulkStyles.footer}>
            <View style={bulkStyles.footerLeft}>
              {step > 1 && step < 3 && (
                <Pressable style={bulkStyles.outlineBtn} onPress={() => setStep(step - 1)}>
                  <Text style={bulkStyles.outlineBtnText}>Atrás</Text>
                </Pressable>
              )}
            </View>
            <View style={bulkStyles.footerRight}>
              <Pressable style={bulkStyles.outlineBtn} onPress={handleClose}>
                <Text style={bulkStyles.outlineBtnText}>
                  {step === 3 ? 'Cerrar' : 'Cancelar'}
                </Text>
              </Pressable>
              {step === 1 && (
                <Pressable
                  style={[
                    bulkStyles.primaryBtn,
                    !selectedLocationId && bulkStyles.primaryBtnDisabled,
                  ]}
                  onPress={() => setStep(2)}
                  disabled={!selectedLocationId}
                >
                  <Text style={bulkStyles.primaryBtnText}>Siguiente</Text>
                </Pressable>
              )}
              {step === 2 && (
                <Pressable
                  style={[
                    bulkStyles.primaryBtn,
                    (!selectedFile || isUploading) && bulkStyles.primaryBtnDisabled,
                  ]}
                  onPress={handleUpload}
                  disabled={!selectedFile || isUploading}
                >
                  {isUploading ? (
                    <Spinner size="sm" />
                  ) : (
                    <Icon name="upload" size={16} color={colors.background} />
                  )}
                  <Text style={bulkStyles.primaryBtnText}>
                    {isUploading ? 'Subiendo…' : 'Subir y Aplicar'}
                  </Text>
                </Pressable>
              )}
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const bulkStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: spacing[4] },
  modal: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.lg,
    borderWidth: 1, borderColor: colorScales.gray[200],
    width: '100%', maxWidth: 640, maxHeight: '92%',
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 24, elevation: 8,
  },
  header: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    paddingHorizontal: spacing[5], paddingTop: spacing[5], paddingBottom: spacing[4],
    borderBottomWidth: 1, borderBottomColor: colorScales.gray[100],
  },
  title: { fontSize: typography.fontSize.lg, fontWeight: '700' as any, color: colorScales.gray[900] },
  subtitle: { fontSize: typography.fontSize.sm, color: colorScales.gray[500], marginTop: 4 },
  closeBtn: { padding: spacing[1] },

  stepsRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: spacing[4], backgroundColor: colorScales.gray[50],
    gap: spacing[2],
  },
  stepRow: { flexDirection: 'row', alignItems: 'center' },
  stepCircle: {
    width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colorScales.gray[200],
  },
  stepCircleActive: { backgroundColor: colors.primary },
  stepLine: { width: 48, height: 2, backgroundColor: colorScales.gray[200], marginHorizontal: spacing[2] },
  stepLineDone: { backgroundColor: colors.primary },
  stepNum: { fontSize: 13, fontWeight: '600' as any, color: colorScales.gray[500] },
  stepNumActive: { color: colors.background, fontWeight: '700' as any },

  body: { flexGrow: 0, flexShrink: 1, maxHeight: 520 },
  bodyContent: { padding: spacing[5], gap: spacing[4] },
  stepContent: { gap: spacing[4] },
  sectionTitle: { fontSize: typography.fontSize.base, fontWeight: '700' as any, color: colorScales.gray[900] },

  formLabel: { fontSize: 12, fontWeight: '700' as any, color: colorScales.gray[500], textTransform: 'uppercase' as any, letterSpacing: 0.5, marginBottom: spacing[1] },

  selectTrigger: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: spacing[3], paddingHorizontal: spacing[3],
    borderWidth: 1.5, borderColor: colorScales.gray[300], borderRadius: borderRadius.lg,
    backgroundColor: colors.background,
  },
  selectValue: { flex: 1, fontSize: 14, fontWeight: '500' as any, color: colorScales.gray[900] },
  selectPlaceholder: { flex: 1, fontSize: 14, color: colorScales.gray[400] },
  selectList: { marginTop: 4, borderWidth: 1, borderColor: colorScales.gray[200], borderRadius: borderRadius.lg, backgroundColor: colors.background, overflow: 'hidden' },
  selectEmpty: { padding: spacing[3], textAlign: 'center' as any, fontSize: 12, color: colorScales.gray[500] },
  selectOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing[3], paddingHorizontal: spacing[3], borderBottomWidth: 1, borderBottomColor: colorScales.gray[100] },
  selectOptionActive: { backgroundColor: colorScales.green[50] },
  selectOptionText: { fontSize: 14, color: colorScales.gray[700] },
  selectOptionTextActive: { fontWeight: '600' as any, color: colors.primary },

  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  typeChip: { paddingHorizontal: spacing[3], paddingVertical: spacing[2], borderRadius: borderRadius.full, borderWidth: 1, borderColor: colorScales.gray[300], backgroundColor: colors.background },
  typeChipActive: { backgroundColor: colorScales.green[50], borderColor: colors.primary },
  typeChipText: { fontSize: 12, fontWeight: '500' as any, color: colorScales.gray[700] },
  typeChipTextActive: { color: colors.primary, fontWeight: '700' as any },

  textArea: {
    borderWidth: 1, borderColor: colorScales.gray[200], borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3], paddingVertical: spacing[2],
    fontSize: 14, color: colorScales.gray[900], backgroundColor: colors.background,
    minHeight: 56, textAlignVertical: 'top' as any,
  },

  templateRow: { gap: spacing[1] },
  templateBtn: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[2],
    paddingVertical: spacing[2.5], paddingHorizontal: spacing[3],
    borderWidth: 1.5, borderColor: colors.primary, borderRadius: borderRadius.lg,
    alignSelf: 'flex-start' as any,
  },
  templateBtnDisabled: { opacity: 0.4 },
  templateBtnText: { fontSize: 13, fontWeight: '600' as any, color: colors.primary },
  templateHint: { fontSize: 11, color: colorScales.gray[500] },

  dropZone: {
    borderWidth: 2, borderStyle: 'dashed' as any, borderColor: colorScales.gray[300],
    borderRadius: borderRadius.lg, paddingVertical: spacing[8], paddingHorizontal: spacing[4],
    alignItems: 'center' as any, backgroundColor: colors.background,
  },
  dropZoneActive: { borderColor: colors.primary, backgroundColor: colorScales.green[50] },
  dropZonePrimary: { fontSize: 14, fontWeight: '600' as any, color: colorScales.gray[700], textAlign: 'center' as any },
  dropZoneSecondary: { fontSize: 12, color: colorScales.gray[400], marginTop: 4, textAlign: 'center' as any },
  fileName: { fontSize: 14, fontWeight: '700' as any, color: colorScales.gray[900], textAlign: 'center' as any },
  fileSize: { fontSize: 12, color: colorScales.gray[500], marginTop: 4, textAlign: 'center' as any },
  removeFileLink: { fontSize: 12, color: colorScales.red[500], textDecorationLine: 'underline' as any },

  uploadingContainer: { alignItems: 'center' as any, paddingVertical: spacing[8], gap: spacing[3] },
  uploadingText: { fontSize: 14, fontWeight: '600' as any, color: colorScales.gray[900] },

  summaryGrid: { flexDirection: 'row', gap: spacing[3] },
  summaryCard: {
    flex: 1, alignItems: 'center' as any, paddingVertical: spacing[3], paddingHorizontal: spacing[2],
    backgroundColor: colorScales.gray[50], borderRadius: borderRadius.lg,
  },
  summaryCardSuccess: { backgroundColor: colorScales.green[50] },
  summaryCardError: { backgroundColor: colorScales.red[50] },
  summaryValue: { fontSize: typography.fontSize['2xl'], fontWeight: '800' as any, color: colorScales.gray[900] },
  summaryLabel: { fontSize: 11, color: colorScales.gray[500], marginTop: 2 },

  tableContainer: {
    borderWidth: 1, borderColor: colorScales.gray[200], borderRadius: borderRadius.lg, overflow: 'hidden' as any,
  },
  tableHeader: {
    flexDirection: 'row', backgroundColor: colorScales.gray[50],
    paddingVertical: spacing[2], paddingHorizontal: spacing[3],
    borderBottomWidth: 1, borderBottomColor: colorScales.gray[200],
  },
  tableRow: {
    flexDirection: 'row', paddingVertical: spacing[2], paddingHorizontal: spacing[3],
    borderBottomWidth: 1, borderBottomColor: colorScales.gray[100],
  },
  tableRowError: { backgroundColor: colorScales.red[50] },
  tableCell: { flex: 2, fontSize: 12, color: colorScales.gray[900] },
  tableCellMono: { flex: 2, fontSize: 12, color: colorScales.gray[900], fontFamily: 'Courier' },
  tableCellHeader: { fontWeight: '700' as any, color: colorScales.gray[600], textTransform: 'uppercase' as any, fontSize: 10, letterSpacing: 0.5 },
  tableCellCenter: { flex: 1, alignItems: 'center' as any, justifyContent: 'center' as any },
  badgeOk: { paddingHorizontal: spacing[2], paddingVertical: 2, borderRadius: 10, backgroundColor: colorScales.green[100] },
  badgeOkText: { fontSize: 10, fontWeight: '700' as any, color: colorScales.green[800] },
  badgeError: { paddingHorizontal: spacing[2], paddingVertical: 2, borderRadius: 10, backgroundColor: colorScales.red[100] },
  badgeErrorText: { fontSize: 10, fontWeight: '700' as any, color: colorScales.red[800] },

  errorBox: {
    backgroundColor: colorScales.red[50], borderWidth: 1, borderColor: colorScales.red[200],
    borderRadius: borderRadius.lg, padding: spacing[3], gap: 4,
  },
  errorTitle: { fontSize: 12, fontWeight: '700' as any, color: colorScales.red[800] },
  errorLine: { fontSize: 11, color: colorScales.red[700] },

  footer: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing[2],
    paddingHorizontal: spacing[4], paddingVertical: spacing[3],
    backgroundColor: colorScales.gray[50], borderTopWidth: 1, borderTopColor: colorScales.gray[100],
  },
  footerLeft: { flexDirection: 'row' },
  footerRight: { flexDirection: 'row', gap: spacing[2] },
  outlineBtn: { paddingVertical: 10, paddingHorizontal: spacing[4], borderRadius: borderRadius.lg, borderWidth: 1.5, borderColor: colorScales.gray[300], alignItems: 'center' as any, justifyContent: 'center' as any },
  outlineBtnText: { fontSize: 14, fontWeight: '700' as any, color: colorScales.gray[700] },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing[2],
    paddingVertical: 10, paddingHorizontal: spacing[4], borderRadius: borderRadius.lg, backgroundColor: colors.primary,
  },
  primaryBtnDisabled: { backgroundColor: colorScales.green[600], opacity: 0.4 },
  primaryBtnText: { fontSize: 14, fontWeight: '700' as any, color: colors.background },
});
