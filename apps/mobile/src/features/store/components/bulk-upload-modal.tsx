import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQueryClient } from '@tanstack/react-query';
import {
  Modal,
  Button,
  Card,
  Badge,
  Spinner,
  EmptyState,
  Pagination,
} from '@/shared/components';
import { Icon } from '@/shared/components/icon/icon';
import { toastError, toastSuccess, toastWarning } from '@/shared/components/toast/toast.store';
import { ProductService } from '@/features/store/services/product.service';
import {
  downloadCurrentProducts,
  downloadTemplate,
} from '@/features/store/utils/xlsx';
import {
  colors,
  colorScales,
  spacing,
  borderRadius,
  typography,
} from '@/shared/theme';
import type {
  BulkProductAnalysisItem,
  BulkProductAnalysisResult,
  BulkUploadResult,
  BulkUploadItemResult,
} from '@/features/store/types/product.types';

/* ============================================================
 * Bulk product upload — wizard 3-step + intro
 * ============================================================
 * Parity con el web `bulk-upload-modal.component.ts`:
 *   Step 0 → POST /store/products/bulk/analyze → session_id
 *   Step 1 → POST /store/products/bulk/upload-session → results
 *   Closing mid-flow → DELETE /store/products/bulk/session/:sessionId
 */

const INTRO_CACHE_KEY = 'vendix_bulk_product_intro_dismissed';
const INTRO_DURATION_MS = 20_000;
const INTRO_TICK_MS = 100;
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_EXTS = ['.csv', '.xlsx', '.xls'];

const STEPS = [
  { num: 1, label: 'Preparar' },
  { num: 2, label: 'Revisar' },
  { num: 3, label: 'Resultados' },
] as const;

const PAGE_SIZE = 20;

type WizardStep = 0 | 1 | 2;

interface BulkUploadModalProps {
  visible: boolean;
  onClose: () => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getValidationText(text: string | { code: string; message: string }): string {
  return typeof text === 'object' ? text.message : text;
}

function getCellState(
  item: BulkProductAnalysisItem,
  field: string,
): 'modified' | 'nulled' | 'unchanged' | 'create' {
  if (item.action === 'create') return 'create';
  if (item.nulled_fields?.includes(field)) return 'nulled';
  if (item.modified_fields?.includes(field)) return 'modified';
  return 'unchanged';
}

function cellStateColor(state: ReturnType<typeof getCellState>): string {
  switch (state) {
    case 'modified':
      return colorScales.green[700];
    case 'nulled':
      return colorScales.red[600];
    case 'unchanged':
      return colorScales.gray[400];
    case 'create':
      return colors.text.primary;
  }
}

/* ============================================================
 * Sub-components
 * ============================================================ */

function StepIndicator({ currentStep }: { currentStep: WizardStep }) {
  const stepNumbers = [0, 1, 2];
  return (
    <View style={styles.stepIndicator}>
      {stepNumbers.map((idx) => {
        const isDone = idx < currentStep;
        const isActive = idx === currentStep;
        return (
          <View key={idx} style={styles.stepIndicatorRow}>
            <View
              style={[
                styles.stepCircle,
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
                  width: 24,
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

function TemplateCard({
  type,
  title,
  description,
  iconName,
  borderColor,
  iconBg,
  iconColor,
  onPress,
}: {
  type: 'products' | 'services';
  title: string;
  description: string;
  iconName: 'package' | 'briefcase';
  borderColor: string;
  iconBg: string;
  iconColor: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.templateCard,
        { borderColor, backgroundColor: iconBg, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <View style={[styles.templateIconBox, { backgroundColor: iconColor + '20' }]}>
        <Icon name={iconName} size={16} color={iconColor} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.templateTitle, { color: iconColor }]}>{title}</Text>
        <Text style={[styles.templateDesc, { color: iconColor }]}>{description}</Text>
        <View style={styles.templateDownloadRow}>
          <Icon name="download" size={12} color={iconColor} />
          <Text style={[styles.templateDownloadText, { color: iconColor }]}>
            DESCARGAR EXCEL
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

function DropZone({
  file,
  onPick,
}: {
  file: { uri: string; name: string; size?: number } | null;
  onPick: () => void;
}) {
  return (
    <Pressable
      onPress={onPick}
      style={({ pressed }) => [
        styles.dropZone,
        {
          borderColor: file ? colors.primary : colorScales.gray[300],
          backgroundColor: file ? colors.primaryLight : colorScales.gray[50],
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      {file ? (
        <View style={{ alignItems: 'center' }}>
          <Icon name="file-spreadsheet" size={32} color={colors.primary} />
          <Text style={[styles.dropZonePrimary, { marginTop: spacing[2] }]}>
            {file.name}
          </Text>
          {file.size && (
            <Text style={[styles.dropZoneSecondary, { marginTop: spacing[1] }]}>
              {(file.size / 1024).toFixed(1)} KB
            </Text>
          )}
        </View>
      ) : (
        <View style={{ alignItems: 'center' }}>
          <Icon name="upload-cloud" size={32} color={colors.text.muted} />
          <Text style={[styles.dropZonePrimary, { marginTop: spacing[2] }]}>
            Toca para seleccionar un archivo XLSX
          </Text>
          <Text style={[styles.dropZoneSecondary, { marginTop: spacing[1] }]}>
            .xlsx, .xls, .csv · Máximo 5 MB
          </Text>
        </View>
      )}
    </Pressable>
  );
}

function AnalysisRowCard({ item }: { item: BulkProductAnalysisItem }) {
  const nameState = getCellState(item, 'name');
  const priceState = getCellState(item, 'base_price');
  const trackState = getCellState(item, 'track_inventory');
  const isService = item.product_type === 'service';

  return (
    <Card>
      <View style={styles.analysisRowHeader}>
        <Text
          style={{
            fontSize: typography.fontSize.sm,
            fontWeight: '600',
            color: cellStateColor(nameState),
            flex: 1,
            marginRight: spacing[2],
          }}
          numberOfLines={1}
        >
          {nameState === 'unchanged'
            ? '(sin cambios)'
            : nameState === 'nulled'
              ? '→ null'
              : (item.name || '—')}
        </Text>
        <Badge
          label={
            item.status === 'ready'
              ? 'Listo'
              : item.status === 'warning'
                ? 'Advertencia'
                : 'Error'
          }
          variant={
            item.status === 'ready'
              ? 'success'
              : item.status === 'warning'
                ? 'warning'
                : 'error'
          }
          size="xs"
        />
      </View>
      <Text
        style={{
          fontSize: typography.fontSize.xs,
          color: colors.text.secondary,
          fontFamily: typography.fontFamily,
          marginTop: spacing[1],
        }}
      >
        {item.sku || '—'}
      </Text>
      <View style={styles.analysisRowBadges}>
        <Badge
          label={isService ? 'Servicio' : 'Producto'}
          variant={isService ? 'service' : 'info'}
          size="xsm"
        />
        <Badge
          label={item.action === 'create' ? 'Crear' : 'Actualizar'}
          variant={item.action === 'create' ? 'success' : 'primary'}
          size="xsm"
        />
        <Text
          style={{
            fontSize: typography.fontSize.xs,
            color: cellStateColor(priceState),
            fontWeight: priceState === 'modified' ? '600' : '400',
            marginLeft: spacing[2],
          }}
        >
          ${item.base_price?.toFixed(0) ?? '—'}
        </Text>
        {priceState === 'nulled' && (
          <Text style={{ fontSize: typography.fontSize.xs, color: colorScales.red[600] }}>
            {' → null'}
          </Text>
        )}
      </View>
      {!isService && (
        <View style={styles.analysisRowInventoryRow}>
          <Text
            style={{
              fontSize: typography.fontSize.xs,
              color: colors.text.secondary,
              fontWeight: '600',
            }}
          >
            Inv:
          </Text>
          <Badge
            label={
              trackState === 'modified'
                ? 'Cambia'
                : item.track_inventory === true
                  ? 'Sí'
                  : item.track_inventory === false
                    ? 'No'
                    : '—'
            }
            variant={
              trackState === 'modified'
                ? 'primary'
                : item.track_inventory === true
                  ? 'success'
                  : 'neutral'
            }
            size="xsm"
          />
        </View>
      )}
      {isService && (
        <View style={styles.analysisRowServiceRow}>
          {item.service_duration_minutes ? (
            <Badge
              label={`${item.service_duration_minutes} min`}
              variant="neutral"
              size="xsm"
            />
          ) : null}
          {item.service_modality ? (
            <Badge label={item.service_modality} variant="neutral" size="xsm" />
          ) : null}
          {item.requires_booking ? (
            <Badge label="Reserva" variant="neutral" size="xsm" />
          ) : null}
        </View>
      )}
      {(item.warnings.length > 0 || item.errors.length > 0) && (
        <View style={styles.analysisRowMessages}>
          {item.errors.map((err, idx) => (
            <Text
              key={`err-${idx}`}
              style={{
                fontSize: typography.fontSize.xs,
                color: colorScales.red[700],
              }}
            >
              ✗ {getValidationText(err)}
            </Text>
          ))}
          {item.warnings.map((warn, idx) => (
            <Text
              key={`warn-${idx}`}
              style={{
                fontSize: typography.fontSize.xs,
                color: colorScales.amber[700],
              }}
            >
              ⚠ {getValidationText(warn)}
            </Text>
          ))}
        </View>
      )}
    </Card>
  );
}

function ResultRow({ row }: { row: BulkUploadItemResult }) {
  return (
    <View style={styles.resultRow}>
      <Text style={styles.resultRowText} numberOfLines={1}>
        {row.product_name || row.sku || '—'}
      </Text>
      <View style={styles.resultRowStatus}>
        <Badge
          label={
            row.status === 'success'
              ? 'Exitoso'
              : row.status === 'error'
                ? 'Error'
                : 'Omitido'
          }
          variant={
            row.status === 'success'
              ? 'success'
              : row.status === 'error'
                ? 'error'
                : 'warning'
          }
          size="xs"
        />
      </View>
      <Text style={styles.resultRowMessage} numberOfLines={2}>
        {row.message}
      </Text>
    </View>
  );
}

function StatCard({
  label,
  value,
  bg,
  fg,
  border,
}: {
  label: string;
  value: number;
  bg: string;
  fg: string;
  border: string;
}) {
  return (
    <View style={[styles.statCard, { backgroundColor: bg, borderColor: border }]}>
      <Text style={[styles.statCardLabel, { color: fg }]}>{label}</Text>
      <Text style={[styles.statCardValue, { color: fg }]}>{value}</Text>
    </View>
  );
}

/* ============================================================
 * Main component
 * ============================================================ */

export function BulkUploadModal({ visible, onClose }: BulkUploadModalProps) {
  const queryClient = useQueryClient();
  // ─── State ────────────────────────────────────────────────
  const [showingIntro, setShowingIntro] = useState(true);
  const [dontShowIntroAgain, setDontShowIntroAgain] = useState(false);
  const [introProgress, setIntroProgress] = useState(0);
  const [introCountdown, setIntroCountdown] = useState(20);
  const introTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [currentStep, setCurrentStep] = useState<WizardStep>(0);
  const [selectedFile, setSelectedFile] = useState<
    { uri: string; name: string; size?: number } | null
  >(null);
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<BulkProductAnalysisResult | null>(
    null,
  );
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [uploadResults, setUploadResults] = useState<BulkUploadResult | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [analysisPage, setAnalysisPage] = useState(1);
  const [uploadPage, setUploadPage] = useState(1);

  // Refs para que el cleanup del useEffect (solo unmount) capture los
  // valores más recientes sin re-dispararse cuando cambian.
  const sessionIdRef = useRef<string | null>(null);
  const uploadResultsRef = useRef<BulkUploadResult | null>(null);
  sessionIdRef.current = sessionId;
  uploadResultsRef.current = uploadResults;

  // ─── Computed ─────────────────────────────────────────────
  const totalProductsToUpload = useMemo(() => {
    if (!analysisResult) return 0;
    return analysisResult.products.filter((p) => p.status !== 'error').length;
  }, [analysisResult]);

  const canProceed = useMemo(() => {
    if (!analysisResult) return false;
    return analysisResult.ready + analysisResult.with_warnings > 0;
  }, [analysisResult]);

  const pagedAnalysisRows = useMemo(() => {
    if (!analysisResult) return [];
    const start = (analysisPage - 1) * PAGE_SIZE;
    return analysisResult.products.slice(start, start + PAGE_SIZE);
  }, [analysisResult, analysisPage]);

  const pagedUploadRows = useMemo(() => {
    if (!uploadResults) return [];
    const start = (uploadPage - 1) * PAGE_SIZE;
    return uploadResults.results.slice(start, start + PAGE_SIZE);
  }, [uploadResults, uploadPage]);

  // ─── Effects ──────────────────────────────────────────────
  useEffect(() => {
    if (!visible) {
      // cleanup done in next effect
      return;
    }
    let cancelled = false;
    (async () => {
      const dismissed = await AsyncStorage.getItem(INTRO_CACHE_KEY);
      if (cancelled) return;
      if (dismissed === 'true') {
        setShowingIntro(false);
      } else {
        setShowingIntro(true);
        startIntroTimer();
      }
    })();
    return () => {
      cancelled = true;
      clearIntroTimer();
    };
  }, [visible]);

  // Cleanup session ONLY on actual unmount (no en cambios de state).
  // Si el usuario cancela mid-flow via handleClose, eso ya cancela
  // explícitamente. El cleanup de unmount cubre el caso raro de que
  // el parent se desmonte sin llamar handleClose (p.ej. navegación).
  useEffect(() => {
    return () => {
      const sid = sessionIdRef.current;
      if (sid && !uploadResultsRef.current) {
        ProductService.cancelBulkProductSession(sid).catch(() => {});
      }
    };
  }, []);

  function startIntroTimer() {
    clearIntroTimer();
    let elapsed = 0;
    introTimerRef.current = setInterval(() => {
      elapsed += INTRO_TICK_MS;
      setIntroProgress(Math.min(100, (elapsed / INTRO_DURATION_MS) * 100));
      setIntroCountdown(
        Math.max(
          0,
          Math.ceil((INTRO_DURATION_MS - elapsed) / 1000),
        ),
      );
      if (elapsed >= INTRO_DURATION_MS) {
        skipIntro();
      }
    }, INTRO_TICK_MS);
  }

  function clearIntroTimer() {
    if (introTimerRef.current) {
      clearInterval(introTimerRef.current);
      introTimerRef.current = null;
    }
  }

  function skipIntro() {
    clearIntroTimer();
    if (dontShowIntroAgain) {
      AsyncStorage.setItem(INTRO_CACHE_KEY, 'true').catch(() => {
        // best-effort: ignorar errores de storage
      });
    }
    setShowingIntro(false);
  }

  function toggleDontShowIntroAgain() {
    setDontShowIntroAgain((v) => !v);
  }

  function resetState() {
    clearIntroTimer();
    setShowingIntro(true);
    setDontShowIntroAgain(false);
    setIntroProgress(0);
    setIntroCountdown(20);
    setCurrentStep(0);
    setSelectedFile(null);
    setShowHowItWorks(false);
    setSessionId(null);
    setAnalysisResult(null);
    setIsAnalyzing(false);
    setUploadResults(null);
    setIsUploading(false);
    setUploadError(null);
    setAnalysisPage(1);
    setUploadPage(1);
  }

  // ─── Handlers ─────────────────────────────────────────────
  async function handleDownloadTemplate(type: 'products' | 'services') {
    try {
      await downloadTemplate(type);
      toastSuccess(`Plantilla de ${type === 'products' ? 'productos' : 'servicios'} descargada`);
    } catch (err) {
      toastError(`No se pudo descargar la plantilla de ${type === 'products' ? 'productos' : 'servicios'}`);
    }
  }

  async function handleDownloadCurrentProducts() {
    try {
      const allProducts: any[] = [];
      let page = 1;
      // Loop simple; el backend /products soporta paginación
      while (true) {
        const res = await ProductService.list({ page, limit: 100 });
        const items = (res as { data?: any[] }).data ?? [];
        if (items.length === 0) break;
        allProducts.push(...items);
        if (items.length < 100) break;
        page += 1;
      }
      if (allProducts.length === 0) {
        toastWarning('No hay productos para exportar');
        return;
      }
      await downloadCurrentProducts(allProducts as never);
      toastSuccess('Plantilla con productos descargada');
    } catch (err) {
      toastError('No se pudo generar la plantilla con productos');
    }
  }

  async function handlePickFile() {
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
        toastError('Por favor selecciona un archivo válido (.xlsx, .xls o .csv)');
        return;
      }
      if (picked.size && picked.size > MAX_FILE_SIZE_BYTES) {
        toastError('El archivo excede el límite de 5 MB');
        return;
      }
      setSelectedFile({ uri: picked.uri, name: picked.name, size: picked.size ?? undefined });
      setUploadError(null);
    } catch (err) {
      toastError('No se pudo seleccionar el archivo');
    }
  }

  async function handleAnalyze() {
    if (!selectedFile) return;
    setIsAnalyzing(true);
    setUploadError(null);
    setCurrentStep(1);
    try {
      const result = await ProductService.analyzeBulkProducts({
        uri: selectedFile.uri,
        name: selectedFile.name,
      });
      setAnalysisResult(result);
      setSessionId(result.session_id);
      setAnalysisPage(1);
      if (result.with_errors > 0) {
        toastWarning(
          `${result.with_errors} concepto(s) con errores detectados`,
        );
      }
    } catch (err: any) {
      setCurrentStep(0);
      const msg =
        typeof err === 'string'
          ? err
          : err?.response?.data?.message ||
            err?.message ||
            'Error al analizar el archivo';
      setUploadError(msg);
      toastError('Error al analizar el archivo');
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function handleProceedWithUpload() {
    if (!sessionId) return;
    setIsUploading(true);
    setUploadError(null);
    setCurrentStep(2);
    try {
      const result = await ProductService.uploadBulkProductsFromSession(sessionId);
      setUploadResults(result);
      setUploadPage(1);
      if (result.failed > 0 || result.skipped > 0) {
        toastWarning('La carga se completó con algunos errores u omisiones.');
      } else {
        toastSuccess(`${result.successful} concepto(s) cargados exitosamente`);
      }
    } catch (err: any) {
      const msg =
        typeof err === 'string'
          ? err
          : err?.response?.data?.message ||
            err?.message ||
            'Error en la carga';
      setUploadError(msg);
      toastError('Error en la carga masiva de catálogo');
    } finally {
      setIsUploading(false);
    }
  }

  function goBack() {
    setCurrentStep((s) => (s > 0 ? ((s - 1) as WizardStep) : s));
  }

  function handleClose() {
    if (sessionId && !uploadResults) {
      ProductService.cancelBulkProductSession(sessionId).catch(() => {});
    }
    resetState();
    onClose();
  }

  // ─── Render ───────────────────────────────────────────────
  return (
    <Modal
      visible={visible}
      onClose={handleClose}
      title="Carga Masiva de Catálogo"
      showFooter
      footer={
        showingIntro ? (
          <View style={styles.footerRow}>
            <View style={styles.footerBtn}>
              <Button
                title="Cancelar"
                variant="outline"
                onPress={handleClose}
                fullWidth
              />
            </View>
            <View style={styles.footerBtn}>
              <Button
                title="Continuar"
                variant="primary"
                onPress={skipIntro}
                fullWidth
              />
            </View>
          </View>
        ) : currentStep === 0 ? (
          <View style={styles.footerRow}>
            <View style={styles.footerBtn}>
              <Button title="Cancelar" variant="outline" onPress={handleClose} fullWidth />
            </View>
            {selectedFile && (
              <View style={styles.footerBtn}>
                <Button
                  title="Analizar Archivo"
                  variant="primary"
                  onPress={handleAnalyze}
                  loading={isAnalyzing}
                  fullWidth
                />
              </View>
            )}
          </View>
        ) : currentStep === 1 && !isAnalyzing ? (
          <View style={styles.footerRow}>
            <View style={styles.footerBtn}>
              <Button title="Atrás" variant="outline" onPress={goBack} fullWidth />
            </View>
            <View style={styles.footerBtn}>
              <Button title="Cancelar" variant="outline" onPress={handleClose} fullWidth />
            </View>
            {canProceed && (
              <View style={styles.footerBtn}>
                <Button
                  title={`Cargar ${totalProductsToUpload} Concepto${totalProductsToUpload === 1 ? '' : 's'}`}
                  variant="primary"
                  onPress={handleProceedWithUpload}
                  loading={isUploading}
                  fullWidth
                />
              </View>
            )}
          </View>
        ) : null
      }
    >
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
      >
        {showingIntro ? (
          // ─── Intro Screen ──────────────────────────────────────
          <View>
            <View style={styles.introHeader}>
              <View style={styles.introIconBox}>
                <Icon name="package" size={24} color={colors.primary} />
              </View>
              <Text style={styles.introTitle}>Carga masiva de catálogo</Text>
              <Text style={styles.introSubtitle}>
                Importa productos o servicios como conceptos de venta
              </Text>
            </View>

            <View style={styles.introSteps}>
              {[
                { num: 1, title: 'Descarga la plantilla', desc: 'Excel con columnas separadas para productos o servicios.', bg: colors.primaryLight, border: colorScales.green[100], circleBg: colors.primary, circleFg: colors.background },
                { num: 2, title: 'Completa los datos', desc: 'Nombre, SKU, estado, precio y flags comerciales aplicables.', bg: colorScales.blue[50], border: colorScales.blue[100], circleBg: colorScales.blue[600], circleFg: colors.background },
                { num: 3, title: 'Sube el archivo', desc: 'Excel (.xlsx, .xls) o CSV. Máx. 1000 conceptos por archivo.', bg: colorScales.purple[50], border: colorScales.purple[100], circleBg: colorScales.purple[600], circleFg: colors.background },
                { num: 4, title: 'Revisa y confirma', desc: 'Análisis concepto por concepto antes de confirmar la carga.', bg: colorScales.green[50], border: colorScales.green[100], circleBg: colorScales.green[600], circleFg: colors.background },
              ].map((step) => (
                <View
                  key={step.num}
                  style={[
                    styles.introStepRow,
                    { backgroundColor: step.bg, borderColor: step.border },
                  ]}
                >
                  <View
                    style={[
                      styles.introStepCircle,
                      { backgroundColor: step.circleBg },
                    ]}
                  >
                    <Text
                      style={[
                        styles.introStepCircleText,
                        { color: step.circleFg },
                      ]}
                    >
                      {step.num}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.introStepTitle}>{step.title}</Text>
                    <Text style={styles.introStepDesc}>{step.desc}</Text>
                  </View>
                </View>
              ))}
            </View>

            <View style={styles.introFooter}>
              <Pressable
                onPress={toggleDontShowIntroAgain}
                style={styles.introCheckboxRow}
              >
                <View
                  style={[
                    styles.introCheckbox,
                    {
                      borderColor: dontShowIntroAgain
                        ? colors.primary
                        : colorScales.gray[300],
                      backgroundColor: dontShowIntroAgain
                        ? colors.primary
                        : colors.background,
                    },
                  ]}
                >
                  {dontShowIntroAgain && (
                    <Icon name="check" size={12} color={colors.background} />
                  )}
                </View>
                <Text style={styles.introCheckboxLabel}>
                  No volver a mostrar
                </Text>
              </Pressable>
              <View style={styles.introCountdownRow}>
                <View style={styles.introCountdownBar}>
                  <View
                    style={[
                      styles.introCountdownFill,
                      { width: `${introProgress}%` },
                    ]}
                  />
                </View>
                <Text style={styles.introCountdownText}>
                  {introCountdown}s
                </Text>
              </View>
            </View>
          </View>
        ) : (
          <>
            {/* ─── Step Indicator ───────────────────────────── */}
            <View style={{ marginBottom: spacing[4] }}>
              <StepIndicator currentStep={currentStep} />
            </View>

            {/* ─── Step 0: Preparar ──────────────────────────── */}
            {currentStep === 0 && (
              <View>
                {/* POP banner */}
                <View style={styles.popBanner}>
                  <Icon name="info" size={20} color={colorScales.blue[600]} />
                  <Text style={styles.popBannerText}>
                    Esta carga masiva gestiona el{' '}
                    <Text style={{ fontWeight: '700' }}>catálogo</Text>{' '}
                    (definir productos y servicios). Para stock, costos de
                    compra o activos contables, usa{' '}
                    <Text style={{ fontWeight: '700' }}>Inventario {'>'} POP</Text>.
                  </Text>
                </View>

                {/* ¿Cómo funciona? collapsible */}
                <Pressable
                  onPress={() => setShowHowItWorks((v) => !v)}
                  style={styles.howItWorksTrigger}
                >
                  <Icon name="info" size={16} color={colorScales.blue[600]} />
                  <Text style={styles.howItWorksTriggerText}>
                    ¿Cómo funciona el bulk de catálogo?
                  </Text>
                  <Icon
                    name={showHowItWorks ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color={colors.text.secondary}
                  />
                </Pressable>
                {showHowItWorks && (
                  <View style={styles.howItWorksBody}>
                    {[
                      { sym: '+', color: colorScales.green[600], text: 'Concepto nuevo (SKU no existe): se crea con los campos provistos.' },
                      { sym: '~', color: colorScales.blue[600], text: 'Concepto existente (SKU coincide): se actualiza solo los campos con valor. Las celdas vacías mantienen el valor previo (sparse update).' },
                      { sym: '∅', color: colorScales.amber[600], text: 'Para limpiar un campo opcional, escribe NULL, null, - o --.' },
                      { sym: '!', color: colorScales.gray[500], text: 'El concepto se identifica por SKU (case-insensitive).' },
                    ].map((item, idx) => (
                      <View key={idx} style={styles.howItWorksItem}>
                        <Text
                          style={[
                            styles.howItWorksSymbol,
                            { color: item.color },
                          ]}
                        >
                          {item.sym}
                        </Text>
                        <Text style={styles.howItWorksItemText}>{item.text}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {/* Hint */}
                <View style={styles.hintBanner}>
                  <Icon name="info" size={14} color={colorScales.blue[600]} />
                  <Text style={styles.hintBannerText}>
                    <Text style={{ fontWeight: '700' }}>Descarga la plantilla</Text>,
                    completa los datos de tus productos o servicios y sube el
                    archivo. Formatos: .xlsx, .xls, .csv · Máx. 1000 conceptos.
                  </Text>
                </View>

                {/* Template downloads */}
                <Text style={styles.sectionLabel}>1. Descarga una plantilla</Text>
                <View style={styles.templateRow}>
                  <View style={{ flex: 1 }}>
                    <TemplateCard
                      type="products"
                      title="Plantilla de Productos"
                      description="Campos de producto físico y flags comerciales"
                      iconName="package"
                      borderColor={colorScales.blue[200]}
                      iconBg={colorScales.blue[50]}
                      iconColor={colorScales.blue[600]}
                      onPress={() => handleDownloadTemplate('products')}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <TemplateCard
                      type="services"
                      title="Plantilla de Servicios"
                      description="Campos de servicio, reservas, recurrencia y consulta"
                      iconName="briefcase"
                      borderColor={colorScales.green[200]}
                      iconBg={colorScales.green[50]}
                      iconColor={colorScales.green[600]}
                      onPress={() => handleDownloadTemplate('services')}
                    />
                  </View>
                </View>

                {/* File upload */}
                <Text style={[styles.sectionLabel, { marginTop: spacing[4] }]}>
                  2. Sube tu archivo
                </Text>
                <DropZone file={selectedFile} onPick={handlePickFile} />

                {/* Plantilla con productos actuales (action secundario) */}
                <Pressable
                  onPress={handleDownloadCurrentProducts}
                  style={styles.downloadCurrentLink}
                >
                  <Icon name="download" size={14} color={colors.text.secondary} />
                  <Text style={styles.downloadCurrentLinkText}>
                    Descargar plantilla con productos actuales (.xlsx)
                  </Text>
                </Pressable>
              </View>
            )}

            {/* ─── Step 1: Revisar ────────────────────────────── */}
            {currentStep === 1 && (
              <View>
                {isAnalyzing ? (
                  <View style={styles.centered}>
                    <Spinner size="lg" />
                    <Text style={styles.loadingText}>Analizando archivo...</Text>
                    <Text style={styles.loadingHint}>
                      Verificando conceptos, marcas y categorías
                    </Text>
                  </View>
                ) : analysisResult ? (
                  <>
                    {/* Summary stats */}
                    <View style={styles.statsRow}>
                      <StatCard
                        label="Total"
                        value={analysisResult.total_products}
                        bg={colorScales.blue[50]}
                        fg={colorScales.blue[700]}
                        border={colorScales.blue[100]}
                      />
                      <StatCard
                        label="Listos"
                        value={analysisResult.ready}
                        bg={colorScales.green[50]}
                        fg={colorScales.green[700]}
                        border={colorScales.green[100]}
                      />
                      <StatCard
                        label="Advertencias"
                        value={analysisResult.with_warnings}
                        bg={colorScales.amber[50]}
                        fg={colorScales.amber[700]}
                        border={colorScales.amber[100]}
                      />
                      <StatCard
                        label="Errores"
                        value={analysisResult.with_errors}
                        bg={colorScales.red[50]}
                        fg={colorScales.red[700]}
                        border={colorScales.red[100]}
                      />
                    </View>

                    {/* Update legend */}
                    <View style={styles.legendRow}>
                      <View style={styles.legendItem}>
                        <View
                          style={[
                            styles.legendDot,
                            { backgroundColor: colorScales.green[500] },
                          ]}
                        />
                        <Text style={styles.legendText}>Cambia</Text>
                      </View>
                      <View style={styles.legendItem}>
                        <View
                          style={[
                            styles.legendDot,
                            { backgroundColor: colorScales.red[500] },
                          ]}
                        />
                        <Text style={styles.legendText}>Se limpia (→ null)</Text>
                      </View>
                      <Text
                        style={{
                          fontSize: typography.fontSize.xs,
                          color: colors.text.secondary,
                          fontStyle: 'italic',
                        }}
                      >
                        (sin cambios)
                      </Text>
                    </View>

                    {/* Per-row analysis */}
                    {analysisResult.products.length === 0 ? (
                      <EmptyState
                        title="Sin conceptos"
                        description="El archivo no contiene productos para analizar."
                      />
                    ) : (
                      <View style={styles.analysisList}>
                        {pagedAnalysisRows.map((item) => (
                          <AnalysisRowCard
                            key={`${item.row_number}-${item.sku}`}
                            item={item}
                          />
                        ))}
                      </View>
                    )}

                    {/* Pagination */}
                    {analysisResult.products.length > PAGE_SIZE && (
                      <Pagination
                        page={analysisPage}
                        totalPages={Math.ceil(
                          analysisResult.products.length / PAGE_SIZE,
                        )}
                        onPageChange={setAnalysisPage}
                      />
                    )}
                  </>
                ) : null}
              </View>
            )}

            {/* ─── Step 2: Resultados ─────────────────────────── */}
            {currentStep === 2 && (
              <View>
                {isUploading ? (
                  <View style={styles.centered}>
                    <Spinner size="lg" />
                    <Text style={styles.loadingText}>Cargando conceptos...</Text>
                    <Text style={styles.loadingHint}>
                      Esto puede tomar unos momentos
                    </Text>
                  </View>
                ) : (
                  <>
                    {uploadError && (
                      <View style={styles.errorBanner}>
                        <Icon name="alert-circle" size={14} color={colorScales.red[700]} />
                        <Text style={styles.errorBannerText}>{uploadError}</Text>
                      </View>
                    )}
                    {uploadResults && (
                      <>
                        <View style={styles.summaryCard}>
                          <View style={styles.summaryHeader}>
                            <Text style={styles.summaryTitle}>
                              Resumen de Carga
                            </Text>
                            <Text style={styles.summaryTotal}>
                              {uploadResults.total_processed} conceptos
                            </Text>
                          </View>
                          <View style={styles.summaryStatsRow}>
                            <StatCard
                              label="Exitosos"
                              value={uploadResults.successful}
                              bg={colorScales.green[50]}
                              fg={colorScales.green[700]}
                              border={colorScales.green[100]}
                            />
                            <StatCard
                              label="Fallidos"
                              value={uploadResults.failed}
                              bg={colorScales.red[50]}
                              fg={colorScales.red[700]}
                              border={colorScales.red[100]}
                            />
                            <StatCard
                              label="Omitidos"
                              value={uploadResults.skipped}
                              bg={colorScales.amber[50]}
                              fg={colorScales.amber[700]}
                              border={colorScales.amber[100]}
                            />
                          </View>
                        </View>

                        <View style={styles.detailCard}>
                          <View style={styles.detailHeader}>
                            <Icon name="list" size={14} color={colors.text.secondary} />
                            <Text style={styles.detailHeaderText}>
                              Detalle por Concepto
                            </Text>
                          </View>
                          {uploadResults.results.length === 0 ? (
                            <EmptyState
                              title="Sin detalle"
                              description="No hay resultados para mostrar."
                            />
                          ) : (
                            <View>
                              {pagedUploadRows.map((row, idx) => (
                                <ResultRow
                                  key={`${row.sku}-${idx}`}
                                  row={row}
                                />
                              ))}
                            </View>
                          )}
                        </View>

                        {uploadResults.results.length > PAGE_SIZE && (
                          <Pagination
                            page={uploadPage}
                            totalPages={Math.ceil(
                              uploadResults.results.length / PAGE_SIZE,
                            )}
                            onPageChange={setUploadPage}
                          />
                        )}

                        <Button
                          title="Cerrar"
                          variant="outline"
                          onPress={handleClose}
                          fullWidth
                          style={{ marginTop: spacing[4] }}
                        />
                      </>
                    )}
                  </>
                )}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </Modal>
  );
}

/* ============================================================
 * Styles
 * ============================================================ */

const styles = StyleSheet.create({
  body: {
    padding: spacing[4],
    gap: spacing[3],
  },
  footerRow: {
    flexDirection: 'row',
    gap: spacing[2],
  },
  footerBtn: {
    flex: 1,
  },

  // Intro screen
  introHeader: {
    alignItems: 'center',
    marginBottom: spacing[3],
  },
  introIconBox: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[2],
  },
  introTitle: {
    fontSize: typography.fontSize.base,
    fontWeight: '700',
    color: colors.text.primary,
  },
  introSubtitle: {
    fontSize: typography.fontSize.xs,
    color: colors.text.secondary,
    marginTop: spacing[1],
  },
  introSteps: {
    gap: spacing[2],
  },
  introStepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
  },
  introStepCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  introStepCircleText: {
    fontWeight: '700',
    fontSize: 10,
  },
  introStepTitle: {
    fontSize: typography.fontSize.xs,
    fontWeight: '600',
    color: colors.text.primary,
  },
  introStepDesc: {
    fontSize: 11,
    color: colors.text.secondary,
    marginTop: 2,
  },
  introFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing[2],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[100],
  },
  introCheckboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  introCheckbox: {
    width: 14,
    height: 14,
    borderRadius: 3,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  introCheckboxLabel: {
    fontSize: 11,
    color: colors.text.secondary,
  },
  introCountdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
  },
  introCountdownBar: {
    width: 64,
    height: 4,
    backgroundColor: colorScales.gray[200],
    borderRadius: 2,
    overflow: 'hidden',
  },
  introCountdownFill: {
    height: '100%',
    backgroundColor: colors.primary,
  },
  introCountdownText: {
    fontSize: 10,
    color: colors.text.secondary,
  },

  // Step indicator
  stepIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
  },
  stepIndicatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  stepCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Step 0
  popBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[3],
    padding: spacing[3],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.blue[200],
    backgroundColor: colorScales.blue[50],
  },
  popBannerText: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    color: colorScales.blue[800],
  },
  howItWorksTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    padding: spacing[3],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    backgroundColor: colorScales.gray[50],
  },
  howItWorksTriggerText: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    fontWeight: '600',
    color: colors.text.primary,
  },
  howItWorksBody: {
    paddingHorizontal: spacing[3],
    paddingTop: spacing[2],
    gap: spacing[2],
  },
  howItWorksItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2],
  },
  howItWorksSymbol: {
    fontSize: typography.fontSize.base,
    fontWeight: '700',
    width: 16,
  },
  howItWorksItemText: {
    flex: 1,
    fontSize: typography.fontSize.xs,
    color: colors.text.secondary,
  },
  hintBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2],
    padding: spacing[3],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.blue[100],
    backgroundColor: colorScales.blue[50],
  },
  hintBannerText: {
    flex: 1,
    fontSize: 11,
    color: colorScales.blue[800],
    lineHeight: 16,
  },
  sectionLabel: {
    fontSize: typography.fontSize.xs,
    fontWeight: '600',
    color: colors.text.primary,
    marginBottom: spacing[2],
  },
  templateRow: {
    flexDirection: 'row',
    gap: spacing[2],
  },
  templateCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[3],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
  },
  templateIconBox: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  templateTitle: {
    fontSize: typography.fontSize.xs,
    fontWeight: '700',
  },
  templateDesc: {
    fontSize: 10,
    marginTop: 2,
  },
  templateDownloadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: spacing[1],
  },
  templateDownloadText: {
    fontSize: 10,
    fontWeight: '700',
  },

  dropZone: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: borderRadius.md,
    padding: spacing[6],
    alignItems: 'center',
    justifyContent: 'center',
  },
  dropZonePrimary: {
    fontSize: typography.fontSize.base,
    fontWeight: '600',
    color: colors.text.primary,
    textAlign: 'center',
  },
  dropZoneSecondary: {
    fontSize: typography.fontSize.xs,
    color: colors.text.secondary,
    textAlign: 'center',
  },

  downloadCurrentLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    alignSelf: 'center',
    padding: spacing[2],
  },
  downloadCurrentLinkText: {
    fontSize: typography.fontSize.xs,
    color: colors.text.secondary,
    textDecorationLine: 'underline',
  },

  // Step 1
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[8],
    gap: spacing[3],
  },
  loadingText: {
    fontSize: typography.fontSize.sm,
    fontWeight: '600',
    color: colors.text.primary,
  },
  loadingHint: {
    fontSize: typography.fontSize.xs,
    color: colors.text.secondary,
  },
  statsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[2],
  },
  statCard: {
    flex: 1,
    minWidth: 80,
    padding: spacing[3],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
  },
  statCardLabel: {
    fontSize: 10,
    fontWeight: '600',
  },
  statCardValue: {
    fontSize: typography.fontSize.xl,
    fontWeight: '700',
    marginTop: spacing[1],
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing[3],
    marginVertical: spacing[3],
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontSize: typography.fontSize.xs,
    color: colors.text.secondary,
  },
  analysisList: {
    gap: spacing[2],
  },
  analysisRowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  analysisRowBadges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing[2],
    marginTop: spacing[2],
  },
  analysisRowInventoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginTop: spacing[2],
  },
  analysisRowServiceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[1],
    marginTop: spacing[2],
  },
  analysisRowMessages: {
    marginTop: spacing[2],
    paddingTop: spacing[2],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[100],
    gap: 4,
  },

  // Step 2
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2],
    padding: spacing[3],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.red[100],
    backgroundColor: colorScales.red[50],
  },
  errorBannerText: {
    flex: 1,
    fontSize: typography.fontSize.xs,
    color: colorScales.red[700],
  },
  summaryCard: {
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    backgroundColor: colors.card,
    overflow: 'hidden',
  },
  summaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    backgroundColor: colorScales.gray[50],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[200],
  },
  summaryTitle: {
    fontSize: typography.fontSize.sm,
    fontWeight: '600',
    color: colors.text.primary,
  },
  summaryTotal: {
    fontSize: typography.fontSize.xs,
    color: colors.text.secondary,
  },
  summaryStatsRow: {
    flexDirection: 'row',
    padding: spacing[3],
    gap: spacing[2],
  },
  detailCard: {
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    backgroundColor: colors.card,
    overflow: 'hidden',
    marginTop: spacing[3],
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    backgroundColor: colorScales.gray[50],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[200],
  },
  detailHeaderText: {
    fontSize: typography.fontSize.xs,
    fontWeight: '600',
    color: colors.text.primary,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  resultRowText: {
    flex: 1.5,
    fontSize: typography.fontSize.sm,
    color: colors.text.primary,
  },
  resultRowStatus: {
    flex: 1,
    alignItems: 'flex-start',
  },
  resultRowMessage: {
    flex: 2,
    fontSize: typography.fontSize.xs,
    color: colors.text.secondary,
  },
});
