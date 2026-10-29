import {
  BarChart3,
  BookOpen,
  Landmark,
  LayoutDashboard,
  NotebookPen,
  Package,
  Receipt,
  Settings,
  ShoppingCart,
  Users,
  type LucideIcon,
} from 'lucide-react'
import type { Company } from '../../db/types'
import type { Mode } from '../../state/prefs'

export interface NavItem {
  label: string
  to: string
  icon: LucideIcon
  soon?: boolean
}

export interface NavGroup {
  label?: string
  items: NavItem[]
}

export function navGroups(company: Company, mode: Mode): NavGroup[] {
  const simple = mode === 'simple'
  return [
    { items: [{ label: 'Dashboard', to: '/', icon: LayoutDashboard }] },
    {
      label: 'Business',
      items: [
        { label: 'Sales & invoices', to: '/soon/sales', icon: Receipt, soon: true },
        { label: 'Purchases & bills', to: '/soon/purchases', icon: ShoppingCart, soon: true },
        { label: 'Banking', to: '/soon/banking', icon: Landmark, soon: true },
        ...(company.features.inventory ? [{ label: 'Inventory', to: '/soon/inventory', icon: Package, soon: true }] : []),
        { label: 'Customers & suppliers', to: '/soon/contacts', icon: Users, soon: true },
      ],
    },
    {
      label: 'Accounting',
      items: [
        { label: simple ? 'Transactions' : 'Journal', to: '/journal', icon: NotebookPen },
        { label: simple ? 'Accounts' : 'Chart of accounts', to: '/accounts', icon: BookOpen },
        { label: 'Reports', to: '/reports', icon: BarChart3 },
      ],
    },
  ]
}

export const SETTINGS_ITEM: NavItem = { label: 'Settings', to: '/settings', icon: Settings }
