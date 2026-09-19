import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test-utils/renderWithProviders";
import { EndShiftModal } from "./EndShiftModal";
import { cashSessionService, type CashSession } from "@/services/cashSessionService";
import { toast } from "sonner";

vi.mock("@/services/cashSessionService", () => ({
  cashSessionService: {
    start: vi.fn(),
    end: vi.fn(),
    getActive: vi.fn(),
  },
}));

function activeSession(overrides: Partial<CashSession> = {}): CashSession {
  return {
    id: "s1",
    userId: "u1",
    userName: "Alex",
    branchId: "b1",
    branchName: "Main Branch",
    timeRecordId: "t1",
    clockInTime: "2026-04-29T09:00:00Z",
    clockOutTime: null,
    openingBalance: 200,
    closingBalance: null,
    expectedBalance: null,
    cashSalesTotal: 50,
    cashRefundsTotal: 0,
    cashRepaymentsTotal: 0,
    variance: null,
    status: "OPEN",
    openedAt: "2026-04-29T09:00:00Z",
    closedAt: null,
    notes: null,
    ...overrides,
  };
}

describe("EndShiftModal", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders expected = opening + cash sales − refunds", async () => {
    vi.mocked(cashSessionService.getActive).mockResolvedValue(
      activeSession({ openingBalance: 200, cashSalesTotal: 80, cashRefundsTotal: 30 })
    );

    renderWithProviders(<EndShiftModal open onClose={() => {}} />);

    // Expected = 200 + 80 − 30 = 250 (currency-agnostic — app renders LKR "Rs.")
    await waitFor(() => {
      expect(screen.getByTestId("end-shift-expected")).toHaveTextContent("250.00");
    });
    // The refund-line warning shows when refunds > 0
    expect(screen.getByText(/cash refunds issued/i)).toBeInTheDocument();
  });

  it("shows live 'balances exactly' when counted matches expected", async () => {
    vi.mocked(cashSessionService.getActive).mockResolvedValue(activeSession());
    const user = userEvent.setup();

    renderWithProviders(<EndShiftModal open onClose={() => {}} />);

    await screen.findByLabelText(/counted cash/i);
    await user.type(screen.getByLabelText(/counted cash/i), "250");

    expect(await screen.findByText(/balances exactly/i)).toBeInTheDocument();
  });

  it("shows 'short by' when counted is below expected", async () => {
    vi.mocked(cashSessionService.getActive).mockResolvedValue(activeSession());
    const user = userEvent.setup();

    renderWithProviders(<EndShiftModal open onClose={() => {}} />);

    await screen.findByLabelText(/counted cash/i);
    await user.type(screen.getByLabelText(/counted cash/i), "240");

    expect(await screen.findByText(/short by .*10\.00/i)).toBeInTheDocument();
  });

  it("submits the counted amount and reports the variance toast", async () => {
    vi.mocked(cashSessionService.getActive).mockResolvedValue(activeSession());
    vi.mocked(cashSessionService.end).mockResolvedValue(
      activeSession({ status: "CLOSED", variance: 0, closingBalance: 250 })
    );
    const onClose = vi.fn();
    const onEnded = vi.fn();
    const user = userEvent.setup();

    renderWithProviders(<EndShiftModal open onClose={onClose} onEnded={onEnded} />);

    await screen.findByLabelText(/counted cash/i);
    await user.type(screen.getByLabelText(/counted cash/i), "250");
    await user.click(screen.getByRole("button", { name: /end shift/i }));

    await waitFor(() => {
      expect(cashSessionService.end).toHaveBeenCalledWith(250, undefined);
    });
    expect(onEnded).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalled();
  });
});
