import { Boxes, ClipboardList, PackageMinus, PackageX, Radio, Warehouse } from 'lucide-react'
import { formatPrice } from '../../lib/format-price'
import { formatOrderDate, orderStatusLabel } from '../../services/order-tracking'
import type { AdminEventRow, AdminOrderRow, AdminOverview } from '../../types/admin'
import { cities } from '../../types/products'

const integer = new Intl.NumberFormat('en-IN')

export function OverviewPanels({ overview }: { overview: AdminOverview }) {
  const metrics = [
    { label: 'Today’s orders', value: overview.ordersToday.count, Icon: ClipboardList },
    { label: 'Products running low on stock', value: overview.lowStockRecords, Icon: PackageMinus },
    { label: 'Products out of stock', value: overview.outOfStockRecords, Icon: PackageX },
    { label: 'Total units in stock', value: overview.totalStockUnits, Icon: Boxes },
    { label: 'Shop updates waiting to be sent', value: overview.outboxBacklog, Icon: Radio },
  ]
  const peak = Math.max(1, ...overview.inventoryByCity.map(({ stockUnits }) => stockUnits))
  return (
    <>
      <h2 className="retailer-section-title">Your shop at a glance</h2>
      <p className="retailer-metric-note">Stock counts are tracked separately for each city.</p>
      <dl className="command-metrics retailer-summary" aria-label="Inventory and order metrics">
        {metrics.slice(0, 3).map(({ label, value, Icon }) => (
          <div className="command-panel command-metric" key={label}>
            <Icon size={18} aria-hidden="true" />
            <dt>{label}</dt>
            <dd>{integer.format(value)}</dd>
          </div>
        ))}
      </dl>
      <details className="command-panel retailer-details command-city" aria-labelledby="command-city-heading">
        <summary id="command-city-heading"><Warehouse size={19} aria-hidden="true" /> Stock by city</summary>
        <dl className="retailer-stock-totals">
          {metrics.slice(3).map(({ label, value }) => (
            <div key={label}><dt>{label}</dt><dd>{integer.format(value)}</dd></div>
          ))}
        </dl>
        <div className="command-panel-heading">
          <p>Orders today · {overview.ordersToday.date} ({overview.ordersToday.timeZone})</p>
        </div>
        <dl className="command-bars" aria-label="Stock units by city">
          {overview.inventoryByCity.map(({ city, stockUnits }) => (
            <div key={city}>
              <dt>{cities[city]}</dt>
              <dd className="command-bar-track" aria-hidden="true">
                <span style={{ width: `${stockUnits / peak * 100}%` }} />
              </dd>
              <dd>{integer.format(stockUnits)} units</dd>
            </div>
          ))}
        </dl>
      </details>
    </>
  )
}

export function RecentOrders({ orders }: { orders: AdminOrderRow[] }) {
  return (
    <section className="command-panel" aria-labelledby="command-orders-heading">
      <h2 id="command-orders-heading"><ClipboardList size={19} aria-hidden="true" /> Recent orders</h2>
      {orders.length ? (
        <ul className="retailer-orders">
          {orders.map((order) => (
            <li key={order.orderId}>
              <div>
                <strong>{cities[order.city]} · {formatPrice(order.total)}</strong>
                <time dateTime={order.createdAt}>{formatOrderDate(order.createdAt)}</time>
              </div>
              <span className="history-status" data-status={order.status}>{orderStatusLabel(order.status)}</span>
              <p className="command-reference">Order ID {order.orderId}</p>
            </li>
          ))}
        </ul>
      ) : <p className="command-empty">No recent orders.</p>}
    </section>
  )
}

export function EventActivity({ events }: { events: AdminEventRow[] }) {
  return (
    <section className="command-panel" aria-labelledby="command-events-heading">
      <h2 id="command-events-heading"><Radio size={19} aria-hidden="true" /> Event activity</h2>
      <p>See which shop updates are waiting to be sent and which have been published.</p>
      {events.length ? (
        <ol className="command-events">
          {events.map((event) => (
            <li key={event.eventId}>
              <div className="command-event-heading">
                <strong>{event.eventType}</strong>
                <span className="command-stock-badge" data-status={event.publicationState}>
                  {event.publicationState === 'published' ? 'Published to Kafka' : 'Pending publication'}
                </span>
              </div>
              <div className="command-event-meta">
                {event.productId && <span>{event.productId}</span>}
                {event.city && <span>{cities[event.city]}</span>}
                {event.orderId && <span>Order {event.orderId}</span>}
                <span>Created <time dateTime={event.createdAt}>{formatOrderDate(event.createdAt)}</time></span>
                {event.publishedAt && <span>Published <time dateTime={event.publishedAt}>{formatOrderDate(event.publishedAt)}</time></span>}
              </div>
            </li>
          ))}
        </ol>
      ) : <p className="command-empty">No outbox events.</p>}
    </section>
  )
}
