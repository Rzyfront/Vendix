import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { Icon } from '@/shared/components/icon/icon';
import { Toggle } from '@/shared/components/toggle/toggle';
import { borderRadius, colorScales, colors } from '@/shared/theme';
import { getUomCatalog, type UnitOfMeasure } from '@/features/store/services/uom.service';
import { getQtyControlSize } from '../constants';
import type { PreBulkData } from '../types';

interface PopPrebulkModalProps {
  visible: boolean;
  onConfirm: (data: PreBulkData) => void;
  onCancel: () => void;
}

export default function PopPrebulkModal({ visible, onConfirm, onCancel }: PopPrebulkModalProps) {
  const { width: SCREEN_WIDTH } = useWindowDimensions();
  // Tamaños responsive del bloque Cantidad (- [qty] +) compartidos con
  // pop-config-modal via `getQtyControlSize`.
  const { btnSize: QTY_BTN_SIZE, fontSize: QTY_FONT_SIZE, hPad: QTY_H_PAD } = getQtyControlSize(SCREEN_WIDTH);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [basePrice, setBasePrice] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [notes, setNotes] = useState('');

  // ----------------------------------------------------------------
  // UoM (Fase 5 parity con web prebulk modal — solo visible si la tienda
  // soporta ingredientes, e.g. restaurant industry). El catálogo es global /
  // read-only y se cachea en el service.
  // ----------------------------------------------------------------
  const [isIngredient, setIsIngredient] = useState(false);
  const [uomCatalog, setUomCatalog] = useState<UnitOfMeasure[]>([]);
  const [purchaseUomId, setPurchaseUomId] = useState<number | null>(null);
  const [stockUomId, setStockUomId] = useState<number | null>(null);
  const [uomError, setUomError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setName('');
      setCode('');
      setDescription('');
      setUnitCost('');
      setBasePrice('');
      setQuantity('1');
      setNotes('');
      setIsIngredient(false);
      setPurchaseUomId(null);
      setStockUomId(null);
      setUomError(null);
    }
  }, [visible]);

  // Fetch del catálogo UoM en background al primer mount (cache a nivel de
  // service). No bloquea el render — la sección UoM solo aparece si el toggle
  // está ON.
  useEffect(() => {
    if (!isIngredient || uomCatalog.length > 0) return;
    getUomCatalog()
      .then(setUomCatalog)
      .catch((err: any) => {
        // No fatal: retail mode sigue funcionando. Solo bloqueamos confirm
        // si el usuario está en ingredient mode y el catálogo no carga.
        setUomError(err?.message || 'No se pudo cargar el catálogo de UoM');
      });
  }, [isIngredient, uomCatalog.length]);

  // Factor de conversión purchase → stock (preview en tiempo real). Solo si
  // ambos UoMs están seleccionados y pertenecen a la misma dimensión (mismo
  // dominio: masa, volumen o count).
  const unitCapacity = useMemo(() => {
    if (!purchaseUomId || !stockUomId) return null;
    const purchase = uomCatalog.find((u) => u.id === purchaseUomId);
    const stock = uomCatalog.find((u) => u.id === stockUomId);
    if (!purchase || !stock) return null;
    if (purchase.dimension !== stock.dimension) return null;
    const pf = Number(purchase.factor_to_base);
    const sf = Number(stock.factor_to_base);
    if (!Number.isFinite(pf) || !Number.isFinite(sf) || pf <= 0) return null;
    const factor = Math.round((pf / sf) * 1e6) / 1e6;
    return { factor, purchaseCode: purchase.code, stockCode: stock.code };
  }, [purchaseUomId, stockUomId, uomCatalog]);

  // Cuando el toggle se apaga, limpiamos los UoM FKs (no dejamos data sucia).
  const handleIngredientToggle = (value: boolean) => {
    setIsIngredient(value);
    if (!value) {
      setPurchaseUomId(null);
      setStockUomId(null);
    }
  };

  const totalPreview = useMemo(() => {
    return (Number(unitCost) || 0) * (Number(quantity) || 1);
  }, [unitCost, quantity]);

  const handleConfirm = () => {
    if (!name.trim() || !code.trim()) return;
    // Si es insumo, requerimos ambos UoMs antes de confirmar.
    if (isIngredient && (!purchaseUomId || !stockUomId)) return;
    onConfirm({
      name: name.trim(),
      code: code.trim(),
      description: description.trim() || undefined,
      base_price: Number(basePrice) || undefined,
      unit_cost: Number(unitCost) || undefined,
      quantity: Math.max(1, Number(quantity) || 1),
      notes: notes.trim() || undefined,
      is_ingredient: isIngredient || undefined,
      purchase_uom_id: isIngredient ? purchaseUomId : null,
      stock_uom_id: isIngredient ? stockUomId : null,
      is_sellable: !isIngredient,
    });
  };

  const isValid =
    name.trim().length > 0 &&
    code.trim().length > 0 &&
    (!isIngredient || (!!purchaseUomId && !!stockUomId));

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <View style={styles.header}>
            <View style={styles.headerTitle}>
              <Icon name="info" size={22} color={colors.primary} />
              <View style={styles.headerText}>
                <Text style={styles.title}>Agregar Producto Nuevo</Text>
                <Text style={styles.subtitle}>Se creará en tu catálogo al confirmar la orden</Text>
              </View>
            </View>
            <TouchableOpacity onPress={onCancel} style={styles.closeBtn}>
              <Icon name="x" size={22} color="#6b7280" />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled">
            {/* Info banner */}
            <View style={styles.infoBanner}>
              <Icon name="info" size={18} color="#2563eb" />
              <View style={styles.infoBannerText}>
                <Text style={styles.infoBannerTitle}>Producto nuevo</Text>
                <Text style={styles.infoBannerDesc}>
                  Se creará automáticamente en tu catálogo al confirmar la orden. Podrás editarlo luego desde Productos.
                </Text>
              </View>
            </View>

            {/* Section: Información básica */}
            <Text style={styles.sectionTitle}>INFORMACIÓN BÁSICA</Text>

            <Text style={styles.label}>Nombre del Producto <Text style={styles.required}>*</Text></Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Ej: Material genérico"
              placeholderTextColor="#9ca3af"
            />

            <View style={styles.row2}>
              <View style={styles.row2Field}>
                <Text style={styles.label}>SKU / Código <Text style={styles.required}>*</Text></Text>
                <TextInput
                  style={styles.input}
                  value={code}
                  onChangeText={setCode}
                  placeholder="Ej: MAN-001"
                  placeholderTextColor="#9ca3af"
                />
              </View>
              <View style={styles.row2Field}>
                <Text style={styles.label}>Descripción corta</Text>
                <TextInput
                  style={styles.input}
                  value={description}
                  onChangeText={setDescription}
                  placeholder="Opcional"
                  placeholderTextColor="#9ca3af"
                />
              </View>
            </View>

            {/* Section: Precio y costo */}
            <Text style={styles.sectionTitle}>PRECIO Y COSTO</Text>

            <View style={styles.row2}>
              <View style={styles.row2Field}>
                <Text style={styles.label}>Costo Unitario</Text>
                <View style={styles.priceInputWrap}>
                  <Text style={styles.pricePrefix}>$</Text>
                  <TextInput
                    style={styles.priceInput}
                    value={unitCost}
                    onChangeText={setUnitCost}
                    keyboardType="decimal-pad"
                    placeholder="0.00"
                    placeholderTextColor="#9ca3af"
                  />
                </View>
              </View>
              <View style={styles.row2Field}>
                <Text style={styles.label}>Precio de Venta</Text>
                <View style={styles.priceInputWrap}>
                  <Text style={styles.pricePrefix}>$</Text>
                  <TextInput
                    style={styles.priceInput}
                    value={basePrice}
                    onChangeText={setBasePrice}
                    keyboardType="decimal-pad"
                    placeholder="0.00"
                    placeholderTextColor="#9ca3af"
                  />
                </View>
              </View>
            </View>

            {/* Total preview */}
            <View style={styles.totalPreview}>
              <View style={styles.totalPreviewLeft}>
                <Icon name="calculator" size={16} color="#6b7280" />
                <Text style={styles.totalPreviewLabel}>Total estimado</Text>
              </View>
              <Text style={styles.totalPreviewValue}>${totalPreview.toLocaleString()}</Text>
            </View>

            {/* ----------------------------------------------------------------
                Ingredient classification + UoM catalog (Fase 5 parity con web).
                En mobile actual no hay detection de industry aún, así que el
                toggle se muestra siempre (default OFF). Si la tienda no soporta
                ingredientes (e.g. retail puro) el usuario simplemente no lo
                activará.
               ---------------------------------------------------------------- */}
            <Text style={styles.sectionTitle}>CLASIFICACIÓN</Text>
            <Toggle
              value={isIngredient}
              onChange={handleIngredientToggle}
              label="Es un insumo"
              description="Marca este producto como insumo para recetas. Se medirá por unidades de compra y stock con factor de conversión."
            />

            {isIngredient && (
              <View style={styles.uomCard}>
                <View style={styles.uomCardHeader}>
                  <Icon name="package" size={14} color={colors.primary} />
                  <Text style={styles.uomCardTitle}>Unidad de medida del insumo</Text>
                </View>
                <Text style={styles.uomCardHint}>
                  Captura el costo por la <Text style={styles.uomCardHintStrong}>unidad de compra</Text> (la presentación que llega del proveedor). El sistema lo convertirá a la unidad de stock con el factor de la UoM.
                </Text>

                <View style={styles.uomRow}>
                  <View style={styles.uomField}>
                    <Text style={styles.label}>Unidad de compra <Text style={styles.required}>*</Text></Text>
                    <UomSelect
                      value={purchaseUomId}
                      options={uomCatalog}
                      onChange={setPurchaseUomId}
                      placeholder="Seleccionar..."
                    />
                  </View>
                  <View style={styles.uomField}>
                    <Text style={styles.label}>Unidad de stock <Text style={styles.required}>*</Text></Text>
                    <UomSelect
                      value={stockUomId}
                      options={uomCatalog}
                      onChange={setStockUomId}
                      placeholder="Seleccionar..."
                    />
                  </View>
                </View>

                {uomError && (
                  <Text style={styles.uomError}>{uomError}</Text>
                )}

                {unitCapacity && (
                  <View style={styles.uomPreview}>
                    <Icon name="zap" size={14} color={colors.primary} />
                    <Text style={styles.uomPreviewText}>
                      1 {unitCapacity.purchaseCode} = {unitCapacity.factor} {unitCapacity.stockCode}
                    </Text>
                  </View>
                )}
              </View>
            )}

            {/* Section: Cantidad y notas */}
            <Text style={styles.sectionTitle}>CANTIDAD Y NOTAS</Text>

            <Text style={styles.label}>Cantidad</Text>
            <View style={styles.qtyRow}>
              <TouchableOpacity
                style={[styles.qtyBtn, { width: QTY_BTN_SIZE, height: QTY_BTN_SIZE }]}
                onPress={() => setQuantity(String(Math.max(1, Number(quantity) - 1)))}
              >
                <Icon name="minus" size={18} color="#374151" />
              </TouchableOpacity>
              <TextInput
                style={[styles.qtyInput, { fontSize: QTY_FONT_SIZE, paddingHorizontal: QTY_H_PAD }]}
                value={quantity}
                onChangeText={setQuantity}
                keyboardType="numeric"
                selectTextOnFocus
              />
              <TouchableOpacity
                style={[styles.qtyBtn, { width: QTY_BTN_SIZE, height: QTY_BTN_SIZE }]}
                onPress={() => setQuantity(String(Number(quantity) + 1))}
              >
                <Icon name="plus" size={18} color="#374151" />
              </TouchableOpacity>
            </View>

            <Text style={[styles.label, { marginTop: 14 }]}>Notas</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={notes}
              onChangeText={setNotes}
              placeholder="Notas adicionales sobre este producto..."
              placeholderTextColor="#9ca3af"
              multiline
              numberOfLines={2}
            />
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onCancel}>
              <Text style={styles.cancelText}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.confirmBtn, !isValid && styles.confirmBtnDisabled]}
              onPress={handleConfirm}
              disabled={!isValid}
            >
              <Icon name="shopping-cart" size={16} color="#fff" />
              <Text style={styles.confirmText}>Agregar al carrito</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ----------------------------------------------------------------------------
// UomSelect — single-select dropdown para el catálogo de UoM. Mismo patrón
// que `SupplierDropdown` / `LocationDropdown` en `pop-header.tsx` (TouchableOpacity
// que abre un Modal con ScrollView). Como el catálogo es chico (< 30 unidades)
// y agrupado por dimensión, el dropdown se ve completo sin búsqueda.
// ----------------------------------------------------------------------------
interface UomSelectProps {
  value: number | null;
  options: UnitOfMeasure[];
  onChange: (id: number | null) => void;
  placeholder?: string;
}

function UomSelect({ value, options, onChange, placeholder }: UomSelectProps) {
  const [open, setOpen] = useState(false);

  const selected = value ? options.find((u) => u.id === value) : null;

  // Agrupa las UoMs por dimensión para visual scanning más rápido.
  const grouped = useMemo(() => {
    const groups: Record<string, UnitOfMeasure[]> = {};
    for (const u of options) {
      if (!groups[u.dimension]) groups[u.dimension] = [];
      groups[u.dimension].push(u);
    }
    return groups;
  }, [options]);

  const dimLabel = (d: string) =>
    d === 'mass' ? 'Masa' : d === 'volume' ? 'Volumen' : 'Conteo';

  return (
    <View>
      <TouchableOpacity
        style={styles.uomSelectBtn}
        activeOpacity={0.7}
        onPress={() => setOpen(true)}
      >
        <Text
          style={[styles.uomSelectValue, !selected && styles.uomSelectPlaceholder]}
          numberOfLines={1}
        >
          {selected ? `${selected.code} · ${selected.name}` : placeholder || 'Seleccionar...'}
        </Text>
        <Icon name="chevron-down" size={16} color={colorScales.gray[400]} />
      </TouchableOpacity>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <TouchableOpacity
          style={styles.uomModalBackdrop}
          activeOpacity={1}
          onPress={() => setOpen(false)}
        >
          <TouchableOpacity activeOpacity={1} style={styles.uomModalCard}>
            <View style={styles.uomModalHeader}>
              <Text style={styles.uomModalTitle}>Unidad de medida</Text>
              <TouchableOpacity onPress={() => setOpen(false)} style={styles.uomModalClose}>
                <Icon name="x" size={20} color={colorScales.gray[500]} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.uomModalList} keyboardShouldPersistTaps="handled">
              {Object.keys(grouped).length === 0 && (
                <Text style={styles.uomModalEmpty}>Sin unidades disponibles</Text>
              )}
              {Object.entries(grouped).map(([dim, units]) => (
                <View key={dim} style={styles.uomModalGroup}>
                  <Text style={styles.uomModalGroupLabel}>{dimLabel(dim)}</Text>
                  {units.map((u) => {
                    const active = u.id === value;
                    return (
                      <TouchableOpacity
                        key={u.id}
                        style={[styles.uomDropdownItem, active && styles.uomDropdownItemActive]}
                        onPress={() => {
                          onChange(u.id);
                          setOpen(false);
                        }}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={styles.uomDropdownItemLabel}>
                            {u.code} · {u.name}
                          </Text>
                          {!u.is_base && (
                            <Text style={styles.uomDropdownItemSubLabel}>
                              factor {Number(u.factor_to_base)}
                            </Text>
                          )}
                        </View>
                        {u.is_base && (
                          <Text style={styles.uomDropdownItemDim}>base</Text>
                        )}
                        {active && <Icon name="check" size={16} color={colors.primary} />}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ))}
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  // Contenedor del modal — mismo estilo de card que customers.tsx
  modal: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    width: '100%',
    maxWidth: 480,
    maxHeight: '90%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 8,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colorScales.gray[200] },
  headerTitle: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, flex: 1, marginRight: 12 },
  headerText: { flex: 1 },
  closeBtn: { padding: 4 },
  title: { fontSize: 16, fontWeight: '700', color: colorScales.gray[900] },
  subtitle: { fontSize: 11, color: colorScales.gray[500], marginTop: 2 },
  body: { paddingHorizontal: 16, maxHeight: 420 },
  bodyContent: { paddingTop: 16, paddingBottom: 24 },
  infoBanner: { flexDirection: 'row', gap: 10, backgroundColor: colorScales.blue[50], borderRadius: 10, borderWidth: 1, borderColor: colorScales.blue[200], padding: 12, marginBottom: 16, alignItems: 'flex-start' },
  infoBannerText: { flex: 1 },
  infoBannerTitle: { fontSize: 12, fontWeight: '700', color: colorScales.blue[800] },
  infoBannerDesc: { fontSize: 11, color: colorScales.blue[900], marginTop: 2, lineHeight: 15 },
  sectionTitle: { fontSize: 10, fontWeight: '700', color: colorScales.gray[500], letterSpacing: 0.5, marginBottom: 10, marginTop: 6 },
  label: { fontSize: 12, fontWeight: '600', color: colorScales.gray[700], marginBottom: 6 },
  required: { color: colors.error },
  input: { borderWidth: 1, borderColor: colorScales.gray[300], borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: colorScales.gray[900], backgroundColor: colors.background },
  textArea: { minHeight: 60, textAlignVertical: 'top' },
  row2: { flexDirection: 'row', gap: 8, marginTop: 12, marginBottom: 4 },
  row2Field: { flex: 1 },
  priceInputWrap: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colorScales.gray[300], borderRadius: 8, paddingHorizontal: 10, backgroundColor: colors.background },
  pricePrefix: { fontSize: 15, fontWeight: '600', color: colorScales.gray[500], marginRight: 4 },
  priceInput: { flex: 1, fontSize: 15, fontWeight: '600', paddingVertical: 9, color: colorScales.gray[900] },
  totalPreview: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colorScales.gray[50], borderRadius: 8, borderWidth: 1, borderColor: colorScales.gray[200], paddingHorizontal: 14, paddingVertical: 12, marginVertical: 12 },
  totalPreviewLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  totalPreviewLabel: { fontSize: 12, color: colorScales.gray[500] },
  totalPreviewValue: { fontSize: 18, fontWeight: '800', color: colorScales.green[700] },
  // UoM (Fase 5 parity con web prebulk)
  uomCard: {
    backgroundColor: colors.primaryLight,
    borderWidth: 1,
    borderColor: colorScales.green[200],
    borderRadius: 10,
    padding: 12,
    gap: 10,
    marginTop: 10,
  },
  uomCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  uomCardTitle: { fontSize: 10, fontWeight: '700', color: colors.primary, textTransform: 'uppercase', letterSpacing: 0.5 },
  uomCardHint: { fontSize: 11, color: colorScales.gray[700], lineHeight: 16 },
  uomCardHintStrong: { fontWeight: '700' },
  uomRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  uomField: { flex: 1 },
  uomError: { fontSize: 11, color: colors.error, marginTop: 4 },
  uomPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colorScales.green[200],
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 4,
  },
  uomPreviewText: { fontSize: 12, fontWeight: '600', color: colors.primary },
  // UoM select dropdown
  uomSelectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colorScales.gray[300],
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
    backgroundColor: colors.background,
  },
  uomSelectValue: { flex: 1, fontSize: 14, color: colorScales.gray[900] },
  uomSelectPlaceholder: { color: colorScales.gray[400] },
  uomDropdownOverlay: {
    position: 'absolute',
    backgroundColor: colors.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
    maxHeight: 240,
    zIndex: 100,
  },
  uomDropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  uomDropdownItemActive: { backgroundColor: colors.primaryLight },
  uomDropdownItemLabel: { fontSize: 13, color: colorScales.gray[900] },
  uomDropdownItemSubLabel: { fontSize: 11, color: colorScales.gray[500], marginTop: 1 },
  uomDropdownItemDim: { fontSize: 10, color: colorScales.gray[400], textTransform: 'uppercase' },
  // UoM dropdown modal
  uomModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  uomModalCard: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.lg,
    width: '100%',
    maxWidth: 380,
    maxHeight: '85%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 10,
    overflow: 'hidden',
  },
  uomModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[200],
  },
  uomModalTitle: { fontSize: 15, fontWeight: '700', color: colorScales.gray[900] },
  uomModalClose: { padding: 4 },
  uomModalList: { maxHeight: 380 },
  uomModalEmpty: {
    textAlign: 'center',
    paddingVertical: 24,
    color: colorScales.gray[500],
    fontSize: 13,
  },
  uomModalGroup: { paddingVertical: 4 },
  uomModalGroupLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: colorScales.gray[500],
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 4,
    backgroundColor: colorScales.gray[50],
  },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  qtyBtn: {
    borderRadius: 8,
    backgroundColor: colorScales.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  qtyInput: {
    flex: 1,
    minWidth: 0,
    borderWidth: 1,
    borderColor: colorScales.gray[300],
    borderRadius: 8,
    paddingVertical: 9,
    fontWeight: '700',
    textAlign: 'center',
    color: colorScales.gray[900],
  },
  footer: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colorScales.gray[200], backgroundColor: colorScales.gray[50] },
  cancelBtn: { flex: 1, paddingVertical: 12, borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colorScales.gray[300], alignItems: 'center', backgroundColor: colors.background },
  cancelText: { fontSize: 14, fontWeight: '700', color: colorScales.gray[700] },
  confirmBtn: { flex: 1, flexDirection: 'row', paddingVertical: 12, borderRadius: borderRadius.lg, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', gap: 6, shadowColor: colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 6, elevation: 4 },
  // Disabled: verde opaco (no gris) — como la web cuando faltan datos obligatorios
  confirmBtnDisabled: { backgroundColor: 'rgba(34,197,94,0.4)', shadowOpacity: 0, opacity: 0.6 },
  confirmText: { fontSize: 14, fontWeight: '700', color: colors.background },
});
