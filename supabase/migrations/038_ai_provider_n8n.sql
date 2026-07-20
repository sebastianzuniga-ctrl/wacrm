-- Allow 'n8n' as a valid ai_configs.provider value, alongside
-- 'openai' / 'anthropic' / 'ollama'. The 'n8n' provider is a
-- synchronous webhook callout to an external workflow automation
-- (n8n or similar) instead of a direct LLM API call.
ALTER TABLE ai_configs DROP CONSTRAINT IF EXISTS ai_configs_provider_check;
ALTER TABLE ai_configs ADD CONSTRAINT ai_configs_provider_check
  CHECK (provider IN ('openai', 'anthropic', 'ollama', 'n8n'));
