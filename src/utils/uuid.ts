/**
 * Safe RFC4122 v4 UUID generator.
 *
 * In non-secure contexts (such as testing over local Wi-Fi IP http://192.168.x.x or
 * older mobile WebViews), `crypto.randomUUID` is undefined according to the Web Cryptography specification.
 *
 * This utility safely checks for `crypto.randomUUID()`, then falls back to `crypto.getRandomValues()`,
 * and finally to `Math.random()` to guarantee compliant RFC4122 v4 UUID generation in all runtime environments.
 */
export function generateUUID(): string {
  // 1. Native crypto.randomUUID (available in modern browsers in secure contexts: HTTPS or localhost)
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    try {
      return crypto.randomUUID();
    } catch {
      // Fall through to standard fallback if invocation throws
    }
  }

  // 2. Fallback using crypto.getRandomValues if available
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.getRandomValues === "function"
  ) {
    try {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);

      // Per RFC 4122 section 4.4:
      // Set the 4 most significant bits of the 7th byte to 0100 (version 4)
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      // Set the 2 most significant bits of the 9th byte to 10 (variant 10xx)
      bytes[8] = (bytes[8] & 0x3f) | 0x80;

      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
      return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
    } catch {
      // Fall through to Math.random
    }
  }

  // 3. RFC4122 compliant fallback using Math.random for environments with restricted crypto
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
