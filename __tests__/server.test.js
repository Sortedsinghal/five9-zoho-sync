const { normalizeLanguage, app } = require("../server");
const request = require("supertest");

// ─── normalizeLanguage ────────────────────────────────────────────────────────

describe("normalizeLanguage()", () => {
  test("returns English for null input", () => {
    expect(normalizeLanguage(null)).toBe("English");
  });

  test("returns English for empty string", () => {
    expect(normalizeLanguage("")).toBe("English");
  });

  test("returns English for undefined", () => {
    expect(normalizeLanguage(undefined)).toBe("English");
  });

  test("returns English for 'English'", () => {
    expect(normalizeLanguage("English")).toBe("English");
  });

  test("returns English for 'english' (case-insensitive)", () => {
    expect(normalizeLanguage("english")).toBe("English");
  });

  test("returns English for 'EN'", () => {
    expect(normalizeLanguage("EN")).toBe("English");
  });

  test("returns Spanish for 'Spanish'", () => {
    expect(normalizeLanguage("Spanish")).toBe("Spanish");
  });

  test("returns Spanish for 'spanish' (case-insensitive)", () => {
    expect(normalizeLanguage("spanish")).toBe("Spanish");
  });

  test("returns Spanish for 'ES'", () => {
    expect(normalizeLanguage("ES")).toBe("Spanish");
  });

  test("returns Spanish for 'Español'", () => {
    expect(normalizeLanguage("Español")).toBe("Spanish");
  });

  test("defaults to English for unknown values", () => {
    expect(normalizeLanguage("French")).toBe("English");
    expect(normalizeLanguage("mandarin")).toBe("English");
  });
});

// ─── POST /lead ───────────────────────────────────────────────────────────────

describe("POST /lead — input validation", () => {
  test("returns 400 when email is missing", async () => {
    const res = await request(app)
      .post("/lead")
      .send({ name: "Test User" })
      .set("Content-Type", "application/json");

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "Email required");
  });

  test("returns 400 when body is empty", async () => {
    const res = await request(app)
      .post("/lead")
      .send({})
      .set("Content-Type", "application/json");

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "Email required");
  });

  test("returns 400 when email is null", async () => {
    const res = await request(app)
      .post("/lead")
      .send({ email: null })
      .set("Content-Type", "application/json");

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "Email required");
  });
});
