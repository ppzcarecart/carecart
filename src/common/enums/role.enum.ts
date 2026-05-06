export enum Role {
  ADMIN = 'admin',
  MANAGER = 'manager',
  VENDOR = 'vendor',
  // Scoped staff role: only the Manage Collection workflow.
  // Cannot see or use Forfeit, products, orders, or any admin tools.
  SCANNER = 'scanner',
  CUSTOMER = 'customer',
}
