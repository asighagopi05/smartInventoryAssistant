import Dashboard from '../pages/Dashboard';
import Products from '../pages/Products';
import Stock from '../pages/Stock';
import Restock from '../pages/Restock';
import Billing from '../pages/Billing';
import Customers from '../pages/Customers';
import CustomerDetail from '../pages/CustomerDetail';
import Suppliers from '../pages/Suppliers';
import Feedback from '../pages/Feedback';
import QRCodes from '../pages/QRCodes';
import Team from '../pages/Team';

/**
 * The single source of truth for navigation.
 *
 * The sidebar and the router are both generated from this array. That is
 * deliberate: the previous build kept a nav list with ten destinations and no
 * files behind them, so half the menu led nowhere. Here a screen cannot appear
 * in the menu without a component, and cannot be reachable without being in
 * the menu for that role.
 *
 * `roles` gates both at once. Adding a screen means adding one entry.
 */
export const ROUTES = [
  {
    path: '/', label: 'Dashboard', icon: 'bi-grid-1x2-fill',
    component: Dashboard, roles: ['Owner', 'Manager', 'Staff'],
    accent: 'indigo', section: 'Overview',
  },
  {
    path: '/billing', label: 'Billing', icon: 'bi-receipt',
    component: Billing, roles: ['Manager', 'Staff'], // never the Owner
    accent: 'teal', section: 'Counter',
  },
  {
    path: '/customers', label: 'Customers', icon: 'bi-people-fill',
    component: Customers, roles: ['Owner', 'Manager', 'Staff'],
    accent: 'rose', section: 'Counter',
  },
  {
    path: '/customers/:id', label: 'Customer', icon: 'bi-person',
    component: CustomerDetail, roles: ['Owner', 'Manager', 'Staff'],
    hidden: true,
  },
  {
    path: '/products', label: 'Products', icon: 'bi-box-seam-fill',
    component: Products, roles: ['Owner', 'Manager', 'Staff'],
    accent: 'sky', section: 'Inventory',
  },
  {
    path: '/stock', label: 'Stock ledger', icon: 'bi-clipboard-data-fill',
    component: Stock, roles: ['Owner', 'Manager', 'Staff'],
    accent: 'sage', section: 'Inventory',
  },
  {
    path: '/restock', label: 'Restock requests', icon: 'bi-arrow-repeat',
    component: Restock, roles: ['Owner', 'Manager', 'Staff'],
    accent: 'amber', section: 'Inventory',
    badge: 'restock',
  },
  {
    path: '/suppliers', label: 'Suppliers', icon: 'bi-truck',
    component: Suppliers, roles: ['Owner', 'Manager'],
    accent: 'coral', section: 'Inventory',
  },
  {
    path: '/feedback', label: 'Feedback', icon: 'bi-star-fill',
    component: Feedback, roles: ['Owner', 'Manager', 'Staff'],
    accent: 'plum', section: 'Shop',
  },
  {
    path: '/qr', label: 'QR codes', icon: 'bi-qr-code',
    component: QRCodes, roles: ['Owner', 'Manager'],
    accent: 'teal', section: 'Shop',
  },
  {
    path: '/team', label: 'Team', icon: 'bi-person-badge-fill',
    component: Team, roles: ['Owner', 'Manager'],
    accent: 'indigo', section: 'Shop',
  },
];

export const SECTION_ORDER = ['Overview', 'Counter', 'Inventory', 'Shop'];

export const routesForRole = (role) =>
  ROUTES.filter((r) => r.roles.includes(role));

export const navForRole = (role) =>
  ROUTES.filter((r) => r.roles.includes(role) && !r.hidden);

export const ROLE_META = {
  Owner: { color: 'var(--role-owner)', blurb: 'Owns the shop. Sees everything, bills nothing.' },
  Manager: { color: 'var(--role-manager)', blurb: 'Runs products, suppliers, restocking and staff.' },
  Staff: { color: 'var(--role-staff)', blurb: 'The floor and the till.' },
};
