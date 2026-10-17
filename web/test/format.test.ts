import { describe, expect, it } from "vitest";
import { formatBtc, formatMusd } from "@/lib/format";

describe("formatBtc", () => {
  it("shows at most 8 decimals, rounded down", () => {
    expect(formatBtc(123_456_789_123_456_789n)).toBe("0.12345678");
    expect(formatBtc(10n ** 18n)).toBe("1");
    expect(formatBtc(9n)).toBe("0"); // below 1 sat
  });
});

describe("formatMusd", () => {
  it("shows 2 decimals with thousands separators, rounded down", () => {
    expect(formatMusd(1_234_567_891n * 10n ** 15n)).toBe("1,234,567.89");
    expect(formatMusd(5n * 10n ** 16n)).toBe("0.05");
    expect(formatMusd(0n)).toBe("0.00");
  });
});
