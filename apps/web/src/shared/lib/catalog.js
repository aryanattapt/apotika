import { Activity, FileHeart, HeartPulse, Pill } from 'lucide-react'

export const categoryIcon = (category) => category?.includes('Vitamin') ? HeartPulse : category?.includes('Alat') ? Activity : category?.includes('Pertolongan') ? FileHeart : Pill
export const categoryColor = (category) => category?.includes('Vitamin') ? 'mint' : category?.includes('Alat') ? 'blue' : category?.includes('Pertolongan') ? 'peach' : 'lilac'
