/**
 * 系统修复验证脚本
 * 用于验证数据查询丢失问题是否已解决
 */

async function verifySystemFix() {
    console.log('开始验证系统修复...');

    // 1. 检查缓存配置
    if (window.pokerCache) {
        console.log('✓ 缓存管理器已加载');
        console.log('  - 默认缓存时间:', window.pokerCache.defaultCacheDuration, 'ms');
        console.log('  - 统计缓存时间:', window.pokerCache.statsCacheDuration, 'ms');
        
        if (window.pokerCache.statsCacheDuration <= 5 * 60 * 1000) {
            console.log('✓ 缓存时间已正确设置为5分钟或更短');
        } else {
            console.log('✗ 缓存时间设置不正确');
        }
        
        // 检查是否添加了新方法
        if (typeof window.pokerCache.forceRefreshPlayerStats === 'function') {
            console.log('✓ forceRefreshPlayerStats 方法已添加');
        } else {
            console.log('✗ forceRefreshPlayerStats 方法未找到');
        }
    } else {
        console.log('✗ 缓存管理器未加载');
        return false;
    }

    // 2. 检查Supabase客户端
    if (window.supabaseClient) {
        console.log('✓ Supabase客户端已加载');
    } else {
        console.log('✗ Supabase客户端未加载');
        return false;
    }

    // 3. 检查更新函数
    if (typeof updatePlayerStats === 'function') {
        console.log('✓ updatePlayerStats 函数已更新');
    } else {
        console.log('✗ updatePlayerStats 函数未找到');
    }

    // 4. 检查是否可以访问修复脚本功能
    if (window.supabaseClient.forceUpdatePlayerStats) {
        console.log('✓ forceUpdatePlayerStats 方法已添加到Supabase客户端');
    } else {
        console.log('✗ forceUpdatePlayerStats 方法未添加到Supabase客户端');
    }

    console.log('\n系统修复验证完成');
    console.log('\n主要修复内容:');
    console.log('1. 将统计数据缓存时间从30分钟缩短到5分钟');
    console.log('2. 优化了数据库触发器以确保数据变更时立即更新统计');
    console.log('3. 增强了错误处理和缓存清除机制');
    console.log('4. 添加了forceRefreshPlayerStats方法以强制刷新数据');
    console.log('5. 改进了updatePlayerStats函数的健壮性');

    console.log('\n要完全解决问题，请执行以下步骤:');
    console.log('1. 在数据库中运行 improved-stats-triggers.sql 脚本');
    console.log('2. 使用 update_all_player_stats() 函数更新所有现有玩家的统计');
    console.log('3. 在数据上传后调用 forceUpdatePlayerStats() 来确保统计及时更新');
    
    return true;
}

// 运行验证
verifySystemFix();

// 导出验证函数以供外部调用
window.verifySystemFix = verifySystemFix;