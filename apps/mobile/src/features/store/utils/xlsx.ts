import * as XLSX from 'xlsx';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Platform, Alert } from 'react-native';
import type { Product } from '@/features/store/types';

const COLUMNS = [
  'Nombre',
  'SKU',
  'Código de barras',
  'Slug',
  'Descripción',
  'Categoría',
  'Marca',
  'Tipo',
  'Unidad de venta',
  'Costo',
  'Margen %',
  'Precio base',
  'Stock',
  'Controlar inventario',
  'Estado',
];

function toRows(products: Product[]) {
  return products.map((p) => ({
    Nombre: p.name,
    SKU: p.sku ?? '',
    'Código de barras': (p as any).barcode ?? '',
    Slug: (p as any).slug ?? '',
    Descripción: p.description ?? '',
    Categoría: p.categories?.map((c) => c.name).join(', ') ?? '',
    Marca: p.brand?.name ?? '',
    Tipo: p.product_type ?? 'physical',
    'Unidad de venta': p.pricing_type ?? 'unit',
    Costo: p.cost_price ?? '',
    'Margen %': p.profit_margin ?? '',
    'Precio base': p.base_price,
    Stock: p.stock_quantity ?? 0,
    'Controlar inventario': p.track_inventory ? 'Sí' : 'No',
    Estado: p.state,
  }));
}

function rowsToSheet(rows: Record<string, unknown>[]) {
  const ws = XLSX.utils.json_to_sheet(rows, { header: COLUMNS });
  ws['!cols'] = COLUMNS.map(() => ({ wch: 18 }));
  return ws;
}

function workbookToBase64(wb: XLSX.WorkBook): string {
  const buf = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
  return buf;
}

async function shareBase64(base64: string, filename: string) {
  const fileUri = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.writeAsStringAsync(fileUri, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });

  if (Platform.OS === 'web') {
    const link = document.createElement('a');
    link.href = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${base64}`;
    link.download = filename;
    link.click();
    return;
  }

  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(fileUri, {
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      dialogTitle: filename,
    });
  } else {
    Alert.alert('Descarga completa', `Archivo guardado en: ${fileUri}`);
  }
}

export async function downloadEmptyTemplate() {
  const rows = [
    {
      Nombre: 'Camiseta deportiva',
      SKU: 'CAM-001',
      'Código de barras': '7701234567890',
      Slug: 'camiseta-deportiva',
      Descripción: 'Camiseta de algodón para running',
      Categoría: 'Ropa',
      Marca: 'Mi Marca',
      Tipo: 'physical',
      'Unidad de venta': 'unit',
      Costo: 15000,
      'Margen %': 30,
      'Precio base': 19500,
      Stock: 50,
      'Controlar inventario': 'Sí',
      Estado: 'active',
    },
  ];
  const ws = rowsToSheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Productos');
  const base64 = workbookToBase64(wb);
  await shareBase64(base64, 'plantilla_productos.xlsx');
}

export async function downloadCurrentProducts(products: Product[]) {
  const rows = toRows(products);
  const ws = rowsToSheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Productos');
  const base64 = workbookToBase64(wb);
  await shareBase64(base64, `productos_${new Date().toISOString().slice(0, 10)}.xlsx`);
}