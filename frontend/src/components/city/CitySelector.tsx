import { ChevronDown, MapPin } from 'lucide-react'
import { cities, type City } from '../../types/products'

export function CitySelector({ city, onChange, disabled }: { city: City; onChange: (city: City) => void; disabled?: boolean }) {
  return (
    <label className="city-control">
      <MapPin size={18} aria-hidden="true" />
      <span className="sr-only">Shopping city</span>
      <select value={city} disabled={disabled} onChange={(event) => onChange(event.target.value as City)}>
        {Object.entries(cities).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <ChevronDown size={15} aria-hidden="true" />
    </label>
  )
}
