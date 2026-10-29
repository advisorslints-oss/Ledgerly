import {
  Briefcase,
  Building2,
  Factory,
  GraduationCap,
  HardHat,
  HeartHandshake,
  Lightbulb,
  ShoppingBag,
  Sprout,
  Stethoscope,
  Truck,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react'
import type { IndustryId } from '../db/types'

export const INDUSTRY_ICONS: Record<IndustryId, LucideIcon> = {
  general: Briefcase,
  services: Lightbulb,
  retail: ShoppingBag,
  manufacturing: Factory,
  restaurant: UtensilsCrossed,
  construction: HardHat,
  healthcare: Stethoscope,
  education: GraduationCap,
  nonprofit: HeartHandshake,
  realestate: Building2,
  logistics: Truck,
  agriculture: Sprout,
}
