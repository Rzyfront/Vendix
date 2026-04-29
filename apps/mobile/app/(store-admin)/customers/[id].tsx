import { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, TextInput, FlatList } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CustomerService } from '@/features/store/services/customer.service';
import type { CustomerWithWallet, CustomerState } from '@/features/store/types';
import { formatCurrency } from '@/shared/utils/currency';
import { formatRelative } from '@/shared/utils/date';
import { Card } from '@/shared/components/card/card';
import { Avatar } from '@/shared/components/avatar/avatar';
import { Icon } from '@/shared/components/icon/icon';
import { Badge } from '@/shared/components/badge/badge';
import { Button } from '@/shared/components/button/button';
import { Spinner } from '@/shared/components/spinner/spinner';
import { ConfirmDialog } from '@/shared/components/confirm-dialog/confirm-dialog';
import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';
import { spacing, borderRadius, typography, colorScales, colors } from '@/shared/theme';

const stateVariant = (state: CustomerState) =>
  state === 'active' ? 'success' : 'warning';

const stateLabel = (state: CustomerState) =>
  state === 'active' ? 'Activo' : 'Inactivo';

const TRANSACTION_ICONS: Record<string, string> = {
  topup: 'plus-circle',
  payment: 'credit-card',
  adjustment: 'sliders',
  refund: 'rotate-ccw',
};

const TRANSACTION_COLORS: Record<string, string> = {
  topup: colorScales.green[600],
  payment: colorScales.blue[600],
  adjustment: colorScales.gray[600],
  refund: colorScales.amber[600],
};

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function TransactionItem({
  transaction,
}: {
  transaction: { id: string; type: string; amount: number; description: string; created_at: string };
}) {
  const iconName = TRANSACTION_ICONS[transaction.type] ?? 'circle';
  const amountColor = transaction.type === 'payment' ? colorScales.red[600] : colorScales.green[600];
  const prefix = transaction.type === 'payment' ? '-' : '+';

  return (
    <View style={styles.transactionItem}>
      <View style={[styles.transactionIcon, { backgroundColor: `${TRANSACTION_COLORS[transaction.type]}15` }]}>
        <Icon name={iconName} size={16} color={TRANSACTION_COLORS[transaction.type]} />
      </View>
      <View style={styles.transactionContent}>
        <Text style={styles.transactionDescription}>{transaction.description}</Text>
        <Text style={styles.transactionDate}>{formatRelative(transaction.created_at)}</Text>
      </View>
      <Text style={[styles.transactionAmount, { color: amountColor }]}>
        {prefix}{formatCurrency(Math.abs(transaction.amount))}
      </Text>
    </View>
  );
}

export default function CustomerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [topupAmount, setTopupAmount] = useState('');

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
    mutationFn: (amount: number) => CustomerService.topup(id!, amount),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer', id] });
      setTopupAmount('');
      toastSuccess('Billetera recargada');
    },
    onError: () => toastError('Error al recargar la billetera'),
  });

  const handleTopup = () => {
    const amount = parseFloat(topupAmount);
    if (isNaN(amount) || amount <= 0) {
      toastError('Ingresa un monto válido');
      return;
    }
    topupMutation.mutate(amount);
  };

  if (isLoading || !customer) {
    return (
      <View style={styles.loadingContainer}>
        <Spinner />
      </View>
    );
  }

  const fullName = `${customer.first_name} ${customer.last_name}`;
  const walletBalance = customer.wallet_balance ?? 0;
  const walletHeld = customer.wallet_held ?? 0;
  const walletTotal = walletBalance + walletHeld;

  return (
    <View style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.avatarSection}>
          <Avatar name={fullName} size="lg" />
          <Text style={styles.customerName}>{fullName}</Text>
          <Badge
            label={stateLabel(customer.state)}
            variant={stateVariant(customer.state)}
          />
        </View>

        <View style={styles.content}>
          <Card>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Información del Cliente</Text>
              <Pressable onPress={() => router.push(`/(store-admin)/customers/${id}/edit`)}>
                <Icon name="edit-2" size={18} color={colorScales.gray[600]} />
              </Pressable>
            </View>
            <InfoRow label="Email" value={customer.email} />
            {customer.phone && <InfoRow label="Teléfono" value={customer.phone} />}
            {customer.document_number && (
              <InfoRow label="Documento" value={customer.document_number} />
            )}
            <InfoRow label="Fecha de registro" value={formatRelative(customer.created_at)} />
            {customer.last_purchase_at && (
              <InfoRow label="Última compra" value={formatRelative(customer.last_purchase_at)} />
            )}
            {customer.total_orders !== undefined && (
              <InfoRow label="Total de órdenes" value={String(customer.total_orders)} />
            )}
            <InfoRow label="Total gastado" value={formatCurrency(customer.total_spent ?? 0)} />
          </Card>

          <Card>
            <Text style={styles.sectionTitle}>Billetera</Text>
            <View style={styles.walletRow}>
              <View style={styles.walletItem}>
                <Text style={styles.walletLabel}>Disponible</Text>
                <Text style={[styles.walletValue, { color: colorScales.green[600] }]}>
                  {formatCurrency(walletBalance)}
                </Text>
              </View>
              <View style={styles.walletItem}>
                <Text style={styles.walletLabel}>Bloqueado</Text>
                <Text style={[styles.walletValue, { color: colorScales.amber[600] }]}>
                  {formatCurrency(walletHeld)}
                </Text>
              </View>
              <View style={styles.walletItem}>
                <Text style={styles.walletLabel}>Total</Text>
                <Text style={styles.walletValue}>{formatCurrency(walletTotal)}</Text>
              </View>
            </View>

            <View style={styles.topupRow}>
              <TextInput
                style={styles.topupInput}
                value={topupAmount}
                onChangeText={setTopupAmount}
                placeholder="Monto a recargar"
                keyboardType="decimal-pad"
                placeholderTextColor={colorScales.gray[400]}
              />
              <Button
                title="Recargar"
                onPress={handleTopup}
                loading={topupMutation.isPending}
                disabled={!topupAmount}
              />
            </View>
          </Card>

          {customer.wallet_transactions && customer.wallet_transactions.length > 0 && (
            <Card>
              <Text style={styles.sectionTitle}>Historial de Transacciones</Text>
              {customer.wallet_transactions.map((tx) => (
                <TransactionItem key={tx.id} transaction={tx} />
              ))}
            </Card>
          )}
        </View>
      </ScrollView>

      <View style={styles.footer}>
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
    backgroundColor: colors.background,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  avatarSection: {
    alignItems: 'center',
    padding: spacing[6],
    backgroundColor: colorScales.gray[50],
    gap: spacing[3],
  },
  customerName: {
    fontSize: typography.fontSize.xl,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
  },
  content: {
    padding: spacing[4],
    gap: spacing[4],
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing[2],
  },
  sectionTitle: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[700],
    marginBottom: spacing[3],
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  infoLabel: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
  },
  infoValue: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colorScales.gray[900],
  },
  walletRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing[4],
  },
  walletItem: {
    alignItems: 'center',
  },
  walletLabel: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
    marginBottom: spacing[1],
  },
  walletValue: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
  },
  topupRow: {
    flexDirection: 'row',
    gap: spacing[3],
    alignItems: 'center',
  },
  topupInput: {
    flex: 1,
    height: 44,
    borderWidth: 1,
    borderColor: colorScales.gray[300],
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3],
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[900],
  },
  transactionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  transactionIcon: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing[3],
  },
  transactionContent: {
    flex: 1,
  },
  transactionDescription: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[900],
  },
  transactionDate: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
    marginTop: 2,
  },
  transactionAmount: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
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
