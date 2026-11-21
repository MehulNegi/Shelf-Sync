-- Additive only. No commerce rows are rewritten and no checkout trigger is installed.
CREATE TABLE product_cost_scopes (
  product_id text NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  scope_key text NOT NULL CHECK (scope_key IN ('global','pune','delhi','bengaluru')),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  PRIMARY KEY (product_id,scope_key)
);
CREATE TABLE product_cost_versions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id text NOT NULL,
  scope_key text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  currency text NOT NULL CHECK (currency='INR'),
  effective_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL,
  actor_ref text NOT NULL CHECK (length(actor_ref) BETWEEN 1 AND 256),
  procurement_paise bigint CHECK (procurement_paise BETWEEN 0 AND 999999999999),
  shipping_paise bigint CHECK (shipping_paise BETWEEN 0 AND 999999999999),
  packaging_paise bigint CHECK (packaging_paise BETWEEN 0 AND 999999999999),
  labour_paise bigint CHECK (labour_paise BETWEEN 0 AND 999999999999),
  taxes_paise bigint CHECK (taxes_paise BETWEEN 0 AND 999999999999),
  overhead_paise bigint CHECK (overhead_paise BETWEEN 0 AND 999999999999),
  payment_method text CHECK (payment_method IN ('per_unit','rate')),
  payment_paise bigint CHECK (payment_paise BETWEEN 0 AND 999999999999),
  payment_bps integer CHECK (payment_bps BETWEEN 0 AND 10000),
  CHECK (effective_at >= recorded_at),
  CHECK (CASE WHEN payment_method IS NULL THEN payment_paise IS NULL AND payment_bps IS NULL
    WHEN payment_method='per_unit' THEN payment_paise IS NOT NULL AND payment_bps IS NULL
    ELSE payment_paise IS NULL AND payment_bps IS NOT NULL END),
  FOREIGN KEY (product_id,scope_key) REFERENCES product_cost_scopes(product_id,scope_key) ON DELETE RESTRICT,
  UNIQUE(product_id,scope_key,version), UNIQUE(product_id,scope_key,effective_at)
);
CREATE INDEX product_cost_versions_effective_idx ON product_cost_versions(product_id,scope_key,effective_at DESC);

CREATE FUNCTION profitability_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Financial history is immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER product_cost_versions_immutable BEFORE UPDATE OR DELETE ON product_cost_versions FOR EACH ROW EXECUTE FUNCTION profitability_immutable();
CREATE FUNCTION profitability_cost_version_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE current_revision integer; previous_time timestamptz;
BEGIN
  SELECT revision INTO current_revision FROM product_cost_scopes WHERE product_id=NEW.product_id AND scope_key=NEW.scope_key FOR UPDATE;
  IF current_revision IS NULL OR NEW.version<>current_revision+1 THEN RAISE EXCEPTION 'Cost revision conflict' USING ERRCODE='23514'; END IF;
  SELECT effective_at INTO previous_time FROM product_cost_versions WHERE product_id=NEW.product_id AND scope_key=NEW.scope_key ORDER BY version DESC LIMIT 1;
  IF previous_time IS NOT NULL AND NEW.effective_at<=previous_time THEN RAISE EXCEPTION 'Cost effective time conflict' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER product_cost_versions_guard BEFORE INSERT ON product_cost_versions FOR EACH ROW EXECUTE FUNCTION profitability_cost_version_guard();

CREATE FUNCTION profitability_amounts_valid(data jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE component text; value jsonb;
BEGIN
  IF jsonb_typeof(data) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(data))<>13 THEN RETURN false; END IF;
  FOREACH component IN ARRAY ARRAY['grossSales','customerShipping','discounts','refunds','taxCollected','taxRefunded','procurement','retailerShipping','packaging','labour','paymentFees','nonRecoverableTaxes','allocatedOverhead'] LOOP
    value:=data->component;
    IF jsonb_typeof(value) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
    IF (SELECT count(*) FROM jsonb_object_keys(value))<>2 OR NOT(value ? 'paise' AND value ? 'quality') THEN RETURN false; END IF;
    IF jsonb_typeof(value->'quality') IS DISTINCT FROM 'string' THEN RETURN false; END IF;
    IF value->'paise'='null'::jsonb THEN
      IF value->>'quality' IS DISTINCT FROM 'unknown' THEN RETURN false; END IF;
    ELSE
      IF jsonb_typeof(value->'paise') IS DISTINCT FROM 'string' OR (value->>'paise') !~ '^(0|-?[1-9][0-9]*)$'
        OR length(value->>'paise')>39 OR value->>'quality' NOT IN ('actual','estimated','mixed') THEN RETURN false; END IF;
    END IF;
  END LOOP;
  RETURN true;
END $$;
CREATE TABLE order_financial_snapshots (
  order_id text PRIMARY KEY REFERENCES orders(id) ON DELETE RESTRICT,
  currency text NOT NULL CHECK (currency='INR'),
  city text NOT NULL CHECK (city IN ('pune','delhi','bengaluru')),
  business_date date NOT NULL,
  order_created_at timestamptz NOT NULL,
  confirmed_at timestamptz,
  snapshot_at timestamptz NOT NULL,
  calculation_version text NOT NULL CHECK (calculation_version='c8-v1'),
  pricing_policy text NOT NULL CHECK (pricing_policy='unresolved'),
  source text NOT NULL CHECK (source='recorded_order')
);
CREATE TABLE order_item_financial_snapshots (
  order_item_id bigint PRIMARY KEY REFERENCES order_items(id) ON DELETE RESTRICT,
  order_id text NOT NULL REFERENCES order_financial_snapshots(order_id) ON DELETE RESTRICT,
  product_id text NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  profile_version_id bigint REFERENCES product_cost_versions(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity>0),
  charged_unit_price_paise bigint NOT NULL CHECK (charged_unit_price_paise>0 AND charged_unit_price_paise<=999999999999),
  returned_units integer CHECK (returned_units BETWEEN 0 AND quantity),
  amounts jsonb NOT NULL CHECK (profitability_amounts_valid(amounts)),
  profile_payment jsonb,
  CHECK ((amounts->'grossSales'->'paise')='null'::jsonb)
);
CREATE INDEX order_financial_snapshots_cohort_idx ON order_financial_snapshots(business_date,city,order_id);
CREATE INDEX order_item_financial_snapshots_product_idx ON order_item_financial_snapshots(product_id,order_id);
CREATE TRIGGER order_financial_snapshots_immutable BEFORE UPDATE OR DELETE ON order_financial_snapshots FOR EACH ROW EXECUTE FUNCTION profitability_immutable();
CREATE FUNCTION profitability_snapshot_header_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM orders o WHERE o.id=NEW.order_id AND o.city=NEW.city AND o.created_at=NEW.order_created_at
    AND (o.created_at AT TIME ZONE 'Asia/Kolkata')::date=NEW.business_date AND o.xmin::text::bigint=(txid_current()%4294967296)
    AND (o.status='confirmed' OR EXISTS(SELECT 1 FROM order_status_history h WHERE h.order_id=o.id AND h.status='confirmed'))) THEN
    RAISE EXCEPTION 'Financial capture requires a new confirmed order' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER order_financial_snapshots_guard BEFORE INSERT ON order_financial_snapshots FOR EACH ROW EXECUTE FUNCTION profitability_snapshot_header_guard();
CREATE TRIGGER order_item_financial_snapshots_immutable BEFORE UPDATE OR DELETE ON order_item_financial_snapshots FOR EACH ROW EXECUTE FUNCTION profitability_immutable();
CREATE FUNCTION profitability_snapshot_line_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM order_items i WHERE i.id=NEW.order_item_id AND i.order_id=NEW.order_id AND i.product_id=NEW.product_id AND i.quantity=NEW.quantity AND i.unit_price*100=NEW.charged_unit_price_paise) THEN
    RAISE EXCEPTION 'Snapshot does not match recorded order line' USING ERRCODE='23514';
  END IF;
  IF NEW.profile_version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM product_cost_versions v JOIN order_financial_snapshots h ON h.order_id=NEW.order_id
    WHERE v.id=NEW.profile_version_id AND v.product_id=NEW.product_id AND v.scope_key IN ('global',h.city) AND v.effective_at<=h.snapshot_at) THEN
    RAISE EXCEPTION 'Snapshot cost scope does not match' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER order_item_financial_snapshots_guard BEFORE INSERT ON order_item_financial_snapshots FOR EACH ROW EXECUTE FUNCTION profitability_snapshot_line_guard();
REVOKE UPDATE,DELETE ON product_cost_versions,order_financial_snapshots,order_item_financial_snapshots FROM PUBLIC;
