// 数据同步修复脚本
// 用于确保数据上传后统计立即更新

// 1. 修复缓存清除机制
function clearPlayerStatsCache(playerId) {
    if (window.pokerCache) {
        // 清除玩家统计缓存
        window.pokerCache.clearCache('player_stats', playerId);
        // 清除相关缓存
        window.pokerCache.clearCache('recent_hands', playerId, 20);
        window.pokerCache.clearCache('hand_range_data', playerId);
        console.log(`已清除玩家 ${playerId} 的缓存`);
    }
}

// 2. 强制更新玩家统计
async function forceUpdatePlayerStats(playerId) {
    try {
        if (!window.supabaseClient) {
            console.error('Supabase客户端未初始化');
            return false;
        }
        
        const client = await window.supabaseClient.ensureSupabase();
        
        // 直接调用数据库函数更新统计
        const { data, error } = await client.rpc('update_player_stats', {
            p_player_id: playerId
        });
        
        if (error) {
            console.error('更新玩家统计失败:', error);
            return false;
        }
        
        // 清除缓存以确保获取最新数据
        clearPlayerStatsCache(playerId);
        
        console.log(`玩家 ${playerId} 统计更新成功`);
        return true;
    } catch (error) {
        console.error('强制更新统计时出错:', error);
        return false;
    }
}

// 3. 修复后的数据上传后处理
async function processPostUpload(playerId) {
    // 清除相关缓存
    clearPlayerStatsCache(playerId);
    
    // 立即更新统计
    await forceUpdatePlayerStats(playerId);
    
    // 如果在player页面，更新当前显示的数据
    if (window.currentPlayer && window.currentPlayer.id === playerId) {
        if (typeof loadPlayerData === 'function') {
            await loadPlayerData(playerId);
        }
    }
}

// 4. 更新全局函数以确保数据实时性
if (typeof window.supabaseClient !== 'undefined') {
    // 扩展supabase客户端以支持强制更新
    window.supabaseClient.forceUpdatePlayerStats = forceUpdatePlayerStats;
    window.supabaseClient.clearPlayerStatsCache = clearPlayerStatsCache;
    window.supabaseClient.processPostUpload = processPostUpload;
}

console.log('数据同步修复脚本已加载');