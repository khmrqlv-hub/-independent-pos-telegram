CREATE TYPE payment_method AS ENUM ('CASH','CLICK','PAYME','CARD','TRANSFER','OTHER');
CREATE TYPE stock_movement_type AS ENUM ('SALE','RETURN','RETURN_NO_RESTOCK','RESTOCK','INVENTORY_ADJUSTMENT','MANUAL_ADJUSTMENT','WRITE_OFF');

CREATE TABLE sale_requests (
  idempotency_key uuid PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES users(id),
  request_hash char(64) NOT NULL,
  sale_id uuid,
  result_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((sale_id IS NULL AND result_code IS NULL) OR (sale_id IS NOT NULL AND result_code = 'SUCCESS'))
);

CREATE TABLE sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  cashier_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  payment_method payment_method NOT NULL,
  original_total bigint NOT NULL CHECK (original_total >= 0),
  discount_amount bigint NOT NULL CHECK (discount_amount >= 0 AND discount_amount <= original_total),
  final_total bigint NOT NULL CHECK (final_total = original_total - discount_amount),
  status text NOT NULL DEFAULT 'COMPLETED' CHECK (status = 'COMPLETED'),
  idempotency_key uuid NOT NULL UNIQUE REFERENCES sale_requests(idempotency_key)
);
ALTER TABLE sale_requests ADD CONSTRAINT sale_requests_sale_fk FOREIGN KEY (sale_id) REFERENCES sales(id);

CREATE TABLE sale_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES sales(id),
  product_id uuid NOT NULL REFERENCES products(id),
  sku_at_sale text NOT NULL,
  barcode_at_sale text,
  product_name_ru_at_sale text NOT NULL,
  product_name_uz_at_sale text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  sale_price_at_sale bigint NOT NULL CHECK (sale_price_at_sale >= 0),
  purchase_price_at_sale bigint NOT NULL CHECK (purchase_price_at_sale >= 0),
  line_original_total bigint NOT NULL CHECK (line_original_total = sale_price_at_sale * quantity),
  line_discount bigint NOT NULL CHECK (line_discount >= 0 AND line_discount <= line_original_total),
  line_final_total bigint NOT NULL CHECK (line_final_total = line_original_total - line_discount),
  UNIQUE (sale_id, product_id)
);

CREATE TABLE sale_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES sales(id),
  method payment_method NOT NULL,
  amount bigint NOT NULL CHECK (amount >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id),
  type stock_movement_type NOT NULL,
  quantity_change integer NOT NULL CHECK (quantity_change <> 0),
  quantity_before integer NOT NULL CHECK (quantity_before >= 0),
  quantity_after integer NOT NULL CHECK (quantity_after >= 0 AND quantity_after = quantity_before + quantity_change),
  reference_id uuid,
  user_id uuid NOT NULL REFERENCES users(id),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

