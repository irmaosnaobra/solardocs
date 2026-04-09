-- Logo da empresa (base64 ou URL)
ALTER TABLE company
  ADD COLUMN IF NOT EXISTS logo_base64 TEXT;
