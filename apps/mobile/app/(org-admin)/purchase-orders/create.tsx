import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/shared/components/button/button';
import { Card } from '@/shared/components/card/card';
import { Input } from '@/shared/components/input/input';
import { Spinner } from '@/shared/components/spinner/spinner';
import { colors, colorScales, spacing, typography, borderRadius } from '@/shared/theme';
import { OrgPurchaseOrdersService } from '@/features/org/services/org-purchase-orders.service';
import { OrgInventoryService } from '@/features/org/services/org-inventory.service';
import { toastError, toastSuccess } from '@/shared/components/toast/toast.store';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Form de creación de OC org-native.
 *
 * El destino es UNA sola ubicación de inventario (`destination_location_id`),
 * no una tienda. Plan §6.4.1 — el destino se fija a nivel cabecera y los
 * items heredan. Las ubicaciones pueden ser WAREHOUSE, STORE, CENTRAL o
 * TRANSIT; el backend valida pertenencia yOperatingScope.
 */
export default function CreatePurchaseOrderScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [supplierId, setSupplierId] = useState('');
  const [locationId, setLocationId] = useState('');
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

  // Plan §6.4.1 — el destino es una ubicación de inventario, no una tienda.
  // Traemos solo las activas para no permitir seleccionar bodegas en baja.
  const locationsQuery = useQuery({
    queryKey: ['org-inventory-locations-purchase-create'],
    queryFn: () =>
      OrgInventoryService.listLocations({
        pageSize: 100,
        is_active: true,
      } as Parameters<typeof OrgInventoryService.listLocations>[0]),
  });

  // H2: rama de error dedicada — antes un 500/403 caía en
  // "No hay proveedores/ubicaciones registradas" y el usuario no sabía que
  // falló la carga.
  const suppliersLoadError = suppliersQuery.isError
    ? suppliersQuery.error?.message || 'No se pudieron cargar los proveedores.'
    : null;
  const locationsLoadError = locationsQuery.isError
    ? locationsQuery.error?.message || 'No se pudieron cargar las ubicaciones.'
    : null;

  const createMutation = useMutation({
    mutationFn: () => {
      // El backend exige `supplier_id` y `destination_location_id` como
      // `number` (DTO usa @IsInt). Validamos antes para no mandarle string.
      const supplierIdNum = Number(supplierId);
      const locationIdNum = Number(locationId);
      if (!Number.isFinite(supplierIdNum) || !Number.isFinite(locationIdNum)) {
        throw new Error('IDs de proveedor o ubicación inválidos.');
      }
      return OrgPurchaseOrdersService.create({
        supplier_id: supplierIdNum,
        destination_location_id: locationIdNum,
        expected_date: expectedDate || undefined,
        notes: notes || undefined,
        items: [],
      });
    },
    onSuccess: () => {
      // H3: invalidar la lista para que al volver a la pantalla no muestre el
      // status viejo ni tenga que tirar pull-to-refresh.
      queryClient.invalidateQueries({ queryKey: ['org-purchase-orders-list'] });
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
    if (!supplierId || !locationId) {
      toastError('Selecciona proveedor y ubicación antes de continuar.');
      return;
    }
    createMutation.mutate();
  };

  const locations = locationsQuery.data ?? [];
  const suppliers = suppliersQuery.data ?? [];
  const isLoadingLists = suppliersQuery.isLoading || locationsQuery.isLoading;

  const locationLabel = (loc: { name: string; code?: string; type: string }) =>
    loc.code ? `${loc.name} (${loc.code}) · ${loc.type}` : `${loc.name} · ${loc.type}`;

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Nueva orden de compra</Text>

        {isLoadingLists ? (
          <View style={styles.loadingRow}>
            <Spinner size="sm" />
            <Text style={styles.loadingText}>Cargando proveedores y ubicaciones…</Text>
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.label}>
            Proveedor <Text style={styles.required}>*</Text>
          </Text>
          {suppliersLoadError ? (
            // H2: error dedicado — antes caía en el helper de "No hay
            // proveedores registrados" y el usuario no sabía que era un 500.
            <View>
              <Text style={styles.errorText}>{suppliersLoadError}</Text>
              <Text style={styles.helper}>
                Reintenta o revisa tu conexión antes de continuar.
              </Text>
            </View>
          ) : suppliers.length === 0 && !suppliersQuery.isLoading ? (
            <Text style={styles.helper}>
              No hay proveedores registrados. Crea uno desde Inventario › Proveedores.
            </Text>
          ) : (
            <View style={styles.chipsRow}>
              {suppliers.map((s) => (
                <Pressable
                  key={s.id}
                  style={[styles.chip, supplierId === String(s.id) && styles.chipActive]}
                  onPress={() => setSupplierId(String(s.id))}
                >
                  <Text
                    style={[styles.chipText, supplierId === String(s.id) && styles.chipTextActive]}
                  >
                    {s.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>
            Ubicación destino <Text style={styles.required}>*</Text>
          </Text>
          <Text style={styles.helper}>
            Bodega, tienda o centro de distribución donde entra el stock al recibir.
          </Text>
          {locationsLoadError ? (
            <View>
              <Text style={styles.errorText}>{locationsLoadError}</Text>
              <Text style={styles.helper}>
                Reintenta o revisa tu conexión antes de continuar.
              </Text>
            </View>
          ) : locations.length === 0 && !locationsQuery.isLoading ? (
            <Text style={styles.helper}>
              No hay ubicaciones activas. Crea una desde Inventario › Ubicaciones.
            </Text>
          ) : (
            <View style={styles.chipsRow}>
              {locations.map((loc) => (
                <Pressable
                  key={loc.id}
                  style={[styles.chip, locationId === String(loc.id) && styles.chipActive]}
                  onPress={() => setLocationId(String(loc.id))}
                >
                  <Text
                    style={[styles.chipText, locationId === String(loc.id) && styles.chipTextActive]}
                    numberOfLines={1}
                  >
                    {locationLabel(loc)}
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
            disabled={!supplierId || !locationId || createMutation.isPending}
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
  errorText: { fontSize: typography.fontSize.xs, color: colors.error, marginTop: spacing[1], fontWeight: typography.fontWeight.medium },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginBottom: spacing[3] },
  loadingText: { fontSize: typography.fontSize.xs, color: colorScales.gray[500] },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  chip: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    backgroundColor: colorScales.gray[100],
    borderRadius: borderRadius.full,
    maxWidth: '100%',
  },
  chipActive: { backgroundColor: colors.primary },
  chipText: { fontSize: typography.fontSize.sm, color: colorScales.gray[700] },
  chipTextActive: { color: '#fff', fontWeight: typography.fontWeight.semibold },
  actions: { marginVertical: spacing[4] },
  note: { fontSize: typography.fontSize.xs, color: colorScales.gray[500] },
});
