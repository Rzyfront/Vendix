import { useState } from 'react';
import { View, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { InvoiceService } from '@/features/store/services/invoice.service';
import {
  Invoice,
  INVOICE_STATUS_LABELS,
  INVOICE_STATUS_VARIANT,
  INVOICE_TYPE_LABELS,
} from '@/features/store/types/invoice.types';
import { Card } from '@/shared/components/card/card';
import { Icon } from '@/shared/components/icon/icon';
import { Badge } from '@/shared/components/badge/badge';
import { Button } from '@/shared/components/button/button';
import { Spinner } from '@/shared/components/spinner/spinner';
import { ListItem } from '@/shared/components/list-item/list-item';
import { ConfirmDialog } from '@/shared/components/confirm-dialog/confirm-dialog';
import { Modal } from '@/shared/components/modal/modal';
import { Input } from '@/shared/components/input/input';
import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';
import { formatCurrency } from '@/shared/utils/currency';
import { formatDateTime } from '@/shared/utils/date';
import { spacing, borderRadius, colorScales, colors } from '@/shared/theme';

export default function InvoiceDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [voidDialogVisible, setVoidDialogVisible] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const { data: invoice, isLoading } = useQuery({
    queryKey: ['invoice', id],
    queryFn: () => InvoiceService.getById(id),
    enabled: !!id,
  });

  const invalidateInvoice = async () => {
    await queryClient.invalidateQueries({ queryKey: ['invoice', id] });
    await queryClient.invalidateQueries({ queryKey: ['invoices'] });
    await queryClient.invalidateQueries({ queryKey: ['invoice-stats'] });
  };

  const handleAction = async (actionFn: () => Promise<Invoice>, successMsg: string) => {
    setActionLoading(true);
    try {
      await actionFn();
      await invalidateInvoice();
      toastSuccess(successMsg);
    } catch (e: any) {
      toastError(e?.message ?? 'Error al procesar la acción');
    } finally {
      setActionLoading(false);
    }
  };

  const handleSend = () => {
    handleAction(() => InvoiceService.send(id), 'Factura enviada exitosamente');
  };

  const handleVoid = () => {
    handleAction(
      () => InvoiceService.void(id, voidReason),
      'Factura anulada exitosamente',
    );
    setVoidDialogVisible(false);
    setVoidReason('');
  };

  if (isLoading || !invoice) {
    return (
      <View style={styles.loadingContainer}>
        <Spinner />
      </View>
    );
  }

  const showSend = invoice.status === 'draft' || invoice.status === 'validated';
  const showVoid = invoice.status === 'draft';
  const showCreditNote = invoice.status === 'accepted';

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()}>
            <Icon name="arrow-left" size={24} color={colorScales.gray[700]} />
          </Pressable>
          <View style={styles.flex1}>
            <ListItem title={invoice.invoice_number} />
          </View>
          <Badge
            label={INVOICE_STATUS_LABELS[invoice.status]}
            variant={INVOICE_STATUS_VARIANT[invoice.status]}
          />
        </View>

        <Card style={styles.cardMargin}>
          <View style={styles.rowBetween}>
            <View>
              <ListItem title="Tipo" subtitle={INVOICE_TYPE_LABELS[invoice.invoice_type]} />
            </View>
            <ListItem title={formatDateTime(invoice.issue_date)} />
          </View>
        </Card>

        {invoice.customer_name && (
          <Card style={styles.cardMargin}>
            <ListItem title="Cliente" subtitle={invoice.customer_name} />
          </Card>
        )}

        {invoice.items && invoice.items.length > 0 && (
          <Card style={styles.cardMargin}>
            <ListItem title="Productos" />
            <View style={styles.mt2}>
              {invoice.items.map((item) => (
                <View key={item.id} style={styles.itemRow}>
                  <View style={styles.flex1}>
                    <ListItem title={item.description} />
                    <ListItem
                      title={`${item.quantity} × ${formatCurrency(item.unit_price)}`}
                    />
                  </View>
                  <ListItem title={formatCurrency(item.total)} />
                </View>
              ))}
            </View>
          </Card>
        )}

        <Card style={styles.cardMargin}>
          <ListItem title="Resumen" />
          <View style={styles.mt2Gap1}>
            <View style={styles.rowBetween}>
              <ListItem title="Subtotal" />
              <ListItem title={formatCurrency(invoice.subtotal)} />
            </View>
            <View style={styles.rowBetween}>
              <ListItem title="Impuestos" />
              <ListItem title={formatCurrency(invoice.tax_amount)} />
            </View>
            {invoice.discount_amount > 0 && (
              <View style={styles.rowBetween}>
                <ListItem title="Descuento" />
                <ListItem title={`-${formatCurrency(invoice.discount_amount)}`} />
              </View>
            )}
            <View style={styles.totalRow}>
              <ListItem title="Total" />
              <ListItem title={formatCurrency(invoice.total_amount)} />
            </View>
          </View>
        </Card>

        <View style={styles.navButtons}>
          <Button
            title="Resoluciones"
            onPress={() => router.push('/(store-admin)/invoicing/resolutions')}
            variant="secondary"
          />
          <Button
            title="Config DIAN"
            onPress={() => router.push('/(store-admin)/invoicing/dian-config')}
            variant="secondary"
          />
        </View>

        <View style={styles.actionsGap}>
          {showSend && (
            <Button
              title="Enviar"
              onPress={handleSend}
              variant="primary"
              loading={actionLoading}
            />
          )}
          {showVoid && (
            <Button
              title="Anular"
              onPress={() => setVoidDialogVisible(true)}
              variant="destructive"
              loading={actionLoading}
            />
          )}
          {showCreditNote && (
            <Button
              title="Nota Crédito"
              onPress={() => {}}
              variant="secondary"
            />
          )}
        </View>
      </ScrollView>

      <Modal visible={voidDialogVisible} onClose={() => setVoidDialogVisible(false)} title="Anular Factura">
        <View style={styles.modalGap}>
          <Input
            label="Motivo de anulación"
            value={voidReason}
            onChangeText={setVoidReason}
            placeholder="Ingrese el motivo"
            multiline
          />
          <Button
            title="Confirmar Anulación"
            onPress={handleVoid}
            variant="destructive"
            loading={actionLoading}
          />
        </View>
      </Modal>
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
  scrollContent: {
    padding: spacing[4],
    paddingBottom: spacing[24],
  },
  flex1: {
    flex: 1,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    marginBottom: spacing[4],
  },
  cardMargin: {
    marginBottom: spacing[3],
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  mt2: {
    marginTop: spacing[2],
  },
  mt2Gap1: {
    marginTop: spacing[2],
    gap: spacing[1],
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: spacing[2],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
  },
  navButtons: {
    flexDirection: 'row',
    gap: spacing[2],
    marginTop: spacing[2],
  },
  actionsGap: {
    gap: spacing[2],
    marginTop: spacing[2],
  },
  modalGap: {
    gap: spacing[3],
  },
});
