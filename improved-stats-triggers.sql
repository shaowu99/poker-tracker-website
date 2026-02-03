-- 改进的扑克追踪器统计更新脚本
-- 修复数据同步问题

-- 1. 修改触发器函数 - 确保数据插入后立即更新统计
CREATE OR REPLACE FUNCTION update_player_stats_on_position_change()
RETURNS TRIGGER AS $$
BEGIN
  -- 对于INSERT和UPDATE操作
  IF TG_OP = 'INSERT' THEN
    -- 更新玩家总体统计
    PERFORM update_player_stats(NEW.player_id);
    -- 更新玩家位置统计
    PERFORM update_player_position_stats(NEW.player_id);
  ELSIF TG_OP = 'UPDATE' THEN
    -- 更新新旧两个玩家的统计
    IF OLD.player_id != NEW.player_id THEN
      PERFORM update_player_stats(OLD.player_id);
      PERFORM update_player_position_stats(OLD.player_id);
    END IF;
    PERFORM update_player_stats(NEW.player_id);
    PERFORM update_player_position_stats(NEW.player_id);
  ELSIF TG_OP = 'DELETE' THEN
    -- 更新被删除记录的玩家统计
    PERFORM update_player_stats(OLD.player_id);
    PERFORM update_player_position_stats(OLD.player_id);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- 2. 修改动作表的触发器函数
CREATE OR REPLACE FUNCTION update_player_stats_on_action_change()
RETURNS TRIGGER AS $$
BEGIN
  -- 对于所有操作都更新统计，不管是否为preflop
  IF TG_OP = 'INSERT' THEN
    PERFORM update_player_stats(NEW.player_id);
  ELSIF TG_OP = 'UPDATE' THEN
    -- 如果玩家发生变化，更新两个玩家的统计
    IF OLD.player_id != NEW.player_id THEN
      PERFORM update_player_stats(OLD.player_id);
    END IF;
    PERFORM update_player_stats(NEW.player_id);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM update_player_stats(OLD.player_id);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- 3. 重新创建触发器
DROP TRIGGER IF EXISTS trigger_update_player_stats ON player_positions;
CREATE TRIGGER trigger_update_player_stats
  AFTER INSERT OR UPDATE OR DELETE ON player_positions
  FOR EACH ROW EXECUTE FUNCTION update_player_stats_on_position_change();

DROP TRIGGER IF EXISTS trigger_update_player_actions_stats ON hand_actions;
CREATE TRIGGER trigger_update_player_actions_stats
  AFTER INSERT OR UPDATE OR DELETE ON hand_actions
  FOR EACH ROW EXECUTE FUNCTION update_player_stats_on_action_change();

-- 4. 优化统计更新函数 - 添加异常处理
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
  BEGIN
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
      LEAST(COALESCE(
        (SELECT COUNT(DISTINCT ha.game_id)
         FROM hand_actions ha
         WHERE ha.player_id = p_player_id 
           AND ha.street = 'preflop' 
           AND ha.action_type IN ('call', 'bet', 'raise', 'all_in')
           AND EXISTS (
             SELECT 1 FROM player_positions pp
             WHERE pp.player_id = ha.player_id
               AND pp.game_id = ha.game_id
           )
        ) * 100.0 / NULLIF(total_hands_count, 0), 
      0), 999.99)
    INTO vpip_calc;

    -- 计算PFR - 翻前加注率
    SELECT 
      LEAST(COALESCE(
        (SELECT COUNT(DISTINCT ha.game_id)
         FROM hand_actions ha
         WHERE ha.player_id = p_player_id 
           AND ha.street = 'preflop' 
           AND ha.action_type = 'raise'
           AND EXISTS (
             SELECT 1 FROM player_positions pp
             WHERE pp.player_id = ha.player_id
               AND pp.game_id = ha.game_id
           )
        ) * 100.0 / NULLIF(total_hands_count, 0), 
      0), 999.99)
    INTO pfr_calc;

    -- 暂时简化3bet计算
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
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING '更新玩家统计时出错 (player_id: %): %', p_player_id, SQLERRM;
  END;
END;
$$ LANGUAGE plpgsql;

-- 5. 优化位置统计更新函数
CREATE OR REPLACE FUNCTION update_player_position_stats(p_player_id UUID)
RETURNS VOID AS $$
BEGIN
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
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING '更新玩家位置统计时出错 (player_id: %): %', p_player_id, SQLERRM;
  END;
END;
$$ LANGUAGE plpgsql;

-- 6. 创建一个立即更新指定玩家统计的辅助函数
CREATE OR REPLACE FUNCTION refresh_player_stats_immediately(p_username TEXT)
RETURNS TABLE (
  success BOOLEAN,
  message TEXT,
  updated_at TIMESTAMPTZ
) AS $$
DECLARE
  v_player_id UUID;
  v_result RECORD;
BEGIN
  -- 根据用户名查找玩家ID
  SELECT id INTO v_player_id
  FROM players
  WHERE username ILIKE p_username
  LIMIT 1;
  
  IF v_player_id IS NULL THEN
    RETURN QUERY SELECT FALSE, '未找到玩家: ' || p_username, NOW();
    RETURN;
  END IF;
  
  -- 更新玩家统计
  PERFORM update_player_stats(v_player_id);
  PERFORM update_player_position_stats(v_player_id);
  
  -- 返回成功信息
  RETURN QUERY SELECT TRUE, '玩家统计已更新: ' || p_username, NOW();
END;
$$ LANGUAGE plpgsql;

-- 7. 重新执行批量更新以确保现有数据正确
-- 注意：如果数据量很大，请谨慎运行此命令
-- SELECT update_all_player_stats();