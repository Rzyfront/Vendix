import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  ScrollView,
  StyleSheet,
  Switch,
  ActivityIndicator,
  useWindowDimensions,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { borderRadius, colorScales, colors } from '@/shared/theme';
import { apiPost, apiDelete } from '@/core/api/http';
import { Endpoints } from '@/core/api/endpoints';
import { DatePickerField } from '@/shared/components/date-picker-field/date-picker-field';
import type {
  PopProduct,
  PopProductVariant,
  PopProductConfigResult,
  PricingType,
  VariantAttributeDraft,
  GeneratedVariantDraft,
} from '../types';
import { defaultUnitCost, getQtyControlSize } from '../constants';

interface PopConfigModalProps {
  visible: boolean;
  product: PopProduct | null;
  onConfirm: (result: PopProductConfigResult) => void;
  onCancel: () => void;
}

type ConfigTab = 'general' | 'variants' | 'lot';

/** Payload que espera `POST /store/products/:productId/variants` (parity web). */
interface CreateVariantPayload {
  sku: string;
  name: string;
  cost_price: number;
  attributes: Record<string, string>;
  stock_quantity?: number;
}

/** Quick attributes para variant creation — parity con web. */
const QUICK_ATTRIBUTES = ['Color', 'Talla', 'Material'] as const;

export default function PopConfigModal({ visible, product, onConfirm, onCancel }: PopConfigModalProps) {
  const { width: SCREEN_WIDTH } = useWindowDimensions();
  // Tamaños responsive del bloque Cantidad (- [qty] +) compartidos con
  // pop-prebulk-modal via `getQtyControlSize`.
  const { btnSize: QTY_BTN_SIZE, fontSize: QTY_FONT_SIZE, hPad: QTY_H_PAD } = getQtyControlSize(SCREEN_WIDTH);
  const [tab, setTab] = useState<ConfigTab>('general');
  const [selectedVariant, setSelectedVariant] = useState<PopProductVariant | null>(null);
  /** Multi-select para variantes existentes (parity web con `selectedVariantIds`). */
  const [selectedVariantIds, setSelectedVariantIds] = useState<Set<number>>(new Set());
  const [quantity, setQuantity] = useState('1');
  const [unitCost, setUnitCost] = useState('0');
  const [batchNumber, setBatchNumber] = useState('');
  const [manufacturingDate, setManufacturingDate] = useState('');
  const [expirationDate, setExpirationDate] = useState('');
  const [pricingType, setPricingType] = useState<PricingType>('unit');

  const [manageVariants, setManageVariants] = useState(false);
  const [manageLot, setManageLot] = useState(false);

  // ----------------------------------------------------------------
  // Variant creation state (parity con web — Fase 5 unified modal).
  // ----------------------------------------------------------------
  /** Atributos en edición (Color, Talla, etc.). */
  const [variantAttributes, setVariantAttributes] = useState<VariantAttributeDraft[]>([]);
  /** Variantes pre-calculadas (cartesian product de attributes.values). */
  const [generatedVariants, setGeneratedVariants] = useState<GeneratedVariantDraft[]>([]);
  /** Set de IDs de atributos ya agregados — evita duplicados en quick-add. */
  const attributeNamesLower = useMemo(
    () => new Set(variantAttributes.map((a) => a.name.toLowerCase())),
    [variantAttributes],
  );
  /** Mientras POSTea las variantes al backend. */
  const [creatingVariants, setCreatingVariants] = useState(false);

  const variants = product?.product_variants || [];
  const hasVariants = variants.length > 0;
  /**
   * Si el toggle está ON y el producto NO tiene variantes → variant creation mode.
   * Si tiene → existing variant selection mode (multi-select).
   * Parity con `isCreatingVariants` web (config-product-config-modal.component.ts:726).
   */
  const isCreatingVariants = manageVariants && !hasVariants;
  const isSelectionMode = manageVariants && hasVariants;

  const tabs: { key: ConfigTab; label: string; icon: string }[] = [{ key: 'general', label: 'General', icon: 'settings-outline' }];
  if (manageVariants) tabs.push({ key: 'variants', label: 'Variantes', icon: 'layers-outline' });
  if (manageLot) tabs.push({ key: 'lot', label: 'Lote', icon: 'cube-outline' });

  useEffect(() => {
    if (visible) {
      setTab('general');
      setSelectedVariant(null);
      setSelectedVariantIds(new Set());
      setQuantity('1');
      const def = product ? defaultUnitCost(product, null) : 0;
      setUnitCost(String(def));
      setBatchNumber('');
      setManufacturingDate('');
      setExpirationDate('');
      setManageVariants(false);
      setManageLot(false);
      setPricingType(product?.pricing_type || 'unit');
      setVariantAttributes([]);
      setGeneratedVariants([]);
      setCreatingVariants(false);
    }
  }, [visible, product]);

  // Si la tab activa desaparece (porque el toggle se apagó), volver a 'general'.
  useEffect(() => {
    if (!tabs.find((t) => t.key === tab)) setTab('general');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manageVariants, manageLot]);

  const totalCost = Number(quantity) * Number(unitCost);

  // ----------------------------------------------------------------
  // Variant creation handlers (parity web).
  // ----------------------------------------------------------------

  const addQuickAttribute = (name: string) => {
    if (attributeNamesLower.has(name.toLowerCase())) return;
    setVariantAttributes((prev) => [...prev, { name, values: [] }]);
  };

  const addAttribute = () => {
    setVariantAttributes((prev) => [...prev, { name: '', values: [] }]);
  };

  const updateAttributeName = (index: number, name: string) => {
    setVariantAttributes((prev) => {
      const next = prev.slice();
      next[index] = { ...next[index], name };
      return next;
    });
  };

  const removeAttribute = (index: number) => {
    setVariantAttributes((prev) => prev.filter((_, i) => i !== index));
    regenerateNext();
  };

  const addAttributeValue = (attrIndex: number, rawValue: string) => {
    const value = rawValue.trim();
    if (!value) return;
    setVariantAttributes((prev) => {
      const attr = prev[attrIndex];
      if (!attr) return prev;
      if (attr.values.some((v) => v.toLowerCase() === value.toLowerCase())) return prev;
      const next = prev.slice();
      next[attrIndex] = { ...attr, values: [...attr.values, value] };
      return next;
    });
    // Regenerate después del setState (microtask para que attributes.values ya tenga el nuevo valor).
    setTimeout(regenerateNext, 0);
  };

  const removeAttributeValue = (attrIndex: number, valueIndex: number) => {
    setVariantAttributes((prev) => {
      const attr = prev[attrIndex];
      if (!attr) return prev;
      const next = prev.slice();
      next[attrIndex] = { ...attr, values: attr.values.filter((_, i) => i !== valueIndex) };
      return next;
    });
    setTimeout(regenerateNext, 0);
  };

  /**
   * Cartesian product de attributes.values → generatedVariants.
   * `attributes` en cada combo es el map atributo→valor (ej: {Color:"Rojo"}).
   * Mirroring `generateNewVariants()` en web.
   */
  const generateNewVariants = (attrs: VariantAttributeDraft[]) => {
    const valid = attrs.filter((a) => a.name.trim() && a.values.length > 0);
    if (valid.length === 0) {
      setGeneratedVariants([]);
      return;
    }
    const combos = cartesian(valid.map((a) => a.values));
    const baseCost = product ? defaultUnitCost(product, null) : 0;
    const baseSku = product?.code || product?.sku || '';
    const baseName = product?.name || 'Product';

    const generated: GeneratedVariantDraft[] = combos.map((combo) => {
      const attributes: Record<string, string> = {};
      let nameSuffix = '';
      let skuSuffix = '';
      valid.forEach((attr, idx) => {
        const v = combo[idx];
        attributes[attr.name] = v;
        nameSuffix += ` ${v}`;
        skuSuffix += `-${v.toUpperCase().slice(0, 3)}`;
      });
      return {
        name: `${baseName}${nameSuffix}`,
        sku: baseSku ? `${baseSku}${skuSuffix}` : `VAR${skuSuffix}`,
        cost_price: baseCost,
        attributes,
      };
    });
    setGeneratedVariants(generated);
  };

  /**
   * Wrapper que lee el state actual y llama a generateNewVariants.
   * Se usa después de cada mutation de variantAttributes.
   */
  const regenerateNext = () => {
    setVariantAttributes((prev) => {
      generateNewVariants(prev);
      return prev;
    });
  };

  const updateGeneratedCost = (index: number, cost: number) => {
    setGeneratedVariants((prev) => {
      const next = prev.slice();
      next[index] = { ...next[index], cost_price: Math.max(0, cost) };
      return next;
    });
  };

  const previewVariantCount = useMemo(() => {
    const valid = variantAttributes.filter((a) => a.name.trim() && a.values.length > 0);
    if (valid.length === 0) return 0;
    return valid.reduce((acc, a) => acc * a.values.length, 1);
  }, [variantAttributes]);

  // ----------------------------------------------------------------
  // Existing variants — multi-select (parity web).
  // ----------------------------------------------------------------

  const toggleVariant = (id: number) => {
    setSelectedVariantIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allVariantsSelected = variants.length > 0 && selectedVariantIds.size === variants.length;

  const toggleSelectAllVariants = () => {
    if (allVariantsSelected) {
      setSelectedVariantIds(new Set());
    } else {
      setSelectedVariantIds(new Set(variants.map((v) => v.id)));
    }
  };

  // ----------------------------------------------------------------
  // Confirm — branch por modo (create variants / select existing / plain).
  // ----------------------------------------------------------------

  const handleConfirm = async () => {
    if (!product) return;

    // Caso A: variant creation mode — POST cada variant y emitir `newVariants`.
    if (isCreatingVariants && generatedVariants.length > 0) {
      setCreatingVariants(true);
      // Creamos las variantes secuencialmente. Si una POST falla,
      // hacemos rollback de las que ya quedaron creadas en backend
      // para evitar variantes huérfanas en el producto.
      const path = Endpoints.STORE.PRODUCTS.VARIANT_CREATE.replace(':productId', String(product.id));
      const created: PopProductVariant[] = [];
      try {
        for (const v of generatedVariants) {
          const created_v = await apiPost<PopProductVariant>(path, {
            sku: v.sku,
            name: v.name,
            cost_price: v.cost_price,
            attributes: v.attributes,
            stock_quantity: 0,
          } as CreateVariantPayload);
          created.push(created_v);
        }
        onConfirm({
          newVariants: created,
          quantity: Math.max(1, Number(quantity) || 1),
          unit_cost: Number(unitCost) || 0,
          pricing_type: pricingType,
          lot_info: manageLot ? {
            batch_number: batchNumber.trim() || undefined,
            manufacturing_date: manufacturingDate.trim() || undefined,
            expiration_date: expirationDate.trim() || undefined,
          } : undefined,
        });
      } catch (err) {
        // Rollback: borrar las variantes que ya quedaron creadas en backend
        // antes de que fallara el loop. Errores de rollback se ignoran (best-effort)
        // para no enmascarar el error original.
        await Promise.all(
          created.map((v) => {
            const delPath = Endpoints.STORE.PRODUCTS.VARIANT_DELETE.replace(':variantId', String(v.id));
            return apiDelete(delPath).catch(() => undefined);
          }),
        );
        setCreatingVariants(false);
        throw err;
      }
      return;
    }

    // Caso B: selección de variantes existentes (multi).
    if (isSelectionMode && selectedVariantIds.size > 0) {
      const selected = variants.filter((v) => selectedVariantIds.has(v.id));
      // Mantener compat: si solo hay 1 seleccionada, `variant` también.
      const single = selected.length === 1 ? selected[0] : null;
      onConfirm({
        variant: single,
        variants: selected,
        quantity: Math.max(1, Number(quantity) || 1),
        unit_cost: Number(unitCost) || 0,
        pricing_type: pricingType,
        lot_info: manageLot ? {
          batch_number: batchNumber.trim() || undefined,
          manufacturing_date: manufacturingDate.trim() || undefined,
          expiration_date: expirationDate.trim() || undefined,
        } : undefined,
      });
      return;
    }

    // Caso C: flujo plain (sin gestión de variantes).
    onConfirm({
      variant: selectedVariant,
      variants: selectedVariant ? undefined : variants,
      quantity: Math.max(1, Number(quantity) || 1),
      unit_cost: Number(unitCost) || 0,
      pricing_type: pricingType,
      lot_info: manageLot ? {
        batch_number: batchNumber.trim() || undefined,
        manufacturing_date: manufacturingDate.trim() || undefined,
        expiration_date: expirationDate.trim() || undefined,
      } : undefined,
    });
  };

  if (!product) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Text style={styles.headerTitle}>Configurar producto</Text>
              <Text style={styles.headerSubtitle} numberOfLines={1}>{product.name}</Text>
            </View>
            <TouchableOpacity onPress={onCancel} disabled={creatingVariants}>
              <Ionicons name="close" size={22} color="#6b7280" />
            </TouchableOpacity>
          </View>

              {/* Tabs dinámicas — General siempre visible; Variantes/Lote aparecen al activar los toggles */}
              <View style={styles.tabsRow}>
                {tabs.map((t) => (
                  <TouchableOpacity
                    key={t.key}
                    style={[styles.tabPill, tab === t.key && styles.tabPillActive]}
                    onPress={() => setTab(t.key)}
                    activeOpacity={0.7}
                    disabled={creatingVariants}
                  >
                    <Ionicons name={t.icon as any} size={14} color={tab === t.key ? colors.card : '#6b7280'} />
                    <Text style={[styles.tabPillText, tab === t.key && styles.tabPillTextActive]}>{t.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

          <ScrollView style={styles.body}>
            {tab === 'general' && (
            <View>
              {/* Card de info del producto — alineado con la web (icono + nombre + costo) */}
              <View style={styles.productInfoCard}>
                <View style={styles.productInfoIcon}>
                  {product.image_url ? (
                    <Image source={{ uri: product.image_url }} style={styles.productImage} />
                  ) : (
                    <Ionicons name="cube-outline" size={20} color="#374151" />
                  )}
                </View>
                <View style={styles.productInfoText}>
                  <Text style={styles.productInfoName} numberOfLines={1}>{product.name}</Text>
                  <Text style={styles.productInfoCost}>Costo: ${Number(unitCost || 0).toLocaleString()}</Text>
                </View>
              </View>

                <Text style={styles.label}>Unidad de medida</Text>
                <View style={styles.pricingRow}>
                  <TouchableOpacity
                    style={[styles.pricingChip, pricingType !== 'weight' && styles.pricingChipActive]}
                    onPress={() => setPricingType('unit')}
                    activeOpacity={0.7}
                    disabled={creatingVariants}
                  >
                    <Text style={[styles.pricingChipText, pricingType !== 'weight' && styles.pricingChipTextActive]}>Unidad</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.pricingChip, pricingType === 'weight' && styles.pricingChipActive]}
                    onPress={() => setPricingType('weight')}
                    activeOpacity={0.7}
                    disabled={creatingVariants}
                  >
                    <Text style={[styles.pricingChipText, pricingType === 'weight' && styles.pricingChipTextActive]}>Peso (kg)</Text>
                  </TouchableOpacity>
                </View>

                <Text style={[styles.label, { marginTop: 16 }]}>Cantidad</Text>
                <View style={styles.qtyRow}>
                  <TouchableOpacity
                    style={[styles.qtyBtn, { width: QTY_BTN_SIZE, height: QTY_BTN_SIZE }]}
                    onPress={() => setQuantity(String(Math.max(1, Number(quantity) - 1)))}
                    disabled={creatingVariants}
                  >
                    <Ionicons name="remove" size={18} color="#374151" />
                  </TouchableOpacity>
                  <TextInput
                    style={[styles.qtyInput, { fontSize: QTY_FONT_SIZE, paddingHorizontal: QTY_H_PAD }]}
                    value={quantity}
                    onChangeText={setQuantity}
                    keyboardType="numeric"
                    editable={!creatingVariants}
                    selectTextOnFocus
                  />
                  <TouchableOpacity
                    style={[styles.qtyBtn, { width: QTY_BTN_SIZE, height: QTY_BTN_SIZE }]}
                    onPress={() => setQuantity(String(Number(quantity) + 1))}
                    disabled={creatingVariants}
                  >
                    <Ionicons name="add" size={18} color="#374151" />
                  </TouchableOpacity>
                </View>

                <Text style={[styles.label, { marginTop: 16 }]}>Costo unitario</Text>
                <View style={styles.costInputWrap}>
                  <Text style={styles.costPrefix}>$</Text>
                  <TextInput
                    style={styles.costInput}
                    value={unitCost}
                    onChangeText={setUnitCost}
                    keyboardType="decimal-pad"
                    editable={!creatingVariants}
                  />
                </View>

                {/* Toggle switches for variants and lot */}
                <View style={styles.togglesSection}>
                  <TouchableOpacity style={styles.settingToggleRow} onPress={() => setManageVariants(!manageVariants)} activeOpacity={0.7} disabled={creatingVariants}>
                    <View style={styles.settingToggleInfo}>
                      <Text style={styles.settingToggleLabel}>Gestionar variantes</Text>
                      <Text style={styles.settingToggleDesc}>
                        {hasVariants
                          ? 'Seleccionar variantes del producto para la orden'
                          : 'Crear variantes para este producto'}
                      </Text>
                    </View>
                    <Switch
                      value={manageVariants}
                      onValueChange={setManageVariants}
                      trackColor={{ false: '#d1d5db', true: '#86efac' }}
                      thumbColor={manageVariants ? '#22C55E' : '#f4f3f4'}
                      disabled={creatingVariants}
                    />
                  </TouchableOpacity>

                  <TouchableOpacity style={styles.settingToggleRow} onPress={() => setManageLot(!manageLot)} activeOpacity={0.7} disabled={creatingVariants}>
                    <View style={styles.settingToggleInfo}>
                      <Text style={styles.settingToggleLabel}>Gestionar lote</Text>
                      <Text style={styles.settingToggleDesc}>Asignar número de lote y fechas de fabricación/vencimiento</Text>
                    </View>
                    <Switch
                      value={manageLot}
                      onValueChange={setManageLot}
                      trackColor={{ false: '#d1d5db', true: '#86efac' }}
                      thumbColor={manageLot ? '#22C55E' : '#f4f3f4'}
                      disabled={creatingVariants}
                    />
                  </TouchableOpacity>
                </View>

                <View style={styles.totalPreview}>
                  <Text style={styles.totalPreviewLabel}>Total:</Text>
                  <Text style={styles.totalPreviewValue}>${totalCost.toLocaleString()}</Text>
                </View>
            </View>
            )}

            {tab === 'variants' && (
              <View>
                {isCreatingVariants ? (
                  /* ----------------------------------------------------------------
                   * Variant Creation Mode — parity con web
                   * (pop-product-config-modal.component.ts:305-484).
                   * ---------------------------------------------------------------- */
                  <View>
                    {/* Quick attribute buttons */}
                    <View style={styles.quickAttrRow}>
                      {QUICK_ATTRIBUTES.map((attr) => (
                        <TouchableOpacity
                          key={attr}
                          style={[
                            styles.quickAttrChip,
                            attributeNamesLower.has(attr.toLowerCase()) && styles.quickAttrChipDisabled,
                          ]}
                          onPress={() => addQuickAttribute(attr)}
                          disabled={attributeNamesLower.has(attr.toLowerCase()) || creatingVariants}
                          activeOpacity={0.7}
                        >
                          <Ionicons name="add" size={12} color={colors.primary} />
                          <Text style={styles.quickAttrChipText}>{attr}</Text>
                        </TouchableOpacity>
                      ))}
                      <TouchableOpacity
                        style={styles.quickAttrChipCustom}
                        onPress={addAttribute}
                        disabled={creatingVariants}
                        activeOpacity={0.7}
                      >
                        <Ionicons name="add" size={12} color={colors.text.secondary} />
                        <Text style={styles.quickAttrChipCustomText}>Personalizado</Text>
                      </TouchableOpacity>
                    </View>

                    {/* Attribute editor (name + chip values) */}
                    {variantAttributes.map((attr, attrIdx) => (
                      <VariantAttributeRow
                        key={attrIdx}
                        index={attrIdx}
                        name={attr.name}
                        values={attr.values}
                        onChangeName={(name) => updateAttributeName(attrIdx, name)}
                        onCommitName={regenerateNext}
                        onAddValue={(value) => addAttributeValue(attrIdx, value)}
                        onRemoveValue={(valueIdx) => removeAttributeValue(attrIdx, valueIdx)}
                        onRemove={() => removeAttribute(attrIdx)}
                        disabled={creatingVariants}
                      />
                    ))}

                    {/* Preview count + Generar */}
                    {previewVariantCount > 0 && (
                      <View style={styles.previewRow}>
                        <View style={styles.previewInfo}>
                          <Ionicons name="layers-outline" size={16} color={colors.primary} />
                          <Text style={styles.previewText}>
                            Se generarán <Text style={styles.previewTextBold}>{previewVariantCount}</Text> variantes
                          </Text>
                        </View>
                      </View>
                    )}

                    {/* Generated variants list with per-variant cost input */}
                    {generatedVariants.length > 0 && (
                      <View>
                        <Text style={styles.generatedHeader}>
                          {generatedVariants.length} variantes generadas
                        </Text>
                        {generatedVariants.map((v, idx) => (
                          <View key={`${v.sku}-${idx}`} style={styles.generatedRow}>
                            <View style={styles.generatedIcon}>
                              <Ionicons name="layers-outline" size={14} color={colors.primary} />
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.generatedName} numberOfLines={1}>{v.name}</Text>
                              <Text style={styles.generatedSku} numberOfLines={1}>{v.sku}</Text>
                            </View>
                            <View style={styles.generatedCostWrap}>
                              <Text style={styles.generatedCostPrefix}>$</Text>
                              <TextInput
                                style={styles.generatedCostInput}
                                value={String(v.cost_price || 0)}
                                onChangeText={(t) => updateGeneratedCost(idx, Number(t.replace(/[^0-9.]/g, '')) || 0)}
                                keyboardType="decimal-pad"
                                editable={!creatingVariants}
                              />
                            </View>
                          </View>
                        ))}
                      </View>
                    )}

                    {variantAttributes.length === 0 && (
                      <Text style={styles.emptyTabText}>
                        Agrega atributos para crear variantes del producto.
                      </Text>
                    )}
                  </View>
                ) : isSelectionMode ? (
                  /* ----------------------------------------------------------------
                   * Existing Variant Selection Mode — multi-select con checkbox,
                   * counter y select-all (parity web).
                   * ---------------------------------------------------------------- */
                  <View>
                    <View style={styles.selectionHeader}>
                      <Text style={styles.selectionCounter}>
                        {selectedVariantIds.size} de {variants.length} seleccionadas
                      </Text>
                      <TouchableOpacity onPress={toggleSelectAllVariants} disabled={creatingVariants}>
                        <Text style={styles.selectionToggleAll}>
                          {allVariantsSelected ? 'Deseleccionar todas' : 'Seleccionar todas'}
                        </Text>
                      </TouchableOpacity>
                    </View>

                    {variants.map((v) => {
                      const isActive = selectedVariantIds.has(v.id);
                      return (
                        <TouchableOpacity
                          key={v.id}
                          style={[styles.variantItem, isActive && styles.variantItemActive]}
                          onPress={() => toggleVariant(v.id)}
                          activeOpacity={0.7}
                          disabled={creatingVariants}
                        >
                          <View style={[styles.variantCheckbox, isActive && styles.variantCheckboxActive]}>
                            {isActive && <Ionicons name="checkmark" size={12} color={colors.card} />}
                          </View>
                          <View style={styles.variantIconWrap}>
                            <Ionicons name="layers-outline" size={18} color={colors.text.muted} />
                          </View>
                          <View style={styles.variantInfo}>
                            <Text style={styles.variantName} numberOfLines={1}>{v.name || v.sku || `Variante #${v.id}`}</Text>
                            {v.sku && <Text style={styles.variantSku}>SKU: {v.sku}</Text>}
                          </View>
                          <View style={styles.variantRight}>
                            {v.cost_price != null && (
                              <Text style={styles.variantPrice}>${Number(v.cost_price).toLocaleString()}</Text>
                            )}
                            {v.stock_quantity != null && (
                              <Text style={styles.variantStock}>{v.stock_quantity} disp.</Text>
                            )}
                          </View>
                        </TouchableOpacity>
                      );
                    })}

                    {variants.length === 0 && (
                      <View style={styles.emptyTab}>
                        <Ionicons name="git-branch-outline" size={28} color="#d1d5db" />
                        <Text style={styles.emptyTabText}>Este producto no tiene variantes</Text>
                      </View>
                    )}
                  </View>
                ) : (
                  /* Toggle OFF — no debería pasar porque la tab no se muestra,
                   * pero por si la lógica de tabs cambia, mostramos hint. */
                  <View style={styles.emptyTab}>
                    <Ionicons name="layers-outline" size={28} color="#d1d5db" />
                    <Text style={styles.emptyTabText}>Activa "Gestionar variantes" en General</Text>
                  </View>
                )}
              </View>
            )}

            {tab === 'lot' && (
              <View>
                <Text style={styles.label}>Número de lote</Text>
                <TextInput
                  style={styles.input}
                  value={batchNumber}
                  onChangeText={setBatchNumber}
                  placeholder="Ej: LOTE-2026-001"
                  placeholderTextColor="#9ca3af"
                  editable={!creatingVariants}
                />

                <View style={styles.lotDatesRow}>
                  <View style={styles.lotDateField}>
                    <Text style={styles.lotDateLabel}>Fecha de fabricación</Text>
                    <DatePickerField
                      value={manufacturingDate}
                      onChange={setManufacturingDate}
                      accessibilityLabel="Fecha de fabricación"
                    />
                  </View>

                  <View style={styles.lotDateField}>
                    <Text style={styles.lotDateLabel}>Fecha de vencimiento</Text>
                    <DatePickerField
                      value={expirationDate}
                      onChange={setExpirationDate}
                      minimumDate={manufacturingDate}
                      accessibilityLabel="Fecha de vencimiento"
                    />
                  </View>
                </View>

                <Text style={styles.lotFootnote}>Estos datos se enviarán al proveedor con la orden de compra.</Text>
              </View>
            )}
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onCancel} disabled={creatingVariants}>
              <Text style={styles.cancelText}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.confirmBtn, creatingVariants && styles.confirmBtnDisabled]}
              onPress={handleConfirm}
              disabled={creatingVariants}
            >
              {creatingVariants ? (
                <>
                  <ActivityIndicator size="small" color={colors.card} />
                  <Text style={styles.confirmText}>Creando...</Text>
                </>
              ) : (
                <Text style={styles.confirmText}>
                  {isCreatingVariants && generatedVariants.length > 0
                    ? `Crear ${generatedVariants.length} variantes`
                    : isSelectionMode && selectedVariantIds.size > 1
                    ? `Agregar ${selectedVariantIds.size} variantes`
                    : 'Confirmar'}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ===========================================================================
// Sub-componente: VariantAttributeRow
// ===========================================================================
// Renderiza un atributo editable: name input + lista de chip values + input
// inline para agregar valores + botón trash. Encapsulado para que el JSX del
// modal no quede ilegible. Parity con `<input>` chip-editor del web.

interface VariantAttributeRowProps {
  index: number;
  name: string;
  values: string[];
  onChangeName: (name: string) => void;
  /** Llamado cuando el nombre pierde foco — para regenerar variantes. */
  onCommitName: () => void;
  onAddValue: (value: string) => void;
  onRemoveValue: (valueIndex: number) => void;
  onRemove: () => void;
  disabled?: boolean;
}

function VariantAttributeRow({
  index,
  name,
  values,
  onChangeName,
  onCommitName,
  onAddValue,
  onRemoveValue,
  onRemove,
  disabled,
}: VariantAttributeRowProps) {
  const inputRef = useRef<TextInput>(null);
  const [draft, setDraft] = useState('');

  const submit = () => {
    const v = draft.trim();
    if (v) {
      onAddValue(v);
      setDraft('');
    }
  };

  return (
    <View style={styles.attrCard}>
      <View style={styles.attrHeader}>
        <TextInput
          style={styles.attrNameInput}
          value={name}
          onChangeText={onChangeName}
          onBlur={onCommitName}
          placeholder={`Atributo ${index + 1} (ej: Color)`}
          placeholderTextColor="#9ca3af"
          editable={!disabled}
        />
        <TouchableOpacity onPress={onRemove} disabled={disabled} style={styles.attrTrash}>
          <Ionicons name="trash-outline" size={16} color={colorScales.red[500]} />
        </TouchableOpacity>
      </View>

      <View style={styles.attrValuesBox}>
        {values.map((v, vi) => (
          <View key={`${v}-${vi}`} style={styles.attrChip}>
            <Text style={styles.attrChipText}>{v}</Text>
            <TouchableOpacity onPress={() => onRemoveValue(vi)} disabled={disabled}>
              <Ionicons name="close" size={12} color={colors.primary} />
            </TouchableOpacity>
          </View>
        ))}
        <TextInput
          ref={inputRef}
          style={styles.attrValueInput}
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={submit}
          onBlur={submit}
          placeholder={values.length === 0 ? 'Escribe y presiona Enter' : 'Agregar...'}
          placeholderTextColor="#9ca3af"
          blurOnSubmit={false}
          returnKeyType="done"
          editable={!disabled}
        />
      </View>
    </View>
  );
}

// ===========================================================================
// Helpers
// ===========================================================================

/** Cartesian product de arrays: `cartesian([[1,2],['a','b']])` → `[[1,'a'],[1,'b'],[2,'a'],[2,'b']]`. */
function cartesian<T>(arrays: T[][]): T[][] {
  if (arrays.length === 0) return [[]];
  return arrays.reduce<T[][]>(
    (acc, curr) => acc.flatMap((a) => curr.map((c) => [...a, c])),
    [[]],
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 20 },
  // Contenedor del modal — card blanco puro con borde sutil (mimic web bg-card border-border/50)
  modal: {
    backgroundColor: colors.card,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[100],
    width: '100%',
    maxWidth: 440,
    maxHeight: '85%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 8,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colorScales.gray[100] },
  headerLeft: { flex: 1, marginRight: 12 },
  headerTitle: { fontSize: 16, fontWeight: '700', color: colorScales.gray[900] },
  headerSubtitle: { fontSize: 12, color: colors.text.muted, marginTop: 2 },
  tabs: { flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 10, gap: 8, borderBottomWidth: 1, borderBottomColor: colorScales.gray[100] },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colorScales.gray[200] },
  tabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabText: { fontSize: 11, color: colors.text.secondary, fontWeight: '600' },
  tabTextActive: { color: colors.card },
  tabIconActive: { color: colors.card },
  // Tabs dinámicas — fila de pills (General siempre; Variantes/Lote aparecen al activar toggles)
  tabsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colorScales.gray[100] },
  tabPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 9999, backgroundColor: colors.card, borderWidth: 1, borderColor: colorScales.gray[200] },
  tabPillActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabPillText: { fontSize: 11, color: colors.text.secondary, fontWeight: '600' },
  tabPillTextActive: { color: colors.card },
  // Card de info del producto — fondo sutil gray[50] con tinte primary en el icono (mimic web bg-muted/30 + bg-primary/10)
  productInfoCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 10, backgroundColor: colorScales.gray[50], borderWidth: 1, borderColor: colorScales.gray[100], marginBottom: 16 },
  productInfoIcon: { width: 40, height: 40, borderRadius: 8, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  productImage: { width: '100%', height: '100%', borderRadius: 8 },
  productInfoText: { flex: 1 },
  productInfoName: { fontSize: 14, fontWeight: '600', color: colorScales.gray[900] },
  productInfoCost: { fontSize: 12, color: colors.text.muted, marginTop: 2 },
  body: { padding: 20, maxHeight: 400 },
  label: { fontSize: 13, fontWeight: '700', color: colors.text.secondary, marginBottom: 8 },
  input: { borderWidth: 1, borderColor: colorScales.gray[200], borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: colorScales.gray[900], backgroundColor: colors.card },
  lotDatesRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  lotDateField: { flex: 1, gap: 6 },
  lotDateLabel: { fontSize: 12, fontWeight: '700', color: colors.text.secondary },
  lotFootnote: { fontSize: 11, color: colors.text.muted, marginTop: 14, lineHeight: 16 },
  pricingRow: { flexDirection: 'row', gap: 8 },
  // Pill de "Unidad de medida" — estilo web: inactivo = blanco con borde sutil; activo = blanco con borde primary
  pricingChip: { flex: 1, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: colorScales.gray[200], alignItems: 'center', backgroundColor: colors.card },
  pricingChipActive: { borderColor: colors.primary, backgroundColor: colors.card },
  pricingChipText: { fontSize: 13, fontWeight: '600', color: colors.text.secondary },
  pricingChipTextActive: { color: colorScales.gray[900] },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  qtyBtn: {
    borderRadius: 10,
    backgroundColor: colorScales.gray[50],
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  qtyInput: {
    flex: 1,
    minWidth: 0,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: 10,
    paddingVertical: 10,
    fontWeight: '700',
    textAlign: 'center',
    color: colorScales.gray[900],
    backgroundColor: colors.card,
  },
  costInputWrap: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colorScales.gray[200], borderRadius: 8, paddingHorizontal: 12, backgroundColor: colors.card },
  costPrefix: { fontSize: 16, fontWeight: '600', color: colors.text.muted, marginRight: 4 },
  costInput: { flex: 1, fontSize: 16, fontWeight: '600', paddingVertical: 10, color: colorScales.gray[900] },
  togglesSection: { marginTop: 20, paddingTop: 16, borderTopWidth: 1, borderTopColor: colorScales.gray[100], gap: 8 },
  settingToggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 10, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: colorScales.gray[100], backgroundColor: colorScales.gray[50] },
  settingToggleInfo: { flex: 1, marginRight: 12 },
  settingToggleLabel: { fontSize: 12, fontWeight: '700', color: colorScales.gray[700] },
  settingToggleDesc: { fontSize: 10, color: colors.text.muted, marginTop: 3, lineHeight: 14 },
  totalPreview: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 20, paddingTop: 14, borderTopWidth: 1, borderTopColor: colorScales.gray[100] },
  totalPreviewLabel: { fontSize: 15, fontWeight: '700', color: colorScales.gray[900] },
  totalPreviewValue: { fontSize: 20, fontWeight: '800', color: colorScales.green[700] },
  emptyTab: { alignItems: 'center', paddingVertical: 30, gap: 8 },
  emptyTabText: { fontSize: 14, color: colorScales.gray[400] },
  // ----------------------------------------------------------------
  // Variant Creation Mode styles (parity web).
  // ----------------------------------------------------------------
  quickAttrRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  quickAttrChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  quickAttrChipDisabled: { opacity: 0.4 },
  quickAttrChipText: { fontSize: 12, fontWeight: '600', color: colors.primary },
  quickAttrChipCustom: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colorScales.gray[300],
    backgroundColor: colorScales.gray[50],
  },
  quickAttrChipCustomText: { fontSize: 12, fontWeight: '600', color: colors.text.secondary },
  attrCard: {
    backgroundColor: colorScales.gray[50],
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    padding: 10,
    marginBottom: 10,
  },
  attrHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  attrNameInput: {
    flex: 1,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    fontWeight: '600',
    color: colorScales.gray[900],
  },
  attrTrash: { padding: 4 },
  attrValuesBox: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: colors.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    minHeight: 36,
  },
  attrChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: colors.primaryLight,
    borderWidth: 1,
    borderColor: colors.primaryLight,
  },
  attrChipText: { fontSize: 11, fontWeight: '600', color: colors.primary },
  attrValueInput: {
    flex: 1,
    minWidth: 100,
    fontSize: 13,
    color: colorScales.gray[900],
    paddingVertical: 4,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 10,
    borderRadius: 10,
    backgroundColor: colors.primaryLight,
    borderWidth: 1,
    borderColor: colorScales.green[200],
    marginBottom: 12,
  },
  previewInfo: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  previewText: { fontSize: 12, color: colors.primary, fontWeight: '500' },
  previewTextBold: { fontWeight: '700' },
  generatedHeader: { fontSize: 11, color: colors.text.muted, fontWeight: '500', paddingHorizontal: 4, marginBottom: 6 },
  generatedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    backgroundColor: colors.card,
    marginBottom: 6,
  },
  generatedIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  generatedName: { fontSize: 12, fontWeight: '600', color: colorScales.gray[900] },
  generatedSku: { fontSize: 10, color: colors.text.muted, fontFamily: 'monospace', marginTop: 1 },
  generatedCostWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: 8,
    paddingHorizontal: 8,
    backgroundColor: colors.card,
    width: 90,
  },
  generatedCostPrefix: { fontSize: 12, color: colors.text.muted, marginRight: 2 },
  generatedCostInput: { flex: 1, fontSize: 12, fontWeight: '600', paddingVertical: 6, color: colorScales.gray[900], textAlign: 'right' },
  // ----------------------------------------------------------------
  // Existing Variant Selection Mode styles (parity web).
  // ----------------------------------------------------------------
  selectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingBottom: 8,
  },
  selectionCounter: { fontSize: 11, color: colors.text.muted },
  selectionToggleAll: { fontSize: 12, fontWeight: '600', color: colors.primary },
  variantItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: 10,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    backgroundColor: colors.card,
  },
  variantItemActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  variantCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colorScales.gray[300],
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  variantCheckboxActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  variantIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: colorScales.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  variantInfo: { flex: 1 },
  variantName: { fontSize: 13, fontWeight: '600', color: colorScales.gray[900] },
  variantSku: { fontSize: 11, color: colors.text.muted, marginTop: 2 },
  variantRight: { alignItems: 'flex-end' },
  variantPrice: { fontSize: 13, fontWeight: '700', color: colorScales.gray[900] },
  variantStock: { fontSize: 11, color: colors.text.muted, marginTop: 2 },
  footer: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderTopWidth: 1, borderTopColor: colorScales.gray[100] },
  cancelBtn: { flex: 1, paddingVertical: 12, borderRadius: 8, borderWidth: 1, borderColor: colorScales.gray[200], alignItems: 'center', backgroundColor: colors.card },
  cancelText: { fontSize: 14, fontWeight: '600', color: colorScales.gray[700] },
  confirmBtn: { flex: 1, flexDirection: 'row', paddingVertical: 12, borderRadius: 8, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', gap: 6 },
  confirmBtnDisabled: { opacity: 0.7 },
  confirmText: { fontSize: 14, fontWeight: '700', color: colors.card },
});