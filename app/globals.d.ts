// Vite `?url` imports (e.g. Polaris stylesheet) resolve to a URL string at build time.
declare module "*.css?url" {
  const url: string;
  export default url;
}
