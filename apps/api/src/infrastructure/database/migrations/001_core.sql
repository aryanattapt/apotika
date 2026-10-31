CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text,
  phone text,
  password_hash text NOT NULL,
  mfa_secret_encrypted text,
  mfa_enabled boolean NOT NULL DEFAULT false,
  email_verified_at timestamptz,
  phone_verified_at timestamptz,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (email IS NOT NULL OR phone IS NOT NULL),
  CHECK (NOT mfa_enabled OR mfa_secret_encrypted IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (lower(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_phone_unique ON users (phone) WHERE phone IS NOT NULL;

CREATE TABLE IF NOT EXISTS user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('customer','pharmacist','pharmacy_staff','admin','cs','finance')),
  pharmacy_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, role, pharmacy_id),
  CHECK (role NOT IN ('pharmacist','pharmacy_staff') OR pharmacy_id IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_token_hash text NOT NULL UNIQUE,
  csrf_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS auth_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('verify_email','verify_phone','password_reset')),
  target_contact text,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mfa_recovery_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash text NOT NULL UNIQUE,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pharmacies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  address_text text NOT NULL,
  city text NOT NULL,
  postal_codes text[] NOT NULL DEFAULT '{}',
  delivery_fee numeric(14,2),
  latitude numeric(9,6),
  longitude numeric(9,6),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','suspended')),
  license_reference text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_pharmacy_id_fkey;
ALTER TABLE user_roles ADD CONSTRAINT user_roles_pharmacy_id_fkey FOREIGN KEY (pharmacy_id) REFERENCES pharmacies(id);
CREATE TABLE IF NOT EXISTS pharmacy_service_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id uuid NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  service_type text NOT NULL,
  weekday integer NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  opens_at time NOT NULL,
  closes_at time NOT NULL,
  timezone text NOT NULL DEFAULT 'Asia/Jakarta',
  active boolean NOT NULL DEFAULT true,
  UNIQUE(pharmacy_id, service_type, weekday)
);
CREATE TABLE IF NOT EXISTS pharmacy_service_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id uuid NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  service_type text NOT NULL,
  local_date date NOT NULL,
  closed boolean NOT NULL DEFAULT false,
  opens_at time,
  closes_at time,
  reason text,
  UNIQUE(pharmacy_id,service_type,local_date),
  CHECK ((closed AND opens_at IS NULL AND closes_at IS NULL) OR (NOT closed AND opens_at IS NOT NULL AND closes_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_name text NOT NULL,
  phone text NOT NULL,
  address_text text NOT NULL,
  city text NOT NULL,
  postal_code text NOT NULL,
  latitude numeric(9,6),
  longitude numeric(9,6),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  category text NOT NULL,
  sell_unit text NOT NULL,
  batch_tracking_required boolean NOT NULL DEFAULT false,
  requires_prescription boolean NOT NULL DEFAULT false,
  special_handling boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'inactive' CHECK (status IN ('active','inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS inventory (
  pharmacy_id uuid NOT NULL REFERENCES pharmacies(id),
  product_id uuid NOT NULL REFERENCES products(id),
  on_hand integer NOT NULL CHECK (on_hand >= 0),
  reserved integer NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  unit_price numeric(14,2) NOT NULL CHECK (unit_price >= 0),
  sales_blocked boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (pharmacy_id, product_id),
  CHECK (on_hand >= reserved)
);
CREATE TABLE IF NOT EXISTS inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id uuid NOT NULL REFERENCES pharmacies(id),
  product_id uuid NOT NULL REFERENCES products(id),
  order_id uuid,
  delta_on_hand integer NOT NULL,
  reason text NOT NULL,
  actor_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS checkout_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES users(id),
  pharmacy_id uuid NOT NULL REFERENCES pharmacies(id),
  address_id uuid REFERENCES addresses(id),
  address_snapshot jsonb,
  fulfillment_method text NOT NULL CHECK (fulfillment_method IN ('delivery','pickup')),
  items_snapshot jsonb NOT NULL,
  totals_snapshot jsonb NOT NULL,
  input_fingerprint text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL UNIQUE REFERENCES checkout_quotes(id),
  customer_id uuid NOT NULL REFERENCES users(id),
  pharmacy_id uuid NOT NULL REFERENCES pharmacies(id),
  address_snapshot jsonb,
  fulfillment_method text NOT NULL CHECK (fulfillment_method IN ('delivery','pickup')),
  status text NOT NULL CHECK (status IN ('awaiting_prescription','awaiting_payment','paid','processing','ready','in_delivery','completed','cancelled','expired')),
  pickup_code text NOT NULL,
  document_revision integer NOT NULL DEFAULT 0,
  review_version integer NOT NULL DEFAULT 0,
  subtotal numeric(14,2) NOT NULL CHECK (subtotal >= 0),
  discount numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  shipping_fee numeric(14,2) NOT NULL DEFAULT 0 CHECK (shipping_fee >= 0),
  service_fee numeric(14,2) NOT NULL DEFAULT 0 CHECK (service_fee >= 0),
  total numeric(14,2) NOT NULL CHECK (total >= 0),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (total = subtotal - discount + shipping_fee + service_fee),
  CHECK ((fulfillment_method='pickup' AND address_snapshot IS NULL AND shipping_fee=0) OR (fulfillment_method='delivery' AND address_snapshot IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id),
  product_name_snapshot text NOT NULL,
  sell_unit_snapshot text NOT NULL,
  batch_tracking_required_snapshot boolean NOT NULL DEFAULT false,
  requires_prescription_snapshot boolean NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price numeric(14,2) NOT NULL CHECK (unit_price >= 0),
  line_total numeric(14,2) NOT NULL CHECK (line_total >= 0),
  UNIQUE(order_id, product_id)
);
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS batch_tracking_required_snapshot boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS stock_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id),
  order_item_id uuid NOT NULL UNIQUE REFERENCES order_items(id),
  pharmacy_id uuid NOT NULL REFERENCES pharmacies(id),
  product_id uuid NOT NULL REFERENCES products(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  status text NOT NULL CHECK (status IN ('active','consumed','released','expired')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS prescriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id),
  uploaded_by uuid NOT NULL REFERENCES users(id),
  object_key text NOT NULL,
  original_filename text NOT NULL,
  mime_type text NOT NULL,
  document_revision integer NOT NULL,
  document_sha256 text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','clarification','approved','rejected')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS prescription_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_id uuid NOT NULL REFERENCES prescriptions(id),
  pharmacist_id uuid NOT NULL REFERENCES users(id),
  document_revision integer NOT NULL,
  review_sequence integer NOT NULL,
  decision text NOT NULL CHECK (decision IN ('clarification','approved','rejected')),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(prescription_id, review_sequence)
);
CREATE TABLE IF NOT EXISTS review_items (
  review_id uuid NOT NULL REFERENCES prescription_reviews(id),
  order_item_id uuid NOT NULL REFERENCES order_items(id),
  PRIMARY KEY (review_id, order_item_id)
);
CREATE TABLE IF NOT EXISTS prescription_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id),
  author_id uuid NOT NULL REFERENCES users(id),
  message_type text NOT NULL CHECK (message_type IN ('clarification_request','customer_response')),
  body text,
  private_object_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (body IS NOT NULL OR private_object_key IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id),
  provider text NOT NULL,
  merchant_reference text NOT NULL UNIQUE,
  provider_reference text,
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  received_amount numeric(14,2),
  currency text NOT NULL DEFAULT 'IDR',
  status text NOT NULL CHECK (status IN ('creating','pending','succeeded','failed','expired','late')),
  expires_at timestamptz NOT NULL,
  provider_paid_at timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_ref_unique ON payments(provider, provider_reference) WHERE provider_reference IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS payments_one_active_per_order ON payments(order_id) WHERE status IN ('creating','pending','succeeded');
CREATE TABLE IF NOT EXISTS payment_events (
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  payment_id uuid REFERENCES payments(id),
  payload_hash text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(provider, provider_event_id)
);
CREATE TABLE IF NOT EXISTS refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES payments(id),
  merchant_reference text NOT NULL UNIQUE,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  reason text NOT NULL,
  status text NOT NULL CHECK (status IN ('requested','processing','succeeded','failed')),
  provider_reference text,
  requested_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES orders(id),
  method text NOT NULL CHECK (method IN ('delivery','pickup')),
  provider text,
  tracking_number text,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS shipment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id uuid NOT NULL REFERENCES shipments(id),
  merchant_reference text NOT NULL UNIQUE,
  provider_reference text,
  status text NOT NULL CHECK (status IN ('creating','confirmed','failed','exception')),
  request_snapshot jsonb NOT NULL,
  response_snapshot jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS fulfillment_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id),
  actor_id uuid NOT NULL REFERENCES users(id),
  pharmacist_check boolean NOT NULL DEFAULT false,
  passed boolean NOT NULL,
  note text,
  checked_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS dispensed_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fulfillment_check_id uuid NOT NULL REFERENCES fulfillment_checks(id) ON DELETE CASCADE,
  order_item_id uuid NOT NULL REFERENCES order_items(id),
  lot_number text,
  expires_on date,
  quantity integer NOT NULL CHECK (quantity > 0)
);

CREATE TABLE IF NOT EXISTS order_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id),
  from_status text,
  to_status text NOT NULL,
  actor_id uuid REFERENCES users(id),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS support_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id),
  opened_by uuid NOT NULL REFERENCES users(id),
  category text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','closed')),
  description text NOT NULL,
  assigned_to uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cancellation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id),
  requested_by uuid NOT NULL REFERENCES users(id),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','approved','rejected')),
  decided_by uuid REFERENCES users(id),
  decision_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS cancellation_one_open_per_order ON cancellation_requests(order_id) WHERE status='requested';
CREATE TABLE IF NOT EXISTS audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES users(id),
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  actor_id uuid NOT NULL REFERENCES users(id),
  scope text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(actor_id, scope, idempotency_key)
);

CREATE INDEX IF NOT EXISTS inventory_product_idx ON inventory(product_id);
CREATE INDEX IF NOT EXISTS orders_customer_created_idx ON orders(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_pharmacy_status_idx ON orders(pharmacy_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS reservations_expiry_idx ON stock_reservations(expires_at) WHERE status='active';
CREATE INDEX IF NOT EXISTS prescriptions_order_idx ON prescriptions(order_id, document_revision DESC);
