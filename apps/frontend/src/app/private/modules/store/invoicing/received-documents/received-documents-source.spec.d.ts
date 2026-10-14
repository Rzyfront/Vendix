// Source guards use Angular's text loader, not browser-incompatible Node fs.
declare module '*?source' {
  const source: string;
  export default source;
}
