class PokerCacheManager {
    constructor() {
        this.cachePrefix = 'poker_tracker_';
        this.defaultCacheDuration = 5 * 60 * 1000; // 5分钟
        this.statsCacheDuration = 5 * 60 * 1000; // 5分钟，确保统计数据及时更新
    }
    
    // 生成缓存键
    getCacheKey(type, ...args) {
        return `${this.cachePrefix}${type}_${args.join('_')}`;
    }
    
    // 获取缓存数据
    getCachedData(cacheKey) {
        try {
            const cached = localStorage.getItem(cacheKey);
            if (!cached) return null;
            
            const { data, timestamp, duration } = JSON.parse(cached);
            
            // 检查是否过期
            if (Date.now() - timestamp > (duration || this.defaultCacheDuration)) {
                localStorage.removeItem(cacheKey);
                return null;
            }
            
            return data;
        } catch (error) {
            console.error('读取缓存失败:', error);
            return null;
        }
    }
    
    // 设置缓存数据
    setCachedData(cacheKey, data, duration = null) {
        try {
            localStorage.setItem(cacheKey, JSON.stringify({
                data,
                timestamp: Date.now(),
                duration: duration || this.defaultCacheDuration
            }));
            return true;
        } catch (error) {
            console.error('设置缓存失败:', error);
            return false;
        }
    }
    
    // 清除特定缓存
    clearCache(type, ...args) {
        const cacheKey = this.getCacheKey(type, ...args);
        localStorage.removeItem(cacheKey);
    }
    
    // 清除所有缓存
    clearAllCache() {
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key.startsWith(this.cachePrefix)) {
                keysToRemove.push(key);
            }
        }
        
        keysToRemove.forEach(key => localStorage.removeItem(key));
        return keysToRemove.length;
    }
    
    // 获取缓存统计
    getCacheStats() {
        const stats = {
            total: 0,
            size: 0,
            items: []
        };
        
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key.startsWith(this.cachePrefix)) {
                stats.total++;
                const value = localStorage.getItem(key);
                stats.size += key.length + (value ? value.length : 0);
                stats.items.push({
                    key,
                    size: key.length + (value ? value.length : 0),
                    value: JSON.parse(value)
                });
            }
        }
        
        stats.sizeKB = (stats.size / 1024).toFixed(2);
        return stats;
    }
    
    // 缓存包装函数（已禁用缓存，直接从数据库获取）
    async withCache(cacheKey, fetchFunction, duration = null) {
        // 直接从源获取数据，不使用缓存
        console.log(`直接从数据库获取数据: ${cacheKey}`);
        const data = await fetchFunction();
        return data;
    }
    
    // 玩家相关缓存方法
    async getPlayerStats(playerId, forceRefresh = false) {
        const cacheKey = this.getCacheKey('player_stats', playerId);
        
        if (forceRefresh) {
            this.clearCache('player_stats', playerId);
        }
        
        return this.withCache(
            cacheKey,
            async () => {
                console.log('从数据库获取玩家统计数据...');
                // 确保Supabase客户端已初始化
                let attempts = 0;
                const maxAttempts = 50; // 最多等待5秒 (50 * 100ms)
                while ((!window.supabaseClient || typeof window.supabaseClient.ensureSupabase !== 'function') && attempts < maxAttempts) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    attempts++;
                }
                
                if (!window.supabaseClient || typeof window.supabaseClient.ensureSupabase !== 'function') {
                    throw new Error('Supabase客户端未能初始化');
                }
                
                await window.supabaseClient.ensureSupabase();
                const basicInfo = await window.supabaseClient.getPlayerBasicInfo(playerId);
                const coreStats = await window.supabaseClient.getPlayerCoreStats(playerId);
                const preflopStats = await window.supabaseClient.getPreflopStats(playerId);
                const positionStats = await window.supabaseClient.getPositionStats(playerId);
                
                console.log('获取到统计数据:', { coreStats, preflopStats });
                
                return {
                    basicInfo,
                    coreStats,
                    preflopStats,
                    positionStats,
                    lastUpdated: new Date().toISOString()
                };
            },
            this.statsCacheDuration
        );
    }
    
    async getPlayerRecentHands(playerId, limit = 20) {
        const cacheKey = this.getCacheKey('recent_hands', playerId, limit);
        
        return this.withCache(
            cacheKey,
            async () => {
                // 确保Supabase客户端已初始化
                let attempts = 0;
                const maxAttempts = 50; // 最多等待5秒 (50 * 100ms)
                while ((!window.supabaseClient || typeof window.supabaseClient.ensureSupabase !== 'function') && attempts < maxAttempts) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    attempts++;
                }
                
                if (!window.supabaseClient || typeof window.supabaseClient.ensureSupabase !== 'function') {
                    throw new Error('Supabase客户端未能初始化');
                }
                
                await window.supabaseClient.ensureSupabase();
                return window.supabaseClient.getRecentHands(playerId, limit);
            },
            this.defaultCacheDuration
        );
    }
    
    // 系统统计缓存
    async getSystemStats() {
        const cacheKey = this.getCacheKey('system_stats');
        
        return this.withCache(
            cacheKey,
            async () => {
                // 确保Supabase客户端已初始化
                let attempts = 0;
                const maxAttempts = 50; // 最多等待5秒 (50 * 100ms)
                while ((!window.supabaseClient || typeof window.supabaseClient.ensureSupabase !== 'function') && attempts < maxAttempts) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    attempts++;
                }
                
                if (!window.supabaseClient || typeof window.supabaseClient.ensureSupabase !== 'function') {
                    throw new Error('Supabase客户端未能初始化');
                }
                
                await window.supabaseClient.ensureSupabase();
                return window.supabaseClient.getSystemStats();
            },
            this.statsCacheDuration
        );
    }
}

// 创建全局缓存管理器实例
    // 获取玩家手牌范围数据（带缓存）
    async function getPlayerHandRangeData(playerId) {
        const cacheKey = this.getCacheKey('hand_range_data', playerId);
        
        return this.withCache(
            cacheKey,
            async () => {
                // 确保Supabase客户端可用
                let attempts = 0;
                const maxAttempts = 50;
                while ((!window.supabaseClient || typeof window.supabaseClient.ensureSupabase !== 'function') && attempts < maxAttempts) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    attempts++;
                }
                
                if (!window.supabaseClient || typeof window.supabaseClient.ensureSupabase !== 'function') {
                    throw new Error('Supabase客户端未能初始化');
                }
                
                // 获取showdowns数据
                const showdownsData = await window.supabaseClient.getPlayerHandRangeData(playerId);
                
                // 获取玩家在preflop阶段的动作数据
                const client = await window.supabaseClient.ensureSupabase();
                const { data: handActionsData, error: actionsError } = await client
                    .from('hand_actions')
                    .select(`
                        game_id,
                        action_type,
                        street
                    `)
                    .eq('player_id', playerId)
                    .eq('street', 'preflop'); // 只获取翻前动作

                if (actionsError) throw actionsError;
                
                // 合并数据 - 将动作信息添加到showdowns数据中
                const mergedData = showdownsData.map(showdown => {
                    const relatedAction = handActionsData.find(action => action.game_id === showdown.game_id);
                    return {
                        ...showdown,
                        action_type: relatedAction ? relatedAction.action_type : ''
                    };
                });
                
                return mergedData;
            },
            this.defaultCacheDuration
        );
    }

    // 强制刷新特定玩家的所有统计数据
    async function forceRefreshPlayerStats(playerId) {
        // 清除所有相关缓存
        this.clearCache('player_stats', playerId);
        this.clearCache('recent_hands', playerId, 20);
        this.clearCache('hand_range_data', playerId);
        
        // 重新获取最新数据
        const stats = await this.getPlayerStats(playerId, true); // 强制刷新
        const recentHands = await this.getPlayerRecentHands(playerId, 20);
        const handRangeData = await this.getPlayerHandRangeData(playerId);
        
        return {
            stats,
            recentHands,
            handRangeData
        };
    }

    // 将函数添加到缓存管理器实例上
    PokerCacheManager.prototype.getPlayerHandRangeData = getPlayerHandRangeData;
    PokerCacheManager.prototype.forceRefreshPlayerStats = forceRefreshPlayerStats;

window.pokerCache = new PokerCacheManager();