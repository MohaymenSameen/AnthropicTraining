// @vitest-environment node
import { describe, test, expect, vi, beforeEach } from "vitest";
import { SignJWT, jwtVerify } from "jose";

// Mock server-only so it doesn't throw in test environment
vi.mock("server-only", () => ({}));

// Hoist mock objects so they're available when vi.mock factories run
const { mockCookieStore } = vi.hoisted(() => ({
  mockCookieStore: {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue(mockCookieStore),
}));

// Import after mocks are set up
import {
  createSession,
  getSession,
  deleteSession,
  verifySession,
  type SessionPayload,
} from "@/lib/auth";
import { NextRequest } from "next/server";

const JWT_SECRET = new TextEncoder().encode("development-secret-key");

async function makeValidToken(payload: Partial<SessionPayload> = {}) {
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  return new SignJWT({
    userId: "user-1",
    email: "test@example.com",
    expiresAt,
    ...payload,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("7d")
    .setIssuedAt()
    .sign(JWT_SECRET);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createSession", () => {
  test("sets an httpOnly cookie with a signed JWT", async () => {
    await createSession("user-1", "test@example.com");

    expect(mockCookieStore.set).toHaveBeenCalledOnce();
    const [name, token, options] = mockCookieStore.set.mock.calls[0];

    expect(name).toBe("auth-token");
    expect(typeof token).toBe("string");
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe("lax");
    expect(options.path).toBe("/");
  });

  test("JWT contains the userId and email", async () => {
    await createSession("user-42", "hello@example.com");

    const [, token] = mockCookieStore.set.mock.calls[0];
    const { payload } = await jwtVerify(token, JWT_SECRET);

    expect(payload.userId).toBe("user-42");
    expect(payload.email).toBe("hello@example.com");
  });

  test("cookie expiry is approximately 7 days from now", async () => {
    const before = Date.now();
    await createSession("user-1", "test@example.com");
    const after = Date.now();

    const [, , options] = mockCookieStore.set.mock.calls[0];
    const expires: Date = options.expires;
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

    expect(expires.getTime()).toBeGreaterThanOrEqual(before + sevenDaysMs - 1000);
    expect(expires.getTime()).toBeLessThanOrEqual(after + sevenDaysMs + 1000);
  });
});

describe("getSession", () => {
  test("returns null when no cookie is present", async () => {
    mockCookieStore.get.mockReturnValue(undefined);

    const session = await getSession();

    expect(session).toBeNull();
  });

  test("returns null for an invalid / tampered token", async () => {
    mockCookieStore.get.mockReturnValue({ value: "not.a.valid.jwt" });

    const session = await getSession();

    expect(session).toBeNull();
  });

  test("returns the session payload for a valid token", async () => {
    const token = await makeValidToken({ userId: "user-5", email: "a@b.com" });
    mockCookieStore.get.mockReturnValue({ value: token });

    const session = await getSession();

    expect(session).not.toBeNull();
    expect(session!.userId).toBe("user-5");
    expect(session!.email).toBe("a@b.com");
  });

  test("returns null for an expired token", async () => {
    const expiredToken = await new SignJWT({
      userId: "user-1",
      email: "x@y.com",
      expiresAt: new Date(Date.now() - 1000),
    })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("-1s")
      .setIssuedAt()
      .sign(JWT_SECRET);

    mockCookieStore.get.mockReturnValue({ value: expiredToken });

    const session = await getSession();

    expect(session).toBeNull();
  });

  test("returns null for a token signed with a different secret", async () => {
    const wrongSecret = new TextEncoder().encode("wrong-secret");
    const token = await new SignJWT({ userId: "user-1", email: "a@b.com" })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("7d")
      .setIssuedAt()
      .sign(wrongSecret);

    mockCookieStore.get.mockReturnValue({ value: token });

    const session = await getSession();

    expect(session).toBeNull();
  });

  test("returns the expiresAt field from the token payload", async () => {
    const token = await makeValidToken({ userId: "user-1", email: "a@b.com" });
    mockCookieStore.get.mockReturnValue({ value: token });

    const session = await getSession();

    expect(session!.expiresAt).toBeDefined();
  });

  test("reads from the auth-token cookie specifically", async () => {
    mockCookieStore.get.mockReturnValue(undefined);

    await getSession();

    expect(mockCookieStore.get).toHaveBeenCalledWith("auth-token");
  });
});

describe("deleteSession", () => {
  test("deletes the auth-token cookie", async () => {
    await deleteSession();

    expect(mockCookieStore.delete).toHaveBeenCalledOnce();
    expect(mockCookieStore.delete).toHaveBeenCalledWith("auth-token");
  });
});

describe("verifySession", () => {
  function makeRequest(token?: string) {
    const req = new NextRequest("http://localhost/api/test");
    if (token) {
      req.cookies.set("auth-token", token);
    }
    return req;
  }

  test("returns null when the request has no auth cookie", async () => {
    const session = await verifySession(makeRequest());

    expect(session).toBeNull();
  });

  test("returns null for an invalid token in the request", async () => {
    const session = await verifySession(makeRequest("garbage.token.here"));

    expect(session).toBeNull();
  });

  test("returns the session payload for a valid request token", async () => {
    const token = await makeValidToken({ userId: "user-99", email: "req@test.com" });

    const session = await verifySession(makeRequest(token));

    expect(session).not.toBeNull();
    expect(session!.userId).toBe("user-99");
    expect(session!.email).toBe("req@test.com");
  });

  test("returns null for an expired request token", async () => {
    const expiredToken = await new SignJWT({
      userId: "user-1",
      email: "x@y.com",
      expiresAt: new Date(Date.now() - 1000),
    })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("-1s")
      .setIssuedAt()
      .sign(JWT_SECRET);

    const session = await verifySession(makeRequest(expiredToken));

    expect(session).toBeNull();
  });
});