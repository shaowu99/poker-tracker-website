-- 扑克追踪器 - 预计算统计表创建脚本（修正版）
-- 按以下顺序执行各个部分

-- 1. 创建玩家统计汇总表
CREATE TABLE IF NOT EXISTS player_stats_summary (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  total_hands INTEGER DEFAULT 0,
  total_profit DECIMAL(12, 2) DEFAULT 0,
  wins INTEGER DEFAULT 0,
  losses INTEGER DEFAULT 0,
  vpip DECIMAL(5, 2) DEFAULT 0,  -- 自愿投入底池率
  pfr DECIMAL(5, 2) DEFAULT 0,   -- 翻前加注率
  three_bet DECIMAL(5, 2) DEFAULT 0, -- 三次下注率
  aggression_index DECIMAL(8, 2) DEFAULT 0, -- 激进指数
  avg_profit_per_hand DECIMAL(8, 2) DEFAULT 0, -- 平均每手盈利
  win_rate DECIMAL(5, 2) DEFAULT 0, -- 胜率
  sample_size INTEGER DEFAULT 0, -- 样本大小
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(player_id)
);

-- 2. 创建位置统计汇总表
CREATE TABLE IF NOT EXISTS player_position_stats (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  position TEXT NOT NULL CHECK (position IN ('UTG', 'UTG+1', 'MP', 'HJ', 'CO', 'BTN', 'SB', 'BB')),
  hands INTEGER DEFAULT 0,
  profit DECIMAL(12, 2) DEFAULT 0,
  wins INTEGER DEFAULT 0,
  avg_profit_per_hand DECIMAL(8, 2) DEFAULT 0,
  win_rate DECIMAL(8, 2) DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(player_id, position)
);

-- 3. 创建牌桌统计汇总表
CREATE TABLE IF NOT EXISTS player_table_stats (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  table_id UUID NOT NULL REFERENCES poker_tables(id) ON DELETE CASCADE,
  total_hands INTEGER DEFAULT 0,
  total_profit DECIMAL(12, 2) DEFAULT 0,
  vpip DECIMAL(5, 2) DEFAULT 0,
  pfr DECIMAL(5, 2) DEFAULT 0,
  win_rate DECIMAL(8, 2) DEFAULT 0,
  avg_profit_per_hand DECIMAL(8, 2) DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(player_id, table_id)
);

-- 4. 综合统计视图将在ALTER TABLE操作后创建
-- 5. 位置统计视图将在ALTER TABLE操作后创建

-- 6. 更新玩家总体统计的函数
CREATE OR REPLACE FUNCTION update_player_stats(p_player_id UUID)
RETURNS VOID AS $$
DECLARE
  total_hands_count INTEGER;
  total_profit_sum DECIMAL(12, 2);
  total_wins INTEGER;
  total_losses INTEGER;
  win_rate_calc DECIMAL(5, 2);
  avg_profit_calc DECIMAL(8, 2);
  vpip_calc DECIMAL(5, 2);
  pfr_calc DECIMAL(5, 2);
  three_bet_calc DECIMAL(5, 2);
  aggression_calc DECIMAL(8, 2);
BEGIN
  -- 计算核心统计
  SELECT 
    COUNT(*),
    COALESCE(SUM(net_result), 0),
    COALESCE(SUM(CASE WHEN is_winner THEN 1 ELSE 0 END), 0),
    COUNT(*) - COALESCE(SUM(CASE WHEN is_winner THEN 1 ELSE 0 END), 0)
  INTO 
    total_hands_count,
    total_profit_sum,
    total_wins,
    total_losses
  FROM player_positions
  WHERE player_id = p_player_id;

  -- 计算胜率和平均每手盈利
  win_rate_calc := LEAST(CASE WHEN total_hands_count > 0 THEN (total_wins * 100.0 / total_hands_count) ELSE 0 END, 999.99);
  avg_profit_calc := CASE WHEN total_hands_count > 0 THEN (total_profit_sum / total_hands_count) ELSE 0 END;

  -- 计算VPIP - 自愿投入底池率
  SELECT 
    LEAST(COALESCE(COUNT(DISTINCT ha.game_id) * 100.0 / NULLIF(total_hands_count, 0), 0), 999.99)
  INTO vpip_calc
  FROM hand_actions ha
  WHERE ha.player_id = p_player_id 
    AND ha.street = 'preflop' 
    AND ha.is_voluntary = true;

  -- 计算PFR - 翻前加注率
  SELECT 
    LEAST(COALESCE(COUNT(DISTINCT ha.game_id) * 100.0 / NULLIF(total_hands_count, 0), 0), 999.99)
  INTO pfr_calc
  FROM hand_actions ha
  WHERE ha.player_id = p_player_id 
    AND ha.street = 'preflop' 
    AND ha.action_type = 'raise';

  -- 暂时简化3bet计算，避免过于复杂的查询
  three_bet_calc := 0;

  -- 简化的激进指数（限制最大值为9999.99以避免数值溢出）
  aggression_calc := LEAST(CASE WHEN vpip_calc > 0 THEN (pfr_calc / NULLIF(vpip_calc, 0)) ELSE 0 END, 9999.99);

  -- 插入或更新玩家统计
  INSERT INTO player_stats_summary (
    player_id, total_hands, total_profit, wins, losses,
    vpip, pfr, three_bet, aggression_index, avg_profit_per_hand, win_rate
  ) VALUES (
    p_player_id, total_hands_count, total_profit_sum, total_wins, total_losses,
    vpip_calc, pfr_calc, three_bet_calc, aggression_calc, avg_profit_calc, win_rate_calc
  )
  ON CONFLICT (player_id) 
  DO UPDATE SET
    total_hands = EXCLUDED.total_hands,
    total_profit = EXCLUDED.total_profit,
    wins = EXCLUDED.wins,
    losses = EXCLUDED.losses,
    vpip = EXCLUDED.vpip,
    pfr = EXCLUDED.pfr,
    three_bet = EXCLUDED.three_bet,
    aggression_index = EXCLUDED.aggression_index,
    avg_profit_per_hand = EXCLUDED.avg_profit_per_hand,
    win_rate = EXCLUDED.win_rate,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- 7. 更新玩家位置统计的函数
CREATE OR REPLACE FUNCTION update_player_position_stats(p_player_id UUID)
RETURNS VOID AS $$
BEGIN
  -- 删除现有位置统计
  DELETE FROM player_position_stats WHERE player_id = p_player_id;
  
  -- 插入新的位置统计
  INSERT INTO player_position_stats (player_id, position, hands, profit, wins, avg_profit_per_hand, win_rate)
  SELECT 
    player_id,
    position,
    COUNT(*) as hands,
    SUM(net_result) as profit,
    SUM(CASE WHEN is_winner THEN 1 ELSE 0 END) as wins,
    AVG(net_result) as avg_profit_per_hand,
    LEAST((SUM(CASE WHEN is_winner THEN 1 ELSE 0 END) * 100.0 / COUNT(*)), 9999.99) as win_rate
  FROM player_positions
  WHERE player_id = p_player_id AND position IS NOT NULL
  GROUP BY player_id, position;
END;
$$ LANGUAGE plpgsql;

-- 8. 创建触发器函数 - 更新玩家统计
CREATE OR REPLACE FUNCTION update_player_stats_on_position_change()
RETURNS TRIGGER AS $$
BEGIN
  -- 延迟更新统计，避免频繁更新
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    PERFORM update_player_stats(NEW.player_id);
    PERFORM update_player_position_stats(NEW.player_id);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM update_player_stats(OLD.player_id);
    PERFORM update_player_position_stats(OLD.player_id);
  END IF;
  RETURN NULL; -- 对于AFTER触发器，返回值无关紧要
END;
$$ LANGUAGE plpgsql;

-- 9. 为player_positions表创建触发器（修正版 - 移除IF NOT EXISTS）
DROP TRIGGER IF EXISTS trigger_update_player_stats ON player_positions;
CREATE TRIGGER trigger_update_player_stats
  AFTER INSERT OR UPDATE OR DELETE ON player_positions
  FOR EACH ROW EXECUTE FUNCTION update_player_stats_on_position_change();

-- 10. 为hand_actions表创建触发器函数
CREATE OR REPLACE FUNCTION update_player_stats_on_action_change()
RETURNS TRIGGER AS $$
BEGIN
  -- 延迟更新统计
  -- 注意：仅在preflop操作时更新，避免过于频繁的计算
  IF (TG_OP = 'INSERT' AND NEW.street = 'preflop') OR 
     (TG_OP = 'UPDATE' AND (NEW.street = 'preflop' OR OLD.street = 'preflop')) OR
     (TG_OP = 'DELETE' AND OLD.street = 'preflop') THEN
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
      PERFORM update_player_stats(NEW.player_id);
    ELSE
      PERFORM update_player_stats(OLD.player_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- 11. 为hand_actions表创建触发器（修正版 - 移除IF NOT EXISTS）
DROP TRIGGER IF EXISTS trigger_update_player_actions_stats ON hand_actions;
CREATE TRIGGER trigger_update_player_actions_stats
  AFTER INSERT OR UPDATE OR DELETE ON hand_actions
  FOR EACH ROW EXECUTE FUNCTION update_player_stats_on_action_change();

-- 12. 批量更新所有玩家统计的函数
CREATE OR REPLACE FUNCTION update_all_player_stats()
RETURNS VOID AS $$
DECLARE
  player_record RECORD;
BEGIN
  FOR player_record IN SELECT id FROM players LOOP
    RAISE NOTICE 'Updating stats for player %', player_record.id;
    PERFORM update_player_stats(player_record.id);
    PERFORM update_player_position_stats(player_record.id);
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- 13. 执行批量更新以初始化现有数据
-- 注意：如果数据量很大，您可能需要分批执行或在数据库负载较低时运行
-- SELECT update_all_player_stats();

-- 14. 处理视图依赖的字段类型修改说明
/*
-- 如果需要修改被视图依赖的字段类型（例如修复 numeric field overflow 错误），请按以下步骤执行：

-- 1. 删除依赖视图
DROP VIEW IF EXISTS player_comprehensive_stats;
DROP VIEW IF EXISTS player_position_stats_view;

-- 2. 修改列的数据类型
ALTER TABLE player_stats_summary ALTER COLUMN aggression_index TYPE DECIMAL(8, 2);
ALTER TABLE player_position_stats ALTER COLUMN win_rate TYPE DECIMAL(8, 2);
ALTER TABLE player_table_stats ALTER COLUMN win_rate TYPE DECIMAL(8, 2);

-- 3. 重新创建视图
CREATE OR REPLACE VIEW player_comprehensive_stats AS
SELECT 
  p.id as player_id,
  p.username,
  pss.total_hands,
  pss.total_profit,
  pss.wins,
  pss.losses,
  pss.vpip,
  pss.pfr,
  pss.three_bet,
  pss.aggression_index,
  pss.avg_profit_per_hand,
  pss.win_rate,
  pss.updated_at as stats_updated_at
FROM players p
LEFT JOIN player_stats_summary pss ON p.id = pss.player_id;

CREATE OR REPLACE VIEW player_position_stats_view AS
SELECT 
  p.id as player_id,
  p.username,
  pps.position,
  pps.hands,
  pps.profit,
  pps.wins,
  pps.avg_profit_per_hand,
  pps.win_rate
FROM players p
LEFT JOIN player_position_stats pps ON p.id = pps.player_id;
*/