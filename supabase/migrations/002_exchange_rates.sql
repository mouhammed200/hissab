CREATE TABLE IF NOT EXISTS exchange_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  currency_code VARCHAR(3) NOT NULL,
  rate_to_aed NUMERIC(18,8) NOT NULL CHECK (rate_to_aed > 0),
  rate_date DATE NOT NULL,
  source VARCHAR(30) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(currency_code, rate_date)
);
CREATE INDEX IF NOT EXISTS idx_exchange_rates_currency_date ON exchange_rates(currency_code, rate_date DESC);
