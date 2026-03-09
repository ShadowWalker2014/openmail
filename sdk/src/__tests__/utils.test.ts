import { describe, it, expect } from "vitest";
import { normalizeTraits, mergeAttributes, generateAnonymousId, buildQuery } from "../core/utils.js";

describe("normalizeTraits", () => {
  it("uses userId as email when it looks like an email", () => {
    const result = normalizeTraits("alice@example.com", { plan: "pro" });
    expect(result.email).toBe("alice@example.com");
    expect(result.attributes.plan).toBe("pro");
  });

  it("extracts traits.email when userId is not an email", () => {
    const result = normalizeTraits("user_123", { email: "alice@example.com", plan: "pro" });
    expect(result.email).toBe("alice@example.com");
  });

  it("maps camelCase trait names to contact fields", () => {
    const result = normalizeTraits("alice@example.com", {
      firstName: "Alice",
      lastName: "Smith",
      phone: "555-1234",
    });
    expect(result.firstName).toBe("Alice");
    expect(result.lastName).toBe("Smith");
    expect(result.phone).toBe("555-1234");
    expect(result.attributes).toEqual({});
  });

  it("maps snake_case Segment trait names", () => {
    const result = normalizeTraits("alice@example.com", {
      first_name: "Alice",
      last_name: "Smith",
    });
    expect(result.firstName).toBe("Alice");
    expect(result.lastName).toBe("Smith");
  });

  it("puts unknown traits into attributes", () => {
    const result = normalizeTraits("alice@example.com", {
      plan: "pro",
      company: "Acme",
      mrr: 99,
    });
    expect(result.attributes).toEqual({ plan: "pro", company: "Acme", mrr: 99 });
  });
});

describe("mergeAttributes", () => {
  it("merges two attribute objects", () => {
    const result = mergeAttributes({ plan: "starter", seats: 1 }, { plan: "pro", mrr: 99 });
    expect(result).toEqual({ plan: "pro", seats: 1, mrr: 99 });
  });

  it("handles empty objects", () => {
    expect(mergeAttributes({}, { plan: "pro" })).toEqual({ plan: "pro" });
    expect(mergeAttributes({ plan: "pro" }, {})).toEqual({ plan: "pro" });
  });
});

describe("generateAnonymousId", () => {
  it("generates a UUID v4 format ID", () => {
    const id = generateAnonymousId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("generates unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateAnonymousId()));
    expect(ids.size).toBe(100);
  });
});

describe("buildQuery", () => {
  it("builds a query string from an object", () => {
    const q = buildQuery({ page: 1, pageSize: 50, search: "alice" });
    expect(q).toBe("?page=1&pageSize=50&search=alice");
  });

  it("omits undefined values", () => {
    const q = buildQuery({ page: 1, search: undefined });
    expect(q).toBe("?page=1");
  });

  it("returns empty string for empty object", () => {
    expect(buildQuery({})).toBe("");
  });

  it("encodes special characters", () => {
    const q = buildQuery({ search: "alice@example.com" });
    expect(q).toContain("alice%40example.com");
  });
});
