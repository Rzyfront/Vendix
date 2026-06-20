import { useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  Text,
  View,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { OrgAuditService } from '@/features/org/services/org-audit.service';
import { OrgStatsGrid } from '@/shared/components/org-stats-grid';
import { OrgListItem } from '@/shared/components/org-list-item';
import { OrgBadge } from '@/shared/components/org-badge';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { Modal } from '@/shared/components/modal/modal';
import { OrgDetailRow } from '@/shared/components/org-detail-row';
import {
  PaginationBar,
  SelectableFilterSheet,
} from '@/features/org/components/audit-shared';
import {
  RowActionsMenu,
  type RowAction,
} from '@/shared/components/row-actions-menu/row-actions-menu';
import { Icon } from '@/shared/components/icon/icon';
import { formatSessionUser, getDeviceIcon, isSessionActive } from '@/features/org/components/audit-formatters';
import type { ActiveSession } from '@/core/models/org-admin/audit.types';
import { borderRadius, colorScales, colors, spacing, typography } from '@/shared/theme';
import { toastError, toastSuccess } from '@/shared/components/toast/toast.store';

/**
 * Auditoría · Sesiones.
 *
 * Paridad con `sessions.component.ts` (web):
 *   - 3-stat grid (Total / Activas / Inactivas)
 *   - Filtro de estado (Todas / Activas / Inactivas)
 *   - Cards con badge de estado, dispositivo, IP, última actividad, expiración
 *   - Row action menu: Ver detalle / Terminar
 *   - Modal de detalle con Terminar Sesión (botón rojo)
 *   - Paginación manual
 */

const PAGE_SIZE = 10;

export default function SessionsScreen() {
  const queryClient = useQueryClient();

  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('all');
  const [page, setPage] = useState(1);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<ActiveSession | null>(null);
  const [pendingTerminate, setPendingTerminate] = useState<ActiveSession | null>(null);

  const queryParams = useMemo(
    () => ({
      page,
      limit: PAGE_SIZE,
      ...(status === 'active' || status === 'inactive' ? { status } : {}),
    }),
    [page, status],
  );

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['org-audit-sessions', queryParams],
    queryFn: () => OrgAuditService.listSessions(queryParams),
  });

  const sessions = data?.data ?? [];
  const total = data?.meta?.total ?? 0;
  const totalPages = data?.meta?.totalPages ?? Math.max(1, Math.ceil(total / PAGE_SIZE));
  const activeCount = sessions.filter((s) => isSessionActive(s)).length;

  const terminateMutation = useMutation({
    mutationFn: (id: string | number) => OrgAuditService.terminateSession(id),
    onSuccess: () => {
      toastSuccess('Sesión terminada');
      setPendingTerminate(null);
      setSelected(null);
      queryClient.invalidateQueries({ queryKey: ['org-audit-sessions'] });
    },
    onError: () => toastError('No se pudo terminar la sesión'),
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const rowActionsFor = (session: ActiveSession): RowAction[] => {
    const actions: RowAction[] = [
      {
        key: 'view',
        label: 'Ver detalle',
        icon: 'eye',
        variant: 'info',
        onPress: () => setSelected(session),
      },
    ];
    if (isSessionActive(session)) {
      actions.push({
        key: 'terminate',
        label: 'Terminar',
        icon: 'x-circle',
        variant: 'danger',
        destructive: true,
        onPress: () => setPendingTerminate(session),
      });
    }
    return actions;
  };

  return (
    <View style={styles.root}>
      <FlatList<ActiveSession>
        data={sessions}
        keyExtractor={(s) => String(s.id)}
        ListHeaderComponent={
          <ListHeader
            total={total}
            activeCount={activeCount}
            status={status}
            onStatusChange={(s) => {
              setStatus(s);
              setPage(1);
            }}
            onRefresh={onRefresh}
          />
        }
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.loading}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : (
            <EmptyState
              icon="monitor"
              title="Sin sesiones registradas"
              description="Las sesiones de usuarios aparecerán aquí cuando inicien sesión."
            />
          )
        }
        renderItem={({ item }) => {
          const active = isSessionActive(item);
          return (
            <View style={styles.rowWrap}>
              <OrgListItem
                title={formatSessionUser(item)}
                subtitle={[
                  getDeviceIcon(item.device) === 'smartphone' ? 'Móvil' : 'Escritorio',
                  item.location ?? item.ip_address,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                description={`Activa: ${new Date(
                  item.last_active_at ?? item.last_activity ?? item.created_at,
                ).toLocaleString()}`}
                leftIcon={getDeviceIcon(item.device)}
                leftIconColor={active ? colorScales.green[500] : colorScales.gray[400]}
                rightBadge={
                  item.is_current
                    ? { label: 'Actual', variant: 'primary' }
                    : active
                      ? { label: 'Activa', variant: 'success' }
                      : { label: 'Inactiva', variant: 'muted' }
                }
                rightMeta={new Date(item.expires_at).toLocaleDateString()}
                onPress={() => setSelected(item)}
                chevron={false}
              />
              <View style={styles.rowActions}>
                <RowActionsMenu
                  actions={rowActionsFor(item)}
                  accessibilityLabel={`Acciones de sesión ${formatSessionUser(item)}`}
                />
              </View>
            </View>
          );
        }}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListFooterComponent={
          <PaginationBar
            page={page}
            totalPages={totalPages}
            total={total}
            onChange={(p) => setPage(p)}
          />
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        contentContainerStyle={styles.listContent}
      />

      {/* Detail modal */}
      <Modal
        visible={!!selected}
        onClose={() => setSelected(null)}
        title="Detalle de sesión"
        showFooter={isSessionActive(selected ?? undefined as any)}
        footer={
          selected && isSessionActive(selected) ? (
            <View style={styles.modalActions}>
              <Pressable
                style={[styles.modalBtn, styles.modalBtnSecondary]}
                onPress={() => setSelected(null)}
              >
                <Text style={styles.modalBtnSecondaryText}>Cerrar</Text>
              </Pressable>
              <Pressable
                style={[styles.modalBtn, styles.modalBtnDanger]}
                onPress={() => setPendingTerminate(selected)}
              >
                <Text style={styles.modalBtnDangerText}>Terminar sesión</Text>
              </Pressable>
            </View>
          ) : null
        }
      >
        {selected ? (
          <View>
            <View style={styles.detailHero}>
              <View
                style={[
                  styles.detailHeroIcon,
                  {
                    backgroundColor:
                      (isSessionActive(selected) ? colorScales.green[100] : colorScales.gray[100]),
                  },
                ]}
              >
                <Icon
                  name={getDeviceIcon(selected.device)}
                  size={22}
                  color={isSessionActive(selected) ? colorScales.green[700] : colorScales.gray[500]}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.detailHeroTitle}>{formatSessionUser(selected)}</Text>
                <View style={{ marginTop: 4 }}>
                  <OrgBadge
                    label={
                      selected.is_current
                        ? 'Actual'
                        : isSessionActive(selected)
                          ? 'Activa'
                          : 'Inactiva'
                    }
                    variant={
                      selected.is_current
                        ? 'primary'
                        : isSessionActive(selected)
                          ? 'success'
                          : 'muted'
                    }
                  />
                </View>
              </View>
            </View>

            <View style={styles.card}>
              <OrgDetailRow icon="user" label="Usuario" value={formatSessionUser(selected)} />
              {selected.users?.email ? (
                <OrgDetailRow icon="mail" label="Email" value={selected.users.email} />
              ) : null}
              <OrgDetailRow
                icon="globe"
                label="IP"
                value={selected.ip_address ?? 'N/A'}
                monospace
              />
              <OrgDetailRow
                icon="monitor"
                label="Dispositivo"
                value={selected.device ?? selected.user_agent ?? 'N/A'}
              />
              <OrgDetailRow
                icon="map-pin"
                label="Ubicación"
                value={selected.location ?? 'N/A'}
              />
              <OrgDetailRow
                icon="clock"
                label="Última actividad"
                value={
                  selected.last_active_at
                    ? new Date(selected.last_active_at).toLocaleString()
                    : selected.last_activity
                      ? new Date(selected.last_activity).toLocaleString()
                      : 'N/A'
                }
              />
              <OrgDetailRow
                icon="calendar"
                label="Creada"
                value={new Date(selected.created_at).toLocaleString()}
              />
              <OrgDetailRow
                icon="hourglass"
                label="Expira"
                value={new Date(selected.expires_at).toLocaleString()}
              />
            </View>
          </View>
        ) : null}
      </Modal>

      {/* Confirm terminate */}
      <Modal
        visible={!!pendingTerminate}
        onClose={() => !terminateMutation.isPending && setPendingTerminate(null)}
        title="Terminar sesión"
        showFooter
      >
        <Text style={styles.confirmText}>
          ¿Terminar la sesión de {pendingTerminate ? formatSessionUser(pendingTerminate) : ''}?
        </Text>
        <Text style={styles.confirmHint}>
          El usuario será desconectado y deberá volver a iniciar sesión.
        </Text>
        <View style={styles.modalActions}>
          <Pressable
            style={[styles.modalBtn, styles.modalBtnSecondary]}
            disabled={terminateMutation.isPending}
            onPress={() => setPendingTerminate(null)}
          >
            <Text style={styles.modalBtnSecondaryText}>Cancelar</Text>
          </Pressable>
          <Pressable
            style={[styles.modalBtn, styles.modalBtnDanger, terminateMutation.isPending && styles.modalBtnDisabled]}
            disabled={terminateMutation.isPending}
            onPress={() => pendingTerminate && terminateMutation.mutate(pendingTerminate.id)}
          >
            <Text style={styles.modalBtnDangerText}>
              {terminateMutation.isPending ? 'Terminando…' : 'Sí, terminar'}
            </Text>
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Header
// ─────────────────────────────────────────────────────────────────────────────

interface ListHeaderProps {
  total: number;
  activeCount: number;
  status: 'all' | 'active' | 'inactive';
  onStatusChange: (s: 'all' | 'active' | 'inactive') => void;
  onRefresh: () => void;
}

function ListHeader({ total, activeCount, status, onStatusChange, onRefresh }: ListHeaderProps) {
  return (
    <View>
      <View style={styles.statsWrap}>
        <OrgStatsGrid
          columns={3}
          stats={[
            {
              label: 'Total Sesiones',
              value: total,
              icon: 'monitor',
              color: colorScales.blue[600],
              subText: 'sesiones registradas',
            },
            {
              label: 'Activas',
              value: activeCount,
              icon: 'check-circle',
              color: colorScales.green[600],
              subText: 'sesiones activas',
            },
            {
              label: 'Inactivas',
              value: Math.max(total - activeCount, 0),
              icon: 'x-circle',
              color: colorScales.red[600],
              subText: 'sesiones terminadas',
            },
          ]}
        />
      </View>

      <View style={styles.titleRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.titleMain}>Sesiones</Text>
          <Text style={styles.titleCount}>{total} registradas</Text>
        </View>
        <RowActionsMenu
          actions={[
            {
              key: 'refresh',
              label: 'Actualizar',
              icon: 'refresh-cw',
              variant: 'default',
              onPress: onRefresh,
            },
          ]}
          accessibilityLabel="Acciones de sesiones"
        />
      </View>

      <View style={styles.quickFilters}>
        <Pressable
          style={[styles.quickBtn, status === 'all' && styles.quickBtnActive]}
          onPress={() => onStatusChange('all')}
        >
          <Text style={[styles.quickBtnText, status === 'all' && styles.quickBtnTextActive]}>
            Todas
          </Text>
        </Pressable>
        <Pressable
          style={[styles.quickBtn, status === 'active' && styles.quickBtnActive]}
          onPress={() => onStatusChange('active')}
        >
          <Icon name="check-circle" size={14} color={status === 'active' ? '#FFFFFF' : colorScales.green[600]} />
          <Text style={[styles.quickBtnText, status === 'active' && styles.quickBtnTextActive]}>
            Activas
          </Text>
        </Pressable>
        <Pressable
          style={[styles.quickBtn, status === 'inactive' && styles.quickBtnActive]}
          onPress={() => onStatusChange('inactive')}
        >
          <Icon name="x-circle" size={14} color={status === 'inactive' ? '#FFFFFF' : colorScales.red[600]} />
          <Text style={[styles.quickBtnText, status === 'inactive' && styles.quickBtnTextActive]}>
            Inactivas
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Estilos
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colorScales.gray[50] },
  loading: { paddingVertical: spacing[12], alignItems: 'center' },
  statsWrap: { marginBottom: spacing[3] },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[1],
    marginBottom: spacing[3],
  },
  titleMain: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
  },
  titleCount: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
    marginTop: 2,
  },
  quickFilters: {
    flexDirection: 'row',
    gap: spacing[2],
    marginBottom: spacing[3],
  },
  quickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    backgroundColor: colors.background,
  },
  quickBtnActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  quickBtnText: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[700],
    fontWeight: typography.fontWeight.medium,
  },
  quickBtnTextActive: {
    color: '#FFFFFF',
    fontWeight: typography.fontWeight.semibold,
  },
  rowWrap: {
    position: 'relative',
  },
  rowActions: {
    position: 'absolute',
    right: spacing[4],
    top: spacing[2],
  },
  listContent: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[2],
    paddingBottom: spacing[24],
  },
  separator: { height: spacing[1] },
  detailHero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    marginBottom: spacing[4],
  },
  detailHeroIcon: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailHeroTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
  },
  card: {
    backgroundColor: colorScales.gray[50],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[100],
    paddingHorizontal: spacing[3],
  },
  modalActions: {
    flexDirection: 'row',
    gap: spacing[2],
    paddingTop: spacing[4],
  },
  modalBtn: {
    flex: 1,
    height: 44,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBtnPrimary: { backgroundColor: colors.primary },
  modalBtnPrimaryText: { color: '#FFFFFF', fontWeight: typography.fontWeight.semibold },
  modalBtnSecondary: { backgroundColor: colorScales.gray[100] },
  modalBtnSecondaryText: { color: colorScales.gray[700], fontWeight: typography.fontWeight.semibold },
  modalBtnDanger: { backgroundColor: colorScales.red[600] },
  modalBtnDangerText: { color: '#FFFFFF', fontWeight: typography.fontWeight.semibold },
  modalBtnDisabled: { opacity: 0.6 },
  confirmText: {
    fontSize: typography.fontSize.base,
    color: colorScales.gray[800],
    marginBottom: spacing[2],
  },
  confirmHint: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
    marginBottom: spacing[4],
  },
});
