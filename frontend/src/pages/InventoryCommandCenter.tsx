import { Boxes, ClipboardList, Database, Layers3, LockKeyhole, PackageMinus, PackageX, Radio, Warehouse } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { cities } from '../types/products'

const metrics = [
  { label: 'Total inventory units', Icon: Boxes },
  { label: 'Low-stock products', Icon: PackageMinus },
  { label: 'Out-of-stock products', Icon: PackageX },
  { label: 'Orders today', Icon: ClipboardList },
  { label: 'Pending outbox events', Icon: Radio },
]

export function InventoryCommandCenter() {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    window.scrollTo(0, 0)
    heading.current?.focus({ preventScroll: true })
  }, [])

  return (
    <>
      <header className="site-header">
        <nav className="shell history-nav" aria-label="Command Center navigation">
          <a href="#top" className="brand">
            <span className="brand-icon"><Layers3 size={22} aria-hidden="true" /></span>
            ShelfSync
          </a>
          <a href="#top" className="orders-nav-link">Back to shopping</a>
        </nav>
      </header>
      <main className="shell command-center">
        <div className="command-intro">
          <div>
            <h1 ref={heading} tabIndex={-1}>Inventory Command Center</h1>
            <p>City inventory, recent orders, and outbox publication activity.</p>
          </div>
          <span className="command-state"><LockKeyhole size={16} aria-hidden="true" /> Access unavailable</span>
        </div>

        <section className="command-notice" aria-labelledby="command-notice-title">
          <span className="command-icon"><LockKeyhole size={22} aria-hidden="true" /></span>
          <div>
            <h2 id="command-notice-title">Admin access is unavailable</h2>
            <p>The Command Center requires protected admin endpoints and a trusted sign-in flow. Operational data will be available once those are enabled.</p>
          </div>
        </section>

        <dl className="command-metrics" aria-label="Inventory and order metrics">
          {metrics.map(({ label, Icon }) => (
            <div className="command-panel command-metric" key={label}>
              <Icon size={18} aria-hidden="true" />
              <dt>{label}</dt>
              <dd>Unavailable</dd>
            </div>
          ))}
        </dl>

        <div className="command-sections">
          <section className="command-panel command-city" aria-labelledby="command-city-heading">
            <h2 id="command-city-heading"><Warehouse size={19} aria-hidden="true" /> Inventory by city</h2>
            <dl>
              {Object.values(cities).map((city) => (
                <div key={city}><dt>{city}</dt><dd>Unavailable</dd></div>
              ))}
            </dl>
          </section>
          <section className="command-panel" aria-labelledby="command-stock-heading">
            <h2 id="command-stock-heading"><Database size={19} aria-hidden="true" /> Inventory table</h2>
            <p>Product, city, price, and stock records require admin access.</p>
          </section>
          <section className="command-panel" aria-labelledby="command-orders-heading">
            <h2 id="command-orders-heading"><ClipboardList size={19} aria-hidden="true" /> Recent orders</h2>
            <p>Persisted order totals and statuses require admin access.</p>
          </section>
          <section className="command-panel" aria-labelledby="command-events-heading">
            <h2 id="command-events-heading"><Radio size={19} aria-hidden="true" /> Event activity</h2>
            <p>Outbox records distinguish pending publication from acknowledged Kafka publication.</p>
          </section>
        </div>
      </main>
    </>
  )
}
