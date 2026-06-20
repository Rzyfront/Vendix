import { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  RefreshControl,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { OrgPaymentMethodsService } from '@/features/org/services/org-payment-methods.service';
import { OrgPageContainer } from '@/shared/components/org-page-container';
import { OrgBadge } from '@/shared/components/org-badge';
import { OrgStatsGrid } from '@/shared/components/org-stats-grid';
import { RowActionsMenu, type RowAction } from '@/shared/components/row-actions-menu/row-actions-menu';
import { OrgCenteredModal } from '@/shared/components/org-centered-modal';
import { Button } from '@/shared/components/button/button';
import { Input } from '@/shared/components/input/input';
import { Icon } from '@/shared/components/icon/icon';
import { ConfirmDialog } from '@/shared/components/confirm-dialog/confirm-dialog';
import { toastError, toastSuccess } from '@/shared/components/toast/toast.store';
import { ApiError } from '@/core/api/errors';
import {
  paymentStateBadge,
  formatAmountRange,
  summarizePaymentStats,
} from '@/features/org/components/config-formatters';
import {
  colors,
  colorScales,
  spacing,
  typography,
  borderRadius,
} from '@/shared/theme';
import type {
  StorePaymentMethod,
  SystemPaymentMethod,
} from '@/core/models/org-admin/config.types';

/**
 * Configuración · Métodos de Pago (paridad visual con web).
 *
 * Espejo 1:1 de `apps/frontend/.../config/payment-methods/payment-methods.component.html`.
 *
 * ⚠️ KNOWN ISSUE: endpoints `/store/payment-methods/*` son store-scoped;
 * un token ORG_ADMIN recibe 403. Se replica la UI web tal cual y se muestra
 * el 403 al usuario (paridad visual).
 */
export default function PaymentMethodsScreen() {
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editingMethod, setEditingMethod] = useState<StorePaymentMethod | null>(null);
  const [deletingMethod, setDeletingMethod] = useState<StorePaymentMethod | null>(null);

  const list = useQuery({
    queryKey: ['org-payment-methods-list'],
    queryFn: () => OrgPaymentMethodsService.list(),
    staleTime: 30_000,
  });

  const available = useQuery({
    queryKey: ['org-payment-methods-available'],
    queryFn: () => OrgPaymentMethodsService.listAvailable(),
    staleTime: 60_000,
  });

  const stats = useQuery({
    queryKey: ['org-payment-methods-stats'],
    queryFn: () => OrgPaymentMethodsService.getStats(),
    staleTime: 30_000,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['org-payment-methods-list'] });
    queryClient.invalidateQueries({ queryKey: ['org-payment-methods-stats'] });
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([list.refetch(), available.refetch(), stats.refetch()]);
    setRefreshing(false);
  };

  const isForbidden = (err: unknown): boolean =>
    err instanceof ApiError && (err.statusCode === 403 || err.statusCode === 404);

  const listForbidden = list.error && isForbidden(list.error);
  const availableForbidden = available.error && isForbidden(available.error);
  const statsForbidden = stats.error && isForbidden(stats.error);

  if (list.isLoading && !list.data) {
    return <OrgPageContainer loading>{null}</OrgPageContainer>;
  }

  const items: StorePaymentMethod[] = list.data ?? [];
  const summary = stats.data
    ? summarizePaymentStats(stats.data)
    : { total: items.length, enabled: 0, disabled: 0, requiresConfig: 0 };

  return (
    <OrgPageContainer refreshing={refreshing} onRefresh={onRefresh} padding={false}>
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
        {/* Hero */}
        <View style={styles.heroCard}>
          <View style={styles.heroIcon}>
            <Icon name="credit-card" size={22} color={colors.primary} />
          </View>
          <View style={styles.heroBody}>
            <Text style={styles.heroTitle}>Métodos de pago</Text>
            <Text style={styles.heroSubtitle}>
              Habilita y configura los medios de pago disponibles para las tiendas de tu organización.
            </Text>
          </View>
        </View>

        {/* Forbidden banner (ORG_ADMIN scope issue) */}
        {listForbidden || availableForbidden || statsForbidden ? (
          <View style={styles.alert}>
            <Icon name="alert-triangle" size={16} color={colorScales.amber[700]} />
            <Text style={styles.alertText}>
              Esta vista aún no es accesible desde la cuenta de organización (token ORG_ADMIN).
              Se replica la UI web para paridad visual — el backend responde 403/404 hasta que
              se cree el equivalente bajo <Text style={styles.code}>/organization/payment-methods/*</Text>.
            </Text>
          </View>
        ) : null}

        {/* Stats grid */}
        <OrgStatsGrid
          layout="grid"
          columns={2}
          stats={[
            { label: 'Total', value: summary.total, icon: 'wallet', color: colors.primary },
            { label: 'Activos', value: summary.enabled, icon: 'check-circle', color: colorScales.green[600] },
            { label: 'Desactivados', value: summary.disabled, icon: 'pause-circle', color: colorScales.gray[500] },
            { label: 'Por configurar', value: summary.requiresConfig, icon: 'alert-circle', color: colorScales.amber[600] },
          ]}
        />

        <View style={{ height: spacing[4] }} />

        {/* Add action */}
        <View style={styles.actions}>
          <Button
            title="Agregar método"
            onPress={() => setAddOpen(true)}
            leftIcon={<Icon name="plus" size={16} color="#ffffff" />}
            fullWidth
          />
        </View>

        {/* List */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Métodos configurados</Text>

          {items.length === 0 ? (
            <View style={styles.empty}>
              <Icon name="credit-card" size={28} color={colorScales.gray[400]} />
              <Text style={styles.emptyTitle}>Aún no hay métodos</Text>
              <Text style={styles.emptyText}>
                Agrega el primer método de pago para empezar a aceptar transacciones.
              </Text>
            </View>
          ) : (
            <View style={styles.list}>
              {items.map((m, idx) => (
                <PaymentMethodRow
                  key={m.id}
                  method={m}
                  isLast={idx === items.length - 1}
                  onEdit={() => setEditingMethod(m)}
                  onDelete={() => setDeletingMethod(m)}
                  onEnable={enableMutation(queryClient, m, invalidate)}
                  onDisable={disableMutation(queryClient, m, invalidate)}
                />
              ))}
            </View>
          )}
        </View>

        <View style={{ height: spacing[12] }} />
      </ScrollView>

      {/* Add modal */}
      <AddPaymentMethodModal
        visible={addOpen}
        available={available.data ?? []}
        onClose={() => setAddOpen(false)}
        onSuccess={() => {
          setAddOpen(false);
          invalidate();
        }}
      />

      {/* Edit modal */}
      <EditPaymentMethodModal
        visible={!!editingMethod}
        method={editingMethod}
        onClose={() => setEditingMethod(null)}
        onSuccess={() => {
          setEditingMethod(null);
          invalidate();
        }}
      />

      {/* Delete confirm */}
      <ConfirmDialog
        visible={!!deletingMethod}
        title="Eliminar método"
        message={
          deletingMethod
            ? `¿Seguro que quieres eliminar "${deletingMethod.display_name}"? Esta acción no se puede deshacer.`
            : ''
        }
        confirmLabel="Eliminar"
        destructive
        onClose={() => setDeletingMethod(null)}
        onConfirm={deleteMutation(queryClient, deletingMethod, () => {
          setDeletingMethod(null);
          invalidate();
        })}
      />
    </OrgPageContainer>
  );
}

// ----------------------------------------------------------------------------
// Row
// ----------------------------------------------------------------------------

interface PaymentMethodRowProps {
  method: StorePaymentMethod;
  isLast: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onEnable: () => void;
  onDisable: () => void;
}

function PaymentMethodRow({ method, isLast, onEdit, onDelete, onEnable, onDisable }: PaymentMethodRowProps) {
  const badge = paymentStateBadge(method.state);
  const isEnabled = method.state === 'enabled';

  const actions: RowAction[] = [
    {
      key: 'edit',
      label: 'Editar',
      icon: 'edit-2',
      variant: 'default',
      onPress: onEdit,
    },
    ...(isEnabled
      ? [
          {
            key: 'disable',
            label: 'Desactivar',
            icon: 'pause',
            variant: 'warning' as const,
            onPress: onDisable,
          },
        ]
      : [
          {
            key: 'enable',
            label: 'Activar',
            icon: 'play',
            variant: 'primary' as const,
            onPress: onEnable,
          },
        ]),
    {
      key: 'delete',
      label: 'Eliminar',
      icon: 'trash-2',
      variant: 'danger',
      destructive: true,
      onPress: onDelete,
    },
  ];

  return (
    <View style={[rowStyles.row, !isLast && rowStyles.rowBorder]}>
      <View style={rowStyles.left}>
        <View
          style={[
            rowStyles.icon,
            {
              backgroundColor: isEnabled ? colorScales.green[100] : colorScales.gray[100],
            },
          ]}
        >
          <Icon
            name="credit-card"
            size={18}
            color={isEnabled ? colorScales.green[700] : colorScales.gray[500]}
          />
        </View>
        <View style={rowStyles.body}>
          <Text style={rowStyles.name} numberOfLines={1}>
            {method.display_name}
          </Text>
          <Text style={rowStyles.meta} numberOfLines={1}>
            {formatAmountRange(method)}
          </Text>
        </View>
      </View>

      <View style={rowStyles.right}>
        <OrgBadge label={badge.label} variant={badge.variant} />
        <View style={{ width: spacing[2] }} />
        <RowActionsMenu actions={actions} />
      </View>
    </View>
  );
}

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing[3],
    backgroundColor: colors.card,
  },
  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    flex: 1,
    minWidth: 0,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[900],
    marginBottom: 2,
  },
  meta: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});

// ----------------------------------------------------------------------------
// Mutations (closures que devuelven handlers — aislado para limpieza)
// ----------------------------------------------------------------------------

function enableMutation(
  _qc: ReturnType<typeof useQueryClient>,
  method: StorePaymentMethod,
  onSuccess: () => void,
) {
  return () => {
    OrgPaymentMethodsService.enable(method.id)
      .then(() => {
        toastSuccess('Método activado');
        onSuccess();
      })
      .catch((e: unknown) => toastError(e instanceof ApiError ? e.message : 'No se pudo activar'));
  };
}

function disableMutation(
  _qc: ReturnType<typeof useQueryClient>,
  method: StorePaymentMethod,
  onSuccess: () => void,
) {
  return () => {
    OrgPaymentMethodsService.disable(method.id)
      .then(() => {
        toastSuccess('Método desactivado');
        onSuccess();
      })
      .catch((e: unknown) => toastError(e instanceof ApiError ? e.message : 'No se pudo desactivar'));
  };
}

function deleteMutation(
  _qc: ReturnType<typeof useQueryClient>,
  method: StorePaymentMethod | null,
  onSuccess: () => void,
) {
  return () => {
    if (!method) return;
    OrgPaymentMethodsService.remove(method.id)
      .then(() => {
        toastSuccess('Método eliminado');
        onSuccess();
      })
      .catch((e: unknown) => toastError(e instanceof ApiError ? e.message : 'No se pudo eliminar'));
  };
}

// ----------------------------------------------------------------------------
// Add modal
// ----------------------------------------------------------------------------

interface AddPaymentMethodModalProps {
  visible: boolean;
  available: SystemPaymentMethod[];
  onClose: () => void;
  onSuccess: () => void;
}

function AddPaymentMethodModal({ visible, available, onClose, onSuccess }: AddPaymentMethodModalProps) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [displayName, setDisplayName] = useState('');

  const mutation = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      OrgPaymentMethodsService.enableSystem(id, name ? { display_name: name } : {}),
    onSuccess: () => {
      toastSuccess('Método agregado');
      setSelectedId(null);
      setDisplayName('');
      onSuccess();
    },
    onError: (e: unknown) => toastError(e instanceof ApiError ? e.message : 'No se pudo agregar el método'),
  });

  return (
    <OrgCenteredModal
      visible={visible}
      onClose={onClose}
      title="Agregar método de pago"
      subtitle="Selecciona un método del sistema y personaliza su nombre visible."
      size="md"
      footer={
        <View style={modalStyles.footer}>
          <Button
            title="Cancelar"
            variant="outline"
            onPress={onClose}
            style={modalStyles.footerBtn}
          />
          <Button
            title="Agregar"
            onPress={() => selectedId != null && mutation.mutate({ id: selectedId, name: displayName.trim() })}
            disabled={selectedId == null}
            loading={mutation.isPending}
            style={modalStyles.footerBtn}
          />
        </View>
      }
    >
      <Text style={modalStyles.sectionLabel}>Métodos disponibles</Text>
      {available.length === 0 ? (
        <View style={modalStyles.emptyMini}>
          <Icon name="info" size={16} color={colorScales.gray[400]} />
          <Text style={modalStyles.emptyMiniText}>No hay métodos del sistema para mostrar.</Text>
        </View>
      ) : (
        <View style={modalStyles.list}>
          {available.map((sys, idx) => (
            <Pressable
              key={sys.id}
              style={[
                modalStyles.listItem,
                idx < available.length - 1 && modalStyles.listItemBorder,
                selectedId === sys.id && modalStyles.listItemActive,
              ]}
              onPress={() => setSelectedId(sys.id)}
            >
              <View style={modalStyles.listIcon}>
                <Icon name="credit-card" size={16} color={selectedId === sys.id ? colors.primary : colorScales.gray[500]} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={modalStyles.listTitle}>{sys.display_name || sys.name}</Text>
                <Text style={modalStyles.listSub}>{sys.provider}</Text>
              </View>
              {selectedId === sys.id ? (
                <Icon name="check" size={16} color={colors.primary} />
              ) : null}
            </Pressable>
          ))}
        </View>
      )}

      <View style={{ height: spacing[3] }} />
      <Input
        label="Nombre visible (opcional)"
        value={displayName}
        onChangeText={setDisplayName}
        placeholder="Ej. Tarjeta de crédito"
        autoCapitalize="sentences"
      />
    </OrgCenteredModal>
  );
}

// ----------------------------------------------------------------------------
// Edit modal
// ----------------------------------------------------------------------------

interface EditPaymentMethodModalProps {
  visible: boolean;
  method: StorePaymentMethod | null;
  onClose: () => void;
  onSuccess: () => void;
}

function EditPaymentMethodModal({ visible, method, onClose, onSuccess }: EditPaymentMethodModalProps) {
  const [displayName, setDisplayName] = useState(method?.display_name ?? '');

  // Reset form when target method changes
  useState(() => {
    if (method) setDisplayName(method.display_name);
  });

  const mutation = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      OrgPaymentMethodsService.update(id, { display_name: name }),
    onSuccess: () => {
      toastSuccess('Método actualizado');
      onSuccess();
    },
    onError: (e: unknown) => toastError(e instanceof ApiError ? e.message : 'No se pudo actualizar'),
  });

  return (
    <OrgCenteredModal
      visible={visible}
      onClose={onClose}
      title="Editar método"
      subtitle={method?.display_name ?? ''}
      size="md"
      footer={
        <View style={modalStyles.footer}>
          <Button title="Cancelar" variant="outline" onPress={onClose} style={modalStyles.footerBtn} />
          <Button
            title="Guardar"
            onPress={() => method && mutation.mutate({ id: method.id, name: displayName.trim() })}
            loading={mutation.isPending}
            style={modalStyles.footerBtn}
          />
        </View>
      }
    >
      <Input
        label="Nombre visible"
        value={displayName}
        onChangeText={setDisplayName}
        placeholder="Nombre del método"
        autoCapitalize="sentences"
      />
    </OrgCenteredModal>
  );
}

const modalStyles = StyleSheet.create({
  footer: {
    flexDirection: 'row',
    gap: spacing[2],
  },
  footerBtn: {
    flex: 1,
  },
  sectionLabel: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[500],
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: spacing[2],
  },
  emptyMini: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingVertical: spacing[3],
  },
  emptyMiniText: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
  },
  list: {
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    backgroundColor: colors.card,
    overflow: 'hidden',
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[3],
  },
  listItemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  listItemActive: {
    backgroundColor: colorScales.green[50],
  },
  listIcon: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.sm,
    backgroundColor: colorScales.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  listTitle: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[900],
    marginBottom: 2,
  },
  listSub: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
  },
});

// ----------------------------------------------------------------------------
// Page styles
// ----------------------------------------------------------------------------

const styles = StyleSheet.create({
  scrollContent: {
    padding: spacing[4],
  },
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

  alert: {
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
  alertText: {
    flex: 1,
    fontSize: typography.fontSize.xs,
    color: colorScales.amber[700],
    lineHeight: typography.lineHeight.normal * typography.fontSize.xs,
  },
  code: {
    fontFamily: 'monospace',
  },

  actions: {
    marginBottom: spacing[4],
  },

  section: {
    marginTop: spacing[2],
  },
  sectionTitle: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[500],
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: spacing[3],
  },

  empty: {
    alignItems: 'center',
    paddingVertical: spacing[10],
    gap: spacing[2],
    backgroundColor: colors.card,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
  },
  emptyTitle: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[700],
  },
  emptyText: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
    textAlign: 'center',
    paddingHorizontal: spacing[6],
    lineHeight: typography.lineHeight.normal * typography.fontSize.sm,
  },

  list: {
    backgroundColor: colors.card,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    overflow: 'hidden',
  },
});
