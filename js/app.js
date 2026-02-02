// 全局状态
let currentPlayer = null;
let isLoading = false;

// DOM 元素引用
const loadingOverlay = document.getElementById('loadingOverlay');
const loadingMessage = document.getElementById('loadingMessage');

// 显示/隐藏加载状态
function showLoading(message = '加载中...') {
    isLoading = true;
    if (loadingMessage) loadingMessage.textContent = message;
    if (loadingOverlay) loadingOverlay.classList.remove('hidden');
}

function hideLoading() {
    isLoading = false;
    if (loadingOverlay) loadingOverlay.classList.add('hidden');
}

// 更新系统统计
async function updateSystemStats() {
    try {
        // 确保Supabase客户端已初始化
        let attempts = 0;
        const maxAttempts = 50; // 最多等待5秒 (50 * 100ms)
        while ((!window.supabaseClient || typeof window.supabaseClient.ensureSupabase !== 'function') && attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
        }
        
        if (!window.supabaseClient || typeof window.supabaseClient.ensureSupabase !== 'function') {
            console.warn('Supabase客户端未初始化，显示默认值');
            // 即使客户端未初始化，也显示默认值
            document.getElementById('totalHands').textContent = '0';
            document.getElementById('totalPlayers').textContent = '0';
            return;
        }
        
        // 确保Supabase已初始化
        const client = await window.supabaseClient.ensureSupabase();
        
        // 直接查询数据库获取最新数据
        const [handsResult, playersResult] = await Promise.allSettled([
            client.from('games').select('count', { count: 'exact', head: true }),
            client.from('players').select('count', { count: 'exact', head: true })
        ]);
        
        const totalHands = handsResult.status === 'fulfilled' ? handsResult.value.count || 0 : 0;
        const totalPlayers = playersResult.status === 'fulfilled' ? playersResult.value.count || 0 : 0;
        
        document.getElementById('totalHands').textContent = totalHands.toLocaleString();
        document.getElementById('totalPlayers').textContent = totalPlayers.toLocaleString();
    } catch (error) {
        console.error('更新系统统计失败:', error);
        // 出错时显示默认值
        document.getElementById('totalHands').textContent = '0';
        document.getElementById('totalPlayers').textContent = '0';
    }
}

// 加载最近查询的玩家
function loadRecentPlayers() {
    try {
        const recentPlayers = JSON.parse(localStorage.getItem('poker_recent_players') || '[]');
        
        if (recentPlayers.length > 0) {
            const container = document.getElementById('recentPlayers');
            const list = document.getElementById('recentPlayersList');
            
            if (container && list) {
                container.classList.remove('hidden');
                list.innerHTML = '';
                
                recentPlayers.slice(0, 5).forEach(playerName => {
                    const button = document.createElement('button');
                    button.className = 'px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors';
                    button.textContent = playerName;
                    button.onclick = () => {
                        document.getElementById('playerSearch').value = playerName;
                        searchPlayer();
                    };
                    list.appendChild(button);
                });
            }
        }
    } catch (error) {
        console.error('加载最近玩家失败:', error);
    }
}

// 保存到最近查询
function saveToRecentPlayers(playerName) {
    try {
        let recentPlayers = JSON.parse(localStorage.getItem('poker_recent_players') || '[]');
        
        // 移除已存在的
        recentPlayers = recentPlayers.filter(name => name !== playerName);
        
        // 添加到开头
        recentPlayers.unshift(playerName);
        
        // 限制数量
        if (recentPlayers.length > 10) {
            recentPlayers = recentPlayers.slice(0, 10);
        }
        
        localStorage.setItem('poker_recent_players', JSON.stringify(recentPlayers));
    } catch (error) {
        console.error('保存最近玩家失败:', error);
    }
}

// 搜索玩家（首页使用）
function searchPlayer() {
    const playerName = document.getElementById('playerSearch').value.trim();
    if (!playerName) {
        alert('请输入玩家用户名');
        return;
    }
    
    saveToRecentPlayers(playerName);
    window.location.href = `player.html?player=${encodeURIComponent(playerName)}`;
}

// 当前数据查询范围
let currentDataRange = 'total';
let currentTableId = null;

// 玩家详情页初始化
async function initPlayerPage() {
    try {
        showLoading('正在查询玩家信息...');
        
        // 从URL获取玩家名
        const urlParams = new URLSearchParams(window.location.search);
        const playerName = urlParams.get('player');
        
        if (!playerName) {
            window.location.href = 'index.html';
            return;
        }
        
        // 设置页面标题
        document.title = `${playerName} - 扑克数据追踪器`;
        
        // 显示玩家名
        const playerNameElement = document.getElementById('playerName');
        if (playerNameElement) {
            playerNameElement.textContent = playerName;
        }
        
        // 查找玩家ID
        loadingMessage.textContent = '正在查找玩家ID...';
        const playerInfo = await window.supabaseClient.findPlayerId(playerName);
        
        if (!playerInfo || !playerInfo.id) {
            hideLoading();
            showErrorMessage(`未找到玩家 "${playerName}"`);
            return;
        }
        
        currentPlayer = playerInfo;
        
        // 如果有建议的玩家名（模糊匹配）
        if (playerInfo.suggestions && playerInfo.suggestions.length > 0 && !playerInfo.exactMatch) {
            showSuggestions(playerInfo.suggestions, playerName);
        }
        
        // 加载玩家数据
        await loadPlayerData(playerInfo.id);
        
        hideLoading();
        
    } catch (error) {
        console.error('初始化玩家页面失败:', error);
        hideLoading();
        showErrorMessage('加载失败，请刷新重试');
    }
}

// 显示建议的玩家名
function showSuggestions(suggestions, originalName) {
    const suggestionDiv = document.createElement('div');
    suggestionDiv.className = 'bg-yellow-900 border border-yellow-700 rounded-lg p-4 mb-6';
    
    let html = `<p class="font-bold mb-2">未找到精确匹配的玩家 "${originalName}"，你是不是想查询：</p>`;
    html += '<div class="flex flex-wrap gap-2">';
    
    suggestions.forEach(suggestion => {
        html += `<button class="px-3 py-1 bg-yellow-800 hover:bg-yellow-700 rounded transition-colors" 
                 onclick="selectSuggestion('${suggestion}')">${suggestion}</button>`;
    });
    
    html += '</div>';
    suggestionDiv.innerHTML = html;
    
    const container = document.getElementById('playerDataContainer');
    if (container) {
        container.insertBefore(suggestionDiv, container.firstChild);
    }
}

// 选择建议的玩家
function selectSuggestion(playerName) {
    window.location.href = `player.html?player=${encodeURIComponent(playerName)}`;
}

// 加载玩家数据
async function loadPlayerData(playerId) {
    try {
        // 并行加载所有数据
        loadingMessage.textContent = '正在加载玩家统计数据...';
        
        const [
            playerStats,
            recentHands,
            positionStats,
            handRangeData
        ] = await Promise.all([
            window.pokerCache.getPlayerStats(playerId),
            window.pokerCache.getPlayerRecentHands(playerId, 20),
            window.supabaseClient.getPositionStats(playerId),
            window.pokerCache.getPlayerHandRangeData(playerId)
        ]);
        
        // 渲染数据
        renderPlayerStats(playerStats);
        renderRecentHands(recentHands);
        renderPositionStats(positionStats);
        renderHandRangeGrid(handRangeData);
        
    } catch (error) {
        console.error('加载玩家数据失败:', error);
        throw error;
    }
}

// 渲染玩家统计数据
function renderPlayerStats(data) {
    if (!data) {
        console.error('没有数据可以渲染');
        return;
    }
    
    const container = document.getElementById('playerDataContainer');
    if (!container) return;
    
    let html = '';
    
    // 基本信息卡片
    html += `
        <div class="bg-gray-800 rounded-2xl p-6 mb-6 border border-gray-700">
            <h3 class="text-xl font-bold mb-4">基本信息</h3>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                    <p class="text-gray-400 text-sm">玩家名</p>
                    <p class="text-lg font-bold">${data.basicInfo?.username || '未知'}</p>
                </div>
                <div>
                    <p class="text-gray-400 text-sm">注册时间</p>
                    <p class="text-lg">${data.basicInfo?.created_at ? new Date(data.basicInfo.created_at).toLocaleDateString() : '未知'}</p>
                </div>
                <div>
                    <p class="text-gray-400 text-sm">最后更新</p>
                    <p class="text-lg">${new Date(data.lastUpdated).toLocaleString()}</p>
                </div>
                <div>
                    <p class="text-gray-400 text-sm">数据来源</p>
                    <p class="text-lg">${data.coreStats && data.coreStats.totalHands !== undefined && data.coreStats.totalHands !== null && data.coreStats.totalHands > 0 ? data.coreStats.totalHands : (data.preflopStats && data.preflopStats.sampleHands !== undefined && data.preflopStats.sampleHands !== null && data.preflopStats.sampleHands > 0 ? data.preflopStats.sampleHands : 0)} 手样本</p>
                </div>
            </div>
        </div>
    `;
    
    // 核心统计卡片（HUD风格）
    if (data.coreStats) {
        console.log('渲染核心统计数据:', data.coreStats);
        const profitColor = parseFloat(data.coreStats.totalProfit) >= 0 ? 'text-green-400' : 'text-red-400';
        const profitIcon = parseFloat(data.coreStats.totalProfit) >= 0 ? '📈' : '📉';
        
        html += `
            <div class="bg-gray-800 rounded-2xl p-6 mb-6 border border-gray-700">
                <h3 class="text-xl font-bold mb-4">核心统计</h3>
                <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                    <div class="text-center p-4 bg-gray-900 rounded-xl">
                        <p class="text-gray-400 text-sm">总手数</p>
                        <p class="text-2xl font-bold">${(data.coreStats.totalHands || 0).toLocaleString()}</p>
                    </div>
                    <div class="text-center p-4 bg-gray-900 rounded-xl">
                        <p class="text-gray-400 text-sm">总盈利(BB)</p>
                        <p class="text-2xl font-bold ${profitColor}">${profitIcon} ${data.coreStats.totalProfit}</p>
                    </div>
                    <div class="text-center p-4 bg-gray-900 rounded-xl">
                        <p class="text-gray-400 text-sm">胜率</p>
                        <p class="text-2xl font-bold">${data.coreStats.winRate}%</p>
                    </div>
                    <div class="text-center p-4 bg-gray-900 rounded-xl">
                        <p class="text-gray-400 text-sm">平均盈利/手</p>
                        <p class="text-2xl font-bold ${parseFloat(data.coreStats.avgProfitPerHand) >= 0 ? 'text-green-400' : 'text-red-400'}">${data.coreStats.avgProfitPerHand}</p>
                    </div>
                    <div class="text-center p-4 bg-gray-900 rounded-xl">
                        <p class="text-gray-400 text-sm">获胜</p>
                        <p class="text-2xl font-bold text-green-400">${data.coreStats.wins}</p>
                    </div>
                    <div class="text-center p-4 bg-gray-900 rounded-xl">
                        <p class="text-gray-400 text-sm">失利</p>
                        <p class="text-2xl font-bold text-red-400">${data.coreStats.losses}</p>
                    </div>
                </div>
            </div>
        `;
    }
    
    // 翻前统计卡片（专业HUD数据）
    if (data.preflopStats) {
        console.log('渲染翻前统计数据:', data.preflopStats);
        const vpipClass = getStatClass(parseFloat(data.preflopStats.vpip), 18, 25);
        const pfrClass = getStatClass(parseFloat(data.preflopStats.pfr), 12, 18);
        
        html += `
            <div class="bg-gray-800 rounded-2xl p-6 mb-6 border border-gray-700">
                <h3 class="text-xl font-bold mb-4">翻前统计 (${data.preflopStats.sampleHands || 0}手样本)</h3>
                <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div class="text-center p-4 bg-gray-900 rounded-xl">
                        <p class="text-gray-400 text-sm">VPIP</p>
                        <p class="text-3xl font-bold ${vpipClass}">${data.preflopStats.vpip}%</p>
                        <p class="text-xs text-gray-500 mt-1">自愿投入底池</p>
                    </div>
                    <div class="text-center p-4 bg-gray-900 rounded-xl">
                        <p class="text-gray-400 text-sm">PFR</p>
                        <p class="text-3xl font-bold ${pfrClass}">${data.preflopStats.pfr}%</p>
                        <p class="text-xs text-gray-500 mt-1">翻前加注</p>
                    </div>
                    <div class="text-center p-4 bg-gray-900 rounded-xl">
                        <p class="text-gray-400 text-sm">3Bet</p>
                        <p class="text-3xl font-bold">${data.preflopStats.threeBet}%</p>
                        <p class="text-xs text-gray-500 mt-1">三次下注</p>
                    </div>
                    <div class="text-center p-4 bg-gray-900 rounded-xl">
                        <p class="text-gray-400 text-sm">Agg</p>
                        <p class="text-3xl font-bold">${data.preflopStats.aggression}</p>
                        <p class="text-xs text-gray-500 mt-1">激进指数</p>
                    </div>
                </div>
            </div>
        `;
    }
    
    container.innerHTML = html;
}

    // 根据数值获取CSS类（用于HUD颜色编码）
function getStatClass(value, low, high) {
    const numValue = parseFloat(value);
    if (numValue < low) return 'text-blue-400';      // 过紧
    if (numValue > high) return 'text-red-400';      // 过松
    return 'text-green-400';                         // 正常范围
}

// 渲染最近手牌
function renderRecentHands(hands) {
    if (!hands || hands.length === 0) return;
    
    const container = document.getElementById('recentHandsContainer');
    if (!container) return;
    
    let html = `
        <div class="bg-gray-800 rounded-2xl p-6 mb-6 border border-gray-700">
            <div class="flex justify-between items-center mb-4">
                <h3 class="text-xl font-bold">最近手牌记录</h3>
                <span class="text-gray-400 text-sm">共${hands.length}手牌</span>
            </div>
            <div class="overflow-x-auto">
                <table class="w-full">
                    <thead>
                        <tr class="text-left text-gray-400 border-b border-gray-700">
                            <th class="pb-3 px-2">时间</th>
                            <th class="pb-3 px-2">牌桌</th>
                            <th class="pb-3 px-2">位置</th>
                            <th class="pb-3 px-2">结果(BB)</th>
                            <th class="pb-3 px-2">总池(BB)</th>
                            <th class="pb-3 px-2">手牌ID</th>
                        </tr>
                    </thead>
                    <tbody>
    `;
    
    hands.forEach(hand => {
        const resultColor = hand.isWinner ? 'text-green-400' : 'text-red-400';
        const resultIcon = hand.isWinner ? '🏆' : '💸';
        
        html += `
            <tr class="border-b border-gray-700 hover:bg-gray-750 transition-colors">
                <td class="py-3 px-2">
                    <div class="text-sm">${hand.date}</div>
                    <div class="text-xs text-gray-500">${hand.time}</div>
                </td>
                <td class="py-3 px-2">
                    <div class="font-medium">${hand.table}</div>
                    <div class="text-xs text-gray-500">${hand.blinds}</div>
                </td>
                <td class="py-3 px-2">
                    <span class="px-2 py-1 bg-gray-700 rounded text-xs">${hand.position}</span>
                </td>
                <td class="py-3 px-2">
                    <span class="${resultColor} font-bold">${resultIcon} ${hand.result}</span>
                </td>
                <td class="py-3 px-2">${hand.totalPot}</td>
                <td class="py-3 px-2">
                    <span class="text-xs text-gray-500 font-mono">${hand.handId.substring(0, 8)}...</span>
                </td>
            </tr>
        `;
    });
    
    html += `
                    </tbody>
                </table>
            </div>
        </div>
    `;
    
    container.innerHTML = html;
}
// 渲染手牌范围网格
function renderHandRangeGrid(data) {
    if (!data) return;
    
    const container = document.getElementById('handRangeGrid');
    if (!container) return;
    
    // 创建2D网格数据结构 (13x13)
    const grid = [];
    for (let i = 0; i < 13; i++) {
        grid[i] = [];
        for (let j = 0; j < 13; j++) {
            grid[i][j] = { limps: 0, raises: 0, calls: 0, total: 0 };
        }
    }
    
    // 填充网格数据
    for (const hand of data) {
        const { row, col } = getGridPosition(hand.hole_cards);
        if (row !== -1 && col !== -1) {
            // 确保索引在范围内
            if (row >= 0 && row < 13 && col >= 0 && col < 13) {
                // 根据动作类型更新计数
                if (hand.action_type === 'raise' || hand.action_type === '3bet' || hand.action_type === '4bet' || hand.action_type === 'all_in') {
                    grid[row][col].raises += 1;
                } else if (hand.action_type === 'call') {
                    grid[row][col].calls += 1;
                } else if (hand.action_type === 'fold') {
                    grid[row][col].limps += 1;
                } else if (hand.action_type === '') {
                    // 没有关联的动作，可能是limp
                    grid[row][col].limps += 1;
                } else {
                    // 其他情况也视为limp（没有加注前的跟注或开局跟注）
                    grid[row][col].limps += 1;
                }
                grid[row][col].total += 1;
            }
        }
    }
    
    // 生成网格HTML - 添加CSS样式以确保表格为正方形
    let html = `
    <div class="hand-range-container" style="display: inline-block; overflow-x: auto; padding: 10px; background: #1f2937; border-radius: 0.5rem;">
      <table style="border-collapse: collapse; border: 1px solid #4b5563;">
        <thead>
          <tr style="height: 40px;">
            <th style="width: 40px; height: 40px; border: 1px solid #4b5563; text-align: center; vertical-align: middle; font-size: 0.75rem; color: #d1d5db;"></th>`;
    
    // 添加顶部标签 (A, K, Q, J, T, 9, 8, 7, 6, 5, 4, 3, 2)
    const ranks = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
    for (let j = 0; j < 13; j++) {
        html += `<th style="width: 40px; height: 40px; border: 1px solid #4b5563; text-align: center; vertical-align: middle; font-size: 0.75rem; color: #d1d5db;">${ranks[j]}</th>`;
    }
    html += '</tr></thead><tbody>';
    
    for (let i = 0; i < 13; i++) {
        html += `<tr style="height: 40px;">`;
        // 添加左侧标签
        html += `<th style="width: 40px; height: 40px; border: 1px solid #4b5563; text-align: center; vertical-align: middle; font-size: 0.75rem; color: #d1d5db;">${ranks[i]}</th>`;
        for (let j = 0; j < 13; j++) {
            const cell = grid[i][j];
            let cellStyle = 'width: 40px; height: 40px; border: 1px solid #4b5563; text-align: center; vertical-align: middle; font-size: 0.65rem; ';
            
            if (cell.total > 0) {
                // 计算各种动作的比例
                const limpRatio = cell.limps / cell.total;
                const raiseRatio = cell.raises / cell.total;
                const callRatio = cell.calls / cell.total;
                
                if (raiseRatio > 0 && limpRatio > 0) {
                    // 混合颜色 - 使用渐变来显示raise(红)和limp(绿)的比例
                    const raisePercent = Math.round(raiseRatio * 100);
                    cellStyle += `background: linear-gradient(135deg, #dc2626 ${raisePercent}%, #16a34a ${raisePercent}%);`;
                } else if (raiseRatio > 0) {
                    // 主要是加注 - 红色
                    cellStyle += 'background-color: #dc2626;'; // red-600
                } else if (limpRatio > 0) {
                    // 主要是limp - 绿色
                    cellStyle += 'background-color: #16a34a;'; // green-600
                } else if (callRatio > 0) {
                    // 主要是跟注 - 蓝色
                    cellStyle += 'background-color: #2563eb;'; // blue-600
                } else {
                    cellStyle += 'background-color: #374151;'; // gray-700
                }
            } else {
                cellStyle += 'background-color: #1f2937;'; // gray-800
            }
            
            html += `<td style="${cellStyle}" title="${getHandNotation(i, j)}: ${cell.total}手 (R:${cell.raises}, L:${cell.limps}, C:${cell.calls})">${getHandNotation(i, j)}</td>`;
        }
        html += '</tr>';
    }
    html += '</tbody></table></div>';
    
    container.innerHTML = html;
}

// 根据手牌获取网格位置
function getGridPosition(holeCards) {
    if (!holeCards || holeCards.length < 2) return { row: -1, col: -1 };
    
    const ranks = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
    // 提取前两个字符作为牌面（忽略花色）
    const card1Rank = holeCards[0].toUpperCase();
    const card2Rank = holeCards[1].toUpperCase();
    
    // 确保是有效牌面
    if (!ranks.includes(card1Rank) || !ranks.includes(card2Rank)) {
        return { row: -1, col: -1 };
    }
    
    const rank1Index = ranks.indexOf(card1Rank);
    const rank2Index = ranks.indexOf(card2Rank);
    
    // 对子：主对角线
    if (card1Rank === card2Rank) {
        return { row: rank1Index, col: rank2Index };
    } 
    // 同花：上三角（row < col）
    else if (holeCards.toLowerCase().includes('s') || (holeCards.length >= 4 && holeCards[2] === holeCards[3])) {
        // 确保同花牌位于上三角：较小的牌面值作为行，较大的作为列
        const minIndex = Math.min(rank1Index, rank2Index);
        const maxIndex = Math.max(rank1Index, rank2Index);
        return { row: minIndex, col: maxIndex };
    } 
    // 非同花：下三角（row > col）
    else {
        // 确保非同花牌位于下三角：较大的牌面值作为行，较小的作为列
        const minIndex = Math.min(rank1Index, rank2Index);
        const maxIndex = Math.max(rank1Index, rank2Index);
        return { row: maxIndex, col: minIndex };
    }
}

// 获取手牌表示法
function getHandNotation(row, col) {
    const ranks = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
    if (row === col) {
        return `${ranks[row]}${ranks[col]}`; // 对子
    } else if (row < col) {
        return `${ranks[row]}${ranks[col]}s`; // 同花
    } else {
        return `${ranks[row]}${ranks[col]}o`; // 非同花
    }
}

// 渲染位置统计
function renderPositionStats(positionStats) {
    if (!positionStats || positionStats.length === 0) return;
    
    const container = document.getElementById('positionStatsContainer');
    if (!container) return;
    
    let html = `
        <div class="bg-gray-800 rounded-2xl p-6 mb-6 border border-gray-700">
            <h3 class="text-xl font-bold mb-4">位置统计</h3>
            <div class="overflow-x-auto">
                <table class="w-full">
                    <thead>
                        <tr class="text-left text-gray-400 border-b border-gray-700">
                            <th class="pb-3 px-2">位置</th>
                            <th class="pb-3 px-2">手数</th>
                            <th class="pb-3 px-2">盈利(BB)</th>
                            <th class="pb-3 px-2">胜率</th>
                            <th class="pb-3 px-2">平均/手</th>
                        </tr>
                    </thead>
                    <tbody>
    `;
    
    positionStats.forEach(pos => {
        const avgProfitColor = parseFloat(pos.avgProfit) >= 0 ? 'text-green-400' : 'text-red-400';
        const totalProfitColor = parseFloat(pos.profit) >= 0 ? 'text-green-400' : 'text-red-400';
        
        html += `
            <tr class="border-b border-gray-700 hover:bg-gray-750 transition-colors">
                <td class="py-3 px-2">
                    <span class="px-3 py-1 bg-gray-700 rounded-lg font-medium">${pos.position}</span>
                </td>
                <td class="py-3 px-2">${pos.hands}</td>
                <td class="py-3 px-2">
                    <span class="${totalProfitColor} font-bold">${pos.profit}</span>
                </td>
                <td class="py-3 px-2">${pos.winRate}%</td>
                <td class="py-3 px-2">
                    <span class="${avgProfitColor}">${pos.avgProfit}</span>
                </td>
            </tr>
        `;
    });
    
    // 总计行
    const totalHands = positionStats.reduce((sum, pos) => sum + pos.hands, 0);
    const totalProfit = positionStats.reduce((sum, pos) => sum + parseFloat(pos.profit), 0).toFixed(2);
    const totalProfitColor = totalProfit >= 0 ? 'text-green-400' : 'text-red-400';
    
    html += `
                        <tr class="font-bold bg-gray-750">
                            <td class="py-3 px-2">总计</td>
                            <td class="py-3 px-2">${totalHands}</td>
                            <td class="py-3 px-2 ${totalProfitColor}">${totalProfit}</td>
                            <td class="py-3 px-2">-</td>
                            <td class="py-3 px-2">-</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    `;
    
    container.innerHTML = html;
}

// 显示错误消息
function showErrorMessage(message) {
    const container = document.getElementById('playerDataContainer');
    if (container) {
        container.innerHTML = `
            <div class="text-center py-12">
                <div class="text-5xl mb-4">😕</div>
                <h3 class="text-2xl font-bold mb-2">${message}</h3>
                <p class="text-gray-400 mb-6">请检查玩家名是否正确，或返回首页重试</p>
                <a href="index.html" class="px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors">
                    返回首页
                </a>
            </div>
        `;
    }
}

// 刷新数据
async function refreshData() {
    if (!currentPlayer || isLoading) return;
    
    showLoading('刷新数据中...');
    
    try {
        // 清除缓存
        window.pokerCache.clearCache('player_stats', currentPlayer.id);
        window.pokerCache.clearCache('recent_hands', currentPlayer.id, 20);
        window.pokerCache.clearCache('hand_range_data', currentPlayer.id);
        
        // 重新加载数据
        await loadPlayerData(currentPlayer.id);
        
        // 显示成功消息
        showToast('数据刷新成功！');
        
    } catch (error) {
        console.error('刷新数据失败:', error);
        showToast('刷新失败，请重试', 'error');
    } finally {
        hideLoading();
    }
}

// 获取手牌范围数据
async function getHandRangeData(playerId) {
    try {
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
    } catch (error) {
        console.error('获取手牌范围数据失败:', error);
        return [];
    }
}

// 显示提示消息
function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `fixed bottom-4 right-4 px-6 py-3 rounded-lg shadow-lg z-50 ${
        type === 'success' ? 'bg-green-600' : 'bg-red-600'
    }`;
    toast.textContent = message;
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s';
        setTimeout(() => toast.remove(), 3000);
    }, 3000);
}

// 加载桌子列表
async function loadTableList() {
    try {
        // 确保Supabase客户端已初始化
        let attempts = 0;
        const maxAttempts = 50;
        while ((!window.supabaseClient || typeof window.supabaseClient.getTableList !== 'function') && attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
        }
        
        if (!window.supabaseClient || typeof window.supabaseClient.getTableList !== 'function') {
            throw new Error('Supabase客户端未能初始化或getTableList函数不可用');
        }
        
        const tables = await window.supabaseClient.getTableList();
        const tableSelect = document.getElementById('tableSelect');
        
        // 清空选择框并添加选项
        tableSelect.innerHTML = '<option value="">请选择桌子</option>';
        
        if (tables && tables.length > 0) {
            tables.forEach(table => {
                const option = document.createElement('option');
                option.value = table.id;
                option.textContent = `${table.table_name} (${table.blinds})`;
                tableSelect.appendChild(option);
            });
        } else {
            const option = document.createElement('option');
            option.textContent = '暂无桌子数据';
            tableSelect.appendChild(option);
        }
    } catch (error) {
        console.error('加载桌子列表失败:', error);
    }
}

// 更新数据范围UI
function updateDataRangeUI() {
    const dataRangeSelect = document.getElementById('dataRangeSelect');
    const tableSelectContainer = document.getElementById('tableSelectContainer');
    
    if (dataRangeSelect.value === 'table') {
        tableSelectContainer.classList.remove('hidden');
    } else {
        tableSelectContainer.classList.add('hidden');
    }
}

// 监听数据范围选择变化
document.addEventListener('DOMContentLoaded', function() {
    const dataRangeSelect = document.getElementById('dataRangeSelect');
    if (dataRangeSelect) {
        dataRangeSelect.addEventListener('change', function() {
            updateDataRangeUI();
        });
    }
});

// 获取玩家近100手统计数据
async function getPlayerStatsLast100(playerId) {
    try {
        // 确保Supabase客户端已初始化
        let attempts = 0;
        const maxAttempts = 50;
        while ((!window.supabaseClient || typeof window.supabaseClient.ensureSupabase !== 'function') && attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
        }
        
        if (!window.supabaseClient || typeof window.supabaseClient.ensureSupabase !== 'function') {
            throw new Error('Supabase客户端未能初始化');
        }
        
        const client = await window.supabaseClient.ensureSupabase();
        
        // 获取玩家最近的100手牌数据
        const { data: positionData, error: positionError } = await client
            .from('player_positions')
            .select('net_result, is_winner')
            .eq('player_id', playerId)
            .order('games(played_at)', { ascending: false })
            .limit(100);
        
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
        
        const winRate = totalHands > 0 ? (wins / totalHands * 100).toFixed(1) : 0;
        
        // 获取翻前统计数据 (近100手)
        const { data: preflopData, error: preflopError } = await client
            .from('hand_actions')
            .select('street, action_type, is_voluntary')
            .eq('player_id', playerId)
            .eq('street', 'preflop')
            .in('game_id', positionData.map(pos => pos.game_id))
            .limit(100);
        
        let vpipHands = 0;
        let pfrHands = 0;
        let threeBetHands = 0;
        let totalPreflopHands = 0;
        
        if (preflopData && preflopData.length > 0) {
            totalPreflopHands = preflopData.length;
            preflopData.forEach(action => {
                if (action.is_voluntary) vpipHands++;
                if (action.action_type === 'raise') pfrHands++;
                // 简化的3bet计算
            });
        }
        
        const vpip = totalPreflopHands > 0 ? (vpipHands / totalPreflopHands * 100).toFixed(1) : 0;
        const pfr = totalPreflopHands > 0 ? (pfrHands / totalPreflopHands * 100).toFixed(1) : 0;
        
        return {
            basicInfo: await window.supabaseClient.getPlayerBasicInfo(playerId),
            coreStats: {
                totalHands,
                totalProfit: totalProfit.toFixed(2),
                winRate,
                avgProfitPerHand: totalHands > 0 ? (totalProfit / totalHands).toFixed(2) : 0,
                wins,
                losses: totalHands - wins
            },
            preflopStats: {
                vpip,
                pfr,
                threeBet: threeBetHands > 0 ? (threeBetHands / totalPreflopHands * 100).toFixed(1) : 0,
                aggression: pfrHands > 0 ? ((pfrHands + threeBetHands) / vpipHands).toFixed(2) : 0,
                sampleHands: totalPreflopHands
            },
            positionStats: null, // 位置统计会单独获取
            lastUpdated: new Date().toISOString()
        };
    } catch (error) {
        console.error('获取玩家近100手数据失败:', error);
        return null;
    }
}

// 获取玩家特定桌子的统计数据
async function getPlayerStatsByTable(playerId, tableId) {
    try {
        // 确保Supabase客户端已初始化
        let attempts = 0;
        const maxAttempts = 50;
        while ((!window.supabaseClient || typeof window.supabaseClient.ensureSupabase !== 'function') && attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
        }
        
        if (!window.supabaseClient || typeof window.supabaseClient.ensureSupabase !== 'function') {
            throw new Error('Supabase客户端未能初始化');
        }
        
        const client = await window.supabaseClient.ensureSupabase();
        
        // 获取在特定桌子的游戏ID
        const { data: gameIds, error: gamesError } = await client
            .from('games')
            .select('id')
            .eq('table_id', tableId);
        
        if (gamesError) throw gamesError;
        
        if (!gameIds || gameIds.length === 0) {
            // 如果该桌子没有游戏，则返回空数据
            return {
                basicInfo: await window.supabaseClient.getPlayerBasicInfo(playerId),
                coreStats: {
                    totalHands: 0,
                    totalProfit: '0.00',
                    winRate: '0.0',
                    avgProfitPerHand: '0.00',
                    wins: 0,
                    losses: 0
                },
                preflopStats: {
                    vpip: '0.0',
                    pfr: '0.0',
                    threeBet: '0.0',
                    aggression: '0.00',
                    sampleHands: 0
                },
                positionStats: null,
                lastUpdated: new Date().toISOString()
            };
        }
        
        const gameIdsList = gameIds.map(game => game.id);
        
        // 获取玩家在该桌子的数据
        const { data: positionData, error: positionError } = await client
            .from('player_positions')
            .select('net_result, is_winner')
            .eq('player_id', playerId)
            .in('game_id', gameIdsList);
        
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
        
        const winRate = totalHands > 0 ? (wins / totalHands * 100).toFixed(1) : 0;
        
        // 获取翻前统计数据 (特定桌子)
        const { data: preflopData, error: preflopError } = await client
            .from('hand_actions')
            .select('street, action_type, is_voluntary')
            .eq('player_id', playerId)
            .eq('street', 'preflop')
            .in('game_id', gameIdsList);
        
        let vpipHands = 0;
        let pfrHands = 0;
        let threeBetHands = 0;
        let totalPreflopHands = 0;
        
        if (preflopData && preflopData.length > 0) {
            totalPreflopHands = preflopData.length;
            preflopData.forEach(action => {
                if (action.is_voluntary) vpipHands++;
                if (action.action_type === 'raise') pfrHands++;
                // 简化的3bet计算
            });
        }
        
        const vpip = totalPreflopHands > 0 ? (vpipHands / totalPreflopHands * 100).toFixed(1) : 0;
        const pfr = totalPreflopHands > 0 ? (pfrHands / totalPreflopHands * 100).toFixed(1) : 0;
        
        return {
            basicInfo: await window.supabaseClient.getPlayerBasicInfo(playerId),
            coreStats: {
                totalHands,
                totalProfit: totalProfit.toFixed(2),
                winRate,
                avgProfitPerHand: totalHands > 0 ? (totalProfit / totalHands).toFixed(2) : 0,
                wins,
                losses: totalHands - wins
            },
            preflopStats: {
                vpip,
                pfr,
                threeBet: threeBetHands > 0 ? (threeBetHands / totalPreflopHands * 100).toFixed(1) : 0,
                aggression: pfrHands > 0 ? ((pfrHands + threeBetHands) / vpipHands).toFixed(2) : 0,
                sampleHands: totalPreflopHands
            },
            positionStats: null, // 位置统计会单独获取
            lastUpdated: new Date().toISOString()
        };
    } catch (error) {
        console.error('获取玩家特定桌子数据失败:', error);
        return null;
    }
}

// 获取玩家近100手的位置统计数据
async function getPlayerPositionStatsLast100(playerId) {
    try {
        // 确保Supabase客户端已初始化
        let attempts = 0;
        const maxAttempts = 50;
        while ((!window.supabaseClient || typeof window.supabaseClient.ensureSupabase !== 'function') && attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
        }
        
        if (!window.supabaseClient || typeof window.supabaseClient.ensureSupabase !== 'function') {
            throw new Error('Supabase客户端未能初始化');
        }
        
        const client = await window.supabaseClient.ensureSupabase();
        
        // 获取玩家最近100手的位置数据
        const { data, error } = await client
            .from('player_positions')
            .select('position, net_result, is_winner')
            .eq('player_id', playerId)
            .order('games(played_at)', { ascending: false })
            .limit(100);
        
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
        console.error('获取玩家近100手位置统计数据失败:', error);
        return [];
    }
}

// 获取玩家特定桌子的位置统计数据
async function getPlayerPositionStatsByTable(playerId, tableId) {
    try {
        // 确保Supabase客户端已初始化
        let attempts = 0;
        const maxAttempts = 50;
        while ((!window.supabaseClient || typeof window.supabaseClient.ensureSupabase !== 'function') && attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
        }
        
        if (!window.supabaseClient || typeof window.supabaseClient.ensureSupabase !== 'function') {
            throw new Error('Supabase客户端未能初始化');
        }
        
        const client = await window.supabaseClient.ensureSupabase();
        
        // 获取在特定桌子的游戏ID
        const { data: gameIds, error: gamesError } = await client
            .from('games')
            .select('id')
            .eq('table_id', tableId);
        
        if (gamesError) throw gamesError;
        
        if (!gameIds || gameIds.length === 0) {
            return [];
        }
        
        const gameIdsList = gameIds.map(game => game.id);
        
        // 获取玩家在该桌子的位置数据
        const { data, error } = await client
            .from('player_positions')
            .select('position, net_result, is_winner')
            .eq('player_id', playerId)
            .in('game_id', gameIdsList);
        
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
        console.error('获取玩家特定桌子位置统计数据失败:', error);
        return [];
    }
}

// 手动更新玩家统计
async function updatePlayerStats() {
    if (!currentPlayer || isLoading) return;
    
    showLoading('正在更新玩家统计...');
    
    try {
        // 调用后端函数更新统计
        const client = await window.supabaseClient.ensureSupabase();
        
        // 通过 Supabase Edge Function 或 RPC 调用更新统计的函数
        // 这里我们直接调用数据库函数
        const { data, error } = await client.rpc('update_player_stats', {
            p_player_id: currentPlayer.id
        });
        
        if (error) {
            console.error('更新玩家总体统计失败:', error);
            // 尝试更新位置统计作为备选
            try {
                await client.rpc('update_player_position_stats', {
                    p_player_id: currentPlayer.id
                });
            } catch (posError) {
                console.error('更新位置统计也失败:', posError);
            }
        }
        
        // 强制清除所有相关缓存
        window.pokerCache.clearCache('player_stats', currentPlayer.id);
        window.pokerCache.clearCache('recent_hands', currentPlayer.id, 20);
        window.pokerCache.clearCache('hand_range_data', currentPlayer.id);
        
        // 额外延迟确保数据库更新完成
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // 重新加载数据
        await loadPlayerData(currentPlayer.id);
        
        // 显示成功消息
        showToast('玩家统计更新成功！', 'success');
        
    } catch (error) {
        console.error('更新玩家统计失败:', error);
        showToast('更新失败，请重试', 'error');
    } finally {
        hideLoading();
    }
}

// 导出函数供HTML调用
window.initPlayerPage = initPlayerPage;
window.refreshData = refreshData;
window.updatePlayerStats = updatePlayerStats;
