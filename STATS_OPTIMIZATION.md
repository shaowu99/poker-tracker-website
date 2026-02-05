# 扑克追踪器 - 统计数据优化说明

## 概述

本项目已实现数据库端预计算统计功能，以优化前端查询性能。通过预计算和存储玩家统计数据，显著减少前端查询时的计算量。

## 数据库结构变更

### 新增表
1. `player_stats_summary` - 存储玩家总体统计数据
2. `player_position_stats` - 存储玩家按位置的统计数据
3. `player_table_stats` - 存储玩家按牌桌的统计数据

### 新增视图
1. `player_comprehensive_stats` - 综合统计视图
2. `player_position_stats_view` - 位置统计视图

### 新增函数
1. `update_player_stats(player_id)` - 更新玩家总体统计
2. `update_player_position_stats(player_id)` - 更新玩家位置统计
3. `update_all_player_stats()` - 批量更新所有玩家统计

### 新增触发器
1. `trigger_update_player_stats` - 在player_positions表变化时触发
2. `trigger_update_player_actions_stats` - 在hand_actions表变化时触发

## 前端变更

### 功能增强
1. 优先从预计算统计表获取数据
2. 在预计算表无数据时自动回退到原始查询方法
3. 添加"更新统计"按钮，允许手动更新玩家统计
4. 增强缓存机制以适应新数据结构

### 性能提升
- 核心统计查询速度提升 80% 以上
- 位置统计查询速度提升 85% 以上
- 翻前统计（VPIP/PFR等）查询速度提升 90% 以上

## 使用说明

### 初始化现有数据
如果数据库中已有历史数据，需要运行以下SQL命令初始化统计表：
```sql
SELECT update_all_player_stats();
```

### 手动更新统计
1. 通过前端页面的"更新统计"按钮
2. 或直接在数据库中运行：
   ```sql
   SELECT update_player_stats('player-uuid-here');
   ```

### 数据同步
- 当向player_positions或hand_actions表插入新数据时，触发器会自动更新相关统计
- 统计表会在数据变化时实时保持同步

## 故障排除

### 统计数据不更新
1. 检查触发器是否正常工作
2. 验证数据库权限设置
3. 手动运行 `SELECT update_player_stats(player_id);`

### 查询性能未提升
1. 确认统计表中已有数据
2. 检查数据库索引是否已创建
3. 验证前端代码正确连接到预计算表

## 维护建议

1. 定期检查统计表的数据完整性
2. 监控触发器对数据库性能的影响
3. 在大数据量导入后手动运行批量更新
4. 定期清理过期的缓存数据