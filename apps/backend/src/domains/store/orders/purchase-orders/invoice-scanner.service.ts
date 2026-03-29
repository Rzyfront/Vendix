import { Injectable, Logger } from '@nestjs/common';
import { AIEngineService } from '../../../../ai-engine/ai-engine.service';
import { AIMessage } from '../../../../ai-engine/interfaces/ai-provider.interface';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { PurchaseOrdersService } from './purchase-orders.service';
import { ResponseService } from '@common/responses/response.service';
import { VendixHttpException, ErrorCodes } from '@common/errors';
import {
  InvoiceScanResult,
  InvoiceMatchResult,
  SupplierMatch,
  MatchedLineItem,
  ProductCandidate,
  ConfirmScannedInvoiceDto,
} from './dto/scan-invoice.dto';
import { CreatePurchaseOrderDto, PurchaseOrderItemDto } from './dto/create-purchase-order.dto';
import { AddAttachmentDto } from './dto/add-attachment.dto';

@Injectable()
export class InvoiceScannerService {
  private readonly logger = new Logger(InvoiceScannerService.name);

  constructor(
    private readonly aiEngine: AIEngineService,
    private readonly prisma: StorePrismaService,
    private readonly purchaseOrdersService: PurchaseOrdersService,
    private readonly responseService: ResponseService,
  ) {}

  async scanInvoice(file: Express.Multer.File): Promise<InvoiceScanResult> {
    const dataUri = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;

    const imageMessage: AIMessage = {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `Analyze this purchase invoice image and extract all data. Return ONLY valid JSON with this exact structure (no markdown, no extra text):
{
  "supplier": { "name": "string", "tax_id": "string or null", "address": "string or null", "phone": "string or null" },
  "invoice_number": "string",
  "invoice_date": "YYYY-MM-DD",
  "payment_terms": "string or null",
  "line_items": [
    { "description": "string", "quantity": number, "unit_price": number, "total": number, "sku_if_visible": "string or null" }
  ],
  "subtotal": number,
  "tax_amount": number,
  "total": number,
  "confidence": number between 0 and 100
}`,
        },
        {
          type: 'image_url',
          image_url: { url: dataUri, detail: 'high' },
        },
      ],
    };

    const response = await this.aiEngine.run('invoice_ocr', {}, [imageMessage]);

    if (!response.success || !response.content) {
      this.logger.error(`AI OCR failed: ${response.error}`);
      throw new VendixHttpException(ErrorCodes.INV_SCAN_AI_FAIL);
    }

    try {
      let content = response.content.trim();
      // Strip markdown code fences if present
      if (content.startsWith('```')) {
        content = content.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }
      const parsed: InvoiceScanResult = JSON.parse(content);
      return parsed;
    } catch {
      this.logger.error(`Failed to parse AI OCR response: ${response.content}`);
      throw new VendixHttpException(ErrorCodes.INV_SCAN_PARSE_FAIL);
    }
  }

  async matchProducts(scanResult: InvoiceScanResult): Promise<InvoiceMatchResult> {
    const warnings: string[] = [];

    // --- Match supplier ---
    const supplierMatch = await this.matchSupplier(scanResult);
    if (supplierMatch.is_new) {
      warnings.push(`Proveedor "${scanResult.supplier.name}" no encontrado en el sistema.`);
    }

    // --- Match line items ---
    const matchedItems: MatchedLineItem[] = [];

    for (const item of scanResult.line_items) {
      const candidates = await this.findProductCandidates(item, supplierMatch.matched_id);
      const topCandidate = candidates.length > 0 ? candidates[0] : null;

      let matchStatus: 'matched' | 'partial' | 'new' = 'new';
      let selectedProductId: number | undefined;

      if (topCandidate) {
        if (topCandidate.confidence >= 90) {
          matchStatus = 'matched';
          selectedProductId = topCandidate.id;
        } else if (topCandidate.confidence >= 50) {
          matchStatus = 'partial';
          if (topCandidate.confidence >= 80) {
            selectedProductId = topCandidate.id;
          }
        }
      }

      if (matchStatus === 'new') {
        warnings.push(`Producto "${item.description}" sin coincidencias en el catálogo.`);
      }

      matchedItems.push({
        ...item,
        match_status: matchStatus,
        selected_product_id: selectedProductId,
        candidates: candidates.slice(0, 5),
      });
    }

    return {
      supplier_match: supplierMatch,
      items: matchedItems,
      warnings,
    };
  }

  async confirmAndCreatePO(
    dto: ConfirmScannedInvoiceDto,
    file?: Express.Multer.File,
  ) {
    const items: PurchaseOrderItemDto[] = dto.items.map((item) => {
      const poItem = new PurchaseOrderItemDto();
      if (item.product_id) {
        poItem.product_id = item.product_id;
      } else {
        poItem.product_id = 0;
        poItem.product_name = item.product_name || item.description;
        poItem.sku = item.sku;
      }
      poItem.quantity = item.quantity;
      poItem.unit_price = item.unit_cost;
      poItem.notes = item.description;
      return poItem;
    });

    const createDto = new CreatePurchaseOrderDto();
    createDto.supplier_id = dto.supplier_id ?? 0;
    createDto.location_id = dto.location_id;
    createDto.items = items;
    createDto.notes = dto.notes;
    createDto.tax_amount = dto.tax_amount;
    createDto.discount_amount = dto.discount_amount;

    if (dto.invoice_date) {
      createDto.order_date = dto.invoice_date;
    }

    const po = await this.purchaseOrdersService.create(createDto);

    if (dto.save_attachment && file) {
      const attachmentDto = new AddAttachmentDto();
      attachmentDto.supplier_invoice_number = dto.invoice_number;
      attachmentDto.supplier_invoice_date = dto.invoice_date;
      attachmentDto.notes = 'Factura escaneada con OCR';

      await this.purchaseOrdersService.addAttachment(po.id, file, attachmentDto);
    }

    return po;
  }

  // --- Private helpers ---

  private async matchSupplier(scanResult: InvoiceScanResult): Promise<SupplierMatch> {
    const { supplier } = scanResult;

    // Tier 1: Match by tax_id (exact, case-insensitive)
    if (supplier.tax_id) {
      const byTax = await this.prisma.suppliers.findFirst({
        where: { tax_id: { equals: supplier.tax_id, mode: 'insensitive' } },
      });
      if (byTax) {
        return {
          matched_id: byTax.id,
          name: byTax.name,
          tax_id: byTax.tax_id,
          confidence: 95,
          is_new: false,
        };
      }
    }

    // Tier 2: Match by name (contains, case-insensitive)
    if (supplier.name) {
      const byName = await this.prisma.suppliers.findFirst({
        where: { name: { contains: supplier.name, mode: 'insensitive' } },
      });
      if (byName) {
        return {
          matched_id: byName.id,
          name: byName.name,
          tax_id: byName.tax_id,
          confidence: 70,
          is_new: false,
        };
      }
    }

    return {
      name: supplier.name,
      tax_id: supplier.tax_id,
      confidence: 0,
      is_new: true,
    };
  }

  private async findProductCandidates(
    item: { description: string; sku_if_visible?: string },
    supplierId?: number,
  ): Promise<ProductCandidate[]> {
    const candidates: ProductCandidate[] = [];
    const seenIds = new Set<number>();

    // Tier 1: SKU exact match
    if (item.sku_if_visible) {
      const bySku = await this.prisma.products.findFirst({
        where: { sku: { equals: item.sku_if_visible, mode: 'insensitive' } },
        select: { id: true, name: true, sku: true, cost_price: true },
      });
      if (bySku) {
        seenIds.add(bySku.id);
        candidates.push({
          id: bySku.id,
          name: bySku.name,
          sku: bySku.sku || '',
          cost_price: bySku.cost_price ? Number(bySku.cost_price) : undefined,
          confidence: 95,
        });
      }
    }

    // Tier 2: Supplier catalog match
    if (supplierId) {
      const supplierProducts = await this.prisma.supplier_products.findMany({
        where: { supplier_id: supplierId },
        include: {
          products: { select: { id: true, name: true, sku: true, cost_price: true } },
        },
        take: 20,
      });

      for (const sp of supplierProducts) {
        if (seenIds.has(sp.products.id)) continue;
        const nameScore = this.fuzzyScore(item.description, sp.products.name);
        const skuScore = item.sku_if_visible && sp.supplier_sku
          ? (sp.supplier_sku.toLowerCase() === item.sku_if_visible.toLowerCase() ? 90 : 0)
          : 0;
        const score = Math.max(nameScore + 10, skuScore); // +10 bonus for being in supplier catalog
        if (score >= 30) {
          seenIds.add(sp.products.id);
          candidates.push({
            id: sp.products.id,
            name: sp.products.name,
            sku: sp.products.sku || '',
            cost_price: sp.cost_per_unit ? Number(sp.cost_per_unit) : undefined,
            confidence: Math.min(score, 100),
          });
        }
      }
    }

    // Tier 3: Name-based search in products table
    const keywords = item.description
      .split(/[\s,;.\-\/]+/)
      .filter((w) => w.length > 2)
      .slice(0, 4);

    if (keywords.length > 0) {
      const nameMatches = await this.prisma.products.findMany({
        where: {
          OR: keywords.map((kw) => ({
            name: { contains: kw, mode: 'insensitive' as const },
          })),
          state: { not: 'archived' },
        },
        select: { id: true, name: true, sku: true, cost_price: true },
        take: 10,
      });

      for (const p of nameMatches) {
        if (seenIds.has(p.id)) continue;
        const score = this.fuzzyScore(item.description, p.name);
        if (score >= 25) {
          seenIds.add(p.id);
          candidates.push({
            id: p.id,
            name: p.name,
            sku: p.sku || '',
            cost_price: p.cost_price ? Number(p.cost_price) : undefined,
            confidence: Math.min(score, 100),
          });
        }
      }
    }

    // Sort by confidence descending
    candidates.sort((a, b) => b.confidence - a.confidence);

    return candidates.slice(0, 5);
  }

  private fuzzyScore(query: string, target: string): number {
    const q = query.toLowerCase().trim();
    const t = target.toLowerCase().trim();

    if (q === t) return 100;
    if (t.includes(q) || q.includes(t)) return 85;

    const qWords = q.split(/\s+/).filter((w) => w.length > 2);
    const tWords = t.split(/\s+/).filter((w) => w.length > 2);

    if (qWords.length === 0 || tWords.length === 0) return 0;

    let matches = 0;
    for (const qw of qWords) {
      for (const tw of tWords) {
        if (tw.includes(qw) || qw.includes(tw)) {
          matches++;
          break;
        }
      }
    }

    return Math.round((matches / qWords.length) * 80);
  }
}
