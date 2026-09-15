CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TYPE user_role AS ENUM ('ADMIN','CASHIER');

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  login text,
  email text,
  phone text,
  display_name text NOT NULL CHECK (length(trim(display_name)) > 0),
  role user_role NOT NULL,
  locale text NOT NULL DEFAULT 'ru' CHECK (locale IN ('ru','uz')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (login IS NOT NULL OR email IS NOT NULL OR phone IS NOT NULL)
);
CREATE UNIQUE INDEX users_login_unique ON users(lower(login)) WHERE login IS NOT NULL;
CREATE UNIQUE INDEX users_email_unique ON users(lower(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX users_phone_unique ON users(phone) WHERE phone IS NOT NULL;

CREATE TABLE password_credentials (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  token_hash char(64) PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  ip inet,
  user_agent text,
  CHECK (expires_at > created_at)
);
CREATE INDEX sessions_user_expiry_idx ON sessions(user_id, expires_at);

CREATE TABLE login_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  identifier_hash char(64) NOT NULL,
  ip inet,
  success boolean NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_attempts_identifier_time_idx ON login_attempts(identifier_hash, attempted_at DESC);

CREATE TABLE telegram_accounts (
  telegram_user_id bigint PRIMARY KEY CHECK (telegram_user_id > 0),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  username text,
  first_name text,
  last_name text,
  allowed boolean NOT NULL DEFAULT false,
  linked_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

CREATE TABLE categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name_ru text NOT NULL CHECK (length(trim(name_ru)) > 0),
  name_uz text NOT NULL CHECK (length(trim(name_uz)) > 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku text NOT NULL CHECK (length(trim(sku)) > 0),
  barcode text CHECK (barcode IS NULL OR length(trim(barcode)) > 0),
  name_ru text NOT NULL CHECK (length(trim(name_ru)) > 0),
  name_uz text NOT NULL CHECK (length(trim(name_uz)) > 0),
  category_id uuid NOT NULL REFERENCES categories(id),
  sale_price bigint NOT NULL CHECK (sale_price >= 0),
  purchase_price bigint NOT NULL CHECK (purchase_price >= 0),
  quantity integer NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  minimum_stock integer NOT NULL DEFAULT 0 CHECK (minimum_stock >= 0),
  stock_version bigint NOT NULL DEFAULT 0 CHECK (stock_version >= 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sku),
  UNIQUE (barcode)
);

