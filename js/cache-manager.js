class PokerCacheManager {
    constructor() {
        this.cachePrefix = 'poker_tracker_';
        this.defaultCacheDuration = 10 * 60 * 1000; // 10分钟
        this.statsCacheDuration = 30 * 60 * 1000; // 30分钟
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
    
    // 缓存包装函数
    async withCache(cacheKey, fetchFunction, duration = null) {
        // 尝试从缓存获取
        const cached = this.getCachedData(cacheKey);
        if (cached !== null) {
            console.log(`使用缓存: ${cacheKey}`);
            return cached;
        }
        
        // 从源获取数据
        console.log(`缓存未命中，获取数据: ${cacheKey}`);
        const data = await fetchFunction();
        
        // 缓存结果
        if (data !== null && data !== undefined) {
            this.setCachedData(cacheKey, data, duration);
        }
        
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
                while ((!window.supabaseClient || typeof window.supabaseClient.getPlayerHandRangeData !== 'function') && attempts < maxAttempts) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    attempts++;
                }
                
                if (!window.supabaseClient || typeof window.supabaseClient.getPlayerHandRangeData !== 'function') {
                    throw new Error('Supabase客户端未能初始化或getPlayerHandRangeData函数不可用');
                }
                
                return await window.supabaseClient.getPlayerHandRangeData(playerId);
            },
            this.defaultCacheDuration
        );
    }

    // 将函数添加到缓存管理器实例上
    PokerCacheManager.prototype.getPlayerHandRangeData = getPlayerHandRangeData;

window.pokerCache = new PokerCacheManager();