import { useLocalSearchParams } from 'expo-router';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { AccountingService } from '@/features/store/services/accounting.service';
import type { JournalEntry } from '@/features/store/types';
import { JOURNAL_ENTRY_STATE_LABELS, JOURNAL_ENTRY_STATE_VARIANTS } from '@/features/store/types';
import { Card } from '@/shared/components/card/card';
import { Badge } from '@/shared/components/badge/badge';
import { Spinner } from '@/shared/components/spinner/spinner';
import { Icon } from '@/shared/components/icon/icon';
import { spacing, colorScales, typography, colors } from '@/shared/theme';
import { formatCurrency } from '@/shared/utils/currency';
import { formatDate } from '@/shared/utils/date';

export default function JournalEntryDetailScreen() {
  const { journalEntryId } = useLocalSearchParams<{ journalEntryId: string }>();

  const { data: entry, isLoading } = useQuery({
    queryKey: ['journal-entry', journalEntryId],
    queryFn: () => AccountingService.getJournalEntry(journalEntryId),
    enabled: !!journalEntryId,
  });

  if (isLoading) return <FullScreenSpinner />;

  if (!entry) {
    return (
      <View style={styles.errorContainer}>
        <Icon name="alert-circle" size={48} color={colorScales.gray[300]} />
        <Text style={styles.errorText}>Asiento no encontrado</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Card style={styles.headerCard}>
        <View style={styles.headerRow}>
          <Text style={styles.entryNumber}>{entry.entry_number}</Text>
          <Badge
            label={JOURNAL_ENTRY_STATE_LABELS[entry.state]}
            variant={JOURNAL_ENTRY_STATE_VARIANTS[entry.state]}
            size="md"
          />
        </View>
        <Text style={styles.description}>{entry.description}</Text>
      </Card>

      <Card style={styles.infoCard}>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Fecha</Text>
          <Text style={styles.infoValue}>{formatDate(entry.entry_date)}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Tipo</Text>
          <Text style={styles.infoValue}>{entry.entry_type}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Creado</Text>
          <Text style={styles.infoValue}>{formatDate(entry.created_at)}</Text>
        </View>
      </Card>

      <Text style={styles.sectionLabel}>Líneas del Asiento</Text>

      {entry.lines?.map((line) => (
        <Card key={line.id} style={styles.lineCard}>
          <View style={styles.lineTop}>
            <Text style={styles.lineAccountCode}>{line.account_code}</Text>
            <View style={styles.lineAmounts}>
              <Text style={styles.lineDebit}>{line.debit > 0 ? formatCurrency(line.debit) : '-'}</Text>
              <Text style={styles.lineCredit}>{line.credit > 0 ? formatCurrency(line.credit) : '-'}</Text>
            </View>
          </View>
          <Text style={styles.lineAccountName} numberOfLines={1}>{line.account_name}</Text>
          {line.description ? (
            <Text style={styles.lineDescription} numberOfLines={1}>{line.description}</Text>
          ) : null}
        </Card>
      ))}

      <Card style={styles.totalsCard}>
        <View style={styles.totalsRow}>
          <Text style={styles.totalsLabel}>Total Débito</Text>
          <Text style={styles.totalsValue}>{formatCurrency(entry.total_debit)}</Text>
        </View>
        <View style={[styles.totalsRow, styles.totalsDivider]}>
          <Text style={styles.totalsLabel}>Total Crédito</Text>
          <Text style={styles.totalsValue}>{formatCurrency(entry.total_credit)}</Text>
        </View>
      </Card>
    </ScrollView>
  );
}

function FullScreenSpinner() {
  return (
    <View style={styles.loadingContainer}>
      <Spinner />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colorScales.gray[50],
  },
  content: {
    padding: spacing[4],
    gap: spacing[3],
    paddingBottom: spacing[8],
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colorScales.gray[50],
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing[3],
    backgroundColor: colorScales.gray[50],
  },
  errorText: {
    fontSize: typography.fontSize.base,
    color: colorScales.gray[400],
  },
  headerCard: {
    padding: spacing[4],
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing[2],
  },
  entryNumber: {
    fontSize: typography.fontSize.xl,
    fontWeight: '700' as never,
    color: colorScales.gray[900],
  },
  description: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[600],
  },
  infoCard: {
    padding: spacing[4],
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing[1],
  },
  infoLabel: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
  },
  infoValue: {
    fontSize: typography.fontSize.sm,
    fontWeight: '500' as never,
    color: colorScales.gray[900],
  },
  sectionLabel: {
    fontSize: typography.fontSize.sm,
    fontWeight: '600' as never,
    color: colorScales.gray[500],
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: spacing[2],
  },
  lineCard: {
    padding: spacing[3],
  },
  lineTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  lineAccountCode: {
    fontSize: typography.fontSize.sm,
    fontWeight: '600' as never,
    color: colorScales.gray[900],
  },
  lineAmounts: {
    flexDirection: 'row',
    gap: spacing[4],
  },
  lineDebit: {
    fontSize: typography.fontSize.sm,
    fontWeight: '500' as never,
    color: colorScales.blue[600],
  },
  lineCredit: {
    fontSize: typography.fontSize.sm,
    fontWeight: '500' as never,
    color: colorScales.amber[600],
  },
  lineAccountName: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
    marginTop: spacing[1],
  },
  lineDescription: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[400],
    marginTop: 2,
  },
  totalsCard: {
    padding: spacing[4],
  },
  totalsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing[2],
  },
  totalsDivider: {
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
    paddingTop: spacing[3],
    marginTop: spacing[1],
  },
  totalsLabel: {
    fontSize: typography.fontSize.base,
    fontWeight: '600' as never,
    color: colorScales.gray[700],
  },
  totalsValue: {
    fontSize: typography.fontSize.base,
    fontWeight: '700' as never,
    color: colorScales.gray[900],
  },
});
