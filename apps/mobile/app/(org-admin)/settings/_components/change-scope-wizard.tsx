import { useState } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator, StyleSheet, TextInput } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { OrgConfigService } from '@/features/org/services/org-config.service';
import {
  OrgCenteredModal,
} from '@/shared/components/org-centered-modal';
import { Icon } from '@/shared/components/icon/icon';
import { colors, colorScales, spacing, typography, borderRadius } from '@/shared/theme';
import {
  scopeShortLabel,
  blockerTitle,
  directionArrow,
  forceReasonRemaining,
  isForceReasonValid,
  type BlockerLike,
} from '@/features/org/components/operating-scope-formatters';
import type {
  OperatingScopeValue,
  OperatingScopePreview,
  OperatingScopeApplyResult,
  OperatingScopeBlocker,
} from '@/core/models/org-admin/config.types';
import { toastSuccess } from '@/shared/components/toast/toast.store';

/**
 * Wizard de cambio de modo operativo (paridad visual con web).
 * 4 pasos:
 *   1 — Confirmar intención (current vs target + razón opcional).
 *   2 — Preview (blockers + warnings).
 *   3 — Force-confirm (solo cuando hay blockers DOWN y no son PARTNER_LOCKED).
 *   4 — Result (success o error).
 */
type WizardStep = 1 | 2 | 3 | 4;

interface ChangeScopeWizardProps {
  visible: boolean;
  currentScope: OperatingScopeValue;
  targetScope: OperatingScopeValue;
  onClose: () => void;
  onApplied: (result: OperatingScopeApplyResult) => void;
}

export function ChangeScopeWizard({
  visible,
  currentScope,
  targetScope,
  onClose,
  onApplied,
}: ChangeScopeWizardProps) {
  const [step, setStep] = useState<WizardStep>(1);
  const [reason, setReason] = useState('');
  const [forceReason, setForceReason] = useState('');
  const [understandsConsequences, setUnderstandsConsequences] = useState(false);
  const [preview, setPreview] = useState<OperatingScopePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [appliedResult, setAppliedResult] = useState<OperatingScopeApplyResult | null>(null);

  const reset = () => {
    setStep(1);
    setReason('');
    setForceReason('');
    setUnderstandsConsequences(false);
    setPreview(null);
    setPreviewError(null);
    setApplyError(null);
    setAppliedResult(null);
  };

  const handleClose = () => {
    onClose();
    setTimeout(reset, 250);
  };

  // ---------- preview mutation ----------
  const previewMutation = useMutation({
    mutationFn: async () => {
      return OrgConfigService.previewOperatingScope(targetScope, reason);
    },
    onSuccess: (data) => {
      setPreview(data);
      setStep(2);
    },
    onError: (err: any) => {
      setPreviewError(extractErrorMessage(err, 'No se pudo obtener el preview del cambio.'));
    },
  });

  // ---------- apply mutation ----------
  const applyMutation = useMutation({
    mutationFn: async ({ force }: { force: boolean }) => {
      const reasonToSend = force ? forceReason.trim() : reason;
      return OrgConfigService.applyOperatingScope(targetScope, reasonToSend, force);
    },
    onSuccess: (result) => {
      setAppliedResult(result);
      setStep(4);
      toastSuccess(
        result.forced
          ? 'Cambio aplicado (forzado)'
          : 'Modo operativo actualizado',
      );
      onApplied(result);
    },
    onError: (err: any) => {
      setApplyError(extractErrorMessage(err, 'No se pudo aplicar el cambio.'));

      // 409 with blockers → refresh preview and return to step 2
      const status = err?.status ?? err?.response?.status;
      const blockers = err?.error?.blockers ?? err?.response?.data?.blockers;
      if (status === 409 && Array.isArray(blockers) && preview) {
        setPreview({
          ...preview,
          blockers,
          can_apply: false,
        });
        setStep(2);
      }
    },
  });

  // ---------- gates ----------
  const canShowForceOption =
    !!preview &&
    preview.blockers.length > 0 &&
    preview.direction === 'DOWN' &&
    !preview.blockers.some((b) => b.code === 'PARTNER_LOCKED');

  const canApply = !!preview && preview.can_apply && preview.blockers.length === 0;

  const canForceApply = understandsConsequences && isForceReasonValid(forceReason);

  const reasonRemaining = forceReasonRemaining(forceReason);

  // ---------- handlers ----------
  const goToPreview = () => {
    setPreviewError(null);
    setPreview(null);
    previewMutation.mutate();
  };

  const applyStandard = () => {
    if (!canApply) return;
    setApplyError(null);
    applyMutation.mutate({ force: false });
  };

  const goToForceConfirm = () => {
    if (!canShowForceOption) return;
    setApplyError(null);
    setUnderstandsConsequences(false);
    setForceReason('');
    setStep(3);
  };

  const forceApply = () => {
    if (!canForceApply) return;
    setApplyError(null);
    applyMutation.mutate({ force: true });
  };

  // ---------- render helpers ----------
  const renderStepDots = () => (
    <View style={styles.stepDotsRow}>
      {[1, 2, 3, 4].map((n) => {
        const isActive = n === step;
        const isPast = n < step;
        return (
          <View
            key={n}
            style={[
              styles.stepDot,
              isActive && styles.stepDotActive,
              isPast && styles.stepDotPast,
            ]}
          />
        );
      })}
    </View>
  );

  const renderStepLabel = () => {
    switch (step) {
      case 1:
        return 'Paso 1 de 4 · Confirmar intención';
      case 2:
        return 'Paso 2 de 4 · Vista previa';
      case 3:
        return 'Paso 3 de 4 · Confirmación forzada';
      case 4:
        return 'Paso 4 de 4 · Resultado';
    }
  };

  // ---------- step content ----------
  const renderStep1 = () => (
    <View>
      <Text style={styles.bodyText}>
        Vas a cambiar el modo operativo de la organización. Esta acción afecta cómo se gestiona el inventario, la contabilidad, las compras y los reportes.
      </Text>

      <View style={styles.summaryCard}>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Modo actual</Text>
          <View style={styles.summaryValueWrap}>
            <Icon name="store" size={14} color={colorScales.gray[500]} />
            <Text style={styles.summaryValue}>{scopeShortLabel(currentScope)}</Text>
          </View>
        </View>
        <View style={styles.summaryArrow}>
          <Icon name="arrow-down" size={16} color={colors.primary} />
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Modo destino</Text>
          <View style={styles.summaryValueWrap}>
            <Icon name="building-2" size={14} color={colors.primary} />
            <Text style={styles.summaryValueStrong}>{scopeShortLabel(targetScope)}</Text>
          </View>
        </View>
      </View>

      <Text style={styles.label}>Razón (opcional)</Text>
      <TextInput
        style={styles.textarea}
        placeholder="Describe brevemente por qué necesitas cambiar el modo operativo…"
        placeholderTextColor={colorScales.gray[400]}
        value={reason}
        onChangeText={setReason}
        multiline
        numberOfLines={3}
      />

      {previewError ? (
        <View style={styles.errorBox}>
          <Icon name="alert-circle" size={16} color={colorScales.red[600]} />
          <Text style={styles.errorText}>{previewError}</Text>
        </View>
      ) : null}
    </View>
  );

  const renderStep2 = () => {
    if (!preview) return null;

    const blockerList = preview.blockers ?? [];
    const warningList = preview.warnings ?? [];
    const hasBlockers = blockerList.length > 0;

    return (
      <View>
        <View style={styles.previewHeader}>
          <Text style={styles.previewDirection}>{directionArrow(currentScope, targetScope)}</Text>
          <View style={[styles.directionPill, preview.direction === 'DOWN' ? styles.directionPillDown : styles.directionPillUp]}>
            <Text style={styles.directionPillText}>
              {preview.direction === 'UP' ? 'UPGRADE' : preview.direction === 'DOWN' ? 'DOWNGRADE' : 'NOOP'}
            </Text>
          </View>
        </View>

        {warningList.length > 0 ? (
          <View style={styles.warningsBox}>
            <View style={styles.warningsHeader}>
              <Icon name="alert-triangle" size={14} color={colorScales.amber[700]} />
              <Text style={styles.warningsHeaderText}>Advertencias ({warningList.length})</Text>
            </View>
            {warningList.map((w, i) => (
              <Text key={i} style={styles.warningText}>• {w}</Text>
            ))}
          </View>
        ) : null}

        {hasBlockers ? (
          <View style={styles.blockersBox}>
            <View style={styles.blockersHeader}>
              <Icon name="x-circle" size={14} color={colorScales.red[600]} />
              <Text style={styles.blockersHeaderText}>
                Bloqueos ({blockerList.length})
              </Text>
            </View>
            {blockerList.map((b: OperatingScopeBlocker, i: number) => (
              <View key={i} style={styles.blockerRow}>
                <Text style={styles.blockerTitle}>{blockerTitle(b as BlockerLike)}</Text>
                <Text style={styles.blockerMessage}>{b.message}</Text>
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.canApplyBox}>
            <Icon name="check-circle" size={16} color={colorScales.green[600]} />
            <Text style={styles.canApplyText}>No hay bloqueos — el cambio puede aplicarse.</Text>
          </View>
        )}

        {applyError ? (
          <View style={styles.errorBox}>
            <Icon name="alert-circle" size={16} color={colorScales.red[600]} />
            <Text style={styles.errorText}>{applyError}</Text>
          </View>
        ) : null}
      </View>
    );
  };

  const renderStep3 = () => (
    <View>
      <View style={styles.warningBanner}>
        <Icon name="alert-triangle" size={16} color={colorScales.amber[700]} />
        <Text style={styles.warningBannerText}>
          Estás a punto de forzar la migración ignorando los bloqueos del servidor. Esta acción queda registrada en el log de auditoría con tu razón.
        </Text>
      </View>

      <View style={styles.checkboxRow}>
        <Pressable
          style={[styles.checkbox, understandsConsequences && styles.checkboxChecked]}
          onPress={() => setUnderstandsConsequences(!understandsConsequences)}
          hitSlop={8}
        >
          {understandsConsequences ? (
            <Icon name="check" size={12} color="#fff" />
          ) : null}
        </Pressable>
        <Text style={styles.checkboxLabel}>
          Entiendo las consecuencias y autorizo el cambio forzado.
        </Text>
      </View>

      <Text style={styles.label}>
        Razón (mínimo {forceReasonRemaining('') === 0 ? 10 : 10} caracteres){' '}
        <Text style={styles.labelRequired}>obligatoria</Text>
      </Text>
      <TextInput
        style={styles.textarea}
        placeholder="Mínimo 10 caracteres. Ej: migración por cierre de bodega central…"
        placeholderTextColor={colorScales.gray[400]}
        value={forceReason}
        onChangeText={setForceReason}
        multiline
        numberOfLines={3}
      />
      <Text
        style={[
          styles.charCounter,
          reasonRemaining > 0 && styles.charCounterWarn,
        ]}
      >
        {reasonRemaining > 0
          ? `Faltan ${reasonRemaining} caracteres`
          : '✓ Listo para forzar'}
      </Text>

      {applyError ? (
        <View style={styles.errorBox}>
          <Icon name="alert-circle" size={16} color={colorScales.red[600]} />
          <Text style={styles.errorText}>{applyError}</Text>
        </View>
      ) : null}
    </View>
  );

  const renderStep4 = () => {
    if (applyError && !appliedResult) {
      return (
        <View style={styles.resultErrorBox}>
          <Icon name="x-circle" size={32} color={colorScales.red[600]} />
          <Text style={styles.resultErrorTitle}>No se pudo aplicar el cambio</Text>
          <Text style={styles.resultErrorMessage}>{applyError}</Text>
        </View>
      );
    }
    if (appliedResult) {
      return (
        <View style={styles.resultSuccessBox}>
          <Icon name="check-circle" size={32} color={colorScales.green[600]} />
          <Text style={styles.resultSuccessTitle}>
            Modo operativo actualizado
          </Text>
          <View style={styles.resultSummary}>
            <View style={styles.resultRow}>
              <Text style={styles.resultLabel}>Anterior</Text>
              <Text style={styles.resultValue}>{scopeShortLabel(appliedResult.previous_scope)}</Text>
            </View>
            <View style={styles.resultRow}>
              <Text style={styles.resultLabel}>Nuevo</Text>
              <Text style={styles.resultValueStrong}>{scopeShortLabel(appliedResult.new_scope)}</Text>
            </View>
            <View style={styles.resultRow}>
              <Text style={styles.resultLabel}>Aplicado</Text>
              <Text style={styles.resultValue}>
                {new Date(appliedResult.applied_at).toLocaleString()}
              </Text>
            </View>
            {appliedResult.forced ? (
              <View style={styles.forcedBadge}>
                <Icon name="zap" size={12} color={colorScales.amber[700]} />
                <Text style={styles.forcedBadgeText}>Aplicado con force=true</Text>
              </View>
            ) : null}
          </View>
        </View>
      );
    }
    return null;
  };

  // ---------- footer ----------
  const renderFooter = () => {
    const isLoading = previewMutation.isPending || applyMutation.isPending;

    if (step === 1) {
      return (
        <View style={styles.modalActions}>
          <Pressable
            style={[styles.modalBtn, styles.modalBtnSecondary]}
            onPress={handleClose}
            disabled={isLoading}
          >
            <Text style={styles.modalBtnSecondaryText}>Cancelar</Text>
          </Pressable>
          <Pressable
            style={[
              styles.modalBtn,
              styles.modalBtnPrimary,
              isLoading && styles.modalBtnDisabled,
            ]}
            onPress={goToPreview}
            disabled={isLoading}
          >
            {previewMutation.isPending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.modalBtnPrimaryText}>Vista previa</Text>
            )}
          </Pressable>
        </View>
      );
    }

    if (step === 2) {
      const showForceBtn = canShowForceOption;
      return (
        <View style={styles.modalActions}>
          <Pressable
            style={[styles.modalBtn, styles.modalBtnSecondary]}
            onPress={() => setStep(1)}
            disabled={isLoading}
          >
            <Text style={styles.modalBtnSecondaryText}>Atrás</Text>
          </Pressable>
          {showForceBtn ? (
            <Pressable
              style={[styles.modalBtn, styles.modalBtnDanger]}
              onPress={goToForceConfirm}
              disabled={isLoading}
            >
              <Text style={styles.modalBtnDangerText}>Forzar cambio</Text>
            </Pressable>
          ) : (
            <Pressable
              style={[
                styles.modalBtn,
                styles.modalBtnPrimary,
                (!canApply || isLoading) && styles.modalBtnDisabled,
              ]}
              onPress={applyStandard}
              disabled={!canApply || isLoading}
            >
              {applyMutation.isPending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.modalBtnPrimaryText}>Aplicar cambio</Text>
              )}
            </Pressable>
          )}
        </View>
      );
    }

    if (step === 3) {
      return (
        <View style={styles.modalActions}>
          <Pressable
            style={[styles.modalBtn, styles.modalBtnSecondary]}
            onPress={() => setStep(2)}
            disabled={isLoading}
          >
            <Text style={styles.modalBtnSecondaryText}>Atrás</Text>
          </Pressable>
          <Pressable
            style={[
              styles.modalBtn,
              styles.modalBtnDanger,
              (!canForceApply || isLoading) && styles.modalBtnDisabled,
            ]}
            onPress={forceApply}
            disabled={!canForceApply || isLoading}
          >
            {applyMutation.isPending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.modalBtnDangerText}>Confirmar forzado</Text>
            )}
          </Pressable>
        </View>
      );
    }

    // step 4
    return (
      <View style={styles.modalActions}>
        <Pressable
          style={[styles.modalBtn, styles.modalBtnPrimary, { flex: 1 }]}
          onPress={handleClose}
        >
          <Text style={styles.modalBtnPrimaryText}>Cerrar</Text>
        </Pressable>
      </View>
    );
  };

  return (
    <OrgCenteredModal
      visible={visible}
      onClose={handleClose}
      title="Cambiar modo operativo"
      subtitle={renderStepLabel()}
      size="md"
      footer={renderFooter()}
    >
      <ScrollView showsVerticalScrollIndicator={false}>
        {renderStepDots()}
        {step === 1 && renderStep1()}
        {step === 2 && renderStep2()}
        {step === 3 && renderStep3()}
        {step === 4 && renderStep4()}
      </ScrollView>
    </OrgCenteredModal>
  );
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function extractErrorMessage(err: any, fallback: string): string {
  const payload = err?.error ?? err?.response?.data;
  if (payload) {
    const msg = payload?.message;
    if (Array.isArray(msg)) {
      const joined = msg.filter(Boolean).map(String).join('. ');
      if (joined) return joined;
    }
    if (typeof msg === 'string' && msg.trim()) return msg;
    if (
      typeof payload?.error === 'string' &&
      !['Bad Request', 'Forbidden', 'Conflict', 'Internal Server Error'].includes(payload.error)
    ) {
      return payload.error;
    }
  }

  const status = err?.status ?? err?.response?.status;
  if (status === 0 || status === undefined) {
    return 'No se pudo conectar con el servidor. Revisa tu conexión.';
  }
  if (status === 401) {
    return 'No tienes permisos para esta acción. Cierra sesión y vuelve a iniciar.';
  }
  if (status === 403) {
    return 'Esta organización es partner de Vendix y no puede cambiar el modo operativo.';
  }
  if (status === 409) {
    const blockers = payload?.blockers;
    if (Array.isArray(blockers) && blockers.length) {
      return `No se pudo aplicar el cambio: ${blockers
        .map((b: any) => b?.message || b?.code)
        .filter(Boolean)
        .join(' • ')}`;
    }
    return 'Hay condiciones que bloquean el cambio operativo.';
  }
  if (status >= 500) {
    return 'Error en el servidor al aplicar el cambio. Intenta de nuevo.';
  }
  return fallback;
}

// ----------------------------------------------------------------------------
// Styles
// ----------------------------------------------------------------------------

const styles = StyleSheet.create({
  // step indicator
  stepDotsRow: {
    flexDirection: 'row',
    gap: spacing[2],
    marginBottom: spacing[4],
    justifyContent: 'center',
  },
  stepDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colorScales.gray[200],
  },
  stepDotActive: { backgroundColor: colors.primary, width: 24 },
  stepDotPast: { backgroundColor: colors.primary },

  // body
  bodyText: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[700],
    lineHeight: typography.lineHeight.normal * typography.fontSize.sm,
    marginBottom: spacing[4],
  },

  // summary card (step 1)
  summaryCard: {
    backgroundColor: colorScales.gray[50],
    borderRadius: borderRadius.lg,
    padding: spacing[4],
    marginBottom: spacing[4],
    borderWidth: 1,
    borderColor: colorScales.gray[100],
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing[2],
  },
  summaryLabel: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
  },
  summaryValueWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  summaryValue: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colorScales.gray[700],
  },
  summaryValueStrong: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold,
    color: colors.primary,
  },
  summaryArrow: {
    alignItems: 'center',
    paddingVertical: spacing[1],
  },

  // form
  label: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[700],
    marginBottom: spacing[2],
  },
  labelRequired: {
    color: colorScales.red[600],
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.normal,
  },
  textarea: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    minHeight: 80,
    textAlignVertical: 'top',
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[900],
    marginBottom: spacing[2],
  },
  charCounter: {
    fontSize: typography.fontSize.xs,
    color: colorScales.green[600],
    marginBottom: spacing[3],
    textAlign: 'right',
  },
  charCounterWarn: {
    color: colorScales.amber[600],
  },

  // preview (step 2)
  previewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing[4],
  },
  previewDirection: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
  },
  directionPill: {
    paddingHorizontal: spacing[2],
    paddingVertical: 4,
    borderRadius: borderRadius.full,
  },
  directionPillUp: { backgroundColor: colorScales.green[100] },
  directionPillDown: { backgroundColor: colorScales.amber[100] },
  directionPillText: {
    fontSize: 10,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[700],
    letterSpacing: 0.5,
  },
  warningsBox: {
    backgroundColor: colorScales.amber[50],
    borderRadius: borderRadius.md,
    padding: spacing[3],
    marginBottom: spacing[3],
    borderWidth: 1,
    borderColor: colorScales.amber[200],
  },
  warningsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginBottom: spacing[2],
  },
  warningsHeaderText: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.amber[700],
    textTransform: 'uppercase',
  },
  warningText: {
    fontSize: typography.fontSize.xs,
    color: colorScales.amber[700],
    marginLeft: spacing[2],
    marginBottom: 2,
  },
  blockersBox: {
    backgroundColor: colorScales.red[50],
    borderRadius: borderRadius.md,
    padding: spacing[3],
    marginBottom: spacing[3],
    borderWidth: 1,
    borderColor: colorScales.red[200],
  },
  blockersHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginBottom: spacing[2],
  },
  blockersHeaderText: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.red[700],
    textTransform: 'uppercase',
  },
  blockerRow: {
    paddingVertical: spacing[2],
    borderTopWidth: 1,
    borderTopColor: colorScales.red[100],
  },
  blockerTitle: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.red[800],
    marginBottom: 2,
  },
  blockerMessage: {
    fontSize: typography.fontSize.xs,
    color: colorScales.red[700],
  },
  canApplyBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    backgroundColor: colorScales.green[50],
    borderRadius: borderRadius.md,
    padding: spacing[3],
    marginBottom: spacing[3],
    borderWidth: 1,
    borderColor: colorScales.green[200],
  },
  canApplyText: {
    fontSize: typography.fontSize.sm,
    color: colorScales.green[700],
    flex: 1,
  },

  // force-confirm (step 3)
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2],
    backgroundColor: colorScales.amber[50],
    borderRadius: borderRadius.md,
    padding: spacing[3],
    marginBottom: spacing[4],
    borderWidth: 1,
    borderColor: colorScales.amber[200],
  },
  warningBannerText: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    color: colorScales.amber[700],
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginBottom: spacing[4],
  },
  checkbox: {
    width: 20,
    height: 20,
    borderWidth: 2,
    borderColor: colorScales.gray[300],
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  checkboxLabel: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[700],
  },

  // result (step 4)
  resultErrorBox: {
    alignItems: 'center',
    paddingVertical: spacing[4],
  },
  resultErrorTitle: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.red[700],
    marginTop: spacing[2],
  },
  resultErrorMessage: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[600],
    textAlign: 'center',
    marginTop: spacing[2],
  },
  resultSuccessBox: {
    alignItems: 'center',
    paddingVertical: spacing[2],
  },
  resultSuccessTitle: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.green[700],
    marginTop: spacing[2],
    marginBottom: spacing[4],
  },
  resultSummary: {
    width: '100%',
    backgroundColor: colorScales.gray[50],
    borderRadius: borderRadius.lg,
    padding: spacing[4],
    borderWidth: 1,
    borderColor: colorScales.gray[100],
  },
  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing[2],
  },
  resultLabel: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
  },
  resultValue: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colorScales.gray[700],
  },
  resultValueStrong: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold,
    color: colors.primary,
  },
  forcedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    alignSelf: 'center',
    marginTop: spacing[3],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    backgroundColor: colorScales.amber[50],
    borderRadius: borderRadius.full,
  },
  forcedBadgeText: {
    fontSize: typography.fontSize.xs,
    color: colorScales.amber[700],
    fontWeight: typography.fontWeight.semibold,
  },

  // errors
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2],
    backgroundColor: colorScales.red[50],
    borderRadius: borderRadius.md,
    padding: spacing[3],
    marginTop: spacing[2],
    borderWidth: 1,
    borderColor: colorScales.red[200],
  },
  errorText: {
    flex: 1,
    fontSize: typography.fontSize.xs,
    color: colorScales.red[700],
  },

  // footer buttons
  modalActions: {
    flexDirection: 'row',
    gap: spacing[2],
    justifyContent: 'flex-end',
  },
  modalBtn: {
    height: 40,
    paddingHorizontal: spacing[4],
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 120,
  },
  modalBtnSecondary: { backgroundColor: colorScales.gray[100] },
  modalBtnSecondaryText: {
    color: colorScales.gray[700],
    fontWeight: typography.fontWeight.semibold,
  },
  modalBtnPrimary: { backgroundColor: colors.primary },
  modalBtnPrimaryText: {
    color: '#FFFFFF',
    fontWeight: typography.fontWeight.semibold,
  },
  modalBtnDanger: { backgroundColor: colorScales.red[600] },
  modalBtnDangerText: {
    color: '#FFFFFF',
    fontWeight: typography.fontWeight.semibold,
  },
  modalBtnDisabled: { opacity: 0.6 },
});