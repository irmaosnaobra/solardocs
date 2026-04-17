-- Migration: Adiciona campo CRT/CFT ao técnico responsável
ALTER TABLE company ADD COLUMN IF NOT EXISTS tecnico_crt_cft VARCHAR(60);
