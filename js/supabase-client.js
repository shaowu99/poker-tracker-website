// 防止重复初始化
if (typeof window.supabaseInitialized === 'undefined') {
    window.supabaseInitialized = true;
    
    // Supabase 配置 - 请修改以下配置

    const SUPABASE_CONFIG = {
            // 在你的前端代码中，这样写：
            url: '__SUPABASE_URL__',
            anonKey:'__SUPABASE_ANON_KEY__'
    };


    // 初始化 Supabase 客户端
    let supabase = null;

    async function initializeSupabase() {
        // 现在初始化客户端
        if (typeof window.supabase !== 'undefined' && !supabase) {
            supabase = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
        } else if (!supabase) {
            console.error('Supabase library not loaded');
            throw new Error('Supabase library not loaded');
        }
    }

    // 确保在使用前初始化
    async function ensureSupabase() {
        if (!supabase) {
            await initializeSupabase();
        }
        return supabase;
    }

    // 测试连接
    async function testConnection() {
        try {
            const client = await ensureSupabase();
            const { data, error } = await client
                .from('players')
                .select('count', { count: 'exact', head: true });
            
            if (error) {
                console.error('Supabase连接失败:', error);
                return false;
            }
            
            console.log('Supabase连接成功');
            return true;
        } catch (error) {
            console.error('连接测试异常:', error);
            return false;
        }
    }

    // 查询玩家ID（支持模糊匹配）
    async function findPlayerId(playerName) {
        try {
            const client = await ensureSupabase();
            // 先尝试精确匹配
            let { data, error } = await client
                .from('players')
                .select('id, username')
                .ilike('username', playerName)
                .limit(1);
            
            if (error) throw error;
            
            if (data && data.length > 0) {
                return { id: data[0].id, name: data[0].username, exactMatch: true };
            }
            
            // 模糊匹配（包含搜索）
            const { data: fuzzyData, error: fuzzyError } = await client
                .from('players')
                .select('id, username')
                .ilike('username', `%${playerName}%`)
                .limit(5);
            
            if (fuzzyError) throw fuzzyError;
            
            if (fuzzyData && fuzzyData.length > 0) {
                // 如果有多个匹配，返回第一个
                return { 
                    id: fuzzyData[0].id, 
                    name: fuzzyData[0].username, 
                    exactMatch: false,
                    suggestions: fuzzyData.map(p => p.username)
                };
            }
            
            return null;
            
        } catch (error) {
            console.error('查询玩家ID失败:', error);
            return null;
        }
    }

    // 获取玩家基本信息
    async function getPlayerBasicInfo(playerId) {
        try {
            const client = await ensureSupabase();
            const { data, error } = await client
                .from('players')
                .select('username, created_at')
                .eq('id', playerId)
                .single();
            
            if (error) throw error;
            return data;
        } catch (error) {
            console.error('获取玩家基本信息失败:', error);
            return null;
        }
    }

    // 获取玩家核心统计数据（使用预计算统计表）
    async function getPlayerCoreStats(playerId) {
        try {
            const client = await ensureSupabase();
            // 从预计算统计表获取数据
            const { data, error } = await client
                .from('player_stats_summary')
                .select('total_hands, total_profit, wins, losses, win_rate, avg_profit_per_hand')
                .eq('player_id', playerId)
                .single();
            
            if (error) {
                console.error('从预计算统计表获取数据失败，尝试使用原始方法:', error);
                // 如果预计算表中没有数据，回退到原始方法
                return await getPlayerCoreStatsFallback(playerId);
            }
            
            if (data && data.total_hands !== null && data.total_hands !== undefined) {
                // 预计算表中有数据，返回该数据
                return {
                    totalHands: data.total_hands,
                    totalProfit: data.total_profit ? data.total_profit.toFixed(2) : '0.00',
                    winRate: data.win_rate ? data.win_rate.toFixed(1) : '0.0',
                    avgProfitPerHand: data.avg_profit_per_hand ? data.avg_profit_per_hand.toFixed(2) : '0.00',
                    wins: data.wins || 0,
                    losses: data.losses || 0
                };
            } else {
                // 如果预计算表中没有数据，回退到原始方法
                return await getPlayerCoreStatsFallback(playerId);
            }
        } catch (error) {
            console.error('获取玩家核心统计数据失败:', error);
            // 发生错误时回退到原始方法
            return await getPlayerCoreStatsFallback(playerId);
        }
    }

    // 回退方法：使用原始查询计算统计数据
    async function getPlayerCoreStatsFallback(playerId) {
        try {
            const client = await ensureSupabase();
            // 获取总手数、总盈利、胜率
            const { data: positionData, error: positionError } = await client
                .from('player_positions')
                .select('net_result, is_winner')
                .eq('player_id', playerId);
            
            if (positionError) throw positionError;
            
            // 计算核心数据
            let totalHands = 0;
            let totalProfit = 0;
            let wins = 0;
            
            if (positionData && positionData.length > 0) {
                totalHands = positionData.length;
                positionData.forEach(pos => {
                    totalProfit += pos.net_result || 0;
                    if (pos.is_winner) wins++;
                });
            }
            
            const winRate = totalHands > 0 ? (wins / totalHands * 100).toFixed(1) : '0.0';
            
            return {
                totalHands,
                totalProfit: totalProfit.toFixed(2),
                winRate,
                avgProfitPerHand: totalHands > 0 ? (totalProfit / totalHands).toFixed(2) : '0.00',
                wins,
                losses: totalHands - wins
            };
        } catch (error) {
            console.error('回退方法获取玩家核心统计数据失败:', error);
            return {
                totalHands: 0,
                totalProfit: '0.00',
                winRate: '0.0',
                avgProfitPerHand: '0.00',
                wins: 0,
                losses: 0
            };
        }
    }

    // 获取VPIP/PFR/3bet等翻前数据（使用预计算统计表）
    async function getPreflopStats(playerId) {
        try {
            const client = await ensureSupabase();
            // 从预计算统计表获取数据
            const { data, error } = await client
                .from('player_stats_summary')
                .select('vpip, pfr, three_bet, aggression_index, total_hands as sampleHands')
                .eq('player_id', playerId)
                .single();
            
            if (error) {
                console.error('从预计算统计表获取翻前数据失败，尝试使用原始方法:', error);
                // 如果预计算表中没有数据，回退到原始方法
                return await getPreflopStatsFallback(playerId);
            }
            
            if (data && (data.vpip !== null || data.total_hands !== null)) {
                return {
                    vpip: data.vpip ? data.vpip.toFixed(1) : '0.0',
                    pfr: data.pfr ? data.pfr.toFixed(1) : '0.0',
                    threeBet: data.three_bet ? data.three_bet.toFixed(1) : '0.0',
                    aggression: data.aggression_index ? data.aggression_index.toFixed(2) : '0.00',
                    sampleHands: data.sampleHands !== null && data.sampleHands !== undefined ? data.sampleHands : 0
                };
            } else {
                // 如果预计算表中没有数据，回退到原始方法
                return await getPreflopStatsFallback(playerId);
            }
        } catch (error) {
            console.error('获取翻前统计数据失败:', error);
            // 发生错误时回退到原始方法
            return await getPreflopStatsFallback(playerId);
        }
    }

    // 回退方法：使用原始查询计算翻前统计数据
    async function getPreflopStatsFallback(playerId) {
        try {
            const client = await ensureSupabase();
            // 首先获取玩家的所有牌局ID，用于计算样本大小
            const { data: gameData, error: gameError } = await client
                .from('player_positions')
                .select('game_id')
                .eq('player_id', playerId);
            
            if (gameError) throw gameError;
            
            let totalGames = 0;
            if (gameData && gameData.length > 0) {
                totalGames = gameData.length;
            }
            
            // 然后获取翻前动作数据
            const { data, error } = await client
                .from('hand_actions')
                .select('street, action_type, is_voluntary')
                .eq('player_id', playerId)
                .eq('street', 'preflop');
            
            if (error) throw error;
            
            let vpipHands = 0;  // 自愿投入底池的手牌数
            let pfrHands = 0;   // 翻前加注的手牌数
            let threeBetHands = 0; // 3bet的手牌数
            let totalPreflopHands = 0;
            
            if (data && data.length > 0) {
                // 按手牌分组统计
                data.forEach(action => {
                    if (action.is_voluntary) vpipHands++;
                    if (action.action_type === 'raise') pfrHands++;
                    // 3bet需要更复杂的逻辑检测，这里简化
                });
                
                totalPreflopHands = data.length;
            }
            
            const vpip = totalGames > 0 ? (vpipHands / totalGames * 100).toFixed(1) : '0.0';
            const pfr = totalGames > 0 ? (pfrHands / totalGames * 100).toFixed(1) : '0.0';
            
            return {
                vpip,
                pfr,
                threeBet: totalGames > 0 ? (threeBetHands / totalGames * 100).toFixed(1) : '0.0',
                aggression: vpipHands > 0 ? ((pfrHands + threeBetHands) / vpipHands).toFixed(2) : '0.00',
                sampleHands: totalGames  // 使用实际的游戏数量作为样本大小
            };
        } catch (error) {
            console.error('回退方法获取翻前统计数据失败:', error);
            return {
                vpip: '0.0',
                pfr: '0.0',
                threeBet: '0.0',
                aggression: '0.00',
                sampleHands: 0
            };
        }
    }

    // 获取位置统计数据（使用预计算统计表）
    async function getPositionStats(playerId) {
        try {
            const client = await ensureSupabase();
            // 从预计算位置统计表获取数据
            const { data, error } = await client
                .from('player_position_stats')
                .select('position, hands, profit, wins, avg_profit_per_hand, win_rate')
                .eq('player_id', playerId);
            
            if (error) {
                console.error('从预计算位置统计表获取数据失败，尝试使用原始方法:', error);
                // 如果预计算表中没有数据，回退到原始方法
                return await getPositionStatsFallback(playerId);
            }
            
            if (data && data.length > 0) {
                // 转换数据格式
                const positionStats = data.map(pos => ({
                    position: pos.position,
                    hands: pos.hands || 0,
                    profit: pos.profit ? pos.profit.toFixed(2) : '0.00',
                    winRate: pos.win_rate ? pos.win_rate.toFixed(1) : '0.0',
                    avgProfit: pos.avg_profit_per_hand ? pos.avg_profit_per_hand.toFixed(2) : '0.00'
                }));
                
                // 按标准位置顺序排序
                const positionOrder = ['UTG', 'UTG+1', 'UTG+2', 'MP', 'MP+1', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
                positionStats.sort((a, b) => {
                    const aIndex = positionOrder.indexOf(a.position);
                    const bIndex = positionOrder.indexOf(b.position);
                    if (aIndex === -1 && bIndex === -1) return a.position.localeCompare(b.position);
                    if (aIndex === -1) return 1;
                    if (bIndex === -1) return -1;
                    return aIndex - bIndex;
                });
                
                return positionStats;
            } else {
                // 如果预计算表中没有数据，回退到原始方法
                return await getPositionStatsFallback(playerId);
            }
        } catch (error) {
            console.error('获取位置统计数据失败:', error);
            // 发生错误时回退到原始方法
            return await getPositionStatsFallback(playerId);
        }
    }

    // 回退方法：使用原始查询计算位置统计数据
    async function getPositionStatsFallback(playerId) {
        try {
            const client = await ensureSupabase();
            const { data, error } = await client
                .from('player_positions')
                .select('position, net_result, is_winner')
                .eq('player_id', playerId);
            
            if (error) throw error;
            
            const positionMap = new Map();
            
            if (data && data.length > 0) {
                data.forEach(pos => {
                    const position = pos.position || 'UNKNOWN';
                    if (!positionMap.has(position)) {
                        positionMap.set(position, {
                            hands: 0,
                            profit: 0,
                            wins: 0
                        });
                    }
                    
                    const stats = positionMap.get(position);
                    stats.hands++;
                    stats.profit += pos.net_result || 0;
                    if (pos.is_winner) stats.wins++;
                });
            }
            
            // 转换为数组并计算百分比
            const positionStats = [];
            for (const [position, stats] of positionMap.entries()) {
                positionStats.push({
                    position,
                    hands: stats.hands,
                    profit: stats.profit.toFixed(2),
                    winRate: stats.hands > 0 ? (stats.wins / stats.hands * 100).toFixed(1) : 0,
                    avgProfit: stats.hands > 0 ? (stats.profit / stats.hands).toFixed(2) : 0
                });
            }
            
            // 按标准位置顺序排序
            const positionOrder = ['UTG', 'UTG+1', 'UTG+2', 'MP', 'MP+1', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
            positionStats.sort((a, b) => {
                const aIndex = positionOrder.indexOf(a.position);
                const bIndex = positionOrder.indexOf(b.position);
                if (aIndex === -1 && bIndex === -1) return a.position.localeCompare(b.position);
                if (aIndex === -1) return 1;
                if (bIndex === -1) return -1;
                return aIndex - bIndex;
            });
            
            return positionStats;
        } catch (error) {
            console.error('回退方法获取位置统计数据失败:', error);
            return [];
        }
    }

    // 获取最近手牌记录
    async function getRecentHands(playerId, limit = 20) {
        try {
            const client = await ensureSupabase();
            const { data, error } = await client
                .from('player_positions')
                .select(`
                    net_result,
                    is_winner,
                    position,
                    games (
                        hand_id,
                        total_pot,
                        played_at,
                        poker_tables (
                            table_name,
                            blinds
                        )
                    )
                `)
                .eq('player_id', playerId)
                .order('games(played_at)', { ascending: false })
                .limit(limit);
            
            if (error) throw error;
            
            const recentHands = [];
            
            if (data && data.length > 0) {
                data.forEach(pos => {
                    if (pos.games) {
                        recentHands.push({
                            handId: pos.games.hand_id,
                            date: new Date(pos.games.played_at).toLocaleDateString(),
                            time: new Date(pos.games.played_at).toLocaleTimeString(),
                            table: pos.games.poker_tables?.table_name || '未知',
                            blinds: pos.games.poker_tables?.blinds || '未知',
                            position: pos.position,
                            result: pos.net_result.toFixed(2),
                            isWinner: pos.is_winner,
                            totalPot: pos.games.total_pot
                        });
                    }
                });
            }
            
            return recentHands;
        } catch (error) {
            console.error('获取最近手牌失败:', error);
            return [];
        }
    }

    // 获取系统总体统计
    async function getSystemStats() {
        try {
            const client = await ensureSupabase();
            // 获取总手牌数
            const { count: totalHands, error: handsError } = await client
                .from('games')
                .select('*', { count: 'exact', head: true });
            
            // 获取玩家总数
            const { count: totalPlayers, error: playersError } = await client
                .from('players')
                .select('*', { count: 'exact', head: true });
            
            return {
                totalHands: totalHands || 0,
                totalPlayers: totalPlayers || 0
            };
            
        } catch (error) {
            console.error('获取系统统计失败:', error);
            return { totalHands: 0, totalPlayers: 0 };
        }
    }

    // 获取牌桌列表
    async function getTableList() {
        try {
            const client = await ensureSupabase();
            const { data, error } = await client
                .from('poker_tables')
                .select('id, table_name, blinds')
                .order('table_name');
            
            if (error) throw error;
            return data;
        } catch (error) {
            console.error('获取牌桌列表失败:', error);
            return [];
        }
    }
    
    // 获取玩家手牌范围数据
    async function getPlayerHandRangeData(playerId) {
        try {
            const client = await ensureSupabase();
            // 查询玩家在showdowns表中的数据
            const { data, error } = await client
                .from('showdowns')
                .select(`
                    hole_cards,
                    final_hand,
                    is_winner,
                    win_amount,
                    game_id,
                    created_at
                `)
                .eq('player_id', playerId)
                .limit(1000); // 限制返回数量以提高性能
    
            if (error) throw error;
            return data;
        } catch (error) {
            console.error('获取玩家手牌范围数据失败:', error);
            return [];
        }
    }    
    // 导出函数供其他文件使用
    window.supabaseClient = {
        initializeSupabase,
        ensureSupabase,
        testConnection,
        findPlayerId,
        getPlayerBasicInfo,
        getPlayerCoreStats,
        getPreflopStats,
        getPositionStats,
        getRecentHands,
        getSystemStats,
        getTableList,
        getPlayerHandRangeData
    };    // 页面加载完成后自动初始化Supabase（如果尚未初始化）
    document.addEventListener('DOMContentLoaded', async () => {
        try {
            if (window.supabaseClient && typeof window.supabaseClient.initializeSupabase === 'function') {
                await window.supabaseClient.initializeSupabase();
            }
            console.log('Supabase客户端初始化成功');
        } catch (error) {
            console.error('Supabase客户端初始化失败:', error);
        }
    });
}