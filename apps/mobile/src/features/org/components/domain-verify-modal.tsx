import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { BottomSheet } from '@/shared/components/bottom-sheet/bottom-sheet';
import { Icon } from '@/shared/components/icon/icon';
import { colors, colorScales, spacing, typography, borderRadius } from '@/shared/theme';
import { OrgDomainsService } from '@/features/org/services/org-domains.service';
import type { Domain, DnsInstructions } from '@/core/models/org-admin/domains.types';
import { formatStatus } from './domain-formatters';

interface DomainVerifyModalProps {
  visible: boolean;
  domain: Domain | null;
  onClose: () => void;
  onVerified?: (domain: Domain) => void;
}

/**
 * Modal "Verificar DNS" para ORG_ADMIN Dominios.
 *
 * Espejo del `DomainVerifyModalComponent` de la web. Muestra:
 *   - El edge host target (CNAME) al que el dominio debe apuntar.
 *   - La tabla de registros DNS requeridos (type / host / value).
 *   - Un botón "Copiar" para el edge host.
 *   - Un botón "Verificar DNS" que llama a `OrgDomainsService.verify(id)` y
 *     muestra el resultado inline.
 *
 * Solo aplica a dominios con `ownership = CUSTOM_DOMAIN | CUSTOM_SUBDOMAIN`.
 * El guard se hace en la pantalla que abre el modal (no aquí).
 */
export function DomainVerifyModal({ visible, domain, onClose, onVerified }: DomainVerifyModalProps) {
  const [instructions, setInstructions] = useState<DnsInstructions | null>(null);
  const [loadingInstructions, setLoadingInstructions] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<{ verified: boolean; message?: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!visible || !domain) {
      setInstructions(null);
      setResult(null);
      setCopied(false);
      return;
    }
    setLoadingInstructions(true);
    OrgDomainsService.getDnsInstructions(domain.hostname)
      .then((d) => setInstructions(d))
      .catch(() => setInstructions(null))
      .finally(() => setLoadingInstructions(false));
  }, [visible, domain?.hostname]);

  if (!domain) return null;

  const handleVerify = async () => {
    setVerifying(true);
    setResult(null);
    try {
      const verifyResult = await OrgDomainsService.verify(domain.hostname);
      setResult({ verified: !!verifyResult.verified, message: verifyResult.message });
      if (verifyResult.verified) {
        onVerified?.(domain);
      }
    } catch (e: any) {
      setResult({ verified: false, message: e?.message ?? 'Error al verificar' });
    } finally {
      setVerifying(false);
    }
  };

  const handleCopy = () => {
    if (!instructions?.target) return;
    // Clipboard.setString (sin dep extra: ya viene con Expo)
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Clipboard = require('expo-clipboard').default ?? require('expo-clipboard');
      Clipboard.setStringAsync(instructions.target).catch(() => undefined);
    } catch {
      // fallback silencioso si el módulo no está disponible
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} snapPoint="full">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={styles.headerIcon}>
              <Icon name="shield-check" size={20} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Verificar DNS</Text>
              <Text style={styles.subtitle} numberOfLines={1}>{domain.hostname}</Text>
            </View>
          </View>
          <Pressable onPress={onClose} style={styles.closeBtn}>
            <Icon name="x" size={24} color={colorScales.gray[500]} />
          </Pressable>
        </View>

        <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled">
          <View style={styles.targetBlock}>
            <Text style={styles.label}>Apunta tu CNAME a</Text>
            {loadingInstructions ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : instructions?.target ? (
              <View style={styles.targetRow}>
                <Text style={styles.targetValue} numberOfLines={1}>{instructions.target}</Text>
                <Pressable style={styles.copyBtn} onPress={handleCopy}>
                  <Icon name={copied ? 'check' : 'copy'} size={14} color={colors.primary} />
                  <Text style={styles.copyText}>{copied ? 'Copiado' : 'Copiar'}</Text>
                </Pressable>
              </View>
            ) : (
              <Text style={styles.helperText}>No se pudo cargar el edge host. Reintenta.</Text>
            )}
          </View>

          <Text style={styles.sectionLabel}>Registros DNS requeridos</Text>
          {loadingInstructions ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : instructions?.records?.length ? (
            <View style={styles.recordsTable}>
              <View style={[styles.recordRow, styles.recordHeader]}>
                <Text style={[styles.recordCell, styles.recordCellType]}>Tipo</Text>
                <Text style={[styles.recordCell, styles.recordCellHost]}>Host</Text>
                <Text style={[styles.recordCell, styles.recordCellValue]}>Valor</Text>
                <Text style={[styles.recordCell, styles.recordCellTtl]}>TTL</Text>
              </View>
              {instructions.records.map((r, i) => (
                <View key={i} style={styles.recordRow}>
                  <Text style={[styles.recordCell, styles.recordCellType, styles.recordMono]}>{r.type}</Text>
                  <Text style={[styles.recordCell, styles.recordCellHost, styles.recordMono]} numberOfLines={1}>{r.host}</Text>
                  <Text style={[styles.recordCell, styles.recordCellValue, styles.recordMono]} numberOfLines={2}>{r.value}</Text>
                  <Text style={[styles.recordCell, styles.recordCellTtl, styles.recordMono]}>{r.ttl ?? '—'}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.helperText}>Sin instrucciones DNS disponibles.</Text>
          )}

          <View style={styles.statusBlock}>
            <Text style={styles.label}>Estado actual</Text>
            <Text style={styles.statusText}>{formatStatus(domain.status)}</Text>
          </View>

          {result ? (
            <View style={[styles.resultBlock, result.verified ? styles.resultOk : styles.resultErr]}>
              <Icon
                name={result.verified ? 'check-circle' : 'alert-triangle'}
                size={16}
                color={result.verified ? colors.success : colors.error}
              />
              <Text style={[styles.resultText, result.verified ? styles.resultTextOk : styles.resultTextErr]}>
                {result.message ?? (result.verified ? 'Propiedad verificada.' : 'Verificación falló.')}
              </Text>
            </View>
          ) : null}
        </ScrollView>

        <View style={styles.footer}>
          <Pressable style={styles.cancelBtn} onPress={onClose}>
            <Text style={styles.cancelText}>Cerrar</Text>
          </Pressable>
          <Pressable
            style={[styles.verifyBtn, verifying && styles.verifyBtnDisabled]}
            onPress={handleVerify}
            disabled={verifying}
          >
            {verifying ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <>
                <Icon name="shield-check" size={16} color="#FFFFFF" />
                <Text style={styles.verifyText}>Verificar DNS</Text>
              </>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[200],
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], flex: 1, minWidth: 0 },
  headerIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colorScales.green[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold as any,
    color: colorScales.gray[900],
  },
  subtitle: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
    marginTop: 2,
  },
  closeBtn: { padding: spacing[1] },
  body: { flex: 1 },
  bodyContent: { padding: spacing[4], gap: spacing[4] },
  targetBlock: {
    backgroundColor: colorScales.green[50],
    borderRadius: borderRadius.lg,
    padding: spacing[4],
    gap: spacing[2],
  },
  label: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[600],
    fontWeight: typography.fontWeight.semibold as any,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  targetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  targetValue: {
    flex: 1,
    fontSize: typography.fontSize.base,
    fontFamily: typography.fontFamily,
    fontWeight: typography.fontWeight.semibold as any,
    color: colorScales.gray[900],
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    borderRadius: borderRadius.md,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colorScales.green[200],
  },
  copyText: {
    fontSize: typography.fontSize.xs,
    color: colors.primary,
    fontWeight: typography.fontWeight.semibold as any,
  },
  sectionLabel: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[700],
    fontWeight: typography.fontWeight.semibold as any,
  },
  recordsTable: {
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
  },
  recordRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  recordHeader: { backgroundColor: colorScales.gray[50] },
  recordCell: {
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[800],
  },
  recordCellType: { width: 56 },
  recordCellHost: { flex: 1 },
  recordCellValue: { flex: 2 },
  recordCellTtl: { width: 56, textAlign: 'right' },
  recordMono: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  helperText: { fontSize: typography.fontSize.sm, color: colorScales.gray[500] },
  statusBlock: { gap: spacing[1] },
  statusText: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold as any,
    color: colorScales.gray[900],
  },
  resultBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    padding: spacing[3],
    borderRadius: borderRadius.lg,
  },
  resultOk: { backgroundColor: colorScales.green[50] },
  resultErr: { backgroundColor: colorScales.red[50] },
  resultText: { fontSize: typography.fontSize.sm, flex: 1 },
  resultTextOk: { color: colorScales.green[800] },
  resultTextErr: { color: colorScales.red[800] },
  footer: {
    flexDirection: 'row',
    gap: spacing[3],
    padding: spacing[4],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
  },
  cancelBtn: {
    flex: 1,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colorScales.gray[300],
  },
  cancelText: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold as any,
    color: colorScales.gray[700],
  },
  verifyBtn: {
    flex: 2,
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    backgroundColor: colors.primary,
    borderRadius: borderRadius.xl,
  },
  verifyBtnDisabled: { opacity: 0.6 },
  verifyText: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold as any,
    color: '#FFFFFF',
  },
});