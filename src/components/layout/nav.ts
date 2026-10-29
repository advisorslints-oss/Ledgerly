import { BarChart3, BookOpen, Landmark, LayoutDashboard, Package, Receipt, Settings, ShoppingCart, type LucideIcon } from 'lucide-react'

export interface NavItem {
  label: string
  to: string
  icon: LucideIcon
  /** Other path prefixes that belong to this section, so it stays highlighted. */
  match?: string[]
}

/** The main sections. Everything else lives in tabs inside them, so no screen gets crowded. */
export function navItems(): NavItem[] {
  return [
    { label: 'Home', to: '/', icon: LayoutDashboard },
    { label: 'Sales', to: '/sales', icon: Receipt },
    { label: 'Purchases', to: '/purchases', icon: ShoppingCart },
    { label: 'Banking', to: '/banking', icon: Landmark },
    { label: 'Items', to: '/items', icon: Package },
    { label: 'Accounting', to: '/journal', icon: BookOpen, match: ['/journal', '/accounts'] },
    { label: 'Reports', to: '/reports', icon: BarChart3 },
  ]
}

export const SETTINGS_ITEM: NavItem = { label: 'Settings', to: '/settings', icon: Settings }

export function isActive(item: NavItem, pathname: string): boolean {
  if (item.to === '/') return pathname === '/'
  return [item.to, ...(item.match ?? [])].some((p) => pathname === p || pathname.startsWith(p + '/'))
}
