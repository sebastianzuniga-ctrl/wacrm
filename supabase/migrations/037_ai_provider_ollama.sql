-- Allow 'ollama' as a valid ai_configs.provider value, alongside the
-- existing 'openai' / 'anthropic' BYO-key providers. Ollama runs
-- locally (no real API key needed) so accounts can test the AI
-- assistant against a self-hosted model.
ALTER TABLE ai_configs DROP CONSTRAINT IF EXISTS ai_configs_provider_check;
ALTER TABLE ai_configs ADD CONSTRAINT ai_configs_provider_check
  CHECK (provider IN ('openai', 'anthropic', 'ollama'));
