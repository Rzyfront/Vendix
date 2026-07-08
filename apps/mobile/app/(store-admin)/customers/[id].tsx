import { useState, useMemo } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, TextInput } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CustomerService } from '@/features/store/services/customer.service';
import { CustomerHistoryService } from '@/features/store/services/customer-history.service';
import { MetadataService } from '@/features/store/services/metadata.service';
import { MembershipService } from '@/features/store/services/membership.service';
import type { CustomerWithWallet, CustomerState } from '@/features/store/types';
import { formatCurrency } from '@/shared/utils/currency';
import { formatRelative, formatDate } from '@/shared/utils/date';
import { Avatar } from '@/shared/components/avatar/avatar';
import { Icon } from '@/shared/components/icon/icon';
import { Badge } from '@/shared/components/badge/badge';
import { Button } from '@/shared/components/button/button';
import { Spinner } from '@/shared/components/spinner/spinner';
import { ConfirmDialog } from '@/shared/components/confirm-dialog/confirm-dialog';
import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';
import { spacing, borderRadius, typography, colorScales, colors } from '@/shared/theme';

type TxType = 'topup' | 'payment' | 'adjustment' | 'refund';

const STATE_LABELS: Record<CustomerState, string> = {
  active: 'Activo',
  inactive: 'Inactivo',
};

const STATE_COLORS: Record<CustomerState, 'success' | 'error'> = {
  active: 'success',
  inactive: 'error',
};

const TX_LABELS: Record<string, string> = {
  topup: 'Recarga',
  payment: 'Pago / Débito',
  adjustment: 'Ajuste',
  refund: 'Reembolso',
};

const TX_DIRECTION: Record<string, 'credit' | 'debit'> = {
  topup: 'credit',
  payment: 'debit',
  adjustment: 'debit',
  refund: 'credit',
};

export default function CustomerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [topupAmount, setTopupAmount] = useState('');
  const [topupDescription, setTopupDescription] = useState('');
  const [topupPaymentMethod, setTopupPaymentMethod] = useState<'cash' | 'bank_transfer'>('cash');
  const [showTopupForm, setShowTopupForm] = useState(false);
  const [showAdjustForm, setShowAdjustForm] = useState(false);
  const [adjustType, setAdjustType] = useState<'credit' | 'debit'>('credit');
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const [adjustReference, setAdjustReference] = useState('');
  const [showTxFilters, setShowTxFilters] = useState(false);
  const [txFilterType, setTxFilterType] = useState('');

  const { data: customer, isLoading } = useQuery({
    queryKey: ['customer', id],
    queryFn: () => CustomerService.getById(id!),
    enabled: !!id,
  });

  const deleteMutation = useMutation({
    mutationFn: () => CustomerService.delete(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['customer-stats'] });
      toastSuccess('Cliente eliminado');
      router.back();
    },
    onError: () => toastError('Error al eliminar el cliente'),
  });

  const toggleStateMutation = useMutation({
    mutationFn: () =>
      CustomerService.update(id!, {
        state: customer?.state === 'active' ? 'inactive' : 'active',
      } as any),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer', id] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      toastSuccess('Estado actualizado');
    },
    onError: () => toastError('Error al actualizar el estado'),
  });

  const topupMutation = useMutation({
    mutationFn: (payload: { amount: number; description: string; payment_method: string }) =>
      CustomerService.topup(id!, payload.amount, payload.description, payload.payment_method),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer', id] });
      setTopupAmount('');
      setTopupDescription('');
      setTopupPaymentMethod('cash');
      setShowTopupForm(false);
      toastSuccess('Billetera recargada');
    },
    onError: () => toastError('Error al recargar la billetera'),
  });

  const adjustMutation = useMutation({
    mutationFn: (payload: { type: 'credit' | 'debit'; amount: number; reason: string; reference?: string }) =>
      CustomerService.adjust(id!, payload.type, payload.amount, payload.reason, payload.reference),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer', id] });
      setAdjustAmount('');
      setAdjustReason('');
      setAdjustReference('');
      setAdjustType('credit');
      setShowAdjustForm(false);
      toastSuccess('Ajuste realizado correctamente');
    },
    onError: () => toastError('Error al realizar el ajuste'),
  });

  const handleTopup = () => {
    const amount = parseFloat(topupAmount);
    if (isNaN(amount) || amount <= 0) {
      toastError('Ingresa un monto válido');
      return;
    }
    topupMutation.mutate({ amount, description: topupDescription, payment_method: topupPaymentMethod });
  };

  const handleAdjust = () => {
    const amount = parseFloat(adjustAmount);
    if (isNaN(amount) || amount <= 0) {
      toastError('Ingresa un monto válido');
      return;
    }
    if (!adjustReason.trim()) {
      toastError('La razón es obligatoria');
      return;
    }
    adjustMutation.mutate({ type: adjustType, amount, reason: adjustReason.trim(), reference: adjustReference.trim() || undefined });
  };

  // History (consultation timeline)
  const { data: historyContext } = useQuery({
    queryKey: ['customer-history', id],
    queryFn: () => CustomerHistoryService.getContext(id!),
    enabled: !!id,
  });

  // Membership profile
  const { data: membershipProfile } = useQuery({
    queryKey: ['customer-membership', id],
    queryFn: () => MembershipService.getProfile(id!),
    enabled: !!id,
  });

  // Metadata values for this customer
  const { data: metadataValues } = useQuery({
    queryKey: ['customer-metadata', id],
    queryFn: () => MetadataService.getValues('customer', id!),
    enabled: !!id,
  });

  if (isLoading || !customer) {
    return (
      <View style={styles.loadingContainer}>
        <Spinner />
      </View>
    );
  }

  const fullName = `${customer.first_name} ${customer.last_name}`;
  const hasWallet = customer.wallet_balance !== undefined;
  const walletBalance = customer.wallet_balance ?? 0;
  const walletHeld = customer.wallet_held ?? 0;
  const walletAvailable = walletBalance - walletHeld;
  const orders = Number(customer.total_orders ?? 0);
  const avgTicket = orders > 0 ? (customer.total_spent ?? 0) / orders : 0;

  const filteredTx = useMemo(() => {
    if (!txFilterType) return customer.wallet_transactions || [];
    return (customer.wallet_transactions || []).filter((tx) => tx.type === txFilterType);
  }, [customer.wallet_transactions, txFilterType]);

  const txFilterOptions = [
    { value: '', label: 'Todos' },
    { value: 'topup', label: 'Recargas' },
    { value: 'payment', label: 'Débitos' },
    { value: 'adjustment', label: 'Ajustes' },
    { value: 'refund', label: 'Reembolsos' },
  ];

  return (
    <View style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.stickyHeader}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Icon name="arrow-left" size={20} color={colorScales.gray[700]} />
          </Pressable>
          <View style={styles.stickyHeaderInfo}>
            <Text style={styles.stickyHeaderTitle}>Detalle del Cliente</Text>
            <View style={styles.stickyHeaderSub}>
              <Icon name="user" size={14} color={colorScales.gray[400]} />
              <Text style={styles.stickyHeaderName}>{fullName}</Text>
            </View>
          </View>
          <Badge
            label={STATE_LABELS[customer.state]}
            variant={STATE_COLORS[customer.state]}
          />
        </View>

        <View style={styles.infoCard}>
          <View style={styles.avatarRow}>
            <View style={styles.avatarContainer}>
              <Avatar name={fullName} size="lg" />
            </View>
            <View style={styles.avatarInfo}>
              <Text style={styles.customerName}>{fullName}</Text>
              <View style={styles.contactRow}>
                <Icon name="mail" size={14} color={colorScales.gray[400]} />
                <Text style={styles.contactText}>{customer.email}</Text>
              </View>
              {customer.phone && (
                <View style={styles.contactRow}>
                  <Icon name="phone" size={14} color={colorScales.gray[400]} />
                  <Text style={styles.contactText}>{customer.phone}</Text>
                </View>
              )}
            </View>
          </View>
          <View style={styles.statsDivider} />
          <View style={styles.statsGrid}>
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>Documento</Text>
              <Text style={styles.statValue}>
                {customer.document_number || 'No registrado'}
              </Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>Cliente desde</Text>
              <Text style={styles.statValue}>{formatRelative(customer.created_at)}</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>Última compra</Text>
              <Text style={styles.statValue}>
                {customer.last_purchase_at ? formatRelative(customer.last_purchase_at) : 'Sin compras'}
              </Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>Órdenes</Text>
              <Text style={styles.statValue}>{orders}</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>Gasto total</Text>
              <Text style={styles.statValue}>{formatCurrency(customer.total_spent ?? 0)}</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>Ticket promedio</Text>
              <Text style={styles.statValue}>{formatCurrency(avgTicket)}</Text>
            </View>
          </View>
        </View>

        {/* Consultation History — booking timeline */}
        {(historyContext?.recent_bookings?.length ?? 0) > 0 && (
          <View style={styles.historyCard}>
            <View style={styles.historyHeader}>
              <Icon name="clipboard-list" size={18} color={colors.primary} />
              <Text style={styles.historyTitle}>Historial de Consultas</Text>
            </View>
            {historyContext?.recent_bookings?.slice(0, 5).map((booking) => (
              <View key={booking.id} style={styles.historyItem}>
                <View style={styles.historyItemLeft}>
                  <Badge
                    label={booking.state === 'finished' ? 'Completada' : booking.state === 'cancelled' ? 'Cancelada' : booking.state}
                    variant={booking.state === 'finished' ? 'success' : booking.state === 'cancelled' ? 'error' : 'neutral'}
                    size="xsm"
                  />
                  {booking.intake_submission_status && (
                    <Badge label="Formulario" variant="info" size="xsm" />
                  )}
                  {booking.has_snapshot && (
                    <Badge label="Prediagnóstico" variant="warning" size="xsm" />
                  )}
                  {(booking.notes_count ?? 0) > 0 && (
                    <Badge label={`${booking.notes_count} nota${booking.notes_count === 1 ? '' : 's'}`} variant="neutral" size="xsm" />
                  )}
                </View>
                <Text style={styles.historyItemDate}>
                  {formatDate(booking.created_at)}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Metadata / Ficha del Cliente */}
        {(metadataValues?.length ?? 0) > 0 && (
          <View style={styles.metadataCard}>
            <View style={styles.metadataHeader}>
              <Icon name="database" size={18} color={colors.primary} />
              <Text style={styles.metadataTitle}>Ficha del Cliente</Text>
            </View>
            <View style={styles.metadataGrid}>
              {metadataValues?.map((field) => (
                <View key={field.field_id} style={styles.metadataItem}>
                  <Text style={styles.metadataLabel}>{field.field_label}</Text>
                  <Text style={styles.metadataValue}>{field.value}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        <View style={styles.walletCard}>
          <View style={styles.walletHeader}>
            <View style={styles.walletHeaderLeft}>
              <Icon name="wallet" size={20} color={colors.primary} />
              <Text style={styles.walletTitle}>Wallet</Text>
            </View>
            {hasWallet && (
              <View style={styles.walletActions}>
                <Button
                  title={showAdjustForm ? 'Cancelar' : 'Ajustar'}
                  variant="outline"
                  size="sm"
                  onPress={() => {
                    setShowAdjustForm(!showAdjustForm);
                    setShowTopupForm(false);
                  }}
                />
                <Button
                  title={showTopupForm ? 'Cancelar' : 'Recargar'}
                  variant="primary"
                  size="sm"
                  onPress={() => {
                    setShowTopupForm(!showTopupForm);
                    setShowAdjustForm(false);
                  }}
                />
              </View>
            )}
          </View>

          {!hasWallet ? (
            <View style={styles.emptyWallet}>
              <Icon name="wallet" size={40} color={colorScales.gray[300]} />
              <Text style={styles.emptyWalletText}>Este cliente aún no tiene billetera.</Text>
              <Text style={styles.emptyWalletHint}>
                La billetera se creará automáticamente al realizar la primera recarga.
              </Text>
            </View>
          ) : (
          <>
          <View style={styles.balanceGrid}>
            <View style={styles.balanceBox}>
              <Text style={styles.balanceLabel}>Saldo disponible</Text>
              <Text style={[styles.balanceAmount, { color: colorScales.green[600] }]}>
                {formatCurrency(walletAvailable)}
              </Text>
            </View>
            <View style={styles.balanceBox}>
              <Text style={styles.balanceLabel}>Saldo retenido</Text>
              <Text style={[styles.balanceAmount, { color: colorScales.gray[500] }]}>
                {formatCurrency(walletHeld)}
              </Text>
            </View>
            <View style={styles.balanceBox}>
              <Text style={styles.balanceLabel}>Balance total</Text>
              <Text style={[styles.balanceAmount, { color: colorScales.gray[900] }]}>
                {formatCurrency(walletBalance)}
              </Text>
            </View>
          </View>

          {showTopupForm && (
            <View style={styles.walletForm}>
              <Text style={styles.walletFormTitle}>Recargar Wallet</Text>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Monto</Text>
                <TextInput
                  style={styles.formInput}
                  value={topupAmount}
                  onChangeText={setTopupAmount}
                  placeholder="0"
                  keyboardType="decimal-pad"
                  placeholderTextColor={colorScales.gray[400]}
                />
              </View>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Método de pago</Text>
                <View style={styles.pickerRow}>
                  {(['cash', 'bank_transfer'] as const).map((method) => (
                    <Pressable
                      key={method}
                      style={[
                        styles.pickerOption,
                        topupPaymentMethod === method && styles.pickerOptionActive,
                      ]}
                      onPress={() => setTopupPaymentMethod(method)}
                    >
                      <Text
                        style={[
                          styles.pickerOptionText,
                          topupPaymentMethod === method && styles.pickerOptionTextActive,
                        ]}
                      >
                        {method === 'cash' ? 'Efectivo' : 'Transferencia'}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Descripción</Text>
                <TextInput
                  style={styles.formInput}
                  value={topupDescription}
                  onChangeText={setTopupDescription}
                  placeholder="Ej: Recarga en tienda"
                  placeholderTextColor={colorScales.gray[400]}
                />
              </View>
              <View style={styles.formFooter}>
                <Button variant="ghost" size="sm" title="Cancelar" onPress={() => setShowTopupForm(false)} />
                <Button
                  variant="primary"
                  size="sm"
                  title="Recargar"
                  onPress={handleTopup}
                  loading={topupMutation.isPending}
                  disabled={!topupAmount}
                />
              </View>
            </View>
          )}

          {showAdjustForm && (
            <View style={styles.walletForm}>
              <Text style={styles.walletFormTitle}>Ajustar Wallet</Text>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Tipo</Text>
                <View style={styles.pickerRow}>
                  {(['credit', 'debit'] as const).map((type) => (
                    <Pressable
                      key={type}
                      style={[
                        styles.pickerOption,
                        adjustType === type && styles.pickerOptionActive,
                      ]}
                      onPress={() => setAdjustType(type)}
                    >
                      <Text
                        style={[
                          styles.pickerOptionText,
                          adjustType === type && styles.pickerOptionTextActive,
                        ]}
                      >
                        {type === 'credit' ? 'Crédito (abonar)' : 'Débito (descontar)'}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Monto</Text>
                <TextInput
                  style={styles.formInput}
                  value={adjustAmount}
                  onChangeText={setAdjustAmount}
                  placeholder="0"
                  keyboardType="decimal-pad"
                  placeholderTextColor={colorScales.gray[400]}
                />
              </View>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Razón</Text>
                <TextInput
                  style={styles.formInput}
                  value={adjustReason}
                  onChangeText={setAdjustReason}
                  placeholder="Ej: Corrección de saldo, bonificación..."
                  placeholderTextColor={colorScales.gray[400]}
                />
              </View>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Referencia (opcional)</Text>
                <TextInput
                  style={styles.formInput}
                  value={adjustReference}
                  onChangeText={setAdjustReference}
                  placeholder="Ej: Ticket #123"
                  placeholderTextColor={colorScales.gray[400]}
                />
              </View>
              <View style={styles.formFooter}>
                <Button variant="ghost" size="sm" title="Cancelar" onPress={() => setShowAdjustForm(false)} />
                <Button
                  variant={adjustType === 'debit' ? 'destructive' : 'primary'}
                  size="sm"
                  title={adjustType === 'debit' ? 'Debitar' : 'Acreditar'}
                  onPress={handleAdjust}
                  loading={adjustMutation.isPending}
                  disabled={!adjustAmount || !adjustReason}
                />
              </View>
            </View>
          )}

          <View style={styles.txSection}>
            <View style={styles.txHeader}>
              <Text style={styles.txTitle}>Historial de Movimientos</Text>
              <Pressable
                style={styles.txFilterBtn}
                onPress={() => setShowTxFilters(!showTxFilters)}
              >
                <Icon name="filter" size={14} color={colorScales.gray[600]} />
                <Text style={styles.txFilterBtnText}>Filtros</Text>
              </Pressable>
            </View>

            {showTxFilters && (
              <View style={styles.txFilterBar}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.txFilterOptions}>
                    {txFilterOptions.map((opt) => (
                      <Pressable
                        key={opt.value}
                        style={[
                          styles.txFilterChip,
                          txFilterType === opt.value && styles.txFilterChipActive,
                        ]}
                        onPress={() => setTxFilterType(opt.value)}
                      >
                        <Text
                          style={[
                            styles.txFilterChipText,
                            txFilterType === opt.value && styles.txFilterChipTextActive,
                          ]}
                        >
                          {opt.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>
              </View>
            )}

            {filteredTx.length === 0 && (
              <View style={styles.txEmpty}>
                <Icon name="inbox" size={32} color={colorScales.gray[300]} />
                <Text style={styles.txEmptyText}>No hay movimientos aún</Text>
              </View>
            )}

            {filteredTx.map((tx) => {
              const direction = TX_DIRECTION[tx.type] || 'debit';
              const isCredit = direction === 'credit';
              const circleBg = isCredit ? '#d1fae5' : '#fee2e2';
              const circleColor = isCredit ? '#059669' : '#dc2626';
              const prefix = isCredit ? '+' : '-';

              return (
                <View key={tx.id} style={styles.txItem}>
                  <View style={styles.txLeft}>
                    <View style={[styles.txCircle, { backgroundColor: circleBg }]}>
                      <Text style={[styles.txArrow, { color: circleColor }]}>
                        {isCredit ? '↓' : '↑'}
                      </Text>
                    </View>
                    <View style={styles.txInfo}>
                      <Text style={styles.txLabel}>{TX_LABELS[tx.type] || tx.type}</Text>
                      {tx.description ? (
                        <Text style={styles.txDesc}>{tx.description}</Text>
                      ) : null}
                    </View>
                  </View>
                  <View style={styles.txRight}>
                    <Text style={[styles.txAmount, { color: isCredit ? colorScales.green[600] : colorScales.red[600] }]}>
                      {prefix}{formatCurrency(Math.abs(tx.amount))}
                    </Text>
                    <Text style={styles.txDate}>{formatRelative(tx.created_at)}</Text>
                  </View>
                </View>
              );
            })}
          </View>
          </>
          )}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        {membershipProfile && (
          <Button
            title="Perfil de socio"
            onPress={() => router.push(`/(store-admin)/customers/${id}/membership`)}
            variant="outline"
            fullWidth
          />
        )}
        <Button
          title="Ver reseñas"
          onPress={() => router.push({ pathname: '/(store-admin)/customers/reviews', params: { user_id: id } })}
          variant="outline"
          fullWidth
        />
        <View style={styles.footerRow}>
          <Button
            title="Editar"
            onPress={() => router.push(`/(store-admin)/customers/${id}/edit`)}
            variant="primary"
            fullWidth
          />
          <Button
            title={customer.state === 'active' ? 'Desactivar' : 'Activar'}
            onPress={() => toggleStateMutation.mutate()}
            variant="secondary"
            loading={toggleStateMutation.isPending}
            fullWidth
          />
        </View>
        <Button
          title="Eliminar"
          onPress={() => setShowDeleteDialog(true)}
          variant="destructive"
          fullWidth
        />
      </View>

      <ConfirmDialog
        visible={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
        onConfirm={() => {
          setShowDeleteDialog(false);
          deleteMutation.mutate();
        }}
        title="Eliminar cliente"
        message="¿Estás seguro de que deseas eliminar este cliente? Esta acción no se puede deshacer."
        confirmLabel="Eliminar"
        destructive
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colorScales.gray[50],
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colorScales.gray[50],
  },
  stickyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[200],
    gap: spacing[3],
  },
  backBtn: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stickyHeaderInfo: {
    flex: 1,
  },
  stickyHeaderTitle: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[900],
  },
  stickyHeaderSub: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    marginTop: 2,
  },
  stickyHeaderName: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
  },
  infoCard: {
    backgroundColor: colors.background,
    marginBottom: spacing[1],
  },
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing[4],
    gap: spacing[4],
  },
  avatarContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInfo: {
    flex: 1,
  },
  customerName: {
    fontSize: typography.fontSize.xl,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
    marginBottom: spacing[1],
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
    marginTop: spacing[0.5],
  },
  contactText: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
  },
  statsDivider: {
    height: 1,
    backgroundColor: colorScales.gray[200],
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  statItem: {
    width: '50%',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderRightColor: colorScales.gray[100],
    borderBottomColor: colorScales.gray[100],
  },
  statLabel: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
    marginBottom: spacing[1],
  },
  statValue: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[900],
  },
  walletCard: {
    backgroundColor: colors.background,
    padding: spacing[4],
  },
  walletHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing[4],
  },
  walletHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  walletTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
  },
  walletActions: {
    flexDirection: 'row',
    gap: spacing[2],
  },
  balanceGrid: {
    flexDirection: 'row',
    gap: spacing[3],
    marginBottom: spacing[4],
  },
  balanceBox: {
    flex: 1,
    backgroundColor: colorScales.gray[50],
    borderRadius: borderRadius.lg,
    padding: spacing[3],
  },
  balanceLabel: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
    marginBottom: spacing[1],
  },
  balanceAmount: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
  },
  walletForm: {
    backgroundColor: colorScales.gray[50],
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: borderRadius.lg,
    padding: spacing[4],
    marginBottom: spacing[4],
  },
  walletFormTitle: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[900],
    marginBottom: spacing[3],
  },
  formField: {
    marginBottom: spacing[3],
  },
  formLabel: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.medium,
    color: colorScales.gray[700],
    marginBottom: spacing[1],
  },
  formInput: {
    height: 44,
    borderWidth: 1,
    borderColor: colorScales.gray[300],
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3],
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[900],
    backgroundColor: colors.background,
  },
  pickerRow: {
    flexDirection: 'row',
    gap: spacing[2],
  },
  pickerOption: {
    flex: 1,
    height: 44,
    borderWidth: 1,
    borderColor: colorScales.gray[300],
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  pickerOptionActive: {
    borderColor: colors.primary,
    backgroundColor: '#f0fdf4',
  },
  pickerOptionText: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[600],
  },
  pickerOptionTextActive: {
    color: colors.primary,
    fontWeight: typography.fontWeight.semibold,
  },
  formFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing[2],
    marginTop: spacing[2],
  },
  txSection: {
    marginTop: spacing[1],
  },
  txHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing[3],
  },
  txTitle: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[900],
  },
  txFilterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    paddingVertical: spacing[1],
    paddingHorizontal: spacing[2],
  },
  txFilterBtnText: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[600],
    fontWeight: typography.fontWeight.medium,
  },
  txFilterBar: {
    marginBottom: spacing[3],
  },
  txFilterOptions: {
    flexDirection: 'row',
    gap: spacing[2],
    paddingVertical: spacing[1],
  },
  txFilterChip: {
    paddingVertical: spacing[1.5],
    paddingHorizontal: spacing[3],
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colorScales.gray[300],
    backgroundColor: colors.background,
  },
  txFilterChipActive: {
    borderColor: colors.primary,
    backgroundColor: '#f0fdf4',
  },
  txFilterChipText: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[600],
  },
  txFilterChipTextActive: {
    color: colors.primary,
    fontWeight: typography.fontWeight.semibold,
  },
  txEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[8],
    gap: spacing[2],
  },
  txEmptyText: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[400],
  },
  txItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  txLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    flex: 1,
  },
  txCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  txArrow: {
    fontSize: 16,
    fontWeight: typography.fontWeight.bold,
  },
  txInfo: {
    flex: 1,
  },
  txLabel: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colorScales.gray[900],
  },
  txDesc: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
    marginTop: 1,
  },
  txRight: {
    alignItems: 'flex-end',
  },
  txAmount: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold,
  },
  txDate: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[400],
    marginTop: 2,
  },
  emptyWallet: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[8],
    gap: spacing[2],
  },
  emptyWalletText: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
    fontWeight: typography.fontWeight.medium as any,
  },
  emptyWalletHint: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[400],
    textAlign: 'center',
    paddingHorizontal: spacing[4],
  },
  /* Consultation History */
  historyCard: {
    backgroundColor: colors.background,
    padding: spacing[4],
    marginBottom: spacing[1],
  },
  historyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginBottom: spacing[3],
  },
  historyTitle: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold as any,
    color: colorScales.gray[900],
  },
  historyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  historyItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
    flex: 1,
    flexWrap: 'wrap',
  },
  historyItemDate: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[400],
  },
  /* Metadata / Ficha del Cliente */
  metadataCard: {
    backgroundColor: colors.background,
    padding: spacing[4],
    marginBottom: spacing[1],
  },
  metadataHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginBottom: spacing[3],
  },
  metadataTitle: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold as any,
    color: colorScales.gray[900],
  },
  metadataGrid: {
    gap: spacing[2],
  },
  metadataItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  metadataLabel: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
  },
  metadataValue: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium as any,
    color: colorScales.gray[900],
  },
  footer: {
    padding: spacing[4],
    gap: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
    backgroundColor: colors.background,
  },
  footerRow: {
    flexDirection: 'row',
    gap: spacing[3],
  },
});
