import { describe, expect, it } from 'vitest';
import { visibleNavItems } from './navItems';

const allFeatures = (feature: string) => feature.length > 0;
const labels = (roles: string[], branchCount?: number, hasFeature: (feature: string) => boolean = allFeatures) =>
  visibleNavItems({ roles, hasFeature, branchCount }).map((i) => i.label);

describe('visibleNavItems', () => {
  it('speaks restaurant: Menu Items and Menu Categories, no Brands', () => {
    const admin = labels(['ADMIN'], 1);
    expect(admin).toContain('Menu Items');
    expect(admin).toContain('Menu Categories');
    expect(admin).not.toContain('Products');
    expect(admin).not.toContain('Brands');
  });

  it('keys visibility on roles, not labels: a cashier sees the menu and customers only', () => {
    expect(labels(['CASHIER'], 1)).toEqual(['Menu Items', 'Menu Categories', 'Customers', 'My Profile']);
  });

  it('shows the stock screens to an inventory manager, not the admin-only ones', () => {
    const inv = labels(['INVENTORY_MANAGER'], 2);
    expect(inv).toEqual(expect.arrayContaining(['Suppliers', 'Purchase Orders', 'Stock Transfers']));
    expect(inv).not.toContain('Settings');
    expect(inv).not.toContain('Tables');
  });

  it('shows Stock Transfers only once there is a second branch to transfer to', () => {
    expect(labels(['ADMIN'], 1)).not.toContain('Stock Transfers');
    expect(labels(['ADMIN'], undefined)).not.toContain('Stock Transfers');
    expect(labels(['ADMIN'], 2)).toContain('Stock Transfers');
  });

  it('still hides a page whose feature is off', () => {
    const noReports = labels(['ADMIN'], 1, (f) => f !== 'REPORTS');
    expect(noReports).not.toContain('Reports');
    expect(noReports).toContain('Settings');
  });
});
