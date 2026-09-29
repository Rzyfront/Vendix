import { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/shared/components/button/button';
import { Icon } from '@/shared/components/icon/icon';
import {
  colors,
  colorScales,
  spacing,
  borderRadius,
  typography,
} from '@/shared/theme';
import {
  VexiConfirmationService,
  VexiConfirmationProposal,
  VexiApplyResult,
} from './vexi-confirmation.service';

interface VexiConfirmationScreenProps {
  proposal: VexiConfirmationProposal;
  onApplied: (result: VexiApplyResult) => void;
  onRejected: () => void;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * Pantalla mínima de confirmación Vexi (G10).
 *
 * Propuesta → Aprobar/Rechazar → apply con token single-use. El botón se
 * deshabilita en vuelo y tras aplicar, así que un doble tap no dispara dos
 * POST; y aunque llegaran dos, el redeem Lua del servidor aplica una sola
 * vez. Rechazar es local: el token expira solo a los 300s.
 */
export function VexiConfirmationScreen({
  proposal,
  onApplied,
  onRejected,
}: VexiConfirmationScreenProps) {
  const insets = useSafeAreaInsets();
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = proposal.preview;
  const blocked = preview.status === 'error' || applying || applied;

  const handleApprove = useCallback(async () => {
    if (blocked) return;
    setApplying(true);
    setError(null);
    try {
      const result = await VexiConfirmationService.apply(proposal);
      setApplied(true);
      onApplied(result);
    } catch (e: unknown) {
      const message =
        (e as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ??
        (e instanceof Error ? e.message : 'No se pudo aplicar el cambio.');
      setError(message);
    } finally {
      setApplying(false);
    }
  }, [blocked, proposal, onApplied]);

  return (
    <View
      style={[
        styles.container,
        { paddingBottom: Math.max(insets.bottom, spacing[3]) },
      ]}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
      >
        <View style={styles.header}>
          <Icon name="bot" size={28} color={colors.primary} />
          <Text style={styles.title}>Vexi propone un cambio</Text>
        </View>

        <Text style={styles.target}>{preview.target}</Text>

        {preview.message ? (
          <Text style={styles.message}>{preview.message}</Text>
        ) : null}

        {preview.changes.map((change) => (
          <View key={change.field} style={styles.changeRow}>
            <Text style={styles.changeLabel}>{change.label}</Text>
            <View style={styles.changeValues}>
              <Text style={styles.changeFrom}>
                {formatValue(change.from)}
              </Text>
              <Icon
                name="arrow-left-right"
                size={16}
                color={colorScales.gray[400]}
              />
              <Text style={styles.changeTo}>{formatValue(change.to)}</Text>
            </View>
          </View>
        ))}

        {applied ? (
          <Text style={styles.appliedNote}>
            Aplicado. El cambio ya quedó registrado.
          </Text>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>

      <View style={styles.actions}>
        <View style={styles.actionHalf}>
          <Button
            title="Rechazar"
            variant="outline"
            fullWidth
            disabled={applying || applied}
            onPress={onRejected}
          />
        </View>
        <View style={styles.actionHalf}>
          <Button
            title={applied ? 'Aplicado' : 'Aprobar'}
            variant="primary"
            fullWidth
            loading={applying}
            disabled={blocked}
            onPress={handleApprove}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colorScales.gray[50],
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing[4],
    gap: spacing[3],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  title: {
    fontSize: typography.fontSize.xl,
    fontWeight: typography.fontWeight.semibold,
    color: colors.text.primary,
  },
  target: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold,
    color: colors.text.primary,
  },
  message: {
    fontSize: typography.fontSize.base,
    color: colors.text.secondary,
  },
  changeRow: {
    backgroundColor: colors.card,
    borderRadius: borderRadius.md,
    padding: spacing[3],
    gap: spacing[1],
  },
  changeLabel: {
    fontSize: typography.fontSize.xs,
    color: colors.text.muted,
  },
  changeValues: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  changeFrom: {
    fontSize: typography.fontSize.base,
    flex: 1,
    color: colors.text.secondary,
    textDecorationLine: 'line-through',
  },
  changeTo: {
    fontSize: typography.fontSize.base,
    flex: 1,
    fontWeight: typography.fontWeight.semibold,
    color: colors.text.primary,
  },
  appliedNote: {
    fontSize: typography.fontSize.base,
    color: colors.success,
  },
  error: {
    fontSize: typography.fontSize.base,
    color: colors.error,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
  },
  actionHalf: {
    flex: 1,
  },
});
