-- =============================================
-- ZIDU v6 Migration: KPI 扩展 + AI 配置
-- =============================================

-- ═══ 销售目标扩展：新客户 KPI ═══
ALTER TABLE sales_targets ADD COLUMN IF NOT EXISTS target_new_customers INTEGER DEFAULT 0;
ALTER TABLE sales_targets ADD COLUMN IF NOT EXISTS target_order_count INTEGER DEFAULT 0;

-- ═══ 应用设置（存储 API key 等） ═══
CREATE TABLE IF NOT EXISTS app_settings (
  id SERIAL PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  value TEXT DEFAULT '',
  description TEXT DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on app_settings" ON app_settings FOR ALL USING (true) WITH CHECK (true);

-- 初始化配置项
INSERT INTO app_settings (key, value, description) VALUES
  ('ai_provider', 'deepseek', 'AI 服务商：deepseek / doubao'),
  ('ai_api_key', '', 'AI API Key'),
  ('ai_api_url', 'https://api.deepseek.com/chat/completions', 'AI API 端点'),
  ('ai_model', 'deepseek-chat', 'AI 模型名')
ON CONFLICT (key) DO NOTHING;
