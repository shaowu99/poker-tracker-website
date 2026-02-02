// 强制更新玩家统计数据的脚本
// 用于解决数据丢失和不更新问题

async function forceUpdatePlayerStats() {
    console.log('开始强制更新玩家统计数据...');
    
    try {
        // 确保Supabase客户端已初始化
        if (!window.supabaseClient || typeof window.supabaseClient.ensureSupabase !== 'function') {
            console.error('Supabase客户端未初始化');
            return;
        }
        
        const client = await window.supabaseClient.ensureSupabase();
        
        // 查找masami86玩家ID
        const { data: playerData, error: playerError } = await client
            .from('players')
            .select('id, username')
            .ilike('username', 'masami86');
        
        if (playerError) {
            console.error('查询玩家失败:', playerError);
            return;
        }
        
        if (!playerData || playerData.length === 0) {
            console.log('未找到masami86玩家');
            // 尝试模糊搜索
            const { data: fuzzyData, error: fuzzyError } = await client
                .from('players')
                .select('id, username')
                .ilike('username', '%masami86%');
            
            if (fuzzyError) {
                console.error('模糊查询玩家失败:', fuzzyError);
                return;
            }
            
            if (!fuzzyData || fuzzyData.length === 0) {
                console.log('未找到包含masami86的玩家');
                return;
            }
            
            playerData = fuzzyData;
        }
        
        console.log(`找到 ${playerData.length} 个匹配的玩家`);
        
        for (const player of playerData) {
            console.log(`正在更新玩家: ${player.username} (ID: ${player.id})`);
            
            try {
                // 调用数据库函数更新统计
                const { data, error } = await client.rpc('update_player_stats', {
                    p_player_id: player.id
                });
                
                if (error) {
                    console.error(`更新玩家 ${player.username} 统计失败:`, error);
                } else {
                    console.log(`玩家 ${player.username} 统计更新成功`);
                }
            } catch (updateError) {
                console.error(`调用更新函数失败:`, updateError);
            }
        }
        
        console.log('强制更新完成');
        
        // 如果在player页面，刷新页面显示更新结果
        if (typeof refreshData === 'function') {
            setTimeout(() => {
                refreshData();
            }, 2000);
        }
        
    } catch (error) {
        console.error('强制更新统计数据时发生错误:', error);
    }
}

// 执行强制更新
forceUpdatePlayerStats();