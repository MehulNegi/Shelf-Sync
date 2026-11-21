import { Boxes, ClipboardList, PackageMinus, PackageX, Radio, Warehouse } from 'lucide-react'
import { formatPrice } from '../../lib/format-price'
import { formatOrderDate, orderStatusLabel } from '../../services/order-tracking'
import type { AdminEventRow, AdminOrderRow, AdminOverview } from '../../types/admin'
import { cities } from '../../types/products'

const integer = new Intl.NumberFormat('en-IN')

export function OverviewPanels({ overview }: { overview: AdminOverview }) {
  const metrics = [
    { label: 'Total inventory units', value: overview.totalStockUnits, Icon: Boxes },
    { label: 'Low-stock product-city records', value: overview.lowStockRecords, Icon: PackageMinus },
    { label: 'Out-of-stock product-city records', value: overview.outOfStockRecords, Icon: PackageX },
    { label: 'Orders today', value: overview.ordersToday.count, Icon: ClipboardList },
    { label: 'Pending outbox events', value: overview.outboxBacklog, Icon: Radio },
  ]
  const peak = Math.max(1, ...overview.inventoryByCity.map(({ stockUnits }) => stockUnits))
  return (
    <>
      <dl className="command-metrics" aria-label="Inventory and order metrics">
        {metrics.map(({ label, value, Icon }) => (
          <div className="command-panel command-metric" key={label}>
            <Icon size={18} aria-hidden="true" />
            <dt>{label}</dt>
            <dd>{integer.format(value)}</dd>
          </div>
        ))}
      </dl>
      <section className="command-panel command-city" aria-labelledby="command-city-heading">
        <div className="command-panel-heading">
          <h2 id="command-city-heading"><Warehouse size={19} aria-hidden="true" /> Inventory by city</h2>
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
      </section>
    </>
  )
}

export function RecentOrders({ orders }: { orders: AdminOrderRow[] }) {
  return (
    <section className="command-panel" aria-labelledby="command-orders-heading">
      <h2 id="command-orders-heading"><ClipboardList size={19} aria-hidden="true" /> Recent orders</h2>
      {orders.length ? (
        <div className="command-table-wrap" role="region" aria-label="Recent orders table" tabIndex={0}>
          <table className="command-table">
            <caption className="sr-only">Latest persisted orders</caption>
            <thead><tr>
              <th scope="col">Order ID</th><th scope="col">City</th><th scope="col">Total</th>
              <th scope="col">Created</th><th scope="col">Status</th>
            </tr></thead>
            <tbody>{orders.map((order) => (
              <tr key={order.orderId}>
                <th scope="row" className="command-reference">{order.orderId}</th>
                <td>{cities[order.city]}</td><td>{formatPrice(order.total)}</td>
                <td><time dateTime={order.createdAt}>{formatOrderDate(order.createdAt)}</time></td>
                <td><span className="history-status" data-status={order.status}>{orderStatusLabel(order.status)}</span></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <p className="command-empty">No recent orders.</p>}
    </section>
  )
}

export function EventActivity({ events }: { events: AdminEventRow[] }) {
  return (
    <section className="command-panel" aria-labelledby="command-events-heading">
      <h2 id="command-events-heading"><Radio size={19} aria-hidden="true" /> Event activity</h2>
      <p>Transactional outbox · Kafka publication markers</p>
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
