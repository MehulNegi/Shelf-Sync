import { useEffect, useState } from 'react'

type Result<T> = { data: T } | { error: string }

export function useResource<T>(load: (signal: AbortSignal) => Promise<T>, attempt = 0) {
  const [settled, setSettled] = useState<{ load: typeof load; attempt: number; result: Result<T> }>()

  useEffect(() => {
    const controller = new AbortController()
    function settle(result: Result<T>) {
      if (!controller.signal.aborted) setSettled({ load, attempt, result })
    }

    load(controller.signal).then(
      (data) => settle({ data }),
      (error: unknown) => settle({
        error: error instanceof Error ? error.message : 'Couldn’t load this information.',
      }),
    )
    return () => controller.abort()
  }, [load, attempt])

  if (settled?.load === load && settled.attempt === attempt) return settled.result
}
