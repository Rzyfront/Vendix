// Stub declaration for maplibre-gl to silence TS2307.
// maplibre-gl is declared in package.json but the actual package is not
// installed in node_modules (likely an incomplete npm install in this
// workspace). The component that imports it already casts to `any`:
//
//   const maplibreModule = await import('maplibre-gl');
//   const maplibregl: any = (maplibreModule as any).default ?? maplibreModule;
//
// So runtime behavior is not affected. This declaration only tells
// TypeScript that the module exists. If maplibre-gl is installed later,
// this stub becomes a no-op (TypeScript will prefer the real types).
//
// Related: TS2307 error in
// src/app/private/modules/ecommerce/components/address-map-picker/address-map-picker.component.ts:79
declare module 'maplibre-gl';
