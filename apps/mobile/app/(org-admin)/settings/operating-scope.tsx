import { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { OrgConfigService } from '@/features/org/services/org-config.service';
import { OrgPageContainer } from '@/shared/components/org-page-container';
import { OrgBadge } from '@/shared/components/org-badge';
import { OrgDetailRow } from '@/shared/components/org-detail-row';
import { Icon } from '@/shared/components/icon/icon';
import { colors, colorScales, spacing, typography, borderRadius } from '@/shared/theme';
import { Button } from '@/shared/components/button/button';
import {
  scopeShortLabel,
  scopeDescription,
  formatAuditDate,
} from '@/features/org/components/operating-scope-formatters';
import { ChangeScopeWizard } from './_components/change-scope-wizard';
import type {
  OperatingScopeValue,
  OperatingScopeAuditLogEntry,
  OperatingScopeApplyResult,
} from '@/core/models/org-admin/config.types';

/**
 * Modo operativo · ORG_ADMIN (paridad visual con web).
 *
 * Layout:
 *  - Sticky header (lo da AdminShell).
 *  - Hero card con descripción + modo actual.
 *  - Cards STORE / ORGANIZATION (segmented side-by-side).
 *  - Partner-lock alert (si is_partner).
 *  - Audit log (ResponsiveDataView equivalente → cards en mobile).
 *  - Botón "Cambiar modo operativo".
 */

export default function OperatingScopeScreen() {
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [pendingTarget, setPendingTarget] = useState<OperatingScopeValue | null>(null);

  const { data, isLoading, refetch } = useQuery({
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

  const onApplied = (_result: OperatingScopeApplyResult) => {
    queryClient.invalidateQueries({ queryKey: ['org-operating-scope'] });
    // auth refresh: en web se llama AuthFacade.refreshUser() para refrescar menú lateral.
    // Mobile: el menú lee del store de auth, pero el usuario no verá cambios hasta refresh manual.
    // Mantenemos la consistencia: el siguiente refetch (pull-to-refresh) traerá el nuevo scope.
  };

  if (isLoading && !data) {
    return (
      <OrgPageContainer loading>
        {null}
      </OrgPageContainer>
    );
  }

  const current = data?.current ?? 'STORE';
  const isPartner = !!data?.is_partner;
  const editable = !!data?.editable;
  const auditLog = data?.audit_log_recent ?? [];

  const targetForWizard: OperatingScopeValue =
    pendingTarget ?? (current === 'STORE' ? 'ORGANIZATION' : 'STORE');

  return (
    <OrgPageContainer
      refreshing={refreshing}
      onRefresh={onRefresh}
      padding={false}
    >
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
        {/* Hero card */}
        <View style={styles.heroCard}>
          <View style={styles.heroIcon}>
            <Icon name="settings-2" size={22} color={colors.primary} />
          </View>
          <View style={styles.heroBody}>
            <Text style={styles.heroTitle}>Modo operativo</Text>
            <Text style={styles.heroSubtitle}>
              Define si la organización opera por tienda (inventario independiente) o consolidada (bodega central).
            </Text>
          </View>
        </View>

        {/* Partner-lock alert */}
        {isPartner ? (
          <View style={styles.partnerAlert}>
            <Icon name="lock" size={16} color={colorScales.amber[700]} />
            <Text style={styles.partnerAlertText}>
              Esta organización es partner de Vendix. El modo operativo está bloqueado y no puede modificarse.
            </Text>
          </View>
        ) : null}

        {/* Segmented cards STORE / ORGANIZATION */}
        <View style={styles.scopeRow}>
          <ScopeCard
            value="STORE"
            label={scopeShortLabel('STORE')}
            description={scopeDescription('STORE')}
            icon="store"
            active={current === 'STORE'}
            disabled={isPartner || !editable}
          />
          <ScopeCard
            value="ORGANIZATION"
            label={scopeShortLabel('ORGANIZATION')}
            description={scopeDescription('ORGANIZATION')}
            icon="building-2"
            active={current === 'ORGANIZATION'}
            disabled={isPartner || !editable}
          />
        </View>

        {/* Action button */}
        <View style={styles.actions}>
          <Button
            title={
              isPartner
                ? 'Modo bloqueado (Partner)'
                : !editable
                  ? 'Modo no editable'
                  : 'Cambiar modo operativo'
            }
            onPress={() => openWizardFor(targetForWizard)}
            disabled={isPartner || !editable}
            fullWidth
          />
        </View>

        {/* Audit log */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Icon name="history" size={14} color={colorScales.gray[500]} />
            <Text style={styles.sectionTitle}>Historial de cambios</Text>
          </View>

          {auditLog.length === 0 ? (
            <View style={styles.emptyAudit}>
              <Icon name="history" size={20} color={colorScales.gray[400]} />
              <Text style={styles.emptyAuditText}>
                Aún no hay cambios registrados en el modo operativo.
              </Text>
            </View>
          ) : (
            <View style={styles.auditList}>
              {auditLog.map((entry: OperatingScopeAuditLogEntry, idx) => (
                <View
                  key={entry.id}
                  style={[
                    styles.auditItem,
                    idx < auditLog.length - 1 && styles.auditItemBorder,
                  ]}
                >
                  <View style={styles.auditHeader}>
                    <OrgBadge
                      label={scopeShortLabel(entry.new_value)}
                      variant={entry.new_value === 'ORGANIZATION' ? 'primary' : 'info'}
                    />
                    {entry.previous_value ? (
                      <Text style={styles.auditPrev}>
                        antes: {scopeShortLabel(entry.previous_value)}
                      </Text>
                    ) : (
                      <Text style={styles.auditPrev}>creación inicial</Text>
                    )}
                  </View>
                  <View style={styles.auditCard}>
                    <OrgDetailRow
                      icon="calendar"
                      label="Fecha"
                      value={formatAuditDate(entry.changed_at)}
                    />
                    {entry.reason ? (
                      <OrgDetailRow
                        icon="message-square"
                        label="Razón"
                        value={entry.reason}
                      />
                    ) : null}
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>

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

// ----------------------------------------------------------------------------
// Sub-components
// ----------------------------------------------------------------------------

interface ScopeCardProps {
  value: OperatingScopeValue;
  label: string;
  description: string;
  icon: string;
  active: boolean;
  disabled: boolean;
}

function ScopeCard({ value, label, description, icon, active, disabled }: ScopeCardProps) {
  return (
    <Pressable
      style={[
        styles.scopeCard,
        active && styles.scopeCardActive,
        disabled && styles.scopeCardDisabled,
      ]}
      onPress={() => {
        // The pressable is informational; the actual change goes through the wizard button below.
        // Tapping an option does nothing by itself.
      }}
      disabled={disabled}
    >
      <View
        style={[
          styles.scopeIconWrap,
          active && styles.scopeIconWrapActive,
          disabled && styles.scopeIconWrapDisabled,
        ]}
      >
        <Icon
          name={icon}
          size={20}
          color={active ? colors.primary : disabled ? colorScales.gray[400] : colorScales.gray[500]}
        />
      </View>
      <Text
        style={[
          styles.scopeLabel,
          active && styles.scopeLabelActive,
          disabled && styles.scopeLabelDisabled,
        ]}
      >
        {label}
      </Text>
      <Text
        style={[
          styles.scopeDesc,
          disabled && styles.scopeDescDisabled,
        ]}
        numberOfLines={3}
      >
        {description}
      </Text>
      {active ? (
        <View style={styles.scopeBadgeWrap}>
          <OrgBadge label="Activo" variant="primary" />
        </View>
      ) : null}
    </Pressable>
  );
}

// ----------------------------------------------------------------------------
// Styles
// ----------------------------------------------------------------------------

const styles = StyleSheet.create({
  scrollContent: {
    padding: spacing[4],
  },

  // hero
  heroCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[3],
    backgroundColor: colorScales.gray[50],
    borderRadius: borderRadius.lg,
    padding: spacing[4],
    marginBottom: spacing[4],
    borderWidth: 1,
    borderColor: colorScales.gray[100],
  },
  heroIcon: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.md,
    backgroundColor: colorScales.green[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroBody: {
    flex: 1,
  },
  heroTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
    marginBottom: 2,
  },
  heroSubtitle: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[600],
    lineHeight: typography.lineHeight.normal * typography.fontSize.sm,
  },

  // partner lock
  partnerAlert: {
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
  partnerAlertText: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    color: colorScales.amber[700],
  },

  // scope segmented
  scopeRow: {
    flexDirection: 'row',
    gap: spacing[2],
    marginBottom: spacing[4],
  },
  scopeCard: {
    flex: 1,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: borderRadius.lg,
    padding: spacing[4],
    alignItems: 'center',
  },
  scopeCardActive: {
    borderColor: colors.primary,
    backgroundColor: colorScales.green[50],
  },
  scopeCardDisabled: {
    opacity: 0.5,
  },
  scopeIconWrap: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.md,
    backgroundColor: colorScales.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[2],
  },
  scopeIconWrapActive: {
    backgroundColor: colorScales.green[100],
  },
  scopeIconWrapDisabled: {
    backgroundColor: colorScales.gray[100],
  },
  scopeLabel: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[700],
    marginBottom: 4,
    textAlign: 'center',
  },
  scopeLabelActive: {
    color: colorScales.gray[900],
  },
  scopeLabelDisabled: {
    color: colorScales.gray[400],
  },
  scopeDesc: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
    textAlign: 'center',
    lineHeight: typography.lineHeight.normal * typography.fontSize.xs,
  },
  scopeDescDisabled: {
    color: colorScales.gray[400],
  },
  scopeBadgeWrap: {
    marginTop: spacing[3],
  },

  // action
  actions: {
    marginBottom: spacing[6],
  },

  // audit
  section: {
    marginTop: spacing[2],
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginBottom: spacing[3],
  },
  sectionTitle: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[500],
    textTransform: 'uppercase',
    letterSpacing: 0.4,
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
    backgroundColor: colors.card,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    overflow: 'hidden',
  },
  auditItem: {
    padding: spacing[3],
  },
  auditItemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  auditHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginBottom: spacing[2],
  },
  auditPrev: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
  },
  auditCard: {
    backgroundColor: colorScales.gray[50],
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing[3],
  },
});

// Export para reusar en otros lugares si se necesita
export { ActivityIndicator };