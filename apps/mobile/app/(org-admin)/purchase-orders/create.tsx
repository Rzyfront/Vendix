import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/shared/components/button/button';
import { Card } from '@/shared/components/card/card';
import { Input } from '@/shared/components/input/input';
import { Spinner } from '@/shared/components/spinner/spinner';
import { colors, colorScales, spacing, typography, borderRadius } from '@/shared/theme';
import { OrgPurchaseOrdersService } from '@/features/org/services/org-purchase-orders.service';
import { useQuery } from '@tanstack/react-query';
import { OrgInventoryService } from '@/features/org/services/org-inventory.service';
import { toastError, toastSuccess } from '@/shared/components/toast/toast.store';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export default function CreatePurchaseOrderScreen() {
  const router = useRouter();
  const [supplierId, setSupplierId] = useState('');
  const [storeId, setStoreId] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [dateTouched, setDateTouched] = useState(false);

  const dateError =
    dateTouched && expectedDate.length > 0 && !DATE_REGEX.test(expectedDate)
      ? 'Formato inválido. Usa YYYY-MM-DD, ej: 2026-06-15.'
      : undefined;

  const suppliersQuery = useQuery({
    queryKey: ['org-suppliers-purchase-create'],
    queryFn: () => OrgInventoryService.listSuppliers({ pageSize: 50 }),
  });

  const storesQuery = useQuery({
    queryKey: ['org-stores-purchase-create'],
    queryFn: () => import('@/features/org/services/org-store.service').then(m => m.OrgStoreService.list({ pageSize: 50 })),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      OrgPurchaseOrdersService.create({
        supplier_id: supplierId,
        store_id: storeId,
        expected_date: expectedDate || undefined,
        notes: notes || undefined,
        items: [],
      }),
    onSuccess: () => {
      toastSuccess('Orden de compra creada. Agrega los items en el detalle.');
      router.back();
    },
    onError: (err: any) => {
      const msg =
        err?.response?.data?.message || err?.message || 'No se pudo crear la orden.';
      toastError(msg);
    },
  });

  const handleSubmit = () => {
    setDateTouched(true);
    if (expectedDate.length > 0 && !DATE_REGEX.test(expectedDate)) {
      toastError('La fecha esperada debe tener el formato YYYY-MM-DD.');
      return;
    }
    if (!supplierId || !storeId) {
      toastError('Selecciona proveedor y tienda antes de continuar.');
      return;
    }
    createMutation.mutate();
  };

  const stores = storesQuery.data?.data ?? [];
  const suppliers = suppliersQuery.data ?? [];
  const isLoadingLists = suppliersQuery.isLoading || storesQuery.isLoading;

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Nueva orden de compra</Text>

        {isLoadingLists ? (
          <View style={styles.loadingRow}>
            <Spinner size="sm" />
            <Text style={styles.loadingText}>Cargando proveedores y tiendas…</Text>
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.label}>
            Proveedor <Text style={styles.required}>*</Text>
          </Text>
          {suppliers.length === 0 && !suppliersQuery.isLoading ? (
            <Text style={styles.helper}>
              No hay proveedores registrados. Crea uno desde Inventario › Proveedores.
            </Text>
          ) : (
            <View style={styles.chipsRow}>
              {suppliers.map((s) => (
                <Pressable
                  key={s.id}
                  style={[styles.chip, supplierId === s.id && styles.chipActive]}
                  onPress={() => setSupplierId(s.id)}
                >
                  <Text style={[styles.chipText, supplierId === s.id && styles.chipTextActive]}>
                    {s.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>
            Tienda destino <Text style={styles.required}>*</Text>
          </Text>
          {stores.length === 0 && !storesQuery.isLoading ? (
            <Text style={styles.helper}>
              No hay tiendas disponibles para la organización.
            </Text>
          ) : (
            <View style={styles.chipsRow}>
              {stores.map((s) => (
                <Pressable
                  key={s.id}
                  style={[styles.chip, storeId === s.id && styles.chipActive]}
                  onPress={() => setStoreId(s.id)}
                >
                  <Text style={[styles.chipText, storeId === s.id && styles.chipTextActive]}>
                    {s.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Fecha esperada (YYYY-MM-DD)</Text>
          <Input
            value={expectedDate}
            onChangeText={(v) => {
              setExpectedDate(v);
              if (!dateTouched) setDateTouched(true);
            }}
            onBlur={() => setDateTouched(true)}
            placeholder="2026-06-15"
            error={dateError}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="numbers-and-punctuation"
          />
          <Text style={styles.helper}>Opcional. Déjala vacía si aún no hay fecha estimada.</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Notas</Text>
          <Input value={notes} onChangeText={setNotes} multiline numberOfLines={3} />
        </View>

        <View style={styles.actions}>
          <Button
            title={createMutation.isPending ? 'Creando…' : 'Crear orden'}
            onPress={handleSubmit}
            disabled={!supplierId || !storeId || createMutation.isPending}
            loading={createMutation.isPending}
            fullWidth
          />
        </View>

        <Card>
          <Text style={styles.note}>
            * Los items se agregan desde el detalle de la orden después de crearla.
          </Text>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing[4], paddingBottom: spacing[12] },
  title: { fontSize: typography.fontSize.lg, fontWeight: typography.fontWeight.bold, color: colorScales.gray[900], marginBottom: spacing[4] },
  section: { marginBottom: spacing[3] },
  label: { fontSize: typography.fontSize.sm, color: colorScales.gray[700], marginBottom: spacing[2], fontWeight: typography.fontWeight.medium },
  required: { color: colors.error },
  helper: { fontSize: typography.fontSize.xs, color: colorScales.gray[500], marginTop: spacing[1] },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginBottom: spacing[3] },
  loadingText: { fontSize: typography.fontSize.xs, color: colorScales.gray[500] },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  chip: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    backgroundColor: colorScales.gray[100],
    borderRadius: borderRadius.full,
  },
  chipActive: { backgroundColor: colors.primary },
  chipText: { fontSize: typography.fontSize.sm, color: colorScales.gray[700] },
  chipTextActive: { color: '#fff', fontWeight: typography.fontWeight.semibold },
  actions: { marginVertical: spacing[4] },
  note: { fontSize: typography.fontSize.xs, color: colorScales.gray[500] },
});