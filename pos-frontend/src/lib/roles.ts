/**
 * What the restaurant calls each role. Display only: the names the backend
 * checks (`@PreAuthorize`, `NavItem.roles`) stay ADMIN / MANAGER / CASHIER /
 * INVENTORY_MANAGER. One till on the cashier desk, so there is no server role.
 */
export const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Admin",
  MANAGER: "Manager",
  CASHIER: "Cashier",
  INVENTORY_MANAGER: "Stock Keeper",
};

export const roleLabel = (role: string): string => ROLE_LABELS[role] ?? role;
