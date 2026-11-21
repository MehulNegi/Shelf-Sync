-- Monetary values are INR rupees, with up to two decimal places (never paise).
CREATE TABLE products (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL,
  category text NOT NULL,
  price numeric(12, 2) NOT NULL CHECK (price > 0 AND price <> 'NaN'::numeric),
  image_url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE inventory (
  product_id text NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  city text NOT NULL CHECK (city IN ('pune', 'delhi', 'bengaluru')),
  quantity integer NOT NULL CHECK (quantity >= 0),
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, city)
);

CREATE TABLE orders (
  id text PRIMARY KEY,
  city text NOT NULL CHECK (city IN ('pune', 'delhi', 'bengaluru')),
  status text NOT NULL CHECK (status IN ('pending', 'confirmed', 'cancelled')),
  total numeric(14, 2) NOT NULL CHECK (total >= 0 AND total <> 'NaN'::numeric),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE order_items (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id text NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id text NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price numeric(12, 2) NOT NULL CHECK (unit_price > 0 AND unit_price <> 'NaN'::numeric),
  UNIQUE (order_id, product_id)
);

CREATE TABLE outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);

CREATE INDEX products_category_price_idx ON products(category, price);
CREATE INDEX products_price_idx ON products(price);
CREATE INDEX inventory_city_product_idx ON inventory(city, product_id);
CREATE INDEX order_items_product_idx ON order_items(product_id);
CREATE INDEX orders_city_created_idx ON orders(city, created_at DESC);
CREATE INDEX outbox_events_unpublished_idx ON outbox_events(created_at, id) WHERE published_at IS NULL;
