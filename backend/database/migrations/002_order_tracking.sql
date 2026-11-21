-- Preserve the existing order/status contract. Fulfillment transitions stay
-- disabled until an authorized workflow is provided; no progress is simulated.
-- Serialize with in-flight order creation while taking the legacy snapshot and
-- installing the insert trigger. The migration runner wraps this in a transaction.
LOCK TABLE orders IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE order_status_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id text NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('pending', 'confirmed', 'cancelled')),
  occurred_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  source text NOT NULL CHECK (source IN ('order_created', 'legacy_snapshot')),
  CHECK (
    (source = 'order_created' AND occurred_at IS NOT NULL) OR
    (source = 'legacy_snapshot' AND occurred_at IS NULL)
  )
);

CREATE INDEX order_status_history_order_time_idx
  ON order_status_history(order_id, recorded_at, id);

-- Previous versions had no audit trail. Observe current legacy status without
-- claiming that a transition happened at order creation or migration time.
INSERT INTO order_status_history (order_id, status, occurred_at, source)
  SELECT id, status, NULL, 'legacy_snapshot' FROM orders;

CREATE FUNCTION record_initial_order_status() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  observed_at timestamptz := clock_timestamp();
BEGIN
  INSERT INTO order_status_history (order_id, status, occurred_at, recorded_at, source)
    VALUES (NEW.id, NEW.status, observed_at, observed_at, 'order_created');
  RETURN NEW;
END;
$$;

CREATE TRIGGER orders_record_initial_status
  AFTER INSERT ON orders FOR EACH ROW EXECUTE FUNCTION record_initial_order_status();

CREATE FUNCTION reject_unauthorized_order_status_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Order status transitions are disabled until an authorized workflow exists'
    USING ERRCODE = '23514', CONSTRAINT = 'order_status_transitions_disabled';
END;
$$;

CREATE TRIGGER orders_status_transitions_disabled
  BEFORE UPDATE OF status ON orders FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION reject_unauthorized_order_status_change();
