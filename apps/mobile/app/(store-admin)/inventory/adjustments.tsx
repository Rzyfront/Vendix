import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, FlatList, RefreshControl, Pressable, Modal, ScrollView, StyleSheet, TextInput, Dimensions,
} from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { InventoryService } from '@/features/store/services/inventory.service';
import { ProductService } from '@/features/store/services/product.service';
import { getNextPageParam } from '@/core/api/pagination';
import type { CreateAdjustmentDto } from '@/features/store/services/inventory.service';
import type { StockAdjustment, AdjustmentType, AdjustmentState, Location } from '@/features/store/types';
import { ADJUSTMENT_TYPE_LABELS } from '@/features/store/types';
import { Input } from '@/shared/components/input/input';
import { Button } from '@/shared/components/button/button';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { Spinner } from '@/shared/components/spinner/spinner';
import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';
import { Icon } from '@/shared/components/icon/icon';
import { StatsGrid } from '@/shared/components/stats-card/stats-grid';
import { formatDate } from '@/shared/utils/date';
import { spacing, borderRadius, colors, colorScales, typography, shadows } from '@/shared/theme';
import { INVENTORY_ICONS, STAT_PALETTE } from '@/features/store/constants/inventory-icons';
import { ADJUSTMENT_STATS, ADJUSTMENT_TYPE_MAP, ADJUSTMENT_TYPE_OPTIONS, WIZARD_STEPS } from '@/features/store/constants/inventory-labels';

const STATE_VARIANT: Record<AdjustmentState, 'warning' | 'success'> = {
  pending: 'warning',
  applied: 'success',
};

const REASON_CODE_LABELS: Record<string, string> = {
  DAMAGED: 'Producto dañado',
  LOST: 'Producto perdido',
  THEFT: 'Robo confirmado',
  EXPIRED: 'Producto vencido',
  INV_COUNT: 'Conteo de inventario',
  OTHER: 'Otro',
};

function AdjustmentCard({
  item,
  onView,
}: {
  item: StockAdjustment;
  onView?: (item: StockAdjustment) => void;
}) {
  // Fallbacks seguros para evitar "[object Object]" si el backend devuelve un objeto en campos string
  const productName =
    typeof item.products?.name === 'string'
      ? item.products.name
      : typeof item.description === 'string'
      ? item.description
      : 'Producto sin nombre';
  const locationName =
    typeof item.inventory_locations?.name === 'string'
      ? item.inventory_locations.name
      : 'Sin ubicación';
  const typeLabel = ADJUSTMENT_TYPE_LABELS[item.adjustment_type] ?? 'Ajuste';
  const dateLabel = formatDate(item.created_at);
  const quantityChange = Number(item.quantity_change ?? 0);
  return (
    <View style={styles.card}>
      <View style={styles.cardBody}>
        {/* Fila 1: Título + badge de tipo (alineado con la web) */}
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle} numberOfLines={1}>{productName}</Text>
          <View style={styles.cardBadge}>
            <Text style={styles.cardBadgeText}>{typeLabel}</Text>
          </View>
        </View>

        {/* Fila 2: Grid 2 columnas — FECHA | UBICACIÓN (como la web) */}
        <View style={styles.cardGrid}>
          <View style={styles.cardGridItem}>
            <Text style={styles.cardGridLabel}>FECHA</Text>
            <Text style={styles.cardGridValue}>{dateLabel}</Text>
          </View>
          <View style={styles.cardGridItem}>
            <Text style={styles.cardGridLabel}>UBICACIÓN</Text>
            <Text style={styles.cardGridValue} numberOfLines={1}>{locationName}</Text>
          </View>
        </View>

        {/* Fila 3: Footer con CAMBIO + botón (ver) (como la web) */}
        <View style={styles.cardFooter}>
          <View style={styles.cardFooterLeft}>
            <Text style={styles.cardFooterLabel}>CAMBIO</Text>
            <Text style={styles.cardFooterValue}>{`${quantityChange}`}</Text>
          </View>
          {onView && (
            <Pressable
              onPress={() => onView(item)}
              hitSlop={8}
              style={({ pressed }) => [styles.eyeBtn, pressed && { opacity: 0.6 }]}
              accessibilityLabel="Ver detalle del ajuste"
            >
              <Icon name="eye" size={16} color={colors.primary} />
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

/**
 * Adjustment detail popup — opened when the user taps the eye (ver) button on
 * an AdjustmentCard. Mirrors the web `app-adjustment-detail-modal` visual
 * contract: header with status badge, product/variant/location, before/after/
 * change breakdown, motivo, and contextual actions (Eliminar / Aprobar /
 * Cerrar) based on whether the adjustment is pending or already applied.
 */
interface BulkResultItem {
  row_number: number;
  sku: string;
  product_name?: string;
  status: 'success' | 'error';
  message?: string;
  quantity_change?: number;
}

interface BulkUploadResult {
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
 * Footer: Atrás / Cancelar-Cerrar / Siguiente / Subir y Aplicar.
 */
function BulkAdjustmentModal({
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
      const blob = await InventoryService.downloadAdjustmentTemplate(
        selectedLocationId ?? undefined,
      );
      const url = (global as any).URL?.createObjectURL?.(blob);
      // En React Native no hay URL.createObjectURL nativo. Usamos Linking/RNFS en runtime.
      // Para simplicidad aquí guardamos el blob como data URI y lo dejamos listo.
      if (url) {
        const link = (global as any).document?.createElement?.('a');
        if (link) {
          link.href = url;
          link.download = `plantilla_ajuste_inventario_${new Date().toISOString().split('T')[0]}.xlsx`;
          link.click();
          (global as any).URL.revokeObjectURL?.(url);
        }
      }
      toastSuccess('Plantilla descargada');
    } catch (e: any) {
      toastError(e?.message || 'Error al descargar plantilla');
    } finally {
      setIsDownloading(false);
    }
  };

  const handlePickFile = async () => {
    try {
      const DocumentPicker = await import('expo-document-picker');
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
  const typeOptions = [
    { value: 'count_variance', label: 'Varianza de conteo' },
    { value: 'manual_correction', label: 'Corrección manual' },
    { value: 'damage', label: 'Daño' },
    { value: 'loss', label: 'Pérdida' },
    { value: 'theft', label: 'Robo / Hurto' },
    { value: 'expiration', label: 'Vencimiento' },
  ];

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

          {/* Step Indicator (1 — 2 — 3) */}
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

                {/* Ubicación */}
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

                {/* Tipo de ajuste (global) */}
                <View>
                  <Text style={bulkStyles.formLabel}>Tipo de ajuste (global)</Text>
                  <View style={bulkStyles.typeGrid}>
                    {typeOptions.map((t) => (
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

                {/* Descripción */}
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

                {/* Botón descargar plantilla */}
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
                    {/* Summary cards */}
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

                    {/* Results table */}
                    <View style={bulkStyles.tableContainer}>
                      <View style={bulkStyles.tableHeader}>
                        <Text style={[bulkStyles.tableCell, bulkStyles.tableCellHeader]}>Fila</Text>
                        <Text style={[bulkStyles.tableCell, bulkStyles.tableCellHeader]}>SKU</Text>
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

                    {/* Error details */}
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

function AdjustmentDetailModal({
  adjustment,
  onClose,
  onApprove,
  onDelete,
  isSubmitting = false,
}: {
  adjustment: StockAdjustment | null;
  onClose: () => void;
  onApprove?: (a: StockAdjustment) => void;
  onDelete?: (a: StockAdjustment) => void;
  isSubmitting?: boolean;
}) {
  // Guard clause: don't render anything when there's no adjustment.
  if (!adjustment) return null;
  // Defensive: ensure the adjustment has the minimum shape required.
  if (typeof adjustment !== 'object') return null;

  const typeInfo =
    ADJUSTMENT_TYPE_MAP && adjustment.adjustment_type
      ? ADJUSTMENT_TYPE_MAP[adjustment.adjustment_type]
      : undefined;
  const isPending = !adjustment.approved_at;
  const quantityBefore = Number(adjustment.quantity_before ?? 0) || 0;
  const quantityAfter = Number(adjustment.quantity_after ?? 0) || 0;
  const quantityChange = Number(adjustment.quantity_change ?? 0) || 0;
  const productName =
    typeof adjustment?.products?.name === 'string'
      ? adjustment.products.name
      : 'Producto';
  const locationName =
    typeof adjustment?.inventory_locations?.name === 'string'
      ? adjustment.inventory_locations.name
      : 'Sin ubicación';
  const reasonLabel =
    REASON_CODE_LABELS[adjustment.reason_code ?? ''] ??
    adjustment.reason_code ??
    '—';
  const createdBy =
    typeof adjustment?.created_by_user?.user_name === 'string'
      ? adjustment.created_by_user.user_name
      : '—';
  const approvedBy =
    typeof adjustment?.approved_by_user?.user_name === 'string'
      ? adjustment.approved_by_user.user_name
      : null;
  const adjustmentId = adjustment?.id != null ? Number(adjustment.id) : 0;
  const safeApprove = () => {
    if (onApprove && adjustmentId > 0) onApprove(adjustment);
  };
  const safeDelete = () => {
    if (onDelete && adjustmentId > 0) onDelete(adjustment);
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.detailOverlay}>
        <View style={styles.detailModal}>
          {/* Header */}
          <View style={styles.detailHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.detailTitle}>Detalle del Ajuste</Text>
              <Text style={styles.detailSubtitle} numberOfLines={1}>
                {productName}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8} style={styles.detailCloseBtn}>
              <Icon name="x" size={22} color={colorScales.gray[500]} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.detailBody}
            contentContainerStyle={styles.detailBodyContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Tipo badge */}
            <View style={styles.detailTypeCard}>
              <View style={styles.detailTypeIcon}>
                <Icon
                  name={(typeInfo && typeInfo.icon) || 'edit-2'}
                  size={20}
                  color={colors.primary}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.detailTypeLabel}>Tipo de Ajuste</Text>
                <Text style={styles.detailTypeValue}>
                  {(typeInfo && typeInfo.label) || 'Ajuste'}
                </Text>
              </View>
            </View>

            {/* Ubicación */}
            <View style={styles.detailSection}>
              <View style={styles.detailSectionHeader}>
                <Icon name="map-pin" size={14} color={colorScales.gray[500]} />
                <Text style={styles.detailSectionTitle}>UBICACIÓN</Text>
              </View>
              <View style={styles.detailInfoCard}>
                <Text style={styles.detailInfoPrimary}>{locationName}</Text>
              </View>
            </View>

            {/* Cambio de Cantidad: Antes / Cambio / Después */}
            <View style={styles.detailSection}>
              <View style={styles.detailSectionHeader}>
                <Icon name="hash" size={14} color={colorScales.gray[500]} />
                <Text style={styles.detailSectionTitle}>CAMBIO DE CANTIDAD</Text>
              </View>
              <View style={styles.detailQuantityCard}>
                <View style={styles.detailQuantityRow}>
                  <View style={styles.detailQuantityCell}>
                    <Text style={styles.detailQuantityLabel}>ANTES</Text>
                    <Text style={styles.detailQuantityValue}>
                      {`${quantityBefore}`}
                    </Text>
                  </View>
                  <Icon
                    name={quantityChange >= 0 ? 'trending-up' : 'trending-down'}
                    size={20}
                    color={quantityChange >= 0 ? colors.primary : colors.error}
                  />
                  <View style={styles.detailQuantityCell}>
                    <Text style={styles.detailQuantityLabel}>CAMBIO</Text>
                    <Text
                      style={[
                        styles.detailQuantityValue,
                        {
                          color: quantityChange >= 0 ? colors.primary : colors.error,
                        },
                      ]}
                    >
                      {quantityChange > 0 ? `+${quantityChange}` : `${quantityChange}`}
                    </Text>
                  </View>
                  <Icon name="chevron-right" size={20} color={colorScales.gray[400]} />
                  <View style={styles.detailQuantityCell}>
                    <Text style={styles.detailQuantityLabel}>DESPUÉS</Text>
                    <Text style={styles.detailQuantityValue}>
                      {`${quantityAfter}`}
                    </Text>
                  </View>
                </View>
              </View>
            </View>

            {/* Motivo */}
            <View style={styles.detailSection}>
              <View style={styles.detailSectionHeader}>
                <Icon name="file-text" size={14} color={colorScales.gray[500]} />
                <Text style={styles.detailSectionTitle}>MOTIVO</Text>
              </View>
              <View style={styles.detailInfoCard}>
                <Text style={styles.detailInfoPrimary}>{`${reasonLabel}`}</Text>
                {adjustment.description ? (
                  <Text style={styles.detailInfoSecondary}>
                    {`${adjustment.description}`}
                  </Text>
                ) : null}
              </View>
            </View>

            {/* Auditoría */}
            <View style={styles.detailSection}>
              <View style={styles.detailSectionHeader}>
                <Icon name="users" size={14} color={colorScales.gray[500]} />
                <Text style={styles.detailSectionTitle}>AUDITORÍA</Text>
              </View>
              <View style={styles.detailInfoCard}>
                <View style={styles.detailAuditRow}>
                  <View style={styles.detailAuditIcon}>
                    <Icon name="user" size={14} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.detailInfoLabel}>CREADO POR</Text>
                    <Text style={styles.detailInfoPrimary}>{`${createdBy}`}</Text>
                    <Text style={styles.detailInfoSecondary}>
                      {`${formatDate(adjustment.created_at)}`}
                    </Text>
                  </View>
                </View>
                {approvedBy ? (
                  <View style={[styles.detailAuditRow, { marginTop: spacing[2] }]}>
                    <View style={styles.detailAuditIcon}>
                      <Icon name="user-check" size={14} color={colors.success} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.detailInfoLabel}>APROBADO POR</Text>
                      <Text style={styles.detailInfoPrimary}>{`${approvedBy}`}</Text>
                      <Text style={styles.detailInfoSecondary}>
                        {adjustment.approved_at
                          ? `${formatDate(adjustment.approved_at)}`
                          : '—'}
                      </Text>
                    </View>
                  </View>
                ) : null}
              </View>
            </View>
          </ScrollView>

          {/* Footer: contextual actions */}
          <View style={styles.detailFooter}>
            {isPending ? (
              <>
                {onDelete && (
                  <Pressable
                    style={styles.detailDangerBtn}
                    onPress={safeDelete}
                    disabled={isSubmitting || adjustmentId <= 0}
                  >
                    <Text style={styles.detailDangerBtnText}>Eliminar</Text>
                  </Pressable>
                )}
                <View style={{ width: spacing[2] }} />
                {onApprove && (
                  <Pressable
                    style={styles.detailPrimaryBtn}
                    onPress={safeApprove}
                    disabled={isSubmitting || adjustmentId <= 0}
                  >
                    {isSubmitting ? (
                      <Spinner size="sm" />
                    ) : (
                      <Icon name="check" size={16} color={colors.background} />
                    )}
                    <Text style={styles.detailPrimaryBtnText}>
                      {isSubmitting ? 'Aprobando…' : 'Aprobar'}
                    </Text>
                  </Pressable>
                )}
              </>
            ) : (
              <Pressable style={styles.detailCancelBtn} onPress={onClose}>
                <Text style={styles.detailCancelBtnText}>Cerrar</Text>
              </Pressable>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

export default function AdjustmentsScreen() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<AdjustmentType | 'all'>('all');
  const [modalVisible, setModalVisible] = useState(false);
  const [detailAdjustment, setDetailAdjustment] = useState<StockAdjustment | null>(null);
  const [bulkUploadOpen, setBulkUploadOpen] = useState(false);
  const [createStep, setCreateStep] = useState<1 | 2 | 3>(1);
  const [confirmCreate, setConfirmCreate] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [showTypeOptions, setShowTypeOptions] = useState(false);
  const filterBtnRef = useRef<View>(null);
  const actionsBtnRef = useRef<View>(null);
  const [filterDropdownPos, setFilterDropdownPos] = useState({ top: 0, right: 0 });
  const [actionsDropdownPos, setActionsDropdownPos] = useState({ top: 0, right: 0 });
  const screenW = Dimensions.get('window').width;
  const [form, setForm] = useState<{
    product_id: number;
    description: string;
    type: AdjustmentType;
    quantity_after: number;
    reason_code: string;
  }>({
    product_id: 0,
    description: '',
    type: 'manual_correction',
    quantity_after: 0,
    reason_code: '',
  });

  // --- Wizard state (Crear Ajuste — 3 pasos como la web) ---
  const [selectedLocation, setSelectedLocation] = useState<number | null>(null);
  const [showLocationDropdown, setShowLocationDropdown] = useState(false);
  const [productSearchTerm, setProductSearchTerm] = useState('');
  const [productSearchResults, setProductSearchResults] = useState<Array<{ id: number; name: string; sku?: string; stock: number }>>([]);
  // Ubicaciones reales desde el backend
  const { data: locationsData, isLoading: isLoadingLocations } = useQuery({
    queryKey: ['locations', 'all'],
    queryFn: () => InventoryService.getLocations({ page: 1, limit: 100 }),
  });
  const LOCATIONS: { value: number; label: string }[] = (locationsData?.data ?? []).map((loc: Location) => ({
    value: Number(loc.id),
    label: loc.name,
  }));
  // Productos reales desde el backend (reemplaza el MOCK hardcoded anterior)
  const productsQuery = useQuery({
    queryKey: ['adjustments-products-search', productSearchTerm],
    queryFn: () =>
      ProductService.list({
        page: 1,
        limit: 50,
        search: productSearchTerm.trim() || undefined,
        include_variants: true,
      }),
    enabled: createStep === 2 && productSearchTerm.trim().length > 0,
    staleTime: 30_000,
  });
  const storeProducts: Array<{ id: number; name: string; sku?: string; stock: number; category?: string }> =
    (productsQuery.data?.data ?? []).map((p) => ({
      id: Number(p.id),
      name: p.name,
      sku: p.sku,
      stock: p.stock_quantity ?? 0,
      category: p.category?.name,
    }));
  const selectedLocationName = selectedLocation ? LOCATIONS.find((l) => l.value === selectedLocation)?.label : '';

  const isFocused = useIsFocused();

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, refetch, isRefetching } = useInfiniteQuery({
    queryKey: ['adjustments', search, activeFilter],
    queryFn: ({ pageParam = 1 }) =>
      InventoryService.getAdjustments({
        page: pageParam,
        limit: 20,
        search: search || undefined,
        type: activeFilter === 'all' ? undefined : activeFilter,
      }),
    getNextPageParam,
    initialPageParam: 1,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  // Refetch cuando la pantalla toma foco (ej. usuario vuelve del web al mobile)
  useEffect(() => {
    if (isFocused) {
      refetch();
    }
  }, [isFocused, refetch]);

  const createMutation = useMutation({
    mutationFn: (dto: CreateAdjustmentDto) => InventoryService.createAdjustment(dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adjustments'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-stats'] });
      setModalVisible(false);
      setForm({ product_id: 0, description: '', type: 'manual_correction', quantity_after: 0, reason_code: '' });
      setSelectedLocation(null);
      setShowLocationDropdown(false);
      setProductSearchTerm('');
      setProductSearchResults([]);
      setCreateStep(1);
      setConfirmCreate(false);
      toastSuccess('Ajuste creado correctamente');
    },
    onError: (error: any) => {
      // Log full error for debugging
      console.error('[createAdjustment] Error:', {
        status: error?.response?.status,
        data: error?.response?.data,
        message: error?.message,
      });
      const apiMessage =
        error?.response?.data?.message ||
        error?.response?.data?.error?.message ||
        error?.response?.data?.error;
      const errorCode =
        error?.response?.data?.error_code ||
        error?.response?.data?.errorCode;
      const messageParts: string[] = [];
      if (typeof apiMessage === 'string') messageParts.push(apiMessage);
      else if (Array.isArray(apiMessage)) messageParts.push(apiMessage.join(', '));
      if (errorCode) messageParts.push(`(${errorCode})`);
      if (messageParts.length === 0 && error?.message) messageParts.push(error.message);
      if (messageParts.length === 0) messageParts.push('Error desconocido al crear el ajuste');
      toastError(messageParts.join(' '));
    },
  });

  // Action mutations wired to AdjustmentDetailModal contextual buttons
  const approveMutation = useMutation({
    mutationFn: (id: number) => InventoryService.approveAdjustment(id, 0),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adjustments'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-stats'] });
      setDetailAdjustment(null);
      toastSuccess('Ajuste aprobado');
    },
    onError: () => toastError('No se pudo aprobar el ajuste'),
  });

  const deleteAdjustmentMutation = useMutation({
    mutationFn: (id: number) => InventoryService.deleteAdjustment(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adjustments'] });
      setDetailAdjustment(null);
      toastSuccess('Ajuste eliminado');
    },
    onError: () => toastError('No se pudo eliminar el ajuste'),
  });

  const adjustments = data?.pages.flatMap((p) => p.data) ?? [];

  // El backend `/store/inventory/adjustments` ya filtra por `organization_id` del
  // contexto, así que NO descartamos ajustes client-side por `store_id` (esa lógica
  // anterior filtraba ajustes legítimos cuya ubicación tenía `store_id` null).
  const storeAdjustments = adjustments;

  const totals = {
    total: storeAdjustments.length,
    losses: storeAdjustments.filter((a) => a.adjustment_type === 'loss').length,
    damages: storeAdjustments.filter((a) => a.adjustment_type === 'damage').length,
    corrections: storeAdjustments.filter((a) => a.adjustment_type === 'manual_correction').length,
  };

  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const handleRefresh = useCallback(() => refetch(), [refetch]);

  const handleShowFilters = useCallback(() => {
    filterBtnRef.current?.measureInWindow((x, y, width, btnHeight) => {
      setFilterDropdownPos({ top: y + btnHeight + 6, right: screenW - x - width });
      setShowFilters(true);
    });
  }, [screenW]);

  const handleShowActions = useCallback(() => {
    actionsBtnRef.current?.measureInWindow((x, y, width, btnHeight) => {
      setActionsDropdownPos({ top: y + btnHeight + 6, right: screenW - x - width });
      setShowActions(true);
    });
  }, [screenW]);

  const handleSubmit = () => {
    if (!form.product_id || !form.description || form.quantity_after <= 0 || !selectedLocation) {
      toastError('Completa todos los campos requeridos');
      return;
    }
    // DTO batch que espera el backend (POST /store/inventory/adjustments/batch-complete).
    // El campo `quantity_after` es el stock FINAL (no el cambio). El backend calcula
    // automáticamente `quantity_change = quantity_after - quantity_before`.
    const dto: CreateAdjustmentDto = {
      location_id: selectedLocation,
      items: [{
        product_id: form.product_id,
        type: form.type,
        quantity_after: form.quantity_after,
        ...(form.reason_code && { reason_code: form.reason_code }),
        ...(form.description && { description: form.description }),
      }],
    };
    createMutation.mutate(dto);
  };

  // Stock actual del producto seleccionado (viene de ProductService.list)
  const selectedProductCurrentStock =
    storeProducts.find((p) => p.id === form.product_id)?.stock ?? 0;
  // Diferencia calculada en cliente para mostrar en UI (el backend hace lo mismo)
  const calculatedQuantityChange = form.quantity_after - selectedProductCurrentStock;

  // --- Wizard helpers (Crear Ajuste — 3 pasos como la web) ---
  const canAdvanceStep1 = selectedLocation !== null;
  const canAdvanceStep2 = !!(form.product_id && form.description && form.quantity_after > 0);
  const goToStep2 = () => { if (canAdvanceStep1) setCreateStep(2); };
  const goToStep3 = () => { if (canAdvanceStep2) setCreateStep(3); };
  const goBackToStep1 = () => setCreateStep(1);
  const goBackToStep2 = () => setCreateStep(2);
  const openCreateModal = () => { setCreateStep(1); setConfirmCreate(false); setSelectedLocation(null); setShowLocationDropdown(false); setProductSearchTerm(''); setProductSearchResults([]); setModalVisible(true); };
  const closeCreateModal = () => { setModalVisible(false); setCreateStep(1); setConfirmCreate(false); setSelectedLocation(null); setShowLocationDropdown(false); setProductSearchTerm(''); setProductSearchResults([]); };
  const STEPS = [
    { num: 1, label: 'UBICACIÓN' },
    { num: 2, label: 'PRODUCTOS' },
    { num: 3, label: 'CONFIRMAR' },
  ];
  const TYPE_OPTIONS: { value: AdjustmentType; label: string; icon: string }[] = [
    { value: 'damage', label: 'Daño', icon: 'alert-triangle' },
    { value: 'loss', label: 'Pérdida', icon: 'trending-down' },
    { value: 'theft', label: 'Robo', icon: 'lock' },
    { value: 'expiration', label: 'Vencido', icon: 'clock' },
    { value: 'count_variance', label: 'Conteo', icon: 'layers' },
    { value: 'manual_correction', label: 'Corrección', icon: 'edit-2' },
  ];
  const searchProducts = (term: string) => {
    setProductSearchTerm(term);
    if (term.trim().length < 1) {
      setProductSearchResults([]);
      return;
    }
    // Backend query se dispara automáticamente via useQuery (enabled).
    // Acá filtramos los resultados contra el producto ya seleccionado.
    setProductSearchResults(
      storeProducts.filter((p) => p.id !== form.product_id),
    );
  };
  const selectProduct = (product: { id: number; name: string; sku?: string; stock: number }) => {
    setForm({ ...form, product_id: product.id, description: product.name });
    setProductSearchResults([]);
    setProductSearchTerm('');
  };
  const locationLabel = (id: number | null) => (id ? LOCATIONS.find((l) => l.value === id)?.label : '');

  return (
    <View style={styles.screen}>
      {/* Stats: calculado dinámicamente desde los datos (no más hardcoded 0) */}
      <StatsGrid
        style={styles.statsContainer}
        items={[
          {
            label: ADJUSTMENT_STATS.total.label,
            value: totals.total,
            icon: INVENTORY_ICONS.adjustmentsTotalStat,
            iconBg: STAT_PALETTE.blue.bg,
            iconColor: STAT_PALETTE.blue.color,
            description: ADJUSTMENT_STATS.total.description,
          },
          {
            label: ADJUSTMENT_STATS.loss.label,
            value: totals.losses,
            icon: INVENTORY_ICONS.lossStat,
            iconBg: STAT_PALETTE.red.bg,
            iconColor: STAT_PALETTE.red.color,
            description: ADJUSTMENT_STATS.loss.description,
          },
          {
            label: ADJUSTMENT_STATS.damage.label,
            value: totals.damages,
            icon: INVENTORY_ICONS.damageStat,
            iconBg: STAT_PALETTE.amber.bg,
            iconColor: STAT_PALETTE.amber.color,
            description: ADJUSTMENT_STATS.damage.description,
          },
          {
            label: ADJUSTMENT_STATS.correction.label,
            value: totals.corrections,
            icon: INVENTORY_ICONS.correctionStat,
            iconBg: STAT_PALETTE.green.bg,
            iconColor: STAT_PALETTE.green.color,
            description: ADJUSTMENT_STATS.correction.description,
          },
        ]}
      />

      {/* Card contenedor: título + búsqueda + cards de ajustes (con margen y border radius) */}
      <View style={styles.cardContainer}>
      <FlatList
        data={storeAdjustments}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <AdjustmentCard item={item} onView={setDetailAdjustment} />
        )}
        ListHeaderComponent={
          <View>
            {/* Search + Title row */}
            <View style={styles.searchHeader}>
              <Text style={styles.listTitle}>
                Ajustes de Inventario ({storeAdjustments.length})
              </Text>
            </View>
            {/* POS-style search bar — fondo transparente para integrarse con el card */}
            <View style={styles.searchRow}>
              <View style={styles.searchInput}>
                <Icon name="search" size={16} color={colorScales.gray[400]} style={{ marginRight: 6 }} />
                <TextInput
                  style={styles.searchTextInput}
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Buscar ajuste..."
                  placeholderTextColor={colorScales.gray[400]}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="search"
                />
                {search.length > 0 && (
                  <Pressable onPress={() => setSearch('')} hitSlop={8}>
                    <Icon name="x" size={16} color={colorScales.gray[400]} />
                  </Pressable>
                )}
              </View>
              <Pressable ref={actionsBtnRef} style={styles.iconBtn} onPress={handleShowActions} hitSlop={6}>
                <Icon name="plus" size={20} color={colors.primary} />
              </Pressable>
              <Pressable ref={filterBtnRef} style={styles.iconBtn} onPress={handleShowFilters} hitSlop={6}>
                <Icon name="filter" size={18} color={colors.primary} />
              </Pressable>
            </View>


          </View>
        }
        ListEmptyComponent={
          isLoading ? (
            <Spinner />
          ) : (
            <EmptyState
              title="Sin ajustes"
              description="No se encontraron ajustes de stock"
              actionLabel="Crear Ajustes"
              onAction={openCreateModal}
              secondaryActionLabel="Actualizar"
              onSecondaryAction={handleRefresh}
            />
          )
        }
        ListFooterComponent={isFetchingNextPage ? <Spinner /> : null}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={handleRefresh} />}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.3}
        contentContainerStyle={styles.listContent}
      />
      </View>

      {/* Actions Dropdown */}
      <Modal
        visible={showActions}
        transparent
        animationType="fade"
        presentationStyle="overFullScreen"
        statusBarTranslucent
        onRequestClose={() => setShowActions(false)}
      >
        <Pressable style={styles.dropdownBackdrop} onPress={() => setShowActions(false)} />
        <View style={[styles.dropdownPositioner, { top: actionsDropdownPos.top, right: actionsDropdownPos.right }]}>
          <View style={[styles.dropdownArrow, { marginRight: Math.max(actionsDropdownPos.right, 14) }]} />
          <View style={styles.dropdown}>
            <Pressable style={styles.dropdownItem} onPress={() => { setShowActions(false); setModalVisible(true); }}>
              <View style={styles.dropdownIconWrap}>
                <Icon name="plus" size={18} color={colors.primary} />
              </View>
              <Text style={styles.dropdownItemPrimary}>Nuevo Ajuste</Text>
            </Pressable>
            <View style={styles.dropdownDivider} />
            <Pressable style={styles.dropdownItem} onPress={() => { setShowActions(false); setBulkUploadOpen(true); }}>
              <View style={styles.dropdownIconWrap}>
                <Icon name="upload" size={18} color={colorScales.gray[500]} />
              </View>
              <Text style={styles.dropdownItemText}>Carga Masiva</Text>
            </Pressable>
            <View style={styles.dropdownDivider} />
            <Pressable style={styles.dropdownItem} onPress={() => { setShowActions(false); handleRefresh(); }}>
              <View style={styles.dropdownIconWrap}>
                <Icon name="refresh" size={18} color={colorScales.gray[500]} />
              </View>
              <Text style={styles.dropdownItemText}>Refrescar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Filter Dropdown */}
      <Modal
        visible={showFilters}
        transparent
        animationType="fade"
        presentationStyle="overFullScreen"
        statusBarTranslucent
        onRequestClose={() => { setShowFilters(false); setShowTypeOptions(false); }}
      >
        <Pressable style={styles.dropdownBackdrop} onPress={() => { setShowFilters(false); setShowTypeOptions(false); }} />
        <View style={[styles.dropdownPositioner, { top: filterDropdownPos.top, right: filterDropdownPos.right }]}>
          <View style={[styles.dropdownArrow, { marginRight: Math.max(filterDropdownPos.right, 14) }]} />
          <View style={styles.dropdown}>
            <Text style={styles.dropdownTitle}>Tipos de filtro</Text>
            <View style={styles.dropdownDivider} />
            <View style={styles.dropdownFilterRow}>
              <Text style={styles.dropdownFilterLabel}>Tipo</Text>
              <Pressable style={styles.dropdownSelectBtn} onPress={() => setShowTypeOptions((v) => !v)}>
                <Text style={styles.dropdownSelectText}>
                  {ADJUSTMENT_TYPE_OPTIONS.find((o) => o.value === activeFilter)?.label ?? 'Todos los tipos'}
                </Text>
                <Icon name="chevron-down" size={14} color={colorScales.gray[500]} />
              </Pressable>
            </View>
            <View style={styles.dropdownDivider} />
            {showTypeOptions && (
              <View>
                {ADJUSTMENT_TYPE_OPTIONS.map((opt) => (
                  <Pressable key={opt.value} style={[styles.dropdownOption, activeFilter === opt.value && styles.dropdownOptionActive]} onPress={() => { setActiveFilter(opt.value); setShowTypeOptions(false); setShowFilters(false); }}>
                    <Text style={[styles.dropdownOptionText, activeFilter === opt.value && styles.dropdownOptionTextActive]}>{opt.label}</Text>
                    {activeFilter === opt.value && <Icon name="check" size={16} color={colors.primary} />}
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* Create Modal — alineado con la web (centered dialog + wizard 2 pasos) */}
      <Modal visible={modalVisible} transparent animationType="fade" onRequestClose={closeCreateModal}>
        <View style={styles.createModalOverlay}>
          <View style={styles.createModal}>
            {/* Header: icon + dynamic title (cambia por paso) + subtitle */}
            <View style={styles.createHeader}>
              <View style={styles.createHeaderTitle}>
                <Icon name="sliders" size={22} color={colors.primary} />
                <View style={styles.createHeaderText}>
                  <Text style={styles.createTitle}>
                    {createStep === 1
                      ? 'Seleccionar Ubicación'
                      : createStep === 2
                        ? 'Agregar Productos'
                        : 'Confirmar Ajustes'}
                  </Text>
                  <Text style={styles.createSubtitle}>Registrar ajustes de inventario</Text>
                </View>
              </View>
              <Pressable onPress={closeCreateModal} hitSlop={8}>
                <Icon name="x" size={22} color={colorScales.gray[500]} />
              </Pressable>
            </View>

            {/* Steps indicator (como la web: UBICACION, PRODUCTOS, CONFIRMAR) */}
            <View style={styles.stepsRow}>
              {STEPS.map((s, idx) => {
                const isActive = createStep === s.num;
                const isDone = createStep > s.num;
                return (
                  <React.Fragment key={s.num}>
                    <View style={styles.stepItem}>
                      <View style={[styles.stepCircle, isActive && styles.stepCircleActive, isDone && styles.stepCircleDone]}>
                        {isDone ? (
                          <Icon name="check" size={12} color={colors.background} />
                        ) : (
                          <Text style={[styles.stepNum, isActive && styles.stepNumActive]}>{s.num}</Text>
                        )}
                      </View>
                      <Text style={[styles.stepLabel, (isActive || isDone) && styles.stepLabelActive]}>{s.label}</Text>
                    </View>
                    {idx < STEPS.length - 1 && (
                      <View style={[styles.stepLine, isDone && styles.stepLineDone]} />
                    )}
                  </React.Fragment>
                );
              })}
            </View>

            <ScrollView style={styles.createBody} contentContainerStyle={styles.createBodyContent} showsVerticalScrollIndicator={false}>
              {/* STEP 1: UBICACIÓN — dropdown selector (como la web usa `app-selector`) */}
              {createStep === 1 && (
                <View style={styles.createStepContent}>
                  <View style={styles.formGroup}>
                    <Text style={styles.formLabel}>Ubicación *</Text>
                    {/* Dropdown trigger */}
                    <Pressable
                      onPress={() => setShowLocationDropdown(!showLocationDropdown)}
                      style={styles.locationDropdownTrigger}
                    >
                      <Icon
                        name="warehouse"
                        size={18}
                        color={selectedLocation ? colors.primary : colorScales.gray[400]}
                      />
                      <Text
                        style={[
                          styles.locationDropdownText,
                          !selectedLocation && styles.locationDropdownPlaceholder,
                          !!selectedLocation && styles.locationDropdownTextSelected,
                        ]}
                        numberOfLines={1}
                      >
                        {selectedLocation ? locationLabel(selectedLocation) : 'Seleccionar ubicación'}
                      </Text>
                      <Icon
                        name="chevron-down"
                        size={16}
                        color={colorScales.gray[500]}
                        style={{ transform: showLocationDropdown ? [{ rotate: '180deg' }] : [] }}
                      />
                    </Pressable>

                    {/* Dropdown options (expandible) */}
                    {showLocationDropdown && (
                      <View style={styles.locationDropdownList}>
                        {isLoadingLocations ? (
                          <View style={styles.locationDropdownLoading}>
                            <Spinner size="sm" />
                            <Text style={styles.locationDropdownLoadingText}>Cargando ubicaciones...</Text>
                          </View>
                        ) : LOCATIONS.length === 0 ? (
                          <View style={styles.locationDropdownLoading}>
                            <Icon name="warehouse" size={20} color={colorScales.gray[400]} />
                            <Text style={styles.locationDropdownLoadingText}>No hay ubicaciones registradas</Text>
                          </View>
                        ) : (
                          LOCATIONS.map((loc) => (
                            <Pressable
                              key={loc.value}
                              onPress={() => {
                                setSelectedLocation(loc.value);
                                setShowLocationDropdown(false);
                              }}
                              style={[
                                styles.locationDropdownOption,
                                selectedLocation === loc.value && styles.locationDropdownOptionActive,
                              ]}
                            >
                              <Text
                                style={[
                                  styles.locationDropdownOptionText,
                                  selectedLocation === loc.value && styles.locationDropdownOptionTextActive,
                                ]}
                              >
                                {loc.label}
                              </Text>
                              {selectedLocation === loc.value && (
                                <Icon name="check" size={16} color={colors.primary} />
                              )}
                            </Pressable>
                          ))
                        )}
                      </View>
                    )}
                  </View>

                  {selectedLocation && (
                    <View style={styles.locationSelectedCard}>
                      <Text style={styles.locationSelectedLabel}>Ubicación seleccionada</Text>
                      <Text style={styles.locationSelectedName}>{locationLabel(selectedLocation)}</Text>
                    </View>
                  )}
                </View>
              )}

              {/* STEP 2: PRODUCTOS — ubicación + búsqueda + producto a ajustar (como la web) */}
              {createStep === 2 && (
                <View style={styles.createStepContent}>
                  {/* Resumen de ubicación con botón Cambiar */}
                  <View style={styles.locationSummaryCard}>
                    <Icon name="warehouse" size={18} color={colors.primary} />
                    <Text style={styles.locationSummaryName}>{locationLabel(selectedLocation)}</Text>
                    <Pressable onPress={goBackToStep1} hitSlop={4}>
                      <Text style={styles.locationChangeLink}>Cambiar</Text>
                    </Pressable>
                  </View>

                  {/* Búsqueda de producto */}
                  <View style={styles.formGroup}>
                    <Text style={styles.formLabel}>Buscar producto</Text>
                    <View style={styles.searchBox}>
                      <Icon name="search" size={16} color={colorScales.gray[400]} />
                      <TextInput
                        style={styles.searchInputWizard}
                        value={productSearchTerm}
                        onChangeText={searchProducts}
                        placeholder="Buscar por nombre o SKU..."
                        placeholderTextColor={colorScales.gray[400]}
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                      {productSearchTerm.length > 0 && (
                        <Pressable onPress={() => searchProducts('')} hitSlop={6}>
                          <Icon name="x" size={14} color={colorScales.gray[400]} />
                        </Pressable>
                      )}
                    </View>
                    {productSearchResults.length > 0 && (
                      <View style={styles.searchResults}>
                        {productSearchResults.map((p) => (
                          <Pressable
                            key={p.id}
                            style={styles.searchResultItem}
                            onPress={() => selectProduct(p)}
                          >
                            <View style={{ flex: 1 }}>
                              <Text style={styles.searchResultName} numberOfLines={1}>{p.name}</Text>
                              <Text style={styles.searchResultSku}>SKU: {p.sku ?? 'N/A'}</Text>
                            </View>
                            <Text style={styles.searchResultStock}>Stock: {p.stock}</Text>
                          </Pressable>
                        ))}
                      </View>
                    )}
                  </View>

                  {/* Producto a ajustar (form fields) */}
                  <View style={styles.formGroup}>
                    <Text style={styles.formLabel}>Producto a ajustar</Text>
                    {form.product_id ? (
                      <View style={styles.selectedProductCard}>
                        <View style={styles.selectedProductHeader}>
                          <Text style={styles.selectedProductName} numberOfLines={1}>{form.description || `Producto #${form.product_id}`}</Text>
                          <Pressable onPress={() => setForm({ ...form, product_id: 0, description: '' })} hitSlop={4}>
                            <Icon name="trash-2" size={16} color={colors.error} />
                          </Pressable>
                        </View>
                        <Text style={styles.selectedProductStock}>
                          Stock actual: {storeProducts.find((p) => p.id === form.product_id)?.stock ?? 0}
                        </Text>
                      </View>
                    ) : (
                      <View style={styles.productEmptyState}>
                        <Icon name="clipboard-list" size={28} color={colorScales.gray[300]} />
                        <Text style={styles.productEmptyText}>Busca y selecciona un producto</Text>
                      </View>
                    )}
                  </View>

                  {/* Tipo: grid 3×2 con iconos (como la web) */}
                  {form.product_id && (
                    <View style={styles.formGroup}>
                      <Text style={styles.formLabel}>Tipo *</Text>
                      <View style={styles.typeGrid}>
                        {TYPE_OPTIONS.map((t) => (
                          <Pressable
                            key={t.value}
                            onPress={() => setForm({ ...form, type: t.value })}
                            style={[styles.typeGridItem, form.type === t.value ? styles.typeGridItemActive : styles.typeGridItemInactive]}
                          >
                            <Icon
                              name={t.icon as any}
                              size={14}
                              color={form.type === t.value ? colors.primary : colorScales.gray[500]}
                            />
                            <Text style={[styles.typeGridText, form.type === t.value ? styles.typeGridTextActive : styles.typeGridTextInactive]}>{t.label}</Text>
                          </Pressable>
                        ))}
                      </View>
                    </View>
                  )}

                  {/* Cantidad y motivo (solo si hay producto) */}
                  {form.product_id && (
                    <>
                      <View style={styles.qtyRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.formLabel}>Nueva cantidad *</Text>
                          <TextInput
                            style={styles.qtyInput}
                            value={form.quantity_after > 0 ? String(form.quantity_after) : ''}
                            onChangeText={(t) => setForm({ ...form, quantity_after: parseInt(t) || 0 })}
                            keyboardType="numeric"
                            placeholder="0"
                            placeholderTextColor={colorScales.gray[400]}
                          />
                        </View>
                        <View style={styles.qtyPreview}>
                          <Text style={styles.qtyPreviewLabel}>Cambio</Text>
                          <Text
                            style={[
                              styles.qtyPreviewValue,
                              calculatedQuantityChange > 0
                                ? styles.qtyPreviewValuePositive
                                : calculatedQuantityChange < 0
                                  ? styles.qtyPreviewValueNegative
                                  : styles.qtyPreviewValueNeutral,
                            ]}
                          >
                            {calculatedQuantityChange > 0
                              ? `+${calculatedQuantityChange}`
                              : `${calculatedQuantityChange}`}
                          </Text>
                        </View>
                      </View>
                      <Text style={styles.qtyHelperText}>
                        Stock actual: {selectedProductCurrentStock}
                      </Text>

                      <Input
                        label="Motivo / Nota (opcional)"
                        value={form.reason_code}
                        onChangeText={(t) => setForm({ ...form, reason_code: t })}
                        placeholder="Nota adicional..."
                      />
                    </>
                  )}
                </View>
              )}

              {/* STEP 3: CONFIRMAR — resumen + checkbox + botón dinámico (como la web) */}
              {createStep === 3 && (
                <View style={styles.createStepContent}>
                  {/* Info de ubicación */}
                  <View style={styles.locationInfoCard}>
                    <Icon name="warehouse" size={18} color={colors.primary} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.locationInfoLabel}>Ubicación</Text>
                      <Text style={styles.locationInfoName}>{locationLabel(selectedLocation)}</Text>
                    </View>
                  </View>

                  {/* Card con el resumen del producto */}
                  <View style={styles.summaryCard}>
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>Tipo</Text>
                      <View style={[styles.typeBadge, { backgroundColor: form.type === 'manual_correction' ? colorScales.green[50] : colorScales.amber[50] }]}>
                        <Text style={[styles.typeBadgeText, { color: form.type === 'manual_correction' ? colors.primary : colorScales.amber[700] }]}>
                          {ADJUSTMENT_TYPE_LABELS[form.type]}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.summaryDivider} />
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>Producto</Text>
                      <Text style={styles.summaryValue} numberOfLines={1}>{form.description || `Producto #${form.product_id}`}</Text>
                    </View>
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>Cambio</Text>
                      <Text style={[styles.summaryValue, styles.summaryValueBold]}>
                        {calculatedQuantityChange > 0
                          ? `+${calculatedQuantityChange}`
                          : `${calculatedQuantityChange}`}
                      </Text>
                    </View>
                    {form.reason_code ? (
                      <>
                        <View style={styles.summaryDivider} />
                        <View style={styles.summaryRow}>
                          <Text style={styles.summaryLabel}>Motivo</Text>
                          <Text style={styles.summaryValue} numberOfLines={2}>{form.reason_code}</Text>
                        </View>
                      </>
                    ) : null}
                  </View>

                  {/* Total */}
                  <View style={styles.totalCard}>
                    <Text style={styles.totalCardLabel}>Total de productos a ajustar</Text>
                    <Text style={styles.totalCardValue}>1</Text>
                  </View>

                  {/* Checkbox de confirmación (como la web) */}
                  <Pressable
                    style={styles.confirmCheckboxRow}
                    onPress={() => setConfirmCreate(!confirmCreate)}
                  >
                    <View style={[styles.checkbox, confirmCreate && styles.checkboxChecked]}>
                      {confirmCreate && <Icon name="check" size={12} color={colors.background} />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.confirmCheckboxLabel}>Confirmar creación de ajuste</Text>
                      <Text style={styles.confirmCheckboxDesc}>
                        Al crear y aplicar, el movimiento de inventario será aplicado inmediatamente y no podrá ser revertido.
                      </Text>
                    </View>
                  </Pressable>
                </View>
              )}
            </ScrollView>

            {/* Footer: acción primaria (full-width) + acciones secundarias (iconos) */}
            <View style={styles.createFooter}>
              {/* Acción primaria según el paso */}
              {createStep === 1 && (
                <Button
                  title="Continuar"
                  onPress={goToStep2}
                  disabled={!canAdvanceStep1}
                  variant="primary"
                  fullWidth
                />
              )}
              {createStep === 2 && (
                <Button
                  title="Continuar"
                  onPress={goToStep3}
                  disabled={!canAdvanceStep2}
                  variant="primary"
                  fullWidth
                />
              )}
              {createStep === 3 && confirmCreate && (
                <Button
                  title="Crear y Aplicar"
                  onPress={handleSubmit}
                  loading={createMutation.isPending}
                  variant="primary"
                  fullWidth
                />
              )}
              {createStep === 3 && !confirmCreate && (
                <Button
                  title="Guardar Borrador"
                  onPress={handleSubmit}
                  loading={createMutation.isPending}
                  variant="primary"
                  fullWidth
                />
              )}

              {/* Acciones secundarias (icon-only row) */}
              <View style={styles.createFooterActions}>
                {createStep > 1 && (
                  <Pressable
                    onPress={createStep === 2 ? goBackToStep1 : goBackToStep2}
                    hitSlop={8}
                    style={styles.createFooterIcon}
                  >
                    <Icon name="arrow-left" size={22} color={colorScales.gray[500]} />
                  </Pressable>
                )}
                <Pressable onPress={closeCreateModal} hitSlop={8} style={styles.createFooterIcon}>
                  <Icon name="x" size={22} color={colors.error} />
                </Pressable>
                {createStep === 3 && confirmCreate && (
                  <Pressable onPress={handleSubmit} hitSlop={8} style={styles.createFooterIcon}>
                    <Icon name="check-circle" size={22} color={colorScales.gray[500]} />
                  </Pressable>
                )}
                {createStep === 3 && !confirmCreate && (
                  <Pressable
                    onPress={() => setConfirmCreate(true)}
                    hitSlop={8}
                    style={[styles.createFooterIcon, { opacity: 0.4 }]}
                  >
                    <Icon name="check-circle" size={22} color={colorScales.gray[500]} />
                  </Pressable>
                )}
                {createStep === 3 && (
                  <View style={styles.footerDivider} />
                )}
                {createStep === 3 && !confirmCreate && (
                  <Pressable onPress={handleSubmit} hitSlop={8} style={styles.createFooterIcon}>
                    <Icon name="save" size={22} color={colorScales.gray[500]} />
                  </Pressable>
                )}
                {createStep === 3 && confirmCreate && (
                  <Pressable
                    onPress={() => setConfirmCreate(false)}
                    hitSlop={8}
                    style={[styles.createFooterIcon, { opacity: 0.4 }]}
                  >
                    <Icon name="save" size={22} color={colorScales.gray[500]} />
                  </Pressable>
                )}
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal de detalle — abierto al pulsar el botón (ver) en una card */}
      <AdjustmentDetailModal
        adjustment={detailAdjustment}
        onClose={() => setDetailAdjustment(null)}
        onApprove={(a) => approveMutation.mutate(Number(a.id))}
        onDelete={(a) => deleteAdjustmentMutation.mutate(Number(a.id))}
        isSubmitting={approveMutation.isPending || deleteAdjustmentMutation.isPending}
      />

      {/* Modal de carga masiva — abierto desde acciones (+) → Carga Masiva */}
      <BulkAdjustmentModal
        visible={bulkUploadOpen}
        onClose={() => setBulkUploadOpen(false)}
        locations={LOCATIONS}
        onCompleted={handleRefresh}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colorScales.gray[50] },

  /* Card contenedor principal — invisible: la lista de ajustes se ve directamente
     sobre el fondo de la pantalla sin contenedor visual */
  cardContainer: {
    flex: 1,
    marginHorizontal: spacing[3],
    marginBottom: spacing[3],
    backgroundColor: 'transparent',
    overflow: 'visible',
  },

  /* Stats: horizontal scroll — ancho completo, fondo transparente (gris de la pantalla) */
  statsContainer: {
    backgroundColor: 'transparent',
    paddingTop: spacing[3], paddingBottom: spacing[2.5],
  },
  statsScroll: { paddingHorizontal: spacing[3], gap: spacing[2] },
  statCard: {
    width: 150, backgroundColor: colors.background, borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colorScales.gray[200],
    paddingHorizontal: spacing[2.5], paddingVertical: spacing[2.5], gap: 1,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 3, elevation: 1,
  },
  statIcon: { position: 'absolute', top: spacing[2], right: spacing[2] },
  statLabel: { fontSize: 9, fontWeight: '700' as any, color: colorScales.gray[500], letterSpacing: 0.5, textTransform: 'uppercase' as any, marginTop: 2, maxWidth: '85%' },
  statValue: { fontSize: 20, fontWeight: '800' as any, color: colorScales.gray[900], marginTop: 2 },
  statSmall: { fontSize: 9, fontWeight: '500' as any, color: colors.primary, marginTop: 1 },

  /* Search — fondo transparente para integrarse con el card (mismo color que el fondo del card) */
  searchHeader: { paddingHorizontal: spacing[4], paddingTop: spacing[3], marginBottom: spacing[4] },
  listTitle: { fontSize: 12, fontWeight: '700' as any, color: colorScales.gray[600], letterSpacing: 0.3 },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[2],
    paddingHorizontal: spacing[4], paddingBottom: spacing[3],
    backgroundColor: 'transparent', borderBottomWidth: 1, borderBottomColor: colorScales.gray[100],
  },
  searchInput: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    backgroundColor: colorScales.gray[50], borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3], paddingVertical: spacing[2],
    borderWidth: 1, borderColor: colorScales.gray[200], minHeight: 40,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 3, elevation: 1,
  },
  searchTextInput: {
    flex: 1, fontSize: typography.fontSize.sm, fontFamily: typography.fontFamily,
    color: colorScales.gray[900], padding: 0, height: '100%',
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: borderRadius.lg,
    backgroundColor: colors.background, borderWidth: 1.5, borderColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 3, elevation: 1,
  },

  /* Actions List */
  actionsList: { paddingHorizontal: spacing[4], gap: 0 },
  actionItem: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], paddingVertical: spacing[3] },
  actionIconWrap: { width: 32, height: 32, borderRadius: 8, backgroundColor: colorScales.gray[100], alignItems: 'center', justifyContent: 'center' },
  actionText: { fontSize: typography.fontSize.base, fontWeight: '500' as any, color: colorScales.gray[900] },
  actionDivider: { height: 1, backgroundColor: colorScales.gray[100] },

  /* Card — alineado con la web: título + badge, grid 2 cols (FECHA/UBICACIÓN), footer (CAMBIO + pin) */
  card: {
    marginHorizontal: spacing[3],
    marginBottom: spacing[3],
    backgroundColor: colors.background,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  cardBody: { padding: spacing[4] },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing[2],
    marginBottom: spacing[3],
  },
  cardTitle: {
    flex: 1,
    fontSize: typography.fontSize.base,
    fontWeight: '700' as any,
    color: colorScales.gray[900],
  },
  // Pill de tipo (Conteo, Daño, Pérdida, etc.) — estilo web
  cardBadge: {
    paddingHorizontal: spacing[2.5],
    paddingVertical: 3,
    borderRadius: borderRadius.full,
    backgroundColor: colorScales.blue[50],
    borderWidth: 1,
    borderColor: colorScales.blue[100],
  },
  cardBadgeText: {
    fontSize: 10,
    fontWeight: '700' as any,
    color: colorScales.blue[700],
    textTransform: 'uppercase' as any,
    letterSpacing: 0.3,
  },
  // Grid 2 columnas: FECHA | UBICACIÓN
  cardGrid: {
    flexDirection: 'row',
    gap: spacing[3],
    marginBottom: spacing[3],
  },
  cardGridItem: { flex: 1, gap: 2 },
  cardGridLabel: {
    fontSize: 10,
    fontWeight: '700' as any,
    color: colorScales.gray[500],
    textTransform: 'uppercase' as any,
    letterSpacing: 0.5,
  },
  cardGridValue: {
    fontSize: typography.fontSize.sm,
    fontWeight: '600' as any,
    color: colorScales.gray[900],
  },
  // Footer: CAMBIO (izquierda) + pin (derecha), separados por línea superior
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[100],
  },
  cardFooterLeft: { gap: 2 },
  cardFooterLabel: {
    fontSize: 10,
    fontWeight: '700' as any,
    color: colorScales.gray[500],
    textTransform: 'uppercase' as any,
    letterSpacing: 0.5,
  },
  cardFooterValue: {
    fontSize: typography.fontSize.lg,
    fontWeight: '800' as any,
    color: colorScales.gray[900],
  },
  /* Botón (ver) en el footer de la card — circular como en web */
  eyeBtn: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.md,
    backgroundColor: colorScales.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* Modal de detalle de ajuste — replica web app-adjustment-detail-modal */
  detailOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: spacing[4] },
  detailModal: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    width: '100%', maxWidth: 520, maxHeight: '90%',
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 24, elevation: 8,
  },
  detailHeader: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    paddingHorizontal: spacing[4], paddingVertical: spacing[4], borderBottomWidth: 1, borderBottomColor: colorScales.gray[100],
  },
  detailTitle: { fontSize: typography.fontSize.lg, fontWeight: '700' as any, color: colorScales.gray[900] },
  detailSubtitle: { fontSize: typography.fontSize.sm, color: colorScales.gray[500], marginTop: 2 },
  detailCloseBtn: { padding: spacing[1] },
  detailBody: { flexGrow: 0, flexShrink: 1, maxHeight: 480 },
  detailBodyContent: { padding: spacing[4], gap: spacing[4] },
  detailTypeCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[3],
    padding: spacing[3], borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colorScales.green[200], backgroundColor: colorScales.green[50],
  },
  detailTypeIcon: {
    width: 40, height: 40, borderRadius: borderRadius.md,
    backgroundColor: colors.background, borderWidth: 1, borderColor: colorScales.green[200],
    alignItems: 'center', justifyContent: 'center',
  },
  detailTypeLabel: { fontSize: 10, fontWeight: '700' as any, color: colorScales.gray[500], textTransform: 'uppercase' as any, letterSpacing: 0.5 },
  detailTypeValue: { fontSize: typography.fontSize.base, fontWeight: '700' as any, color: colors.primary, marginTop: 2 },
  detailSection: { gap: spacing[2] },
  detailSectionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing[1.5] },
  detailSectionTitle: { fontSize: 10, fontWeight: '700' as any, color: colorScales.gray[500], textTransform: 'uppercase' as any, letterSpacing: 0.5 },
  detailInfoCard: {
    padding: spacing[3], borderRadius: borderRadius.lg,
    borderWidth: 1, borderColor: colorScales.gray[200], backgroundColor: colors.background, gap: spacing[1],
  },
  detailInfoLabel: { fontSize: 10, fontWeight: '700' as any, color: colorScales.gray[500], textTransform: 'uppercase' as any, letterSpacing: 0.5 },
  detailInfoPrimary: { fontSize: typography.fontSize.sm, fontWeight: '600' as any, color: colorScales.gray[900] },
  detailInfoSecondary: { fontSize: typography.fontSize.xs, color: colorScales.gray[500], marginTop: 2 },
  detailQuantityCard: { padding: spacing[4], borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colorScales.gray[200], backgroundColor: colorScales.gray[50] },
  detailQuantityRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing[2] },
  detailQuantityCell: { flex: 1, alignItems: 'center', gap: 2 },
  detailQuantityLabel: { fontSize: 9, fontWeight: '700' as any, color: colorScales.gray[500], textTransform: 'uppercase' as any, letterSpacing: 0.5 },
  detailQuantityValue: { fontSize: typography.fontSize.lg, fontWeight: '800' as any, color: colorScales.gray[900] },
  detailAuditRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2] },
  detailAuditIcon: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: colorScales.green[50],
    alignItems: 'center', justifyContent: 'center',
  },
  detailFooter: {
    flexDirection: 'row', paddingHorizontal: spacing[4], paddingTop: spacing[3], paddingBottom: spacing[4],
    borderTopWidth: 1, borderTopColor: colorScales.gray[200], backgroundColor: colorScales.gray[50],
  },
  detailDangerBtn: { flex: 1, paddingVertical: 12, borderRadius: borderRadius.lg, borderWidth: 1.5, borderColor: colorScales.red[500], alignItems: 'center', justifyContent: 'center' },
  detailDangerBtnText: { fontSize: 14, fontWeight: '700' as any, color: colorScales.red[600] },
  detailCancelBtn: { flex: 1, paddingVertical: 12, borderRadius: borderRadius.lg, borderWidth: 1.5, borderColor: colorScales.gray[300], alignItems: 'center', justifyContent: 'center' },
  detailCancelBtnText: { fontSize: 14, fontWeight: '700' as any, color: colorScales.gray[700] },
  detailPrimaryBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing[2],
    paddingVertical: 12, borderRadius: borderRadius.lg, backgroundColor: colors.primary,
  },
  detailPrimaryBtnText: { fontSize: 14, fontWeight: '700' as any, color: colors.background },

  /* BulkAdjustmentModal — replica exacta del web app-bulk-adjustment-modal */
});

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

  /* Step Indicator (1 — 2 — 3) */
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

  /* Selector de ubicación */
  selectTrigger: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: spacing[3], paddingHorizontal: spacing[3],
    borderWidth: 1.5, borderColor: colors.primary, borderRadius: borderRadius.lg,
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

  /* Tipo de ajuste (chips) */
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

  /* Botón descargar plantilla */
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

  /* Drop zone */
  dropZone: {
    borderWidth: 2, borderStyle: 'dashed' as any, borderColor: colorScales.gray[300],
    borderRadius: borderRadius.lg, paddingVertical: spacing[8], paddingHorizontal: spacing[4],
    alignItems: 'center' as any, backgroundColor: colors.background,
  },
  dropZoneActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight ?? colorScales.green[50] },
  dropZonePrimary: { fontSize: 14, fontWeight: '600' as any, color: colorScales.gray[700], textAlign: 'center' as any },
  dropZoneSecondary: { fontSize: 12, color: colorScales.gray[400], marginTop: 4, textAlign: 'center' as any },
  fileName: { fontSize: 14, fontWeight: '700' as any, color: colorScales.gray[900], textAlign: 'center' as any },
  fileSize: { fontSize: 12, color: colorScales.gray[500], marginTop: 4, textAlign: 'center' as any },
  removeFileLink: { fontSize: 12, color: colorScales.red[500], textDecorationLine: 'underline' as any },

  /* Step 3: Uploading + Resultado */
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

  /* Footer */
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
  primaryBtnDisabled: { backgroundColor: colorScales.gray[200], opacity: 0.6 },
  primaryBtnText: { fontSize: 14, fontWeight: '700' as any, color: colors.background },

  /* List */
  listContent: { paddingBottom: spacing[6] },

  /* Dropdowns (positioned near buttons) */
  dropdownBackdrop: { flex: 1 },
  dropdownPositioner: { position: 'absolute', alignItems: 'flex-end' },
  dropdownArrow: {
    width: 0, height: 0, borderLeftWidth: 8, borderRightWidth: 8, borderBottomWidth: 8,
    borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: colors.background,
    marginRight: 14, marginBottom: -1,
  },
  dropdown: {
    backgroundColor: colors.background, borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colorScales.gray[200],
    minWidth: 200, ...shadows.lg,
  },
  dropdownTitle: { fontSize: 12, fontWeight: '700' as any, color: colorScales.gray[500], paddingVertical: spacing[2], paddingHorizontal: spacing[3], letterSpacing: 0.3, textTransform: 'uppercase' as any },
  dropdownDivider: { height: 1, backgroundColor: colorScales.gray[100] },
  dropdownItem: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingVertical: spacing[2.5], paddingHorizontal: spacing[3] },
  dropdownIconWrap: { width: 28, height: 28, borderRadius: 6, backgroundColor: colorScales.gray[100], alignItems: 'center', justifyContent: 'center' },
  dropdownItemText: { fontSize: typography.fontSize.sm, fontWeight: '500' as any, color: colorScales.gray[700] },
  dropdownItemPrimary: { fontSize: typography.fontSize.sm, fontWeight: '700' as any, color: colors.primary },
  dropdownFilterRow: { paddingVertical: spacing[2], paddingHorizontal: spacing[3], gap: spacing[1] },
  dropdownFilterLabel: { fontSize: 11, fontWeight: '600' as any, color: colorScales.gray[500], letterSpacing: 0.5, textTransform: 'uppercase' as any },
  dropdownSelectBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6, paddingHorizontal: spacing[2], borderRadius: 6, borderWidth: 1, borderColor: colorScales.gray[200], backgroundColor: colorScales.gray[50], marginTop: 4 },
  dropdownSelectText: { fontSize: typography.fontSize.sm, fontWeight: '500' as any, color: colorScales.gray[800] },
  dropdownOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing[2], paddingHorizontal: spacing[3] },
  dropdownOptionActive: { backgroundColor: colorScales.green[50] },
  dropdownOptionText: { fontSize: typography.fontSize.sm, fontWeight: '500' as any, color: colorScales.gray[700] },
  dropdownOptionTextActive: { fontSize: typography.fontSize.sm, fontWeight: '700' as any, color: colors.primary },

  /* Create Modal — centered dialog + wizard (alineado con la web) */
  createModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: spacing[4] },
  createModal: {
    backgroundColor: colors.background, borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colorScales.gray[200],
    width: '100%', maxWidth: 520, maxHeight: '90%',
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 24, elevation: 8,
  },
  createHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: spacing[4], paddingVertical: spacing[3.5], borderBottomWidth: 1, borderBottomColor: colorScales.gray[200] },
  createHeaderTitle: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2], flex: 1, marginRight: spacing[3] },
  createHeaderText: { flex: 1 },
  createTitle: { fontSize: typography.fontSize.base, fontWeight: '700' as any, color: colorScales.gray[900] },
  createSubtitle: { fontSize: 11, color: colorScales.gray[500], marginTop: 2 },

  /* Steps indicator */
  stepsRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing[4], paddingVertical: spacing[3], backgroundColor: colorScales.gray[50], borderBottomWidth: 1, borderBottomColor: colorScales.gray[200] },
  stepItem: { alignItems: 'center', gap: 4 },
  stepCircle: { width: 24, height: 24, borderRadius: 12, backgroundColor: colorScales.gray[200], alignItems: 'center', justifyContent: 'center' },
  stepCircleActive: { backgroundColor: colors.primary },
  stepCircleDone: { backgroundColor: colors.primary },
  stepNum: { fontSize: 11, fontWeight: '700' as any, color: colorScales.gray[500] },
  stepNumActive: { color: colors.background },
  stepLabel: { fontSize: 10, fontWeight: '600' as any, color: colorScales.gray[500], letterSpacing: 0.5 },
  stepLabelActive: { color: colors.primary },
  stepLine: { flex: 1, height: 2, backgroundColor: colorScales.gray[200], marginHorizontal: 6, marginBottom: 16 },
  stepLineDone: { backgroundColor: colors.primary },

  /* Body */
  createBody: { flexGrow: 0, flexShrink: 1, maxHeight: 420 },
  createBodyContent: { padding: spacing[4], gap: spacing[3] },
  createStepContent: { gap: spacing[3] },

  formGroup: { marginBottom: spacing[1] },
  formLabel: { fontSize: typography.fontSize.xs, fontWeight: '600' as any, color: colorScales.gray[500], marginBottom: spacing[2], textTransform: 'uppercase', letterSpacing: 0.5 },

  /* Type grid 3x2 con iconos (como la web) */
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  typeGridItem: { width: '31%', flexDirection: 'column', alignItems: 'center', paddingVertical: spacing[2], paddingHorizontal: 4, borderRadius: 8, borderWidth: 1, backgroundColor: colors.background },
  typeGridItemActive: { borderColor: colors.primary, backgroundColor: colorScales.green[50] },
  typeGridItemInactive: { borderColor: colorScales.gray[200] },
  typeGridText: { fontSize: 10, fontWeight: '600' as any, marginTop: 4, textAlign: 'center' },
  typeGridTextActive: { color: colors.primary },
  typeGridTextInactive: { color: colorScales.gray[500] },

  /* Confirm step */
  confirmBanner: { flexDirection: 'row', gap: spacing[2], backgroundColor: colorScales.blue[50], borderRadius: 8, borderWidth: 1, borderColor: colorScales.blue[200], padding: spacing[2.5], alignItems: 'flex-start' },
  confirmBannerTitle: { fontSize: 12, fontWeight: '700' as any, color: colorScales.blue[800] },
  confirmBannerDesc: { fontSize: 11, color: colorScales.blue[900], marginTop: 2, lineHeight: 15 },

  summaryCard: { backgroundColor: colorScales.gray[50], borderRadius: 10, borderWidth: 1, borderColor: colorScales.gray[200], padding: spacing[3], gap: spacing[2] },
  summaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing[2] },
  summaryLabel: { fontSize: 12, color: colorScales.gray[500], fontWeight: '500' as any, flex: 1 },
  summaryValue: { fontSize: 13, color: colorScales.gray[900], fontWeight: '500' as any, flex: 1, textAlign: 'right' },
  summaryValueBold: { fontWeight: '700' as any },
  summaryDivider: { height: 1, backgroundColor: colorScales.gray[200] },
  typeBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  typeBadgeText: { fontSize: 10, fontWeight: '700' as any, textTransform: 'uppercase' as any },

  confirmCheckboxRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2.5], padding: spacing[3],
    backgroundColor: colorScales.amber[50], borderRadius: 10, borderWidth: 1, borderColor: colorScales.amber[200],
  },
  checkbox: { width: 16, height: 16, borderRadius: 4, borderWidth: 1.5, borderColor: colorScales.gray[300], backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  confirmCheckboxLabel: { fontSize: 13, fontWeight: '600' as any, color: colorScales.gray[900] },
  confirmCheckboxDesc: { fontSize: 11, color: colorScales.gray[500], marginTop: 2, lineHeight: 15 },

  /* Footer */
  createFooter: { paddingHorizontal: spacing[4], paddingTop: spacing[3], paddingBottom: spacing[4], borderTopWidth: 1, borderTopColor: colorScales.gray[200], backgroundColor: colorScales.gray[50] },
  createFooterActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing[6], paddingTop: spacing[2] },
  createFooterIcon: { padding: spacing[1] },
  footerDivider: { width: 1, height: 20, backgroundColor: colorScales.gray[300] },

  /* Step 1: UBICACIÓN — dropdown selector (como la web usa `app-selector`) */
  locationDropdownTrigger: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[2],
    paddingVertical: spacing[3], paddingHorizontal: spacing[3],
    borderRadius: 10, borderWidth: 1, borderColor: colorScales.gray[200], backgroundColor: colors.background,
  },
  locationDropdownText: { flex: 1, fontSize: 14, fontWeight: '500' as any, color: colorScales.gray[900] },
  locationDropdownPlaceholder: { color: colorScales.gray[400], fontWeight: '400' as any },
  locationDropdownTextSelected: { fontWeight: '600' as any, color: colors.primary },
  locationDropdownList: {
    marginTop: 4, borderWidth: 1, borderColor: colorScales.gray[200], borderRadius: 10,
    backgroundColor: colors.background, overflow: 'hidden',
  },
  locationDropdownOption: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: spacing[3], paddingHorizontal: spacing[3],
    borderBottomWidth: 1, borderBottomColor: colorScales.gray[100],
  },
  locationDropdownOptionActive: { backgroundColor: colorScales.green[50] },
  locationDropdownOptionText: { fontSize: 14, color: colorScales.gray[700] },
  locationDropdownOptionTextActive: { fontWeight: '600' as any, color: colors.primary },
  locationDropdownLoading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: spacing[4] },
  locationDropdownLoadingText: { fontSize: 12, color: colorScales.gray[500] },
  locationSelectedCard: {
    backgroundColor: colorScales.green[50], borderRadius: 10, borderWidth: 1,
    borderColor: colorScales.green[200], padding: spacing[3], alignItems: 'center', gap: 4,
  },
  locationSelectedLabel: { fontSize: 11, color: colorScales.gray[500] },
  locationSelectedName: { fontSize: 16, fontWeight: '700' as any, color: colors.primary },

  /* Step 2: PRODUCTOS — location summary + product search */
  locationSummaryCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[2],
    padding: spacing[2.5], borderRadius: 10, borderWidth: 1,
    borderColor: colorScales.gray[200], backgroundColor: colorScales.gray[50],
  },
  locationSummaryName: { flex: 1, fontSize: 13, fontWeight: '600' as any, color: colorScales.gray[900] },
  locationChangeLink: { fontSize: 12, fontWeight: '600' as any, color: colors.primary, textDecorationLine: 'underline' },

  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1, borderColor: colorScales.gray[200], borderRadius: 8,
    paddingHorizontal: spacing[2.5], paddingVertical: spacing[2], backgroundColor: colors.background,
  },
  searchInputWizard: { flex: 1, fontSize: 13, color: colorScales.gray[900], padding: 0 },
  searchResults: {
    marginTop: 6, borderWidth: 1, borderColor: colorScales.gray[200], borderRadius: 8,
    maxHeight: 180, backgroundColor: colors.background,
  },
  searchResultItem: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: spacing[2], paddingHorizontal: spacing[3],
    borderBottomWidth: 1, borderBottomColor: colorScales.gray[100], gap: spacing[2],
  },
  searchResultName: { fontSize: 12, fontWeight: '500' as any, color: colorScales.gray[900] },
  searchResultSku: { fontSize: 10, color: colorScales.gray[500], marginTop: 2 },
  searchResultStock: { fontSize: 11, fontWeight: '600' as any, color: colorScales.gray[700] },

  /* Selected product card (después de seleccionar) */
  selectedProductCard: {
    backgroundColor: colors.background, borderRadius: 10, borderWidth: 1,
    borderColor: colorScales.gray[200], padding: spacing[2.5], gap: 4,
  },
  selectedProductHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing[2] },
  selectedProductName: { flex: 1, fontSize: 13, fontWeight: '700' as any, color: colorScales.gray[900] },
  selectedProductStock: { fontSize: 11, color: colorScales.gray[500] },

  productEmptyState: {
    alignItems: 'center', paddingVertical: spacing[5], gap: 4,
    borderWidth: 1, borderColor: colorScales.gray[200], borderStyle: 'dashed', borderRadius: 10,
    backgroundColor: colors.background,
  },
  productEmptyText: { fontSize: 12, color: colorScales.gray[500] },

  /* Cantidad con preview de cambio (como la web) */
  qtyRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing[3] },
  qtyInput: {
    borderWidth: 1, borderColor: colorScales.gray[200], borderRadius: 8,
    paddingHorizontal: spacing[2.5], paddingVertical: spacing[2], fontSize: 14,
    fontWeight: '600' as any, color: colorScales.gray[900], backgroundColor: colors.background, textAlign: 'center',
  },
  qtyPreview: { alignItems: 'center', paddingBottom: 4 },
  qtyPreviewLabel: { fontSize: 10, color: colorScales.gray[500], textTransform: 'uppercase' as any, fontWeight: '600' as any, marginBottom: 2 },
  qtyPreviewValue: { fontSize: 16, fontWeight: '700' as any },
  qtyPreviewValuePositive: { color: colors.primary },
  qtyPreviewValueNegative: { color: colors.error },
  qtyPreviewValueNeutral: { color: colorScales.gray[500] },
  qtyHelperText: { fontSize: 11, color: colorScales.gray[500], marginTop: -spacing[1], marginBottom: spacing[2] },

  /* Step 3: CONFIRMAR — location info + total */
  locationInfoCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[2.5],
    padding: spacing[3], borderRadius: 10, borderWidth: 1, borderColor: colorScales.gray[200],
    backgroundColor: colorScales.gray[50],
  },
  locationInfoLabel: { fontSize: 10, fontWeight: '700' as any, color: colorScales.gray[500], textTransform: 'uppercase' as any },
  locationInfoName: { fontSize: 14, fontWeight: '600' as any, color: colorScales.gray[900] },

  totalCard: {
    backgroundColor: colorScales.green[50], borderRadius: 10, borderWidth: 1,
    borderColor: colorScales.green[200], padding: spacing[3], alignItems: 'center', gap: 4,
  },
  totalCardLabel: { fontSize: 12, color: colorScales.gray[500] },
  totalCardValue: { fontSize: 24, fontWeight: '800' as any, color: colors.primary },
});
