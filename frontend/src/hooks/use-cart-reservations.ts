import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '../services/api-error'
import { baseUrl } from '../services/backend'
import type { CartAction, CartState } from '../services/cart'
import { placeOrder } from '../services/orders'
import {
  checkoutReservationIds, getReservations, isUncertainReservation, mutateReservation, newOperationKey,
  remainingSeconds, reservationError, reservationsEnabled, startCartSession, timedReservations,
} from '../services/reservations'
import type { OrderCreated, OrderItem } from '../types/orders'
import type { ReservationEnvelope, ReservationOperation, TimedReservation } from '../types/reservations'
import type { City } from '../types/products'

const operationKey = `shelfsync.cart-operation.v1:${baseUrl}`

function readPending(): ReservationOperation | undefined {
  if (!reservationsEnabled) return
  try {
    const value = JSON.parse(window.sessionStorage.getItem(operationKey) ?? 'null')
    if (value && typeof value.key === 'string' &&
        ['create', 'update', 'remove', 'switch', 'checkout'].includes(value.kind)) return value
  } catch {
    // Browser storage can be blocked.
  }
}

export function useCartReservations(cart: CartState, dispatch: (action: CartAction) => void, refreshCatalog: () => void) {
  const [holds, setHolds] = useState<TimedReservation[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [workingProduct, setWorkingProduct] = useState<string>()
  const [pending, setPending] = useState(readPending)
  const [order, setOrder] = useState<OrderCreated>()
  const [now, setNow] = useState(() => performance.now())
  const inFlight = useRef(false)
  const active = useRef<TimedReservation[]>([])
  const deadlines = useRef<TimedReservation[]>([])
  const sessionReady = useRef(false)
  const pendingRef = useRef(pending)
  const mounted = useRef(false)
  const currentCart = useRef(cart)
  const reloadCatalog = useRef(refreshCatalog)
  currentCart.current = cart
  reloadCatalog.current = refreshCatalog

  const setPendingOperation = useCallback((operation?: ReservationOperation) => {
    pendingRef.current = operation
    setPending(operation)
    try {
      if (operation) window.sessionStorage.setItem(operationKey, JSON.stringify(operation))
      else window.sessionStorage.removeItem(operationKey)
    } catch {
      // Keep the same operation key in memory when browser storage is blocked.
    }
  }, [])

  const updateHolds = useCallback((response: ReservationEnvelope, requestedAt: number, replace: boolean) => {
    const changes = timedReservations(response, requestedAt, deadlines.current)
    deadlines.current = [
      ...deadlines.current.filter((row) => !changes.some((change) => row.city === change.city && row.productId === change.productId)),
      ...changes,
    ]
    const next = replace ? changes : [
      ...active.current.filter((row) => !changes.some((change) => row.city === change.city && row.productId === change.productId)),
      ...changes,
    ]
    active.current = next
    if (mounted.current) {
      setHolds(next)
      setNow(performance.now())
    }
  }, [])

  const reconcile = useCallback(async (allowSession: boolean, adoptQuantities = true) => {
    const read = async () => {
      const started = performance.now()
      const response = await getReservations()
      updateHolds(response, started, true)
      sessionReady.current = true
      if (!mounted.current || !adoptQuantities) return
      for (const row of active.current) {
        const item = currentCart.current.itemsByCity[row.city].find(({ productId }) => productId === row.productId)
        if (item && item.quantity !== row.quantity && remainingSeconds(row, performance.now()) > 0) {
          dispatch({ type: 'setQuantity', city: row.city, productId: row.productId, quantity: row.quantity })
        }
      }
    }
    try {
      await read()
    } catch (error) {
      active.current = []
      sessionReady.current = false
      if (mounted.current) setHolds([])
      if (!allowSession || !(error instanceof ApiError) || error.status !== 401) throw error
      await startCartSession()
      await read()
    }
  }, [dispatch, updateHolds])

  const exclusive = useCallback(async (run: () => Promise<void>, productId?: string, isReplay = false) => {
    if (!reservationsEnabled || !mounted.current || inFlight.current || (pendingRef.current && !isReplay)) return
    inFlight.current = true
    setBusy(true)
    setWorkingProduct(productId)
    setMessage('')
    try {
      await run()
    } catch (error) {
      if (mounted.current) setMessage(reservationError(error))
    } finally {
      inFlight.current = false
      if (mounted.current) {
        setBusy(false)
        setWorkingProduct(undefined)
      }
    }
  }, [])

  const refresh = useCallback(() => exclusive(async () => {
    await reconcile(false)
    reloadCatalog.current()
  }), [exclusive, reconcile])

  useEffect(() => {
    if (!reservationsEnabled) return
    mounted.current = true
    // Reconcile an existing cart on reload, but never replace a lost session before replaying an operation.
    if (!pendingRef.current && Object.values(currentCart.current.itemsByCity).some((items) => items.length)) {
      void exclusive(() => reconcile(true))
    }
    const onFocus = () => {
      if (document.visibilityState === 'visible' &&
          (active.current.length || Object.values(currentCart.current.itemsByCity).some((items) => items.length))) {
        void refresh()
      }
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      mounted.current = false
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [exclusive, reconcile, refresh])

  useEffect(() => {
    if (!holds.some((row) => row.status === 'active')) return
    const interval = setInterval(() => setNow(performance.now()), 250)
    return () => clearInterval(interval)
  }, [holds])

  const locallyExpired = holds.filter((row) => row.status === 'active' && remainingSeconds(row, now) === 0)
    .map((row) => row.reservationId).join(',')
  useEffect(() => {
    if (locallyExpired) void refresh()
  }, [locallyExpired, refresh])

  async function execute(operation: ReservationOperation, replay = false) {
    if (!mounted.current) return
    setPendingOperation(operation)
    try {
      if (operation.kind === 'checkout') {
        const confirmation = await placeOrder(operation.order, { reservationIds: operation.reservationIds, key: operation.key })
        if (!mounted.current) return
        dispatch({ type: 'purchase', city: operation.order.city, items: operation.order.items })
        const next = active.current.filter((row) => !operation.reservationIds.includes(row.reservationId))
        active.current = next
        setHolds(next)
        setOrder(confirmation)
      } else {
        const started = performance.now()
        const response = await mutateReservation(operation)
        if (!mounted.current) return
        if (operation.kind === 'create' || operation.kind === 'update') {
          const row = response.reservations.find((hold) => hold.city === operation.city &&
            hold.productId === operation.item.productId && hold.status === 'active' &&
            hold.quantity === operation.item.quantity &&
            (operation.kind === 'create' || hold.reservationId === operation.reservationId))
          if (!row) throw new ApiError(502, 'INVALID_RESERVATION', 'The store did not acknowledge the requested reservation.')
          dispatch({ type: 'setQuantity', city: operation.city, productId: row.productId, quantity: row.quantity })
        } else {
          if (!operation.reservationIds.every((id) =>
            response.reservations.some((hold) => hold.reservationId === id && hold.status !== 'active'),
          )) throw new ApiError(502, 'INVALID_RESERVATION', 'The store did not acknowledge release.')
          if (operation.kind === 'remove') {
            dispatch({ type: 'remove', city: operation.city, productId: operation.productId })
          } else {
            dispatch({ type: 'selectCity', city: operation.city })
          }
        }
        // A replay includes the original serverTime. Read fresh state before displaying any timer.
        if (replay) {
          try {
            await reconcile(false)
          } catch (error) {
            if (mounted.current) setMessage(reservationError(error))
          }
        } else {
          updateHolds(response, started, false)
        }
      }
      if (!mounted.current) return
      setPendingOperation()
      reloadCatalog.current()
    } catch (error) {
      if (!mounted.current) return
      const replayCheckoutError = replay && operation.kind === 'checkout' && error instanceof ApiError ? error : undefined
      if (replayCheckoutError?.status === 401) {
        setMessage('The checkout session was lost. Contact the store to verify the order before attempting another purchase.')
        return
      }
      // A rejected replay can fail before the backend looks up the original checkout result.
      if (isUncertainReservation(error) || replayCheckoutError &&
          ([403, 404, 429, 503].includes(replayCheckoutError.status) || replayCheckoutError.code === 'IDEMPOTENCY_CONFLICT')) {
        setMessage(error instanceof ApiError && error.retryAfterSeconds
          ? `The request could not be verified. Retry the same request in ${error.retryAfterSeconds} seconds.`
          : 'The request could not be verified. Retry the same request to recover its result.')
        return
      }
      setPendingOperation()
      setMessage(reservationError(error))
      try {
        await reconcile(false)
      } catch {
        // The original failure is more useful. Reconciliation clears unverified holds.
      }
      reloadCatalog.current()
    }
  }

  function changeQuantity(city: City, item: OrderItem, reserve: boolean) {
    return exclusive(async () => {
      if (!sessionReady.current) await reconcile(true, false)
      const row = active.current.find((entry) => entry.city === city && entry.productId === item.productId)
      if (remainingSeconds(row, performance.now()) > 0 && row) {
        await execute({ key: newOperationKey(), kind: 'update', city, item, reservationId: row.reservationId })
      } else if (reserve) {
        await execute({ key: newOperationKey(), kind: 'create', city, item })
      } else if (mounted.current) {
        dispatch({ type: 'setQuantity', city, productId: item.productId, quantity: item.quantity })
      }
    }, item.productId)
  }

  function remove(city: City, productId: string) {
    return exclusive(async () => {
      await reconcile(true, false)
      const row = active.current.find((entry) => entry.city === city && entry.productId === productId && entry.status === 'active')
      if (row) await execute({ key: newOperationKey(), kind: 'remove', city, productId, reservationIds: [row.reservationId] })
      else if (mounted.current) dispatch({ type: 'remove', city, productId })
    }, productId)
  }

  function switchCity(city: City) {
    return exclusive(async () => {
      if (city === cart.city) return
      await reconcile(true, false)
      const old = active.current.filter((row) => row.city === cart.city && row.status === 'active')
      if (old.length) await execute({ key: newOperationKey(), kind: 'switch', city, reservationIds: old.map((row) => row.reservationId) })
      else if (mounted.current) dispatch({ type: 'selectCity', city })
    })
  }

  function checkout(city: City, items: OrderItem[]) {
    return exclusive(async () => {
      const reservationIds = checkoutReservationIds(city, items, active.current, performance.now())
      if (!reservationIds) {
        setMessage('Reserve each item before checkout. One or more holds are missing or expired.')
        await reconcile(false)
        return
      }
      await execute({ key: newOperationKey(), kind: 'checkout', order: { city, items }, reservationIds })
    })
  }

  function retry() {
    const operation = pendingRef.current
    if (operation) return exclusive(() => execute(operation, true), undefined, true)
    return exclusive(async () => {
      await reconcile(true)
      reloadCatalog.current()
    })
  }

  return {
    enabled: reservationsEnabled, busy, message, now, holds, workingProduct, pending, order, retry,
    changeQuantity, remove, switchCity, checkout, dismissOrder: () => setOrder(undefined),
  }
}

export type CartReservations = ReturnType<typeof useCartReservations>
