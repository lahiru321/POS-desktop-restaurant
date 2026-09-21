/**
 * Credentials the E2E suite uses to log in. The backend's V1 / dev seed data
 * provisions these — adjust if your seed changes.
 *
 * For CI you should override these via env vars and use a dedicated test
 * tenant so accidental writes don't pollute shared dev data.
 */
export const TEST_USER = {
  email: process.env.E2E_EMAIL ?? "cashier@demo.lumora.com",
  password: process.env.E2E_PASSWORD ?? "Cashier123!",
};

/**
 * A terminal-capable account that exists in the default dev seed. ADMIN can open
 * /terminal too, so a11y/visual specs that only need the terminal *chrome*
 * rendered can use this without depending on a dedicated cashier being seeded.
 * Override via env for CI or a real cashier-only run.
 */
export const TERMINAL_USER = {
  email: process.env.E2E_TERMINAL_EMAIL ?? "admin@demo.lumora.com",
  password: process.env.E2E_TERMINAL_PASSWORD ?? "admin123",
};

export const API_URL =
  process.env.PLAYWRIGHT_API_URL ?? "http://localhost:8082";
