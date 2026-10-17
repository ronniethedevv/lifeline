import { describe, expect, it } from "vitest";
import { formatBtc, formatMusd, formatPercent, ParseError, parseBtc, parseMusd, parsePercent } from "@/lib/format";

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

describe("formatPercent", () => {
  it("renders a 1e18 ratio as a percentage, 1 decimal by default", () => {
    expect(formatPercent(15n * 10n ** 17n)).toBe("150.0%"); // 1.5e18
    expect(formatPercent(1305n * 10n ** 15n)).toBe("130.5%"); // 1.305e18
    expect(formatPercent(11n * 10n ** 17n, 0)).toBe("110%");
  });
});

describe("parsers", () => {
  it("parse BTC, MUSD and percentages into 1e18-scaled bigints", () => {
    expect(parseBtc("0.05")).toBe(5n * 10n ** 16n);
    expect(parseMusd("1800")).toBe(1800n * 10n ** 18n);
    expect(parsePercent("150")).toBe(15n * 10n ** 17n);
    expect(parsePercent("130.5")).toBe(1305n * 10n ** 15n);
  });

  it("reject non-positive or malformed input with ParseError", () => {
    expect(() => parseBtc("0")).toThrow(ParseError);
    expect(() => parseMusd("")).toThrow(ParseError);
    expect(() => parsePercent("abc")).toThrow(ParseError);
    expect(() => parseBtc("-1")).toThrow(ParseError);
  });
});
