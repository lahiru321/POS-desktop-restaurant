import api from './api';

export interface CashSession {
  id: string;
  userId: string;
  userName: string | null;
  branchId: string | null;
  branchName: string | null;
  timeRecordId: string;
  clockInTime: string;
  clockOutTime: string | null;
  openingBalance: number;
  closingBalance: number | null;
  expectedBalance: number | null;
  cashSalesTotal: number | null;
  cashRefundsTotal: number | null;
  cashRepaymentsTotal: number | null;
  variance: number | null;
  status: 'OPEN' | 'CLOSED';
  openedAt: string;
  closedAt: string | null;
  notes: string | null;
}

export const cashSessionService = {
  start: async (openingBalance: number, branchId?: string, notes?: string) => {
    const res = await api.post<{ data: CashSession }>('/cash-session/start', { openingBalance, branchId, notes });
    return res.data.data;
  },

  end: async (closingBalance: number, notes?: string) => {
    const res = await api.post<{ data: CashSession }>('/cash-session/end', { closingBalance, notes });
    return res.data.data;
  },

  getActive: async () => {
    const res = await api.get<{ data: CashSession | null }>('/cash-session/active');
    return res.data.data;
  },
};
