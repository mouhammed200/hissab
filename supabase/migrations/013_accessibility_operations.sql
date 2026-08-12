-- 013 - ACCESSIBILITY AND OPERATIONS DEPLOYMENT BASELINE
BEGIN;
CREATE TABLE IF NOT EXISTS public.operation_events(
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
 request_id TEXT, event_type TEXT NOT NULL, severity TEXT NOT NULL DEFAULT 'info' CHECK(severity IN('info','warning','error')),
 status_code INTEGER, duration_ms INTEGER, metadata JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE operation_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY operation_events_read ON operation_events FOR SELECT TO authenticated USING(org_id IS NULL OR public.user_has_org_access(org_id));
CREATE INDEX IF NOT EXISTS idx_operation_events_created ON operation_events(created_at DESC);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS retention_policy JSONB NOT NULL DEFAULT '{}'::jsonb;
COMMIT;
