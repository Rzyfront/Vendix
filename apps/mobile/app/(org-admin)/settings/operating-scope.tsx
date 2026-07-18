import { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  RefreshControl,
  StyleSheet,
} from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { OrgConfigService } from '@/features/org/services/org-config.service';
import { OrgPageContainer } from '@/shared/components/org-page-container';
import { OrgBadge } from '@/shared/components/org-badge';
import { Button } from '@/shared/components/button/button';
import { Card } from '@/shared/components/card/card';
import { Icon } from '@/shared/components/icon/icon';
import { Spinner } from '@/shared/components/spinner/spinner';
import { RecordCard } from '@/shared/components/record-card/record-card';
import { colors, colorScales, spacing, typography, borderRadius, shadows } from '@/shared/theme';
import {
  scopeShortLabel,
  scopeLabel,
  formatAuditDate,
} from '@/features/org/components/operating-scope-formatters';
import { ChangeScopeWizard } from './_components/change-scope-wizard';
import { AuthService } from '@/core/auth/auth.service';
import { useAuthStore } from '@/core/store/auth.store';
import type {
  OperatingScopeValue,
  OperatingScopeAuditLogEntry,
  OperatingScopeApplyResult,
} from '@/core/models/org-admin/config.types';

/**
 * Modo operativo · ORG_ADMIN (paridad visual 1:1 con web).
 *
 * Espejo de `apps/frontend/.../settings/operating-scope/operating-scope.component.html`.
 *
 * Estructura:
 *   1. Sticky sub-header (título "Modo operativo" + subtítulo).
 *   2. Loading → app-spinner con texto.
 *   3. Error → alert-banner danger + botón "Reintentar".
 *   4. Current scope card — header (label + título + descripción + badge
 *      "Partner — bloqueado" si aplica) + partner alert + scope cards
 *      (STORE / ORGANIZATION) + botón "Cambiar modo operativo".
 *   5. Audit log card — header con icono history primary + lista de
 *      RecordCards (timestamp · change label · razón · usuario).
 *   6. Wizard modal 4 pasos.
 */

const SCOPE_DESCRIPTIONS: Record<OperatingScopeValue, string> = {
  STORE:
    'Cada tienda maneja sus propios proveedores, ubicaciones, inventario, compras, contabilidad y reportes operativos.',
  ORGANIZATION:
    'La organización consolida operación, valoración, contabilidad y reportes entre tiendas.',
};

const SCOPE_ICONS: Record<OperatingScopeValue, string> = {
  STORE: 'store',
  ORGANIZATION: 'building',
};

const SCOPE_ICON_BG: Record<OperatingScopeValue, string> = {
  STORE: '#eff6ff', // blue-50
  ORGANIZATION: '#faf5ff', // purple-50
};

const SCOPE_ICON_FG: Record<OperatingScopeValue, string> = {
  STORE: '#2563eb', // blue-600
  ORGANIZATION: '#9333ea', // purple-600
};

export default function OperatingScopeScreen() {
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [pendingTarget, setPendingTarget] = useState<OperatingScopeValue | null>(null);

  const { data, isLoading, isFetching, refetch, error } = useQuery({
    queryKey: ['org-operating-scope'],
    queryFn: () => OrgConfigService.getOperatingScope(),
    staleTime: 30_000,
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const openWizardFor = (target: OperatingScopeValue) => {
    setPendingTarget(target);
    setWizardOpen(true);
  };

  const onApplied = async (_result: OperatingScopeApplyResult) => {
    // 1) Refetch del estado de la organización (paridad con web loadCurrent()).
    queryClient.invalidateQueries({ queryKey: ['org-operating-scope'] });

    // 2) Refetch del user para que:
    //    - el scope chip del header global (building/store) se actualice
    //    - el tenant context (useTenantStore) refleje el nuevo operating_scope
    //    - cualquier cache key que dependa del scope se invalide
    // Paridad con web authFacade.refreshUser().
    try {
      const user = await AuthService.getMe();
      useAuthStore.getState().setUser(user);
    } catch (e) {
      // No bloqueamos el flujo si el refresh falla — el pull-to-refresh
      // lo recuperará. Logueamos para visibilidad.
      console.warn('[operating-scope] failed to refresh user after apply:', e);
    }
  };

  // ── Loading state (paridad con web <app-spinner text="Cargando...">) ──
  if (isLoading && !data) {
    return (
      <OrgPageContainer loading>
        {null}
      </OrgPageContainer>
    );
  }

  const current = data?.current ?? 'STORE';
  const isPartner = !!data?.is_partner;
  // Paridad con web `editable = state?.editable === true && !loading()`.
  // No añadimos !isFetching — durante un pull-to-refresh el toggle debe
  // seguir disponible si el servidor ya dijo que es editable.
  const editable = !!data?.editable && !isLoading;
  const auditLog = data?.audit_log_recent ?? [];

  const targetForWizard: OperatingScopeValue =
    pendingTarget ?? (current === 'STORE' ? 'ORGANIZATION' : 'STORE');

  const errorMessage = error ? extractErrorMessage(error) : null;

  return (
    <OrgPageContainer
      refreshing={refreshing}
      onRefresh={onRefresh}
      padding={false}
    >
      {/* ── Sticky sub-header — paridad con <app-sticky-header> web ── */}
      <View style={styles.stickySubHeader}>
        <View style={styles.titleRow}>
          <View style={styles.titleLeft}>
            <Pressable
              onPress={() => {}}
              hitSlop={8}
              style={styles.backBtn}
              accessibilityLabel="Volver"
            >
              <Icon name="arrow-left" size={16} color={colorScales.gray[500]} />
            </Pressable>

            <View style={styles.titleText}>
              <Text style={styles.title} numberOfLines={1}>
                Modo operativo
              </Text>
              <Text style={styles.subtitle} numberOfLines={2}>
                Define si la organización opera por tienda o de forma consolidada
              </Text>
            </View>
          </View>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {isFetching && !data ? (
          <View style={styles.loadingBox}>
            <Spinner size="lg" />
            <Text style={styles.loadingText}>Cargando modo operativo...</Text>
          </View>
        ) : null}

        {errorMessage ? (
          <View style={styles.dangerAlert}>
            <Icon name="alert-circle" size={16} color={colorScales.red[600]} />
            <Text style={styles.dangerAlertText}>{errorMessage}</Text>
            <Pressable onPress={() => refetch()} hitSlop={6}>
              <Text style={styles.retryLink}>Reintentar</Text>
            </Pressable>
          </View>
        ) : null}

        {data ? (
          <>
            {/* ── Current scope card (paridad con <app-card>) ── */}
            <View style={styles.section}>
              <Card>
                <View style={styles.cardBody}>
                  {/* Header row: label + título + descripción (izq) + badge partner (der) */}
                  <View style={styles.currentHeaderRow}>
                    <View style={styles.currentHeaderText}>
                      <Text style={styles.eyebrow}>MODO OPERATIVO ACTUAL</Text>
                      <Text style={styles.currentTitle}>{scopeLabel(current)}</Text>
                      <Text style={styles.currentDescription}>
                        Aplica a inventario, contabilidad, compras, valoración y
                        reportes de la organización.
                      </Text>
                    </View>
                    {isPartner ? (
                      <View style={styles.partnerBadgeWrap}>
                        <OrgBadge label="Partner — bloqueado" variant="warning" />
                      </View>
                    ) : null}
                  </View>

                  {/* Partner-lock alert (paridad con <app-alert-banner warning>) */}
                  {isPartner ? (
                    <View style={styles.partnerAlert}>
                      <Icon name="lock" size={16} color={colorScales.amber[700]} />
                      <Text style={styles.partnerAlertText}>
                        Esta organización es partner de Vendix. El modo operativo
                        está fijado en <Text style={styles.partnerAlertStrong}>Por tienda</Text> y
                        no puede modificarse desde esta pantalla.
                      </Text>
                    </View>
                  ) : null}

                  {/* Scope toggle (segmented) */}
                  <View style={styles.scopeSection}>
                    <Text style={styles.eyebrow}>SELECCIONA EL MODO OPERATIVO</Text>

                    <View style={styles.scopeCardsRow}>
                      <ScopeCardButton
                        value="STORE"
                        active={current === 'STORE'}
                        disabled={!editable}
                        onPress={() => openWizardFor('STORE')}
                      />
                      <ScopeCardButton
                        value="ORGANIZATION"
                        active={current === 'ORGANIZATION'}
                        disabled={!editable}
                        onPress={() => openWizardFor('ORGANIZATION')}
                      />
                    </View>
                  </View>

                  {/* Action button — right-aligned (paridad con web flex justify-end) */}
                  <View style={styles.actions}>
                    <Button
                      title={
                        isPartner
                          ? 'Modo bloqueado (Partner)'
                          : !editable
                            ? 'Modo no editable'
                            : 'Cambiar modo operativo'
                      }
                      variant="primary"
                      onPress={() => openWizardFor(targetForWizard)}
                      disabled={isPartner || !editable}
                    />
                  </View>
                </View>
              </Card>
            </View>

            {/* ── Audit log card (paridad con <app-card> + <app-responsive-data-view>) ── */}
            <View style={styles.section}>
              <Card>
                <View style={styles.cardBody}>
                  <View style={styles.auditHeaderRow}>
                    <Icon name="history" size={18} color={colors.primary} />
                    <Text style={styles.auditHeaderTitle}>Historial reciente</Text>
                  </View>

                  {auditLog.length === 0 ? (
                    <View style={styles.emptyAudit}>
                      <Icon name="history" size={20} color={colorScales.gray[400]} />
                      <Text style={styles.emptyAuditText}>
                        Sin cambios registrados
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.auditList}>
                      {auditLog.map((entry: OperatingScopeAuditLogEntry) => (
                        <View key={entry.id} style={styles.auditItem}>
                          <RecordCard
                            title={formatAuditDate(entry.changed_at)}
                            subtitle={`${scopeShortLabel(entry.previous_value)} → ${scopeShortLabel(entry.new_value)}`}
                            media={{ icon: 'history' }}
                            details={
                              entry.reason
                                ? [
                                    {
                                      label: 'Razón',
                                      value: entry.reason,
                                      icon: 'message-square',
                                    },
                                  ]
                                : []
                            }
                            footerLabel="Usuario"
                            footerValue={
                              entry.changed_by_user_id
                                ? `#${entry.changed_by_user_id}`
                                : 'Sistema'
                            }
                          />
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              </Card>
            </View>
          </>
        ) : null}

        <View style={{ height: spacing[12] }} />
      </ScrollView>

      {/* Wizard */}
      {pendingTarget ? (
        <ChangeScopeWizard
          visible={wizardOpen}
          currentScope={current}
          targetScope={pendingTarget}
          onClose={() => {
            setWizardOpen(false);
            setPendingTarget(null);
          }}
          onApplied={onApplied}
        />
      ) : null}
    </OrgPageContainer>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Sub-component: ScopeCardButton (paridad 1:1 con scope card web)
// ───────────────────────────────────────────────────────────────────────

interface ScopeCardButtonProps {
  value: OperatingScopeValue;
  active: boolean;
  disabled: boolean;
  onPress: () => void;
}

function ScopeCardButton({ value, active, disabled, onPress }: ScopeCardButtonProps) {
  const label = scopeShortLabel(value) === 'Tienda' ? 'Por tienda' : scopeShortLabel(value);
  const description = SCOPE_DESCRIPTIONS[value];
  const iconBg = SCOPE_ICON_BG[value];
  const iconFg = SCOPE_ICON_FG[value];

  return (
    <Pressable
      onPress={() => {
        // Paridad con web `selectScope()`: si la card ya está activa,
        // no abrimos el wizard (sería un NOOP).
        if (active) return;
        onPress();
      }}
      disabled={disabled}
      style={({ pressed }) => [
        styles.scopeCard,
        active && styles.scopeCardActive,
        !active && !disabled && pressed && styles.scopeCardHover,
        disabled && !active && styles.scopeCardDisabled,
      ]}
    >
      <View style={styles.scopeCardRow}>
        <View
          style={[
            styles.scopeIconWrap,
            { backgroundColor: iconBg },
          ]}
        >
          <Icon name={SCOPE_ICONS[value]} size={22} color={iconFg} />
        </View>

        <View style={styles.scopeCardBody}>
          <View style={styles.scopeLabelRow}>
            <Text
              style={[styles.scopeLabel, active && styles.scopeLabelActive]}
              numberOfLines={1}
            >
              {label}
            </Text>
            {active ? (
              <View style={styles.activePill}>
                <Text style={styles.activePillText}>Activo</Text>
              </View>
            ) : null}
          </View>
          <Text
            style={[styles.scopeDesc, disabled && styles.scopeDescDisabled]}
            numberOfLines={4}
          >
            {description}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────

function extractErrorMessage(err: any): string {
  const payload = err?.error ?? err?.response?.data;
  if (payload) {
    const msg = payload?.message;
    if (Array.isArray(msg)) {
      const joined = msg.filter(Boolean).map(String).join('. ');
      if (joined) return joined;
    }
    if (typeof msg === 'string' && msg.trim()) return msg;
  }
  const status = err?.status ?? err?.response?.status;
  if (status === 0 || status === undefined) {
    return 'No se pudo conectar con el servidor.';
  }
  if (status === 401 || status === 403) {
    return 'No tienes permisos para ver el modo operativo. Si los permisos se actualizaron recientemente, cierra sesión y vuelve a iniciar.';
  }
  return 'No se pudo cargar el modo operativo de la organización.';
}

// ───────────────────────────────────────────────────────────────────────
// Styles — paridad 1:1 con clases Tailwind del web
// ───────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // ── Sticky sub-header (espejo del <app-sticky-header> web) ──
  stickySubHeader: {
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[200],
    ...shadows.sm,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1.5],
  },
  titleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    flex: 1,
    minWidth: 0,
  },
  backBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.md,
  },
  titleText: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
  },
  subtitle: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
    marginTop: 2,
  },

  // ── Body ──
  scrollContent: {
    padding: spacing[4],
  },

  // loading
  loadingBox: {
    alignItems: 'center',
    paddingVertical: spacing[10],
    gap: spacing[2],
  },
  loadingText: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
  },

  // danger alert (paridad con <app-alert-banner variant="danger">)
  dangerAlert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    backgroundColor: colorScales.red[50],
    borderRadius: borderRadius.md,
    padding: spacing[3],
    marginBottom: spacing[4],
    borderWidth: 1,
    borderColor: colorScales.red[200],
  },
  dangerAlertText: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    color: colorScales.red[700],
  },
  retryLink: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.red[700],
    textDecorationLine: 'underline',
  },

  // sections
  section: {
    marginBottom: spacing[4],
  },
  cardBody: {
    padding: spacing[4],
    gap: spacing[4],
  },

  // eyebrow labels (text-xs font-bold uppercase tracking-wider text-gray-400)
  eyebrow: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: colorScales.gray[400],
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: spacing[2],
  },

  // current header
  currentHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing[3],
  },
  currentHeaderText: {
    flex: 1,
    minWidth: 0,
  },
  currentTitle: {
    fontSize: typography.fontSize.xl,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[900],
    marginTop: 2,
  },
  currentDescription: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
    marginTop: spacing[1],
    lineHeight: 18,
  },
  partnerBadgeWrap: {
    flexShrink: 0,
  },

  // partner alert (paridad con <app-alert-banner variant="warning" icon="lock">)
  partnerAlert: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2],
    backgroundColor: colorScales.amber[50],
    borderRadius: borderRadius.md,
    padding: spacing[3],
    borderWidth: 1,
    borderColor: colorScales.amber[200],
  },
  partnerAlertText: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    color: colorScales.amber[700],
    lineHeight: 18,
  },
  partnerAlertStrong: {
    fontWeight: typography.fontWeight.bold,
  },

  // scope toggle
  scopeSection: {},
  scopeCardsRow: {
    gap: spacing[3],
  },
  scopeCard: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: 16, // web: rounded-2xl = 1rem
    padding: spacing[4],
  },
  scopeCardActive: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(47, 111, 78, 0.05)', // primary/5
    borderWidth: 1,
    ...shadows.sm,
    // ring-1 ring-primary/20 — simulado con border secundario
  },
  scopeCardHover: {
    borderColor: 'rgba(47, 111, 78, 0.5)', // primary/50
    ...shadows.md,
  },
  scopeCardDisabled: {
    opacity: 0.7,
  },
  scopeCardRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[3],
  },
  scopeIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12, // web: rounded-xl = 0.75rem
    alignItems: 'center',
    justifyContent: 'center',
  },
  scopeCardBody: {
    flex: 1,
    minWidth: 0,
  },
  scopeLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    flexWrap: 'wrap',
  },
  scopeLabel: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[900],
  },
  scopeLabelActive: {
    color: colorScales.gray[900],
  },
  scopeDesc: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
    marginTop: spacing[2],
    lineHeight: 18,
  },
  scopeDescDisabled: {
    color: colorScales.gray[400],
  },
  activePill: {
    backgroundColor: colorScales.green[100],
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: borderRadius.full,
  },
  activePillText: {
    fontSize: 10,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.green[700],
  },

  // actions
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },

  // audit log
  auditHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  auditHeaderTitle: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[900],
  },
  emptyAudit: {
    alignItems: 'center',
    paddingVertical: spacing[8],
    gap: spacing[2],
  },
  emptyAuditText: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
    textAlign: 'center',
  },
  auditList: {
    gap: spacing[2],
  },
  auditItem: {},
});
