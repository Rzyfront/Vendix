import { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { OrgConfigService } from '@/features/org/services/org-config.service';
import { OrgCenteredModal } from '@/shared/components/org-centered-modal';
import { Button } from '@/shared/components/button/button';
import { Icon } from '@/shared/components/icon/icon';
import { colors, colorScales, spacing, typography, borderRadius } from '@/shared/theme';
import {
  scopeLabel,
  scopeShortLabel,
  blockerTitle,
  forceReasonRemaining,
  isForceReasonValid,
  type BlockerLike,
} from '@/features/org/components/operating-scope-formatters';
import { hasOperatingScopeWritePermission } from '@/features/org/components/operating-scope-permissions';
import type {
  OperatingScopeValue,
  OperatingScopePreview,
  OperatingScopeApplyResult,
  OperatingScopeBlocker,
} from '@/core/models/org-admin/config.types';
import { toastSuccess } from '@/shared/components/toast/toast.store';

/**
 * Wizard de cambio de modo operativo (paridad visual 1:1 con web).
 * 4 pasos:
 *   1 — Confirmar intención (current vs target en grid 2-col + razón opcional).
 *   2 — Preview (blockers como cards + warnings como cards + force option banner).
 *   3 — Force-confirm (lista de blockers ignorados + checkbox + textarea + char counter).
 *   4 — Result (icon rounded-full + h3 + párrafo + summary con audit_log_id).
 *
 * Espejo de `apps/frontend/.../operating-scope/components/change-scope-wizard.component.html`.
 */
type WizardStep = 1 | 2 | 3 | 4;
const STEP_NUMBERS = [1, 2, 3, 4] as const;

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

  // ── preview mutation ──
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

  // ── apply mutation ──
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

      const status = err?.statusCode ?? err?.status ?? err?.response?.status;
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

  // ── gates ──
  // Paridad con web `canShowForceOption`:
  //   - preview con blockers
  //   - direction === 'DOWN' (server ignora force en UP)
  //   - ningún blocker es PARTNER_LOCKED (rail de seguridad — nunca bypassable)
  //   - el usuario tiene el permiso de escritura a nivel user (no solo org)
  const canShowForceOption =
    !!preview &&
    preview.blockers.length > 0 &&
    preview.direction === 'DOWN' &&
    !preview.blockers.some((b) => b.code === 'PARTNER_LOCKED') &&
    hasOperatingScopeWritePermission();

  const canApply = !!preview && preview.can_apply && preview.blockers.length === 0;

  const canForceApply = understandsConsequences && isForceReasonValid(forceReason);

  const reasonRemaining = forceReasonRemaining(forceReason);

  // ── handlers ──
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

  const goBackToStep1 = () => {
    setStep(1);
    setPreviewError(null);
  };

  const goBackToPreview = () => {
    setApplyError(null);
    setStep(2);
  };

  // ── step indicator (paridad con web — numbered circles + connectors) ──
  const renderStepIndicator = () => (
    <View style={styles.stepIndicator}>
      {STEP_NUMBERS.map((n, idx) => {
        const isPast = step > n;
        const isActive = step === n;
        return (
          <View key={n} style={styles.stepItem}>
            <View
              style={[
                styles.stepCircle,
                isPast && styles.stepCirclePast,
                isActive && styles.stepCircleActive,
              ]}
            >
              <Text
                style={[
                  styles.stepCircleText,
                  (isPast || isActive) && styles.stepCircleTextActive,
                ]}
              >
                {n}
              </Text>
            </View>
            {idx < STEP_NUMBERS.length - 1 ? (
              <View
                style={[
                  styles.stepConnector,
                  isPast && styles.stepConnectorPast,
                ]}
              />
            ) : null}
          </View>
        );
      })}
    </View>
  );

  // ── step 1: confirm intent ──
  const renderStep1 = () => (
    <View>
      <Text style={styles.bodyText}>
        Vas a cambiar el modo operativo de la organización. Este cambio modifica
        cómo se consultan, agregan y consolidan los datos en inventario,
        contabilidad, compras y reportes.
      </Text>

      <View style={styles.summaryCard}>
        <View style={styles.summaryGrid}>
          <View style={styles.summaryCol}>
            <Text style={styles.summaryLabel}>Actual</Text>
            <Text style={styles.summaryValue}>{scopeLabel(currentScope)}</Text>
          </View>
          <View style={styles.summaryCol}>
            <Text style={styles.summaryLabel}>Destino</Text>
            <Text style={styles.summaryValueStrong}>{scopeLabel(targetScope)}</Text>
          </View>
        </View>
      </View>

      <Text style={styles.label}>Razón del cambio (opcional)</Text>
      <TextInput
        style={styles.textarea}
        placeholder="Ej: la organización pasa a operar de forma consolidada por requisitos contables."
        placeholderTextColor={colorScales.gray[400]}
        value={reason}
        onChangeText={setReason}
        multiline
        numberOfLines={3}
      />

      {previewError ? <AlertBox variant="danger" icon="alert-circle" text={previewError} /> : null}
    </View>
  );

  // ── step 2: preview blockers/warnings ──
  const renderStep2 = () => {
    if (!preview) return null;
    const blockerList = preview.blockers ?? [];
    const warningList = preview.warnings ?? [];

    if (previewMutation.isPending) {
      return (
        <View style={styles.previewLoading}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Validando...</Text>
        </View>
      );
    }

    return (
      <View>
        <Text style={styles.bodyText}>
          Resultado de la validación previa al cambio{' '}
          <Text style={styles.bodyTextStrong}>
            {scopeShortLabel(currentScope)} → {scopeShortLabel(targetScope)}
          </Text>
          .
        </Text>

        {blockerList.length > 0 ? (
          <View>
            <Text style={styles.sectionTitle}>
              Bloqueadores ({blockerList.length})
            </Text>
            <View style={styles.cardsStack}>
              {blockerList.map((b: OperatingScopeBlocker, i: number) => {
                const count = blockerCount(b);
                const remediationLink = blockerRemediationLink(b);
                return (
                  <View key={`${b.code}-${i}`} style={styles.blockerCard}>
                    <View style={styles.cardRow}>
                      <Icon name="alert-circle" size={16} color={colorScales.red[600]} style={styles.cardIconTop} />
                      <View style={styles.cardBody}>
                        <View style={styles.cardHeaderRow}>
                          <Text style={styles.blockerTitle}>
                            {blockerTitle(b as BlockerLike)}
                          </Text>
                          {count !== null ? (
                            <View style={styles.countPill}>
                              <Text style={styles.countPillText}>{count}</Text>
                            </View>
                          ) : null}
                        </View>
                        <Text style={styles.blockerMessage}>{b.message}</Text>
                        {remediationLink ? (
                          <Pressable
                            onPress={handleClose}
                            hitSlop={4}
                            style={styles.remediationLink}
                          >
                            <Text style={styles.remediationLinkText}>Resolver</Text>
                            <Icon name="arrow-right" size={12} color={colorScales.red[700]} />
                          </Pressable>
                        ) : null}
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        ) : null}

        {warningList.length > 0 ? (
          <View style={styles.warningsBlock}>
            <Text style={styles.warningsSectionTitle}>
              Advertencias ({warningList.length})
            </Text>
            <View style={styles.cardsStack}>
              {warningList.map((w, i) => (
                <View key={i} style={styles.warningCard}>
                  <View style={styles.cardRow}>
                    <Icon name="alert-triangle" size={16} color={colorScales.amber[600]} style={styles.cardIconTop} />
                    <Text style={styles.warningMessage}>{w}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {blockerList.length === 0 && warningList.length === 0 ? (
          <View style={styles.successBanner}>
            <Icon name="check-circle" size={16} color={colorScales.green[600]} />
            <Text style={styles.successBannerText}>
              La organización está lista para aplicar el cambio sin restricciones.
            </Text>
          </View>
        ) : null}

        {canShowForceOption ? (
          <View style={styles.warningBanner}>
            <Icon name="alert-triangle" size={16} color={colorScales.amber[700]} />
            <Text style={styles.warningBannerText}>
              <Text style={styles.warningBannerStrong}>¿No puedes resolver los bloqueadores?</Text>{' '}
              Puedes forzar el downgrade para ignorarlos. Esta acción queda
              registrada en el historial de auditoría con tu usuario y razón.
            </Text>
          </View>
        ) : null}

        {applyError ? <AlertBox variant="danger" icon="alert-circle" text={applyError} /> : null}
      </View>
    );
  };

  // ── step 3: force confirmation ──
  const renderStep3 = () => {
    if (!preview) return null;
    const blockerList = preview.blockers ?? [];

    return (
      <View>
        <View style={styles.dangerBanner}>
          <Icon name="alert-triangle" size={16} color={colorScales.red[600]} />
          <Text style={styles.dangerBannerText}>
            <Text style={styles.dangerBannerStrong}>Vas a forzar el downgrade.</Text>{' '}
            Los siguientes bloqueadores serán ignorados. Asegúrate de entender las
            consecuencias antes de continuar.
          </Text>
        </View>

        <Text style={styles.sectionTitle}>
          Bloqueadores que serán ignorados ({blockerList.length})
        </Text>
        <View style={styles.cardsStack}>
          {blockerList.map((b: OperatingScopeBlocker, i: number) => {
            const count = blockerCount(b);
            return (
              <View key={`${b.code}-${i}`} style={styles.blockerCard}>
                <View style={styles.cardRow}>
                  <Icon name="alert-circle" size={16} color={colorScales.red[600]} style={styles.cardIconTop} />
                  <View style={styles.cardBody}>
                    <View style={styles.cardHeaderRow}>
                      <Text style={styles.blockerTitle}>{blockerTitle(b as BlockerLike)}</Text>
                      {count !== null ? (
                        <View style={styles.countPill}>
                          <Text style={styles.countPillText}>{count}</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={styles.blockerMessage}>{b.message}</Text>
                  </View>
                </View>
              </View>
            );
          })}
        </View>

        <Pressable
          onPress={() => setUnderstandsConsequences(!understandsConsequences)}
          style={[
            styles.checkboxCard,
            understandsConsequences && styles.checkboxCardChecked,
          ]}
        >
          <View
            style={[
              styles.checkbox,
              understandsConsequences && styles.checkboxChecked,
            ]}
          >
            {understandsConsequences ? (
              <Icon name="check" size={12} color="#fff" />
            ) : null}
          </View>
          <View style={styles.checkboxTextWrap}>
            <Text style={styles.checkboxStrong}>
              Entiendo las consecuencias.
            </Text>
            <Text style={styles.checkboxMuted}>
              El stock, las órdenes y reservas en bodega central podrían quedar
              inaccesibles desde scope STORE. La acción quedará registrada en
              auditoría.
            </Text>
          </View>
        </Pressable>

        <Text style={styles.label}>
          Razón del force (obligatorio, mínimo 10 caracteres)
        </Text>
        <TextInput
          style={styles.textarea}
          placeholder="Ej: cierre operativo de bodega central; las reservas se liberarán manualmente."
          placeholderTextColor={colorScales.gray[400]}
          value={forceReason}
          onChangeText={setForceReason}
          multiline
          numberOfLines={3}
        />
        {reasonRemaining > 0 ? (
          <Text style={styles.charCounter}>
            Faltan {reasonRemaining} caracteres para alcanzar el mínimo requerido.
          </Text>
        ) : null}

        {applyError ? <AlertBox variant="danger" icon="alert-circle" text={applyError} /> : null}
      </View>
    );
  };

  // ── step 4: result ──
  const renderStep4 = () => {
    if (!appliedResult) return null;
    const forced = !!appliedResult.forced;

    return (
      <View style={styles.resultWrap}>
        <View style={styles.resultHeader}>
          <View
            style={[
              styles.resultIconCircle,
              forced ? styles.resultIconWarn : styles.resultIconOk,
            ]}
          >
            <Icon
              name={forced ? 'alert-triangle' : 'check-circle'}
              size={32}
              color={forced ? colorScales.amber[600] : colorScales.green[600]}
            />
          </View>
          <Text style={styles.resultTitle}>
            {forced ? 'Modo operativo forzado' : 'Modo operativo actualizado'}
          </Text>
          <Text style={styles.resultParagraph}>
            La organización ahora opera como{' '}
            <Text style={styles.resultParagraphStrong}>
              {scopeLabel(appliedResult.new_scope)}
            </Text>
            .
            {forced ? '\n' : null}
            {forced ? (
              <Text style={styles.resultForcedText}>
                {' '}Se ignoraron bloqueadores. Revisa el historial de auditoría.
              </Text>
            ) : null}
          </Text>
        </View>

        <View style={styles.resultSummary}>
          <Text style={styles.resultSummaryLine}>
            Anterior: <Text style={styles.resultSummaryStrong}>{scopeLabel(appliedResult.previous_scope)}</Text>
          </Text>
          <Text style={styles.resultSummaryLine}>
            Audit log ID: <Text style={styles.resultSummaryStrong}>#{appliedResult.audit_log_id}</Text>
          </Text>
          {forced ? (
            <Text style={[styles.resultSummaryLine, styles.resultSummaryForced]}>
              <Text style={styles.resultSummaryForcedStrong}>Forzado:</Text> sí (registrado en audit_logs)
            </Text>
          ) : null}
        </View>
      </View>
    );
  };

  // ── footer ──
  const renderFooter = () => {
    const isLoading = previewMutation.isPending || applyMutation.isPending;

    if (step === 1) {
      return (
        <View style={styles.footerRow}>
          <Button title="Cancelar" variant="ghost" onPress={handleClose} disabled={isLoading} />
          <Button
            title="Continuar"
            variant="primary"
            onPress={goToPreview}
            loading={previewMutation.isPending}
            disabled={isLoading}
          />
        </View>
      );
    }

    if (step === 2) {
      return (
        <View style={styles.footerRow}>
          <Button
            title="Atrás"
            variant="ghost"
            onPress={goBackToStep1}
            disabled={isLoading}
          />
          {canShowForceOption ? (
            <WarningButton
              title="Forzar downgrade"
              onPress={goToForceConfirm}
              disabled={isLoading}
            />
          ) : null}
          <Button
            title="Aplicar cambio"
            variant="primary"
            onPress={applyStandard}
            loading={applyMutation.isPending}
            disabled={!canApply || isLoading}
          />
        </View>
      );
    }

    if (step === 3) {
      return (
        <View style={styles.footerRow}>
          <Button
            title="Cancelar"
            variant="ghost"
            onPress={goBackToPreview}
            disabled={isLoading}
          />
          <Button
            title="Force downgrade"
            variant="destructive"
            onPress={forceApply}
            loading={applyMutation.isPending}
            disabled={!canForceApply || isLoading}
          />
        </View>
      );
    }

    // step 4
    return (
      <View style={styles.footerRow}>
        <Button title="Cerrar" variant="primary" onPress={handleClose} />
      </View>
    );
  };

  return (
    <OrgCenteredModal
      visible={visible}
      onClose={handleClose}
      title="Cambiar modo operativo"
      subtitle={`${scopeLabel(currentScope)} → ${scopeLabel(targetScope)}`}
      size="md"
      footer={renderFooter()}
    >
      <ScrollView showsVerticalScrollIndicator={false}>
        {renderStepIndicator()}
        {step === 1 && renderStep1()}
        {step === 2 && renderStep2()}
        {step === 3 && renderStep3()}
        {step === 4 && renderStep4()}
      </ScrollView>
    </OrgCenteredModal>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Sub-component: WarningButton (paridad con <app-button variant="outline-warning">)
// ───────────────────────────────────────────────────────────────────────

interface WarningButtonProps {
  title: string;
  onPress: () => void;
  disabled?: boolean;
}

function WarningButton({ title, onPress, disabled }: WarningButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        warningButtonStyles.button,
        pressed && warningButtonStyles.pressed,
        disabled && warningButtonStyles.disabled,
      ]}
    >
      <Text style={warningButtonStyles.text}>{title}</Text>
    </Pressable>
  );
}

const warningButtonStyles = StyleSheet.create({
  button: {
    height: 40,
    paddingHorizontal: spacing[4],
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colorScales.amber[500],
  },
  pressed: {
    backgroundColor: colorScales.amber[50],
  },
  disabled: {
    opacity: 0.5,
  },
  text: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.amber[700],
  },
});

// ───────────────────────────────────────────────────────────────────────
// Sub-component: AlertBox (paridad con <app-alert-banner>)
// ───────────────────────────────────────────────────────────────────────

interface AlertBoxProps {
  variant: 'danger' | 'warning' | 'success';
  icon: string;
  text: string;
}

function AlertBox({ variant, icon, text }: AlertBoxProps) {
  const palette = {
    danger: { bg: colorScales.red[50], fg: colorScales.red[600], text: colorScales.red[700] },
    warning: { bg: colorScales.amber[50], fg: colorScales.amber[600], text: colorScales.amber[700] },
    success: { bg: colorScales.green[50], fg: colorScales.green[600], text: colorScales.green[700] },
  }[variant];

  return (
    <View style={[alertBoxStyles.box, { backgroundColor: palette.bg }]}>
      <Icon name={icon} size={16} color={palette.fg} />
      <Text style={[alertBoxStyles.text, { color: palette.text }]}>{text}</Text>
    </View>
  );
}

const alertBoxStyles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2],
    borderRadius: borderRadius.md,
    padding: spacing[3],
  },
  text: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    lineHeight: 18,
  },
});

// ───────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────

function blockerCount(b: OperatingScopeBlocker): number | null {
  const c = b.details?.count;
  if (typeof c === 'number' && Number.isFinite(c)) return c;
  return null;
}

function blockerRemediationLink(b: OperatingScopeBlocker): string | null {
  const link = b.details?.remediation_link;
  if (typeof link === 'string' && link.trim()) return link;
  return null;
}

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

  const status = err?.statusCode ?? err?.status ?? err?.response?.status;
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

// ───────────────────────────────────────────────────────────────────────
// Styles
// ───────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // ── Step indicator (numbered circles + connectors) ──
  stepIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing[4],
  },
  stepItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stepCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colorScales.gray[200],
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepCircleActive: {
    backgroundColor: colors.primary,
  },
  stepCirclePast: {
    backgroundColor: colors.primary,
  },
  stepCircleText: {
    fontSize: 12,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[500],
  },
  stepCircleTextActive: {
    color: '#FFFFFF',
  },
  stepConnector: {
    width: 32,
    height: 2,
    backgroundColor: colorScales.gray[200],
    marginHorizontal: 2,
  },
  stepConnectorPast: {
    backgroundColor: colors.primary,
  },

  // ── Body ──
  bodyText: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
    lineHeight: 18,
    marginBottom: spacing[4],
  },
  bodyTextStrong: {
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
  },
  loadingText: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
    marginTop: spacing[2],
  },

  // ── Summary card (step 1) ──
  summaryCard: {
    backgroundColor: colors.card,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    padding: spacing[4],
    marginBottom: spacing[4],
  },
  summaryGrid: {
    flexDirection: 'row',
    gap: spacing[4],
  },
  summaryCol: {
    flex: 1,
    minWidth: 0,
  },
  summaryLabel: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: colorScales.gray[400],
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  summaryValue: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[900],
    marginTop: spacing[1],
  },
  summaryValueStrong: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colors.primary,
    marginTop: spacing[1],
  },

  // ── Form ──
  label: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[700],
    marginBottom: spacing[2],
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
    color: colorScales.gray[500],
    marginBottom: spacing[2],
  },

  // ── Preview loading ──
  previewLoading: {
    alignItems: 'center',
    paddingVertical: spacing[10],
  },

  // ── Section titles ──
  sectionTitle: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.red[700],
    marginBottom: spacing[2],
  },
  warningsSectionTitle: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.amber[700],
    marginBottom: spacing[2],
  },

  // ── Cards stack ──
  cardsStack: {
    gap: spacing[2],
    marginBottom: spacing[3],
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2],
  },
  cardIconTop: {
    marginTop: 2,
  },
  cardBody: {
    flex: 1,
    minWidth: 0,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    flexWrap: 'wrap',
  },

  // blocker card
  blockerCard: {
    backgroundColor: colorScales.red[50],
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colorScales.red[200],
    padding: spacing[3],
  },
  blockerTitle: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.red[800],
  },
  blockerMessage: {
    fontSize: typography.fontSize.sm,
    color: colorScales.red[700],
    marginTop: 2,
    lineHeight: 18,
  },
  countPill: {
    backgroundColor: colorScales.red[100],
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: borderRadius.full,
  },
  countPillText: {
    fontSize: 10,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.red[700],
  },
  remediationLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    marginTop: spacing[2],
  },
  remediationLinkText: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.red[700],
    textDecorationLine: 'underline',
  },

  // warning card
  warningCard: {
    backgroundColor: colorScales.amber[50],
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colorScales.amber[200],
    padding: spacing[3],
  },
  warningMessage: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    color: colorScales.amber[800],
    lineHeight: 18,
  },

  // success banner
  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    backgroundColor: colorScales.green[50],
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colorScales.green[200],
    padding: spacing[3],
    marginBottom: spacing[3],
  },
  successBannerText: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    color: colorScales.green[700],
  },

  // warning banner (force option)
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2],
    backgroundColor: colorScales.amber[50],
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colorScales.amber[200],
    padding: spacing[3],
    marginBottom: spacing[3],
  },
  warningBannerText: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    color: colorScales.amber[700],
    lineHeight: 18,
  },
  warningBannerStrong: {
    fontWeight: typography.fontWeight.bold,
  },
  warningsBlock: {
    marginTop: spacing[1],
  },

  // danger banner (step 3)
  dangerBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2],
    backgroundColor: colorScales.red[50],
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colorScales.red[200],
    padding: spacing[3],
    marginBottom: spacing[4],
  },
  dangerBannerText: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    color: colorScales.red[700],
    lineHeight: 18,
  },
  dangerBannerStrong: {
    fontWeight: typography.fontWeight.bold,
    color: colorScales.red[800],
  },

  // checkbox card
  checkboxCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[3],
    backgroundColor: colors.card,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    padding: spacing[3],
    marginBottom: spacing[4],
  },
  checkboxCardChecked: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(47, 111, 78, 0.03)',
  },
  checkbox: {
    width: 18,
    height: 18,
    borderWidth: 2,
    borderColor: colorScales.gray[300],
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkboxChecked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  checkboxTextWrap: {
    flex: 1,
  },
  checkboxStrong: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[900],
  },
  checkboxMuted: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
    marginTop: 2,
    lineHeight: 18,
  },

  // ── Result (step 4) ──
  resultWrap: {
    paddingVertical: spacing[4],
  },
  resultHeader: {
    alignItems: 'center',
    gap: spacing[3],
    marginBottom: spacing[4],
  },
  resultIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultIconOk: {
    backgroundColor: colorScales.green[100],
  },
  resultIconWarn: {
    backgroundColor: colorScales.amber[100],
  },
  resultTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[900],
    textAlign: 'center',
  },
  resultParagraph: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
    textAlign: 'center',
    lineHeight: 18,
  },
  resultParagraphStrong: {
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[900],
  },
  resultForcedText: {
    color: colorScales.amber[700],
  },
  resultSummary: {
    backgroundColor: colors.card,
    borderRadius: borderRadius.md,
    padding: spacing[3],
    borderWidth: 1,
    borderColor: colorScales.gray[200],
  },
  resultSummaryLine: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
    marginBottom: 2,
  },
  resultSummaryStrong: {
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[900],
  },
  resultSummaryForced: {
    marginTop: spacing[1],
  },
  resultSummaryForcedStrong: {
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.amber[700],
  },

  // ── Footer ──
  footerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[2],
    justifyContent: 'flex-end',
  },
});

// (end of file)
