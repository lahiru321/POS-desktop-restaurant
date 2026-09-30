import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const get = vi.hoisted(() => vi.fn());
vi.mock("@/services/api", () => ({ default: { get } }));

import { LicenseBanner } from "./LicenseBanner";

function renderBanner() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LicenseBanner />
    </QueryClientProvider>
  );
}

const ok = (data: object) => Promise.resolve({ data: { data } });

beforeEach(() => vi.clearAllMocks());

describe("LicenseBanner", () => {
  it("shows nothing while the license is fine", async () => {
    get.mockReturnValue(ok({ state: "OK", daysLeft: 200 }));
    const { container } = renderBanner();
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("shows nothing outside the desktop app, where the endpoint does not exist", async () => {
    get.mockReturnValue(Promise.reject(Object.assign(new Error("Not Found"), { response: { status: 404 } })));
    const { container } = renderBanner();
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("warns ahead of expiry with the date and days left", async () => {
    get.mockReturnValue(ok({ state: "EXPIRING", expiresAt: "2026-10-12T00:00:00Z", daysLeft: 12 }));
    renderBanner();
    expect(await screen.findByRole("alert")).toHaveTextContent(/expires on .*12 Oct.*12 days/);
  });

  it("in the grace period, says in red the day the till will stop", async () => {
    get.mockReturnValue(
      ok({ state: "GRACE", expiresAt: "2026-10-01T00:00:00Z", graceEndsAt: "2026-10-08T00:00:00Z", daysLeft: 1 })
    );
    renderBanner();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/has expired.*until .*8 Oct.*1 day.*will not start/);
    expect(alert.className).toMatch(/destructive/);
  });
});
