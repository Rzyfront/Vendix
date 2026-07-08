import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform, Alert } from 'react-native';
import * as XLSX from 'xlsx';
import { Modal } from '@/shared/components/modal/modal';
import { Button } from '@/shared/components/button/button';
import { Icon } from '@/shared/components/icon/icon';
import { Spinner } from '@/shared/components/spinner/spinner';
import { toastError, toastSuccess, toastWarning } from '@/shared/components/toast/toast.store';
import { CustomerService } from '@/features/store/services/customer.service';
import {
  colors,
  colorScales,
  spacing,
  borderRadius,
  typography,
} from '@/shared/theme';
import type { BulkCustomerUploadResult } from '@/features/store/types/customer.types';

/* ============================================================
 * Customer bulk upload — wizard 3-step
 * ============================================================
 * Step 0 → Download template + pick Excel/CSV file
 * Step 1 → Preview parsed rows (first 5) + warnings
 * Step 2 → POST /store/customers/bulk/upload → results
 */

const STEPS = [
  { num: 1, label: 'Cargar Datos' },
  { num: 2, label: 'Verificar' },
  { num: 3, label: 'Resultados' },
] as const;

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_EXTS = ['.csv', '.xlsx', '.xls'];
const HEADER_MAP: Record<string, string> = {
  correo: 'email',
  email: 'email',
  nombre: 'first_name',
  first_name: 'first_name',
  apellido: 'last_name',
  last_name: 'last_name',
  documento: 'document_number',
  document_number: 'document_number',
  'tipo documento': 'document_type',
  document_type: 'document_type',
  teléfono: 'phone',
  telefono: 'phone',
  phone: 'phone',
};

type WizardStep = 0 | 1 | 2;

interface ParsedCustomer {
  email?: string;
  first_name: string;
  last_name: string;
  phone?: string;
  document_type?: string;
  document_number?: string;
  row_number: number;
}

interface CustomerBulkUploadModalProps {
  visible: boolean;
  onClose: () => void;
  onUploadComplete?: () => void;
}

function StepIndicator({ currentStep }: { currentStep: WizardStep }) {
  const stepNumbers = [0, 1, 2];
  return (
    <View style={stepStyles.indicator}>
      {stepNumbers.map((idx) => {
        const isDone = idx < currentStep;
        const isActive = idx === currentStep;
        return (
          <View key={idx} style={stepStyles.row}>
            <View
              style={[
                stepStyles.circle,
                {
                  backgroundColor: isDone || isActive ? colors.primary : colorScales.gray[200],
                },
              ]}
            >
              <Text
                style={{
                  color: isDone || isActive ? colors.background : colorScales.gray[500],
                  fontWeight: '700',
                  fontSize: 12,
                }}
              >
                {idx + 1}
              </Text>
            </View>
            <Text
              style={{
                fontSize: typography.fontSize.sm,
                color: isActive ? colors.text.primary : colors.text.secondary,
                fontWeight: isActive ? '700' : '500',
              }}
            >
              {STEPS[idx].label}
            </Text>
            {idx < stepNumbers.length - 1 && (
              <View
                style={{
                  width: 32,
                  height: 2,
                  backgroundColor: isDone ? colors.primary : colorScales.gray[200],
                  marginHorizontal: spacing[2],
                }}
              />
            )}
          </View>
        );
      })}
    </View>
  );
}

const stepStyles = StyleSheet.create({
  indicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[3],
    gap: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  circle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export function CustomerBulkUploadModal({
  visible,
  onClose,
  onUploadComplete,
}: CustomerBulkUploadModalProps) {
  const [currentStep, setCurrentStep] = useState<WizardStep>(0);
  const [selectedFile, setSelectedFile] = useState<{ uri: string; name: string; size?: number } | null>(null);
  const [parsedData, setParsedData] = useState<ParsedCustomer[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadResults, setUploadResults] = useState<BulkCustomerUploadResult | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const resetState = useCallback(() => {
    setCurrentStep(0);
    setSelectedFile(null);
    setParsedData(null);
    setWarnings([]);
    setIsProcessingFile(false);
    setIsUploading(false);
    setUploadResults(null);
    setUploadError(null);
  }, []);

  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [resetState, onClose]);

  const handleDownloadTemplate = useCallback(async () => {
    try {
      const blob: Blob = await CustomerService.getBulkUploadTemplate();
      let base64: string;
      if (typeof blob === 'string') {
        base64 = blob;
      } else {
        // Convert Blob to base64
        const reader = new FileReader();
        base64 = await new Promise((resolve, reject) => {
          reader.onloadend = () => {
            const result = reader.result as string;
            resolve(result.split(',')[1] ?? result);
          };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      }

      const filename = `plantilla_clientes_${new Date().toISOString().split('T')[0]}.xlsx`;
      const fileUri = `${FileSystem.cacheDirectory}${filename}`;

      await FileSystem.writeAsStringAsync(fileUri, base64, {
        encoding: FileSystem.EncodingType.Base64,
      });

      if (Platform.OS === 'web') {
        const link = document.createElement('a');
        link.href = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${base64}`;
        link.download = filename;
        link.click();
      } else {
        const canShare = await Sharing.isAvailableAsync();
        if (canShare) {
          await Sharing.shareAsync(fileUri, {
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            dialogTitle: filename,
          });
        } else {
          Alert.alert('Descarga completa', `Archivo: ${filename}`);
        }
      }
      toastSuccess('Plantilla descargada');
    } catch (err) {
      toastError('No se pudo descargar la plantilla');
    }
  }, []);

  const handlePickFile = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-excel',
          'text/csv',
        ],
        copyToCacheDirectory: true,
      });
      if (result.canceled || result.assets.length === 0) return;
      const picked = result.assets[0];
      const ext = '.' + (picked.name.split('.').pop() ?? '').toLowerCase();
      if (!ALLOWED_EXTS.includes(ext)) {
        toastError('Selecciona un archivo válido (.xlsx, .xls o .csv)');
        return;
      }
      if (picked.size && picked.size > MAX_FILE_SIZE_BYTES) {
        toastError('El archivo excede el límite de 5 MB');
        return;
      }
      setSelectedFile({ uri: picked.uri, name: picked.name, size: picked.size ?? undefined });
    } catch (err) {
      toastError('No se pudo seleccionar el archivo');
    }
  }, []);

  const processFile = useCallback(async () => {
    if (!selectedFile) return;
    setIsProcessingFile(true);
    setWarnings([]);
    setUploadError(null);

    try {
      const fileContent = await FileSystem.readAsStringAsync(selectedFile.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      // Decode base64 to binary string for XLSX
      const binaryString = atob(fileContent);
      const wb: XLSX.WorkBook = XLSX.read(binaryString, { type: 'binary' });
      const wsname: string = wb.SheetNames[0];
      const ws: XLSX.WorkSheet = wb.Sheets[wsname];
      const rawData = XLSX.utils.sheet_to_json(ws, { header: 1 }) as unknown[][];

      if (!rawData || rawData.length < 2) {
        toastError('El archivo debe tener encabezados y al menos una fila de datos');
        setIsProcessingFile(false);
        return;
      }

      const rawHeaders = rawData[0] as string[];
      const headerMap: Record<number, string> = {};

      rawHeaders.forEach((h, index) => {
        if (!h) return;
        const normalized = h.toString().trim().toLowerCase();
        const dtoKey = HEADER_MAP[normalized];
        if (dtoKey) headerMap[index] = dtoKey;
      });

      const customers: ParsedCustomer[] = [];
      const warns: string[] = [];

      for (let i = 1; i < rawData.length; i++) {
        const row = rawData[i] as unknown[];
        if (!row || row.length === 0) continue;

        const customer: Record<string, string> = {};
        let hasData = false;

        row.forEach((cellValue, index) => {
          const key = headerMap[index];
          if (key) {
            const val =
              cellValue === undefined || cellValue === null
                ? ''
                : String(cellValue).trim();
            customer[key] = val;
            if (val !== '') hasData = true;
          }
        });

        if (hasData && (customer['first_name'] || customer['document_number'])) {
          if (!customer['email']) {
            warns.push(`Fila ${i + 1}: ${customer['first_name'] || 'Sin nombre'} — sin correo`);
          }
          if (!customer['document_number']) {
            warns.push(`Fila ${i + 1}: ${customer['first_name'] || 'Sin nombre'} — sin número de documento`);
          }
          customers.push({
            email: customer['email'] || undefined,
            first_name: customer['first_name'] || '',
            last_name: customer['last_name'] || '',
            phone: customer['phone'] || undefined,
            document_type: customer['document_type'] || undefined,
            document_number: customer['document_number'] || undefined,
            row_number: i + 1,
          });
        }
      }

      setIsProcessingFile(false);

      if (customers.length === 0) {
        toastWarning('No se encontraron clientes válidos en el archivo');
        return;
      }

      if (customers.length > 1000) {
        toastError(`El archivo excede el límite de 1000 clientes (tiene ${customers.length})`);
        return;
      }

      setParsedData(customers);
      setWarnings(warns);
      setCurrentStep(1);
    } catch (err) {
      setIsProcessingFile(false);
      toastError('Error al procesar el archivo. Verifica el formato.');
    }
  }, [selectedFile]);

  const handleConfirmUpload = useCallback(async () => {
    if (!parsedData) return;
    setCurrentStep(2);
    setIsUploading(true);
    setUploadError(null);

    try {
      const results = await CustomerService.uploadBulkCustomers(parsedData);
      setUploadResults(results);
      if (results.failed > 0 || !results.success) {
        toastWarning('La carga se completó con algunos errores');
      } else {
        toastSuccess(`${results.successful} clientes cargados exitosamente`);
        onUploadComplete?.();
      }
    } catch (err: any) {
      setUploadError(err?.response?.data?.message || err?.message || 'Error en la carga masiva');
      // Try to set partial results from error
      if (err?.response?.data?.data) {
        setUploadResults(err.response.data.data);
      }
    } finally {
      setIsUploading(false);
    }
  }, [parsedData, onUploadComplete]);

  const goBack = useCallback(() => {
    setCurrentStep(0);
    setParsedData(null);
    setWarnings([]);
  }, []);

  // ─── Computed ───────────────────────────────────────────
  const previewRows = useMemo(() => parsedData?.slice(0, 5) ?? [], [parsedData]);
  const failedRows = useMemo(
    () => uploadResults?.results.filter((r) => r.status === 'error') ?? [],
    [uploadResults],
  );

  return (
    <Modal
      visible={visible}
      onClose={handleClose}
      title="Carga Masiva de Clientes"
      showFooter
      footer={
        <View style={modalStyles.footerRow}>
          {currentStep === 1 && (
            <View style={modalStyles.footerBtn}>
              <Button title="Atrás" variant="outline" onPress={goBack} fullWidth />
            </View>
          )}
          <View style={modalStyles.footerBtn}>
            <Button
              title={currentStep === 2 && uploadResults ? 'Cerrar' : 'Cancelar'}
              variant="outline"
              onPress={handleClose}
              fullWidth
            />
          </View>
          {currentStep === 0 && selectedFile && (
            <View style={modalStyles.footerBtn}>
              <Button
                title="Analizar"
                variant="primary"
                onPress={processFile}
                loading={isProcessingFile}
                fullWidth
              />
            </View>
          )}
          {currentStep === 1 && parsedData && (
            <View style={modalStyles.footerBtn}>
              <Button
                title={`Cargar ${parsedData.length} Clientes`}
                variant="primary"
                onPress={handleConfirmUpload}
                loading={isUploading}
                fullWidth
              />
            </View>
          )}
        </View>
      }
    >
      <ScrollView
        contentContainerStyle={modalStyles.body}
        keyboardShouldPersistTaps="handled"
      >
        {/* Step Indicator */}
        <StepIndicator currentStep={currentStep} />

        {/* ─── Step 0: Cargar Datos ──────────────────────────── */}
        {currentStep === 0 && (
          <View>
            {/* Template download card */}
            <Pressable
              onPress={handleDownloadTemplate}
              style={({ pressed }) => [
                modalStyles.templateCard,
                { opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <View style={modalStyles.templateIconBox}>
                <Icon name="users" size={20} color={colorScales.blue[600]} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={modalStyles.templateTitle}>Plantilla de Clientes</Text>
                <Text style={modalStyles.templateDesc}>
                  Correo, Nombre, Apellido, Documento, Tipo Documento y Teléfono.
                </Text>
                <View style={modalStyles.templateDownload}>
                  <Icon name="download" size={12} color={colorScales.blue[600]} />
                  <Text style={modalStyles.templateDownloadText}>DESCARGAR EXCEL</Text>
                </View>
              </View>
            </Pressable>

            {/* Drop zone */}
            <Pressable
              onPress={handlePickFile}
              style={({ pressed }) => [
                modalStyles.dropZone,
                {
                  borderColor: selectedFile ? colors.primary : colorScales.gray[300],
                  backgroundColor: selectedFile ? colorScales.green[50] : colorScales.gray[50],
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              {isProcessingFile ? (
                <View style={modalStyles.dropZoneProcessing}>
                  <Spinner size="sm" />
                  <Text style={modalStyles.dropZoneProcessingText}>Procesando archivo...</Text>
                </View>
              ) : selectedFile ? (
                <View style={{ alignItems: 'center' }}>
                  <Icon name="file-spreadsheet" size={32} color={colors.primary} />
                  <Text style={[modalStyles.dropZoneFileName, { marginTop: spacing[2] }]}>
                    {selectedFile.name}
                  </Text>
                  {selectedFile.size && (
                    <Text style={modalStyles.dropZoneFileSize}>
                      {(selectedFile.size / 1024).toFixed(1)} KB
                    </Text>
                  )}
                  <Text style={[modalStyles.dropZoneHint, { marginTop: spacing[1] }]}>
                    Toca para cambiar archivo
                  </Text>
                </View>
              ) : (
                <View style={{ alignItems: 'center' }}>
                  <Icon name="upload-cloud" size={32} color={colorScales.gray[400]} />
                  <Text style={[modalStyles.dropZonePrimary, { marginTop: spacing[2] }]}>
                    Arrastra o toca para seleccionar
                  </Text>
                  <Text style={modalStyles.dropZoneSecondary}>
                    .xlsx, .xls, .csv · Máximo 5 MB · Máx. 1000 clientes
                  </Text>
                </View>
              )}
            </Pressable>
          </View>
        )}

        {/* ─── Step 1: Verificar ──────────────────────────────── */}
        {currentStep === 1 && parsedData && (
          <View>
            {/* Count banner */}
            <View style={modalStyles.countBanner}>
              <Icon name="check-circle" size={20} color={colors.primary} />
              <Text style={modalStyles.countBannerText}>
                {parsedData.length} clientes encontrados
              </Text>
              <Pressable onPress={goBack} style={{ marginLeft: 'auto' }}>
                <Text style={modalStyles.changeFileLink}>Cambiar archivo</Text>
              </Pressable>
            </View>

            {/* Preview table */}
            <View style={modalStyles.table}>
              <View style={modalStyles.tableHeader}>
                <Text style={modalStyles.tableHeaderCell}>Fila</Text>
                <Text style={modalStyles.tableHeaderCell}>Correo</Text>
                <Text style={modalStyles.tableHeaderCell}>Nombre</Text>
                <Text style={modalStyles.tableHeaderCell}>Documento</Text>
                <Text style={modalStyles.tableHeaderCell}>Teléfono</Text>
              </View>
              {previewRows.map((row) => (
                <View key={row.row_number} style={modalStyles.tableRow}>
                  <Text style={modalStyles.tableCellDim}>{row.row_number}</Text>
                  <Text style={modalStyles.tableCell} numberOfLines={1}>
                    {row.email || '—'}
                  </Text>
                  <Text style={modalStyles.tableCell} numberOfLines={1}>
                    {row.first_name} {row.last_name}
                  </Text>
                  <Text style={[modalStyles.tableCell, { fontFamily: 'monospace' }]} numberOfLines={1}>
                    {row.document_number || '—'}
                  </Text>
                  <Text style={modalStyles.tableCell} numberOfLines={1}>
                    {row.phone || '—'}
                  </Text>
                </View>
              ))}
              {parsedData.length > 5 && (
                <View style={modalStyles.tableMore}>
                  <Text style={modalStyles.tableMoreText}>
                    ... y {parsedData.length - 5} más
                  </Text>
                </View>
              )}
            </View>

            {/* Warnings */}
            {warnings.length > 0 && (
              <View style={modalStyles.warningsBox}>
                <View style={modalStyles.warningsHeader}>
                  <Icon name="alert-triangle" size={14} color={colorScales.amber[600]} />
                  <Text style={modalStyles.warningsTitle}>Advertencias</Text>
                </View>
                {warnings.slice(0, 5).map((w, i) => (
                  <Text key={i} style={modalStyles.warningItem}>
                    {w}
                  </Text>
                ))}
                {warnings.length > 5 && (
                  <Text style={modalStyles.warningItem}>
                    ...y {warnings.length - 5} más
                  </Text>
                )}
              </View>
            )}
          </View>
        )}

        {/* ─── Step 2: Resultados ─────────────────────────────── */}
        {currentStep === 2 && (
          <View>
            {isUploading ? (
              <View style={modalStyles.uploadingState}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={modalStyles.uploadingText}>
                  Procesando {parsedData?.length ?? 0} clientes...
                </Text>
                <Text style={modalStyles.uploadingHint}>Esto puede tardar unos segundos</Text>
              </View>
            ) : uploadResults ? (
              <View>
                {/* Summary */}
                <View style={modalStyles.resultsCard}>
                  <Text style={modalStyles.resultsTitle}>Resumen de Carga</Text>
                  <View style={modalStyles.resultsStatsRow}>
                    <View style={[modalStyles.resultsStatBox, { backgroundColor: colorScales.green[50], borderColor: colorScales.green[200] }]}>
                      <Text style={modalStyles.resultsStatLabel}>Exitosos</Text>
                      <Text style={modalStyles.resultsStatValueGreen}>
                        {uploadResults.successful ?? 0}
                      </Text>
                    </View>
                    <View style={[modalStyles.resultsStatBox, { backgroundColor: colorScales.red[50], borderColor: colorScales.red[200] }]}>
                      <Text style={modalStyles.resultsStatLabel}>Fallidos</Text>
                      <Text style={modalStyles.resultsStatValueRed}>
                        {uploadResults.failed ?? 0}
                      </Text>
                    </View>
                  </View>
                </View>

                {/* Error list */}
                {failedRows.length > 0 && (
                  <View style={modalStyles.errorCard}>
                    <View style={modalStyles.errorHeader}>
                      <Icon name="alert-triangle" size={16} color={colorScales.red[600]} />
                      <Text style={modalStyles.errorTitle}>Detalle de Errores</Text>
                    </View>
                    {failedRows.slice(0, 10).map((r, i) => (
                      <View key={i} style={modalStyles.errorRow}>
                        <Text style={modalStyles.errorRowLabel}>
                          Fila {r.row_number ?? i + 1}
                        </Text>
                        <Text style={modalStyles.errorRowMsg}>
                          {r.message || r.error || 'Error desconocido'}
                        </Text>
                      </View>
                    ))}
                    {failedRows.length > 10 && (
                      <Text style={modalStyles.errorMore}>
                        ...y {failedRows.length - 10} errores más
                      </Text>
                    )}
                  </View>
                )}
              </View>
            ) : uploadError ? (
              <View style={modalStyles.errorBanner}>
                <Icon name="alert-circle" size={20} color={colorScales.red[600]} />
                <Text style={modalStyles.errorBannerText}>{uploadError}</Text>
              </View>
            ) : null}
          </View>
        )}
      </ScrollView>
    </Modal>
  );
}

const modalStyles = StyleSheet.create({
  body: {
    padding: spacing[4],
    gap: spacing[4],
  },
  footerRow: {
    flexDirection: 'row',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
  },
  footerBtn: {
    flex: 1,
  },
  templateCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing[4],
    borderRadius: borderRadius.lg,
    borderWidth: 2,
    borderColor: colorScales.blue[100],
    backgroundColor: colorScales.blue[50],
    gap: spacing[3],
  },
  templateIconBox: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colorScales.blue[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  templateTitle: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold as any,
    color: colorScales.blue[900],
  },
  templateDesc: {
    fontSize: typography.fontSize.xs,
    color: colorScales.blue[700],
    marginTop: 2,
  },
  templateDownload: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    marginTop: spacing[2],
  },
  templateDownloadText: {
    fontSize: 11,
    fontWeight: typography.fontWeight.bold as any,
    color: colorScales.blue[600],
  },
  dropZone: {
    borderWidth: 2,
    borderStyle: 'dashed',
    borderRadius: borderRadius.lg,
    paddingVertical: spacing[8],
    paddingHorizontal: spacing[4],
    alignItems: 'center',
  },
  dropZoneProcessing: {
    alignItems: 'center',
    gap: spacing[2],
  },
  dropZoneProcessingText: {
    fontSize: typography.fontSize.sm,
    color: colors.text.secondary,
  },
  dropZonePrimary: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold as any,
    color: colorScales.gray[900],
    textAlign: 'center',
  },
  dropZoneSecondary: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
    marginTop: spacing[1],
    textAlign: 'center',
  },
  dropZoneFileName: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold as any,
    color: colors.primary,
  },
  dropZoneFileSize: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
  },
  dropZoneHint: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[400],
  },
  countBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing[3],
    borderRadius: borderRadius.lg,
    backgroundColor: colorScales.green[50],
    borderWidth: 1,
    borderColor: colorScales.green[100],
    gap: spacing[2],
  },
  countBannerText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold as any,
    color: colorScales.green[800],
  },
  changeFileLink: {
    fontSize: typography.fontSize.xs,
    color: colorScales.red[500],
    fontWeight: typography.fontWeight.medium as any,
  },
  table: {
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: colorScales.gray[50],
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[200],
  },
  tableHeaderCell: {
    flex: 1,
    fontSize: 10,
    fontWeight: typography.fontWeight.bold as any,
    color: colorScales.gray[500],
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  tableCell: {
    flex: 1,
    fontSize: 12,
    color: colorScales.gray[800],
  },
  tableCellDim: {
    flex: 1,
    fontSize: 11,
    color: colorScales.gray[400],
  },
  tableMore: {
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
    backgroundColor: colorScales.gray[50],
    alignItems: 'center',
  },
  tableMoreText: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
  },
  warningsBox: {
    backgroundColor: colorScales.amber[50],
    borderWidth: 1,
    borderColor: colorScales.amber[100],
    borderRadius: borderRadius.lg,
    padding: spacing[3],
    gap: spacing[1],
  },
  warningsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    marginBottom: spacing[1],
  },
  warningsTitle: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.bold as any,
    color: colorScales.amber[700],
  },
  warningItem: {
    fontSize: typography.fontSize.xs,
    color: colorScales.amber[800],
  },
  uploadingState: {
    alignItems: 'center',
    paddingVertical: spacing[8],
    gap: spacing[3],
  },
  uploadingText: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold as any,
    color: colorScales.gray[900],
  },
  uploadingHint: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
  },
  resultsCard: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    marginBottom: spacing[4],
  },
  resultsTitle: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold as any,
    color: colorScales.gray[900],
    padding: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  resultsStatsRow: {
    flexDirection: 'row',
    gap: spacing[3],
    padding: spacing[3],
  },
  resultsStatBox: {
    flex: 1,
    padding: spacing[3],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    alignItems: 'center',
  },
  resultsStatLabel: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.medium as any,
    color: colorScales.gray[600],
  },
  resultsStatValueGreen: {
    fontSize: 24,
    fontWeight: typography.fontWeight.bold as any,
    color: colorScales.green[700],
    marginTop: spacing[1],
  },
  resultsStatValueRed: {
    fontSize: 24,
    fontWeight: typography.fontWeight.bold as any,
    color: colorScales.red[700],
    marginTop: spacing[1],
  },
  errorCard: {
    backgroundColor: colorScales.red[50],
    borderWidth: 1,
    borderColor: colorScales.red[100],
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
  },
  errorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    padding: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.red[100],
  },
  errorTitle: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold as any,
    color: colorScales.red[800],
  },
  errorRow: {
    flexDirection: 'row',
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.red[100],
    gap: spacing[2],
  },
  errorRowLabel: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold as any,
    color: colorScales.red[700],
    width: 60,
  },
  errorRowMsg: {
    flex: 1,
    fontSize: typography.fontSize.xs,
    color: colorScales.red[700],
  },
  errorMore: {
    padding: spacing[3],
    fontSize: typography.fontSize.xs,
    color: colorScales.red[600],
    textAlign: 'center',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    padding: spacing[4],
    backgroundColor: colorScales.red[50],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.red[200],
  },
  errorBannerText: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    color: colorScales.red[700],
  },
});
