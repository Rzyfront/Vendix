import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Alert,
  Modal,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import PopHeader from '../../../src/features/pop/components/pop-header';
import PopProductGrid from '../../../src/features/pop/components/pop-product-grid';
import PopConfigModal from '../../../src/features/pop/components/pop-config-modal';
import PopCartModal from '../../../src/features/pop/components/pop-cart-modal';
import PopFooter from '../../../src/features/pop/components/pop-footer';
import PopConfirmModal from '../../../src/features/pop/components/pop-confirm-modal';
import PopPrebulkModal from '../../../src/features/pop/components/pop-prebulk-modal';
import PopInvoiceScanner from '../../../src/features/pop/components/pop-invoice-scanner';
import PopBulkModal from '../../../src/features/pop/components/pop-bulk-modal';
import { usePopCart } from '../../../src/features/pop/pop-cart-service';
import { POP_USE_UNIFIED_MODAL } from '../../../src/features/pop/pop.config';
import type {
  PopProduct,
  PopProductConfigResult,
  PreBulkData,
  PopSupplier,
  PopLocation,
} from '../../../src/features/pop/types';
import { generateTempProductId } from '../../../src/features/pop/types';
import type { ScanResult } from '../../../src/features/pop/components/pop-invoice-scanner';
import { InventoryService } from '../../../src/features/store/services/inventory.service';
import { ProductService } from '../../../src/features/store/services/product.service';
import { borderRadius, colorScales, colors } from '../../../src/shared/theme';
import { toastError } from '../../../src/shared/components/toast/toast.store';

const LOCATION_TYPE_LABELS: Record<string, string> = {
  warehouse: 'Almacen / Bodega',
  store: 'Tienda / Local',
  production_area: 'Área de Producción',
};

const LOCATION_TYPES = ['warehouse', 'store', 'production_area'] as const;

function LocationTypeSelector({ value, onChange }: { value: string; onChange: (t: 'warehouse' | 'store' | 'production_area') => void }) {
  const [showPicker, setShowPicker] = useState(false);
  return (
    <View>
      <TouchableOpacity style={ltStyles.selector} onPress={() => setShowPicker(true)}>
        <Text style={[ltStyles.selectorText, !value && ltStyles.placeholder]}>
          {value ? LOCATION_TYPE_LABELS[value] : 'Seleccionar tipo'}
        </Text>
        <Ionicons name="chevron-down" size={16} color="#6b7280" />
      </TouchableOpacity>
      <Modal visible={showPicker} transparent animationType="fade" onRequestClose={() => setShowPicker(false)}>
        <TouchableOpacity style={ltStyles.backdrop} activeOpacity={1} onPress={() => setShowPicker(false)}>
          <View style={ltStyles.picker}>
            {LOCATION_TYPES.map((t) => (
              <TouchableOpacity key={t} style={[ltStyles.pickerItem, value === t && ltStyles.pickerItemActive]} onPress={() => { onChange(t); setShowPicker(false); }}>
                <Text style={[ltStyles.pickerText, value === t && ltStyles.pickerTextActive]}>{LOCATION_TYPE_LABELS[t]}</Text>
                {value === t && <Ionicons name="checkmark" size={18} color="#22C55E" />}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const ltStyles = StyleSheet.create({
  selector: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: '#d1d5db', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: '#fff', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 3, elevation: 1 },
  selectorText: { fontSize: 15, color: '#111827' },
  placeholder: { color: '#9ca3af' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40 },
  picker: { backgroundColor: '#fff', borderRadius: 14, width: '100%', overflow: 'hidden' },
  pickerItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  pickerItemActive: { backgroundColor: '#dcfce7' },
  pickerText: { fontSize: 16, color: '#374151' },
  pickerTextActive: { color: '#22C55E', fontWeight: '600' },
});

export default function PopScreen() {
  const [suppliers, setSuppliers] = useState<PopSupplier[]>([]);
  const [locations, setLocations] = useState<PopLocation[]>([]);
  const [products, setProducts] = useState<PopProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);

  const [selectedProduct, setSelectedProduct] = useState<PopProduct | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [showCartModal, setShowCartModal] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showPrebulk, setShowPrebulk] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [targetAction, setTargetAction] = useState<'draft' | 'create' | 'create-receive'>('create');
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const [showSupplierCreate, setShowSupplierCreate] = useState(false);
  const [showLocationCreate, setShowLocationCreate] = useState(false);

  const [supplierForm, setSupplierForm] = useState({ name: '', code: '', email: '', phone: '', tax_id: '', payment_terms: '' });
  const [locationForm, setLocationForm] = useState({ name: '', code: '', type: 'warehouse' as 'warehouse' | 'store' | 'production_area' });
  const [creatingSupplier, setCreatingSupplier] = useState(false);
  const [creatingLocation, setCreatingLocation] = useState(false);

  const cart = usePopCart();

  useEffect(() => {
    loadInitialData();
  }, []);

  const loadInitialData = async () => {
    setLoading(true);
    try {
      const [suppliersRes, locationsRes, productsRes] = await Promise.all([
        InventoryService.getSuppliers({ page: 1, limit: 200 }),
        InventoryService.getLocations({ page: 1, limit: 200 }),
        ProductService.list({ page: 1, limit: 200, include_variants: true }),
      ]);
      setSuppliers((suppliersRes.data || []).map((s: any) => ({ id: Number(s.id), name: s.name, code: s.code, email: s.email, phone: s.phone, tax_id: s.tax_id, is_active: !!s.is_active })));
      setLocations((locationsRes.data || []).map((l: any) => ({ id: Number(l.id), name: l.name, code: l.code, type: l.type, is_active: !!l.is_active })));
      setProducts((productsRes.data || []) as PopProduct[]);
    } catch (err) {
      console.error('Error loading POP data:', err);
      toastError('No pudimos cargar el catálogo. Verifica tu conexión e intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateSupplier = useCallback(async () => {
    if (!supplierForm.name.trim()) {
      Alert.alert('Error', 'El nombre del proveedor es obligatorio.');
      return;
    }
    setCreatingSupplier(true);
    try {
      const res = await InventoryService.createSupplier({
        name: supplierForm.name.trim(),
        code: supplierForm.code.trim() || undefined,
        email: supplierForm.email.trim() || undefined,
        phone: supplierForm.phone.trim() || undefined,
        tax_id: supplierForm.tax_id.trim() || undefined,
        payment_terms: supplierForm.payment_terms.trim() || undefined,
      });
      const newSupplier: PopSupplier = {
        id: Number(res.id),
        name: res.name,
        code: res.code,
        email: res.email,
        phone: res.phone,
        is_active: !!res.is_active,
      };
      setSuppliers((prev) => [...prev, newSupplier]);
      cart.setSupplier(newSupplier.id, newSupplier.name);
      setShowSupplierCreate(false);
      setSupplierForm({ name: '', code: '', email: '', phone: '', tax_id: '', payment_terms: '' });
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'No se pudo crear el proveedor.');
    } finally {
      setCreatingSupplier(false);
    }
  }, [supplierForm, cart]);

  const handleCreateLocation = useCallback(async () => {
    if (!locationForm.name.trim()) {
      Alert.alert('Error', 'El nombre de la bodega es obligatorio.');
      return;
    }
    setCreatingLocation(true);
    try {
      const res = await InventoryService.createLocation({
        name: locationForm.name.trim(),
        code: locationForm.code.trim() || undefined,
        type: locationForm.type,
      });
      const newLocation: PopLocation = {
        id: Number(res.id),
        name: res.name,
        code: res.code,
        type: res.type,
        is_active: !!res.is_active,
      };
      setLocations((prev) => [...prev, newLocation]);
      cart.setLocation(newLocation.id, newLocation.name);
      setShowLocationCreate(false);
      setLocationForm({ name: '', code: '', type: 'warehouse' });
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'No se pudo crear la bodega.');
    } finally {
      setCreatingLocation(false);
    }
  }, [locationForm, cart]);

  const handleSelectProduct = useCallback((product: PopProduct) => {
    setSelectedProduct(product);
    setShowConfig(true);
  }, []);

  const handleConfigConfirm = useCallback((result: PopProductConfigResult) => {
    setShowConfig(false);
    if (!selectedProduct) return;

    // Caso A: nuevas variantes recién creadas en backend — cada una se agrega
    // como una línea separada al cart (parity web).
    if (result.newVariants && result.newVariants.length > 0) {
      result.newVariants.forEach((variant) => {
        cart.addToCart({
          product: selectedProduct,
          variant,
          quantity: 1,
          unit_cost: Number(variant.cost_price ?? result.unit_cost ?? 0),
          lot_info: result.lot_info,
        });
      });
      setSelectedProduct(null);
      return;
    }

    // Caso B: variantes existentes seleccionadas (multi o single).
    // Si hay 2+, una línea por variante. Si hay 1, flujo clásico.
    if (result.variants && result.variants.length > 0) {
      if (result.variants.length === 1) {
        cart.addToCart({
          product: selectedProduct,
          variant: result.variants[0],
          quantity: result.quantity,
          unit_cost: Number(result.variants[0].cost_price ?? result.unit_cost ?? 0),
          lot_info: result.lot_info,
        });
      } else {
        result.variants.forEach((variant) => {
          cart.addToCart({
            product: selectedProduct,
            variant,
            quantity: 1,
            unit_cost: Number(variant.cost_price ?? result.unit_cost ?? 0),
            lot_info: result.lot_info,
          });
        });
      }
      setSelectedProduct(null);
      return;
    }

    // Caso C: variant legacy (single-select, kept para back-compat).
    cart.addToCart({
      product: selectedProduct,
      variant: result.variant || null,
      quantity: result.quantity,
      unit_cost: result.unit_cost,
      lot_info: result.lot_info,
    });
    setSelectedProduct(null);
  }, [selectedProduct, cart]);

  const executeOrder = useCallback(async (action: 'draft' | 'create' | 'create-receive') => {
    if (!cart.cart.supplierId || !cart.cart.locationId) {
      setConfigModalOpen(true);
      setShowConfirm(false);
      return;
    }
    setIsCreating(true);
    try {
      const items = cart.cart.items.map((i) => {
        // Prebulk products (Fase 5 — UoM parity con web): el backend acepta
        // is_ingredient + purchase_uom_id + stock_uom_id por línea. Solo se
        // propagan cuando el item fue creado vía PreBulkModal en modo insumo
        // (ver features/pop/components/pop-prebulk-modal.tsx).
        const prebulk = i.is_prebulk ? i.prebulk_data : null;
        return {
          product_id: i.product.id,
          product_variant_id: i.variant?.id,
          quantity: i.quantity,
          unit_price: i.unit_cost,
          notes: i.notes,
          product_name: i.is_prebulk ? prebulk?.name : undefined,
          sku: i.is_prebulk ? prebulk?.code : undefined,
          product_description: i.is_prebulk ? prebulk?.description : undefined,
          is_ingredient: prebulk?.is_ingredient || undefined,
          is_sellable: prebulk?.is_ingredient !== undefined ? prebulk?.is_sellable : undefined,
          purchase_uom_id: prebulk?.is_ingredient ? prebulk?.purchase_uom_id : undefined,
          stock_uom_id: prebulk?.is_ingredient ? prebulk?.stock_uom_id : undefined,
          batch_number: i.lot_info?.batch_number,
          // lot_dates son fechas de calendario elegidas por el usuario (YYYY-MM-DD).
          // Las enviamos tal cual para no desfasar por zona horaria — el backend
          // las trata como date-only, no como instant.
          manufacturing_date: i.lot_info?.manufacturing_date || undefined,
          expiration_date: i.lot_info?.expiration_date || undefined,
        };
      });

      const payload = {
        supplier_id: cart.cart.supplierId,
        location_id: cart.cart.locationId || 1,
        status: action === 'draft' ? 'draft' as const : 'approved' as const,
        order_date: cart.cart.orderDate,
        expected_date: cart.cart.expectedDate || undefined,
        payment_terms: cart.cart.paymentTerms,
        shipping_method: cart.cart.shippingMethod,
        shipping_cost: cart.cart.shippingCost,
        subtotal_amount: cart.summary.subtotal,
        tax_amount: cart.summary.tax_amount,
        total_amount: cart.summary.total,
        notes: cart.cart.notes,
        internal_notes: cart.cart.internalNotes,
        items,
      };

      const order = await InventoryService.createPurchaseOrder(payload as any);

      if (action === 'create-receive' && order?.id) {
        const receiveItems = items.map((i) => ({
          id: 0,
          quantity_received: i.quantity,
        }));
        await InventoryService.receivePurchaseOrder(order.id, receiveItems);
      }

      setShowConfirm(false);
      cart.clearCart();
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'No se pudo crear la orden. Intenta de nuevo.');
    } finally {
      setIsCreating(false);
    }
  }, [cart]);

  const handleSaveDraft = useCallback(() => {
    setTargetAction('draft');
    setShowCartModal(false);
    setShowConfirm(true);
  }, []);

  const handleCreateOrder = useCallback(() => {
    setTargetAction('create');
    setShowCartModal(false);
    setShowConfirm(true);
  }, []);

  const handleCreateAndReceive = useCallback(() => {
    setTargetAction('create-receive');
    setShowCartModal(false);
    setShowConfirm(true);
  }, []);

  const handleConfigure = useCallback(() => {
    setShowCartModal(false);
    setConfigModalOpen(true);
  }, []);

  const handleUpdateItem = useCallback((id: string, qty: number, cost: number) => {
    cart.updateCartItem({ itemId: id, quantity: qty, unit_cost: cost });
  }, [cart]);

  const handlePrebulkConfirm = useCallback((data: PreBulkData) => {
    setShowPrebulk(false);
    const tempProduct: PopProduct = {
      id: generateTempProductId(),
      name: data.name,
      code: data.code,
      cost: data.base_price,
      cost_price: data.base_price,
    };
    cart.addToCart({
      product: tempProduct,
      quantity: data.quantity ?? 0,
      unit_cost: data.unit_cost || 0,
      is_prebulk: true,
      prebulk_data: data,
    });
  }, [cart]);

  const handleBulkDataLoaded = useCallback((items: any[]) => {
    for (const item of items) {
      const tempProduct: PopProduct = {
        id: generateTempProductId(),
        name: item.name,
        code: item.sku,
        cost: item.base_price,
        cost_price: item.cost_price,
      };
      cart.addToCart({
        product: tempProduct,
        quantity: item.quantity || 1,
        unit_cost: item.unit_cost || 0,
        is_prebulk: true,
        prebulk_data: {
          name: item.name,
          code: item.sku,
          description: item.description,
          unit_cost: item.unit_cost,
          quantity: item.quantity,
          base_price: item.base_price,
        },
      });
    }
  }, [cart]);

  const handleScanComplete = useCallback((result: ScanResult) => {
    if (!result.items || result.items.length === 0) return;
    for (const item of result.items) {
      const existingProd = products.find(
        (p) => (item.sku && p.code === item.sku) || p.name.toLowerCase() === item.name.toLowerCase()
      );
      if (existingProd) {
        cart.addToCart({
          product: existingProd,
          quantity: item.quantity,
          unit_cost: item.unit_cost,
        });
      } else {
        const tempProduct: PopProduct = {
          id: generateTempProductId(),
          name: item.name,
          code: item.sku,
          cost: item.unit_cost,
          cost_price: item.unit_cost,
        };
        cart.addToCart({
          product: tempProduct,
          quantity: item.quantity,
          unit_cost: item.unit_cost,
          is_prebulk: true,
          prebulk_data: {
            name: item.name,
            code: item.sku,
            description: item.description,
            unit_cost: item.unit_cost,
            quantity: item.quantity,
            is_sellable: true,
          },
        });
      }
    }
    if (result.supplier_name && !cart.cart.supplierId) {
      const found = suppliers.find(
        (s) => s.name.toLowerCase() === result.supplier_name?.toLowerCase()
      );
      if (found) cart.setSupplier(found.id, found.name);
    }
    Alert.alert(
      'Factura escaneada',
      `${result.items.length} producto(s) agregados al carrito desde la factura.`
    );
  }, [cart, suppliers, products]);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#22C55E" />
        <Text style={styles.loadingText}>Cargando...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        ref={scrollRef as any}
        style={styles.scrollArea}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <PopHeader
          supplierName={cart.cart.supplierName}
          locationName={cart.cart.locationName}
          orderDate={cart.cart.orderDate}
          expectedDate={cart.cart.expectedDate}
          shippingMethod={cart.cart.shippingMethod}
          selectedSupplierId={cart.cart.supplierId}
          selectedLocationId={cart.cart.locationId}
          suppliers={suppliers}
          locations={locations}
          configModalOpen={configModalOpen}
          onConfigModalOpenChange={setConfigModalOpen}
          onSupplierChange={cart.setSupplier}
          onLocationChange={cart.setLocation}
          onOrderDateChange={cart.setOrderDate}
          onExpectedDateChange={cart.setExpectedDate}
          onShippingMethodChange={cart.setShippingMethod}
          onQuickAddSupplier={() => setShowSupplierCreate(true)}
          onQuickAddLocation={() => setShowLocationCreate(true)}
        />

        <PopProductGrid
          products={products}
          loading={loading}
          onSelectProduct={handleSelectProduct}
          onScanInvoice={() => setShowScanner(true)}
          onNewProduct={() => setShowPrebulk(true)}
          onBulkUpload={() => setShowBulk(true)}
          locationName={cart.cart.locationName}
        />
      </ScrollView>

      <PopFooter
        summary={cart.summary}
        itemCount={cart.itemCount}
        onOpenCart={() => setShowCartModal(true)}
        onSaveDraft={handleSaveDraft}
        onCreateOrder={handleCreateOrder}
        onCreateAndReceive={handleCreateAndReceive}
        isLoading={isCreating}
      />

      <PopConfigModal
        visible={showConfig}
        product={selectedProduct}
        onConfirm={handleConfigConfirm}
        onCancel={() => { setShowConfig(false); setSelectedProduct(null); }}
      />

      <PopCartModal
        visible={showCartModal}
        items={cart.cart.items}
        summary={cart.summary}
        supplierName={cart.cart.supplierName}
        locationName={cart.cart.locationName}
        onClose={() => setShowCartModal(false)}
        onUpdateItem={handleUpdateItem}
        onUpdateShippingCost={cart.setShippingCost}
        onRemoveItem={cart.removeFromCart}
        onSaveDraft={handleSaveDraft}
        onCreateOrder={handleCreateOrder}
        onCreateAndReceive={handleCreateAndReceive}
        onClearCart={cart.clearCart}
        onConfigure={handleConfigure}
        isProcessing={isCreating}
      />

      <PopConfirmModal
        visible={showConfirm}
        items={cart.cart.items}
        summary={cart.summary}
        supplierName={cart.cart.supplierName}
        locationName={cart.cart.locationName}
        orderMode={targetAction}
        onConfirm={() => executeOrder(targetAction)}
        onCancel={() => setShowConfirm(false)}
        isLoading={isCreating}
      />

      {/* PrebulkModal solo se muestra si el flag POP_USE_UNIFIED_MODAL es false.
          Cuando es true, el PopConfigModal actúa como modal unificado. */}
      {!POP_USE_UNIFIED_MODAL && (
        <PopPrebulkModal
          visible={showPrebulk}
          onConfirm={handlePrebulkConfirm}
          onCancel={() => setShowPrebulk(false)}
        />
      )}

      <PopInvoiceScanner
        visible={showScanner}
        onClose={() => setShowScanner(false)}
        onScanComplete={handleScanComplete}
      />

      <PopBulkModal
        visible={showBulk}
        onClose={() => setShowBulk(false)}
        onDataLoaded={handleBulkDataLoaded}
      />

      <Modal visible={showSupplierCreate} transparent animationType="fade" onRequestClose={() => setShowSupplierCreate(false)}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Crear Proveedor Rápido</Text>
              <TouchableOpacity onPress={() => setShowSupplierCreate(false)}>
                <Ionicons name="close" size={24} color="#6b7280" />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalForm} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.modalFormContent}>
              <Text style={styles.formLabel}>Nombre *</Text>
              <TextInput style={styles.formInput} value={supplierForm.name} onChangeText={(v) => setSupplierForm((prev) => ({ ...prev, name: v }))} placeholder="Ej: Distribuidora Central S.A." />
              <Text style={styles.formLabel}>Código</Text>
              <TextInput style={styles.formInput} value={supplierForm.code} onChangeText={(v) => setSupplierForm((prev) => ({ ...prev, code: v }))} placeholder="Ej: PROV-001" />
              <Text style={styles.formLabel}>Email</Text>
              <TextInput style={styles.formInput} value={supplierForm.email} onChangeText={(v) => setSupplierForm((prev) => ({ ...prev, email: v }))} placeholder="contacto@proveedor.com" keyboardType="email-address" />
              <Text style={styles.formLabel}>Teléfono</Text>
              <TextInput style={styles.formInput} value={supplierForm.phone} onChangeText={(v) => setSupplierForm((prev) => ({ ...prev, phone: v }))} placeholder="+57 300 123 4567" keyboardType="phone-pad" />
              <Text style={styles.formLabel}>NIT / RUT</Text>
              <TextInput style={styles.formInput} value={supplierForm.tax_id} onChangeText={(v) => setSupplierForm((prev) => ({ ...prev, tax_id: v }))} placeholder="900123456-7" />
              <Text style={styles.formLabel}>Términos de Pago</Text>
              <TextInput style={styles.formInput} value={supplierForm.payment_terms} onChangeText={(v) => setSupplierForm((prev) => ({ ...prev, payment_terms: v }))} placeholder="Ej: 30 días" />
            </ScrollView>
            <View style={styles.modalFooter}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowSupplierCreate(false)}>
                <Text style={styles.cancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmBtn} onPress={handleCreateSupplier} disabled={creatingSupplier}>
                <Text style={styles.confirmText}>{creatingSupplier ? 'Creando...' : 'Crear Proveedor'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={showLocationCreate} transparent animationType="fade" onRequestClose={() => setShowLocationCreate(false)}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Crear Bodega Rápido</Text>
              <TouchableOpacity onPress={() => setShowLocationCreate(false)}>
                <Ionicons name="close" size={24} color="#6b7280" />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalForm} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.modalFormContent}>
              <Text style={styles.formLabel}>Nombre *</Text>
              <TextInput style={styles.formInput} value={locationForm.name} onChangeText={(v) => setLocationForm((prev) => ({ ...prev, name: v }))} placeholder="Ej: Bodega Principal" />
              <Text style={styles.formLabel}>Código</Text>
              <TextInput style={styles.formInput} value={locationForm.code} onChangeText={(v) => setLocationForm((prev) => ({ ...prev, code: v }))} placeholder="Ej: BOD-001" />
              <Text style={styles.formLabel}>Tipo de ubicación</Text>
              <LocationTypeSelector value={locationForm.type} onChange={(t) => setLocationForm((prev) => ({ ...prev, type: t }))} />
            </ScrollView>
            <View style={styles.modalFooter}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowLocationCreate(false)}>
                <Text style={styles.cancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmBtn} onPress={handleCreateLocation} disabled={creatingLocation}>
                <Text style={styles.confirmText}>{creatingLocation ? 'Creando...' : 'Crear Bodega'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  // Fondo de la app — mismo gris que customers.tsx
  container: { flex: 1, backgroundColor: colors.background },
  scrollArea: { flex: 1 },
  scrollContent: { paddingTop: 12, paddingBottom: 70 },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  loadingText: { marginTop: 12, fontSize: 15, color: colorScales.gray[500] },
  // Modal — mismo overlay y card que customers.tsx
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  modalContent: { backgroundColor: colors.background, borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colorScales.gray[200], width: '100%', maxWidth: 520, maxHeight: '90%', shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 24, elevation: 8 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: colorScales.gray[200] },
  modalTitle: { fontSize: 18, fontWeight: '700', color: colorScales.gray[900] },
  modalForm: { maxHeight: 400 },
  modalFormContent: { paddingHorizontal: 20, paddingVertical: 16 },
  formLabel: { fontSize: 13, fontWeight: '600', color: colorScales.gray[700], marginBottom: 6, marginTop: 12 },
  formInput: { borderWidth: 1, borderColor: colorScales.gray[300], borderRadius: borderRadius.lg, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, color: colorScales.gray[900], backgroundColor: colors.background },
  modalFooter: { flexDirection: 'row', gap: 12, padding: 20, borderTopWidth: 1, borderTopColor: colorScales.gray[200] },
  cancelBtn: { flex: 1, paddingVertical: 14, borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colorScales.gray[300], alignItems: 'center', backgroundColor: colors.background },
  cancelText: { fontSize: 15, fontWeight: '600', color: colorScales.gray[700] },
  confirmBtn: { flex: 1, paddingVertical: 14, borderRadius: borderRadius.lg, backgroundColor: colors.primary, alignItems: 'center' },
  confirmText: { fontSize: 15, fontWeight: '700', color: colors.background },
});
