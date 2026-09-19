import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test-utils/renderWithProviders";
import { StartShiftModal } from "./StartShiftModal";
import { cashSessionService, type CashSession } from "@/services/cashSessionService";
import { toast } from "sonner";

vi.mock("@/services/cashSessionService", () => ({
  cashSessionService: {
    start: vi.fn(),
    end: vi.fn(),
    getActive: vi.fn(),
  },
}));

vi.mock("@/services/branchService", () => ({
  branchService: {
    getMyBranches: vi.fn().mockResolvedValue([]),
  },
}));

const sampleSession: CashSession = {
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
  cashSalesTotal: 0,
  cashRefundsTotal: 0,
  cashRepaymentsTotal: 0,
  variance: null,
  status: "OPEN",
  openedAt: "2026-04-29T09:00:00Z",
  closedAt: null,
  notes: null,
};

describe("StartShiftModal", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects a negative opening balance without calling the service", async () => {
    renderWithProviders(<StartShiftModal open onCancel={() => {}} />);

    const input = screen.getByLabelText(/opening cash/i);
    fireEvent.change(input, { target: { value: "-50" } });
    // Submit the form directly: the input's min="0" makes a clicked submit fail
    // HTML constraint validation (so the handler never runs). fireEvent.submit
    // bypasses that gate and exercises the JS guard in handleSubmit.
    fireEvent.submit(input.closest("form")!);

    expect(cashSessionService.start).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Enter a valid opening cash amount");
  });

  it("calls the service and notifies success on submit", async () => {
    vi.mocked(cashSessionService.start).mockResolvedValue(sampleSession);
    const onStarted = vi.fn();
    const user = userEvent.setup();

    renderWithProviders(
      <StartShiftModal open onCancel={() => {}} onStarted={onStarted} />
    );

    await user.type(screen.getByLabelText(/opening cash/i), "200");
    await user.type(screen.getByLabelText(/notes/i), "all twenties");
    await user.click(screen.getByRole("button", { name: /start shift/i }));

    await waitFor(() => {
      expect(cashSessionService.start).toHaveBeenCalledWith(200, undefined, "all twenties");
    });
    expect(onStarted).toHaveBeenCalledWith(sampleSession);
    expect(toast.success).toHaveBeenCalled();
  });

  it("surfaces backend errors via toast", async () => {
    vi.mocked(cashSessionService.start).mockRejectedValue({
      response: { data: { message: "Already have an open shift" } },
    });
    const user = userEvent.setup();

    renderWithProviders(<StartShiftModal open onCancel={() => {}} />);

    await user.type(screen.getByLabelText(/opening cash/i), "100");
    await user.click(screen.getByRole("button", { name: /start shift/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Already have an open shift");
    });
  });
});
