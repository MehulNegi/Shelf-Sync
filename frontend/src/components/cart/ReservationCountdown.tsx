import { Clock3 } from 'lucide-react'

export function ReservationCountdown({ seconds }: { seconds: number }) {
  const minutes = String(Math.floor(seconds / 60)).padStart(2, '0')
  const remainder = String(seconds % 60).padStart(2, '0')

  return (
    <span className="reservation-clock" data-urgent={seconds <= 10}>
      <Clock3 size={15} aria-hidden="true" />
      <span>Reserved for you</span>
      <span className="reservation-clock-time" role="timer" aria-live="off" aria-label="Reservation time remaining">
        {minutes}:{remainder}
      </span>
    </span>
  )
}
