import { describe, it, expect } from "vitest";
import {
  formatCurrency,
  isValidPhone,
  normalizeBDPhone,
  calculateOrderTotals,
  formatDateTime,
  formatDate,
  formatTime,
  copyToClipboard,
  generateUUID,
} from "./helpers";
import { APP_CONFIG } from "../config/config";
import { vi } from "vitest";

describe("Bangladesh Localization & Configuration", () => {
  describe("App Config", () => {
    it("should use Bangladeshi Taka (৳) as default currency", () => {
      expect(APP_CONFIG.defaultCurrency).toBe("৳");
    });

    it("should support bKash and Nagad payment methods and exclude UPI", () => {
      expect(APP_CONFIG.paymentMethods).toContain("bKash");
      expect(APP_CONFIG.paymentMethods).toContain("Nagad");
      expect(APP_CONFIG.paymentMethods).toContain("Cash");
      expect(APP_CONFIG.paymentMethods).not.toContain("UPI");
    });

    it("should have standard NBR 5% VAT rate by default", () => {
      expect(APP_CONFIG.taxRate).toBe(0.05);
    });
  });

  describe("formatCurrency", () => {
    it("should format positive amounts with ৳ symbol", () => {
      expect(formatCurrency(250)).toBe("৳250.00");
      expect(formatCurrency(1499.5)).toBe("৳1499.50");
    });

    it("should handle 0, null, undefined and NaN gracefully", () => {
      expect(formatCurrency(0)).toBe("৳0.00");
      expect(formatCurrency(null)).toBe("৳0.00");
      expect(formatCurrency(undefined)).toBe("৳0.00");
      expect(formatCurrency(NaN)).toBe("৳0.00");
    });
  });

  describe("isValidPhone (Bangladeshi Format)", () => {
    it("should accept valid 11-digit Bangladeshi mobile numbers", () => {
      expect(isValidPhone("01712345678")).toBe(true); // GP
      expect(isValidPhone("01312345678")).toBe(true); // Skitto
      expect(isValidPhone("01412345678")).toBe(true); // Banglalink
      expect(isValidPhone("01512345678")).toBe(true); // Teletalk
      expect(isValidPhone("01612345678")).toBe(true); // Airtel
      expect(isValidPhone("01812345678")).toBe(true); // Robi
      expect(isValidPhone("01912345678")).toBe(true); // Banglalink
    });

    it("should accept valid BD numbers with +880 and 880 prefixes", () => {
      expect(isValidPhone("+8801712345678")).toBe(true);
      expect(isValidPhone("8801812345678")).toBe(true);
    });

    it("should accept valid numbers with hyphens and spaces", () => {
      expect(isValidPhone("017-1234-5678")).toBe(true);
      expect(isValidPhone("+880 1712 345678")).toBe(true);
      expect(isValidPhone("(018) 1234 5678")).toBe(true);
    });

    it("should reject invalid phone numbers", () => {
      expect(isValidPhone("01212345678")).toBe(false); // 012 is invalid operator prefix
      expect(isValidPhone("0171234567")).toBe(false); // 10 digits (too short)
      expect(isValidPhone("017123456789")).toBe(false); // 12 digits (too long)
      expect(isValidPhone("9876543210")).toBe(false); // Indian format
      expect(isValidPhone("")).toBe(false);
      expect(isValidPhone("abcdefghijk")).toBe(false);
    });
  });

  describe("normalizeBDPhone", () => {
    it("should normalize 11-digit numbers to +8801XXXXXXXXX", () => {
      expect(normalizeBDPhone("01712345678")).toBe("+8801712345678");
      expect(normalizeBDPhone("01898765432")).toBe("+8801898765432");
    });

    it("should keep +880 prefix if already present", () => {
      expect(normalizeBDPhone("+8801712345678")).toBe("+8801712345678");
    });

    it("should add + if starting with 880", () => {
      expect(normalizeBDPhone("8801712345678")).toBe("+8801712345678");
    });

    it("should strip formatting and normalize", () => {
      expect(normalizeBDPhone("017-1234-5678")).toBe("+8801712345678");
      expect(normalizeBDPhone("+880 1812 345678")).toBe("+8801812345678");
    });
  });

  describe("calculateOrderTotals (Configurable VAT)", () => {
    const mockItems = [
      { item_total: 600 },
      { item_total: 400 },
    ];

    it("should calculate with default 5% NBR VAT", () => {
      const { subtotal, tax, total } = calculateOrderTotals(mockItems);
      expect(subtotal).toBe(1000);
      expect(tax).toBe(50);
      expect(total).toBe(1050);
    });

    it("should calculate with custom 7.5% AC restaurant VAT", () => {
      const { subtotal, tax, total } = calculateOrderTotals(mockItems, 0.075);
      expect(subtotal).toBe(1000);
      expect(tax).toBe(75);
      expect(total).toBe(1075);
    });

    it("should calculate with custom 15% fine dining VAT", () => {
      const { subtotal, tax, total } = calculateOrderTotals(mockItems, 0.15);
      expect(subtotal).toBe(1000);
      expect(tax).toBe(150);
      expect(total).toBe(1150);
    });

    it("should calculate with 0% VAT when exempt", () => {
      const { subtotal, tax, total } = calculateOrderTotals(mockItems, 0);
      expect(subtotal).toBe(1000);
      expect(tax).toBe(0);
      expect(total).toBe(1000);
    });
  });

  describe("Timezone (Asia/Dhaka)", () => {
    // 2026-11-17T06:30:00.000Z in UTC is 12:30 PM in Asia/Dhaka (+06:00)
    const testUtcDate = "2026-11-17T06:30:00.000Z";

    it("should format time in Asia/Dhaka (+06:00)", () => {
      const timeStr = formatTime(testUtcDate);
      expect(timeStr).toMatch(/12:30/);
    });

    it("should format date in Asia/Dhaka", () => {
      const dateStr = formatDate(testUtcDate);
      expect(dateStr).toMatch(/17 Nov 2026/);
    });

    it("should format date and time in Asia/Dhaka", () => {
      const dateTimeStr = formatDateTime(testUtcDate);
      expect(dateTimeStr).toMatch(/17 Nov 2026/);
      expect(dateTimeStr).toMatch(/12:30/);
    });
  });

  describe("copyToClipboard", () => {
    it("should return false if text is empty", async () => {
      const result = await copyToClipboard("");
      expect(result).toBe(false);
    });

    it("should use navigator.clipboard.writeText when available and in secure context", async () => {
      const writeTextMock = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(globalThis, "window", {
        value: { isSecureContext: true },
        configurable: true,
        writable: true,
      });
      Object.defineProperty(globalThis.navigator, "clipboard", {
        value: { writeText: writeTextMock },
        configurable: true,
        writable: true,
      });

      const result = await copyToClipboard("https://amarmenu.com/onboarding");
      expect(result).toBe(true);
      expect(writeTextMock).toHaveBeenCalledWith("https://amarmenu.com/onboarding");
    });

    it("should fall back to document.execCommand when navigator.clipboard is unavailable (HTTP / LAN context)", async () => {
      // Simulate non-secure context (e.g. http://192.168.0.103:5173)
      Object.defineProperty(globalThis, "window", {
        value: { isSecureContext: false },
        configurable: true,
        writable: true,
      });
      Object.defineProperty(globalThis.navigator, "clipboard", {
        value: undefined,
        configurable: true,
        writable: true,
      });

      const mockTextArea = {
        value: "",
        style: {},
        setAttribute: vi.fn(),
        focus: vi.fn(),
        select: vi.fn(),
        setSelectionRange: vi.fn(),
      };

      const execCommandMock = vi.fn().mockReturnValue(true);
      Object.defineProperty(globalThis, "document", {
        value: {
          createElement: vi.fn().mockReturnValue(mockTextArea),
          body: {
            appendChild: vi.fn(),
            removeChild: vi.fn(),
          },
          execCommand: execCommandMock,
        },
        configurable: true,
        writable: true,
      });

      const result = await copyToClipboard("http://192.168.0.103:5173/set-password?email=test@example.com");
      expect(result).toBe(true);
      expect(execCommandMock).toHaveBeenCalledWith("copy");
      expect(mockTextArea.value).toBe("http://192.168.0.103:5173/set-password?email=test@example.com");
    });
  });

  describe("generateUUID", () => {
    it("should generate a valid RFC4122 v4 UUID format", () => {
      const uuid = generateUUID();
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(uuid).toMatch(uuidRegex);
    });

    it("should generate unique identifiers on successive calls", () => {
      const set = new Set<string>();
      for (let i = 0; i < 100; i++) {
        set.add(generateUUID());
      }
      expect(set.size).toBe(100);
    });

    it("should work when crypto.randomUUID is undefined (e.g. non-HTTPS / HTTP IP access)", () => {
      const originalCrypto = globalThis.crypto;
      try {
        // Simulate non-secure context where randomUUID is not exposed
        const mockCrypto = {
          getRandomValues: originalCrypto?.getRandomValues?.bind(originalCrypto),
        } as any;
        Object.defineProperty(globalThis, "crypto", {
          value: mockCrypto,
          configurable: true,
          writable: true,
        });

        const fallbackUUID = generateUUID();
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        expect(fallbackUUID).toMatch(uuidRegex);
      } finally {
        Object.defineProperty(globalThis, "crypto", {
          value: originalCrypto,
          configurable: true,
          writable: true,
        });
      }
    });
  });
});
