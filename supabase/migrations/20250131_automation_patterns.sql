-- Automation patterns table for storing selectors, known handles, skip patterns
CREATE TABLE IF NOT EXISTS automation_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_type TEXT NOT NULL,
  pattern_key TEXT NOT NULL,
  pattern_value TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(pattern_type, pattern_key)
);

CREATE INDEX IF NOT EXISTS idx_patterns_type ON automation_patterns(pattern_type);
