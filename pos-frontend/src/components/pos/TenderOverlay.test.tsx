import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test-utils/renderWithProviders";
import { TenderOverlay } from "./TenderOverlay";

const baseProps = {
  open: true,
  onClose: vi.fn(),
  paymentMethod: "CASH" as const,
  onPaymentMethodChange: vi.fn(),
  cashTendered: 0,
  onCashTenderedChange: vi.fn(),
  subtotal: 100,
  taxAmount: 0,
  total: 100,
  isProcessing: false,
  onComplete: vi.fn(),
};

describe("TenderOverlay — store credit", () => {
  it("hides the Credit option when the feature is off", () => {
    renderWithProviders(<TenderOverlay {...baseProps} creditEnabled={false} />);
    expect(screen.queryByRole("radio", { name: "Credit" })).not.toBeInTheDocument();
  });

  it("shows the Credit option when enabled and a customer is attached", () => {
    renderWithProviders(
      <TenderOverlay {...baseProps} creditEnabled availableCredit={500} creditBalance={0} />
    );
    expect(screen.getByRole("radio", { name: "Credit" })).toBeInTheDocument();
  });

  it("disables Complete when the amount due exceeds available credit", () => {
    renderWithProviders(
      <TenderOverlay
        {...baseProps}
        paymentMethod="CREDIT"
        creditEnabled
        availableCredit={40}
        creditBalance={10}
      />
    );
    expect(screen.getByText(/exceeds available credit/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /complete sale/i })).toBeDisabled();
  });

  it("allows Complete on credit within the available limit", () => {
    renderWithProviders(
      <TenderOverlay
        {...baseProps}
        paymentMethod="CREDIT"
        creditEnabled
        availableCredit={500}
        creditBalance={0}
      />
    );
    expect(screen.queryByText(/exceeds available credit/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /complete sale/i })).not.toBeDisabled();
  });
});
