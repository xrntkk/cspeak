// Polyfill for demoparser2's wasm-bindgen bootstrapping.
// It reads `location.href` when `document` is undefined. Cloudflare Workers
// don't define `location`, so we provide a harmless fallback before the
// demoparser2 module is evaluated.
if (typeof globalThis.location === "undefined") {
  globalThis.location = { href: "https://csspeak-market.xrntkk.top/" };
}
