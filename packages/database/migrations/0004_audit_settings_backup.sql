CREATE TABLE audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid REFERENCES users(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  old_data jsonb,
  new_data jsonb,
  ip inet,
  user_agent text,
  request_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE telegram_auth_nonces (
  init_data_hash char(64) PRIMARY KEY,
  telegram_user_id bigint NOT NULL,
  auth_date timestamptz NOT NULL,
  used_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX telegram_auth_nonces_used_idx ON telegram_auth_nonces(used_at);

CREATE TABLE app_settings (
  id integer PRIMARY KEY CHECK (id = 1),
  cashier_max_discount_basis_points integer NOT NULL DEFAULT 1000 CHECK (cashier_max_discount_basis_points BETWEEN 0 AND 10000),
  timezone text NOT NULL DEFAULT 'Asia/Tashkent' CHECK (timezone = 'Asia/Tashkent')
);
INSERT INTO app_settings(id) VALUES (1);

CREATE TABLE backup_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename text NOT NULL UNIQUE,
  generation text NOT NULL CHECK (generation IN ('DAILY','WEEKLY','MANUAL')),
  created_at timestamptz NOT NULL DEFAULT now(),
  byte_size bigint NOT NULL CHECK (byte_size > 0),
  checksum char(64) NOT NULL,
  restore_verified boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  restore_error text
);

INSERT INTO expense_categories(name_ru,name_uz) VALUES
('Аренда','Ijara'),
('Доставка','Yetkazib berish'),
('Зарплата','Ish haqi'),
('Ремонт','Ta’mirlash'),
('Хозяйственные расходы','Xo‘jalik xarajatlari'),
('Другое','Boshqa');
