import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config — drives a real browser against a running stack.
 *
 * Defaults assume `docker compose up` is running locally:
 *   frontend → http://localhost:3000
 *   backend  → http://localhost:8082
 *
 * Override with PLAYWRIGHT_BASE_URL / PLAYWRIGHT_API_URL.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false, // money-path flows can clash on shared seed data
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [["html", { open: "never" }], ["github"]] : "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
