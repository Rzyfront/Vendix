# Ejemplo de export XLSX (controller)

```ts
// controller
async exportVentas(@Query() query: SalesReportQueryDto, @Res() res: Response): Promise<void> {
  const tz = await this.resolveReportTz();                 // store TZ, fallback America/Bogota
  const rows = await this.salesService.getSalesForExport(query); // RAW: Date + números
  const sheet = this.toSheet('Ventas', [
    { key: 'created_at', header: 'Fecha',   type: 'date',     tz },
    { key: 'order_code', header: 'Orden',   type: 'text' },
    { key: 'total',      header: 'Total',   type: 'currency' },
    { key: 'margin',     header: 'Margen',  type: 'percent' }, // percent = fracción (0.15 = 15%)
  ], rows, tz);
  await this.emitReport(res, 'reporte_ventas', tz, [sheet]);
}
```

