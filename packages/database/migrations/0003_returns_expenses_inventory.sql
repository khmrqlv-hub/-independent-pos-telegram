CREATE TYPE return_status AS ENUM ('COMPLETED');
CREATE TYPE inventory_status AS ENUM ('DRAFT','IN_PROGRESS','COMPLETED','CANCELLED');

CREATE TABLE returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_sale_id uuid NOT NULL REFERENCES sales(id),
  cashier_id uuid NOT NULL REFERENCES users(id),
  reason text NOT NULL CHECK (length(trim(reason)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  status return_status NOT NULL DEFAULT 'COMPLETED',
  idempotency_key uuid NOT NULL UNIQUE,
  request_hash char(64) NOT NULL
);

CREATE TABLE return_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id uuid NOT NULL REFERENCES returns(id),
  sale_item_id uuid NOT NULL REFERENCES sale_items(id),
  product_id uuid NOT NULL REFERENCES products(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  amount bigint NOT NULL CHECK (amount >= 0),
  cost_amount bigint NOT NULL CHECK (cost_amount >= 0),
  restocked boolean NOT NULL,
  UNIQUE (return_id, sale_item_id)
);

CREATE TABLE expense_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name_ru text NOT NULL UNIQUE,
  name_uz text NOT NULL,
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  amount bigint NOT NULL CHECK (amount > 0),
  category_id uuid NOT NULL REFERENCES expense_categories(id),
  reason text NOT NULL CHECK (length(trim(reason)) > 0),
  user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  idempotency_key uuid NOT NULL UNIQUE,
  request_hash char(64) NOT NULL
);

CREATE TABLE inventory_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status inventory_status NOT NULL DEFAULT 'DRAFT',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  note text,
  start_key uuid UNIQUE
);

CREATE TABLE inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES inventory_sessions(id),
  product_id uuid NOT NULL REFERENCES products(id),
  system_quantity integer NOT NULL CHECK (system_quantity >= 0),
  system_version bigint NOT NULL CHECK (system_version >= 0),
  actual_quantity integer CHECK (actual_quantity >= 0),
  UNIQUE (session_id, product_id)
);

