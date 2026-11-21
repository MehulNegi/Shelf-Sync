CREATE TABLE cart_sessions (
  id uuid PRIMARY KEY,
  token_hash bytea UNIQUE NOT NULL CHECK (octet_length(token_hash) = 32),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at)
);
CREATE TABLE cart_reservations (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES cart_sessions(id) ON DELETE RESTRICT,
  product_id text NOT NULL,
  city text NOT NULL,
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 99),
  state text NOT NULL CHECK (state IN ('active', 'expired', 'released', 'consumed')),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at),
  updated_at timestamptz NOT NULL,
  order_id text REFERENCES orders(id) ON DELETE RESTRICT,
  FOREIGN KEY (product_id, city) REFERENCES inventory(product_id, city) ON DELETE RESTRICT,
  CHECK ((state = 'consumed') = (order_id IS NOT NULL))
);
CREATE UNIQUE INDEX cart_reservations_active_idx ON cart_reservations(session_id, product_id, city) WHERE state = 'active';
CREATE INDEX cart_reservations_availability_idx ON cart_reservations(product_id, city, expires_at) INCLUDE (quantity) WHERE state = 'active';
CREATE INDEX cart_reservations_expiry_idx ON cart_reservations(expires_at, product_id, city) WHERE state = 'active';
CREATE INDEX cart_reservations_latest_idx ON cart_reservations(session_id, product_id, city, created_at DESC, id DESC);
CREATE INDEX cart_reservations_order_idx ON cart_reservations(order_id);
CREATE TABLE cart_idempotency (
  session_id uuid NOT NULL REFERENCES cart_sessions(id) ON DELETE RESTRICT,
  key uuid NOT NULL,
  request_hash bytea NOT NULL CHECK (octet_length(request_hash) = 32),
  http_status smallint NOT NULL CHECK (http_status BETWEEN 200 AND 499),
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (session_id, key)
);
CREATE TABLE reservation_rate_limits (
  scope text NOT NULL,
  key_digest bytea NOT NULL CHECK (octet_length(key_digest) = 32),
  window_start timestamptz NOT NULL,
  count integer NOT NULL CHECK (count > 0),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (scope, key_digest, window_start)
);
CREATE INDEX reservation_rate_limits_expiry_idx ON reservation_rate_limits(expires_at);

CREATE FUNCTION guard_cart_reservation() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (
    (NEW.session_id, NEW.product_id, NEW.city, NEW.created_at, NEW.expires_at)
      IS DISTINCT FROM (OLD.session_id, OLD.product_id, OLD.city, OLD.created_at, OLD.expires_at)
    OR (OLD.state <> 'active' AND NEW IS DISTINCT FROM OLD)
  ) THEN
    RAISE EXCEPTION 'Reservation identity, deadline and terminal state are immutable' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cart_sessions WHERE id = NEW.session_id AND expires_at >= NEW.expires_at) THEN
    RAISE EXCEPTION 'Reservation exceeds session lifetime' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER cart_reservations_guard BEFORE INSERT OR UPDATE ON cart_reservations
  FOR EACH ROW EXECUTE FUNCTION guard_cart_reservation();
