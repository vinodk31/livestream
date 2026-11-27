import { describe, expect, it } from "vitest";
import { loginSchema, registerSchema, resetPasswordSchema, verifyEmailSchema } from "@/lib/validation/auth";
import { safeRedirectPath } from "@/lib/utils";

describe("auth validation", () => {
  it("normalizes email case and whitespace", () => {
    const r = loginSchema.parse({ email: "  Alice@Example.COM ", password: "x" });
    expect(r.email).toBe("alice@example.com");
  });

  it("enforces password rules", () => {
    const base = { name: "A", email: "a@b.co" };
    expect(registerSchema.safeParse({ ...base, password: "short1" }).success).toBe(false);
    expect(registerSchema.safeParse({ ...base, password: "allletterspassword" }).success).toBe(false);
    expect(registerSchema.safeParse({ ...base, password: "1234567890123" }).success).toBe(false);
    expect(registerSchema.safeParse({ ...base, password: "goodpassword1" }).success).toBe(true);
  });

  it("rejects invalid emails", () => {
    expect(loginSchema.safeParse({ email: "not-an-email", password: "x" }).success).toBe(false);
  });

  it("requires matching passwords on reset", () => {
    const r = resetPasswordSchema.safeParse({
      email: "a@b.co",
      code: "123456",
      password: "goodpassword1",
      confirmPassword: "other",
    });
    expect(r.success).toBe(false);
  });
});

describe("one-time codes", () => {
  it("accepts 6 digits, tolerating spaces", () => {
    expect(verifyEmailSchema.parse({ code: "123 456" }).code).toBe("123456");
    expect(verifyEmailSchema.parse({ code: "000042" }).code).toBe("000042");
  });

  it.each(["12345", "1234567", "12a456", ""])("rejects %j", (code) => {
    expect(verifyEmailSchema.safeParse({ code }).success).toBe(false);
  });
});

describe("safeRedirectPath", () => {
  it.each([
    ["/streams/abc", "/streams/abc"],
    ["https://evil.com", "/dashboard"],
    ["//evil.com", "/dashboard"],
    ["/\\evil.com", "/dashboard"],
    [undefined, "/dashboard"],
  ])("%s -> %s", (input, expected) => {
    expect(safeRedirectPath(input)).toBe(expected);
  });
});
