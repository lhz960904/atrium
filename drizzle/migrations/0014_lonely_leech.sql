-- The external-CLI providers were removed with the ACP channel; their rows can
-- no longer be read (nothing in the manifest resolves them). Only the launch
-- overrides are lost, and only for providers that no longer exist.
DELETE FROM `providers` WHERE `id` IN ('claude-code', 'codex-cli', 'gemini-cli');
