// ==UserScript==
// @name         VPIP数据上传插件
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  牌局记录生成与数据上传一体化插件，支持本地查看和批量上传
// @author       You
// @match        https://www.torn.com/page.php?sid=holdem*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @connect      supabase.co
// @connect      *.supabase.co
// ==/UserScript==

(function() {
    'use strict';

    // ==================== 用户配置区（必须修改！）====================
    const SUPABASE_CONFIG = {
        // 1. 从Supabase控制台获取：Settings -> API -> Project URL
        url: 'https://pvylhbtftbgyoqemnfke.supabase.co',

        // 2. 从Supabase控制台获取：Settings -> API -> anon public
        anonKey: 'sb_publishable_fWnKwBxnkUsDINXEfQV6ow_NgEhZcjD' // 以 eyJ 开头的长字符串
    };

    // ==================== 核心配置 ====================
    const CONFIG = {
        VERSION: '1.0',
        HAND_RECORD_PREFIX: 'hand_record_',
        DEBUG: true
    };

    // ==================== 工具函数模块 ====================
    const Utils = {
        log(...args) {
            if (CONFIG.DEBUG) {
                console.log('[VPIP Data Plugin]', ...args);
            }
        },

        error(...args) {
            console.error('[VPIP Data Plugin]', ...args);
        },

        debounce(func, wait) {
            let timeout;
            return function executedFunction(...args) {
                const later = () => {
                    clearTimeout(timeout);
                    func(...args);
                };
                clearTimeout(timeout);
                timeout = setTimeout(later, wait);
            };
        },

        cleanName(raw) {
            return raw.trim().replace(/[​-‍﻿]/g, "").replace(/:$/, "").trim();
        },

        isSystemName(name) {
            const n = name.toLowerCase();
            if (new Set(["the preflop", "the flop", "the turn", "the river", "the board", "the pot"]).has(n)) return true;
            if (["two cards dealt to each player", "did not show hand", "reveals", "won", "with"].some(phrase => n.includes(phrase))) return true;
            return (/^(the|game|hand|dealer|winner|round|pot|turn|river|flop|deck|board|community|cards|small blind|big blind)$/i.test(n) || /^[0-9a-f]{10,}$/i.test(n));
        }
    };

    // ==================== 牌局记录数据存储模块 ====================
    const DataManager = {
        // 保存手牌记录到本地存储
        saveHandRecord(handRecord) {
            const key = `${CONFIG.HAND_RECORD_PREFIX}${handRecord.gameId}`;
            GM_setValue(key, JSON.stringify(handRecord));
            Utils.log('手牌记录已保存:', handRecord.gameId);
        },

        // 获取本地所有手牌记录
        getLocalHandRecords() {
            const values = GM_listValues();
            const handRecords = [];

            values.forEach(key => {
                if (key.startsWith(CONFIG.HAND_RECORD_PREFIX)) {
                    try {
                        const data = JSON.parse(GM_getValue(key));
                        handRecords.push(data);
                    } catch (e) {
                        Utils.error('解析手牌记录失败:', key, e);
                    }
                }
            });

            // 按时间戳排序，最新的在前
            handRecords.sort((a, b) => b.timestamp - a.timestamp);
            return handRecords;
        },

        // 清除所有手牌记录
        clearAllHandRecords() {
            const values = GM_listValues();
            values.forEach(key => {
                if (key.startsWith(CONFIG.HAND_RECORD_PREFIX)) {
                    GM_deleteValue(key);
                }
            });
            Utils.log('所有手牌记录已清除');
        },

        // 批量删除手牌记录
        deleteHandRecords(gameIds) {
            for (const gameId of gameIds) {
                const key = `${CONFIG.HAND_RECORD_PREFIX}${gameId}`;
                GM_deleteValue(key);
                Utils.log('手牌记录已删除:', gameId);
            }
        },

        // 删除已上传的手牌记录
        deleteUploadedRecords(uploadedGameIds) {
            for (const gameId of uploadedGameIds) {
                const key = `${CONFIG.HAND_RECORD_PREFIX}${gameId}`;
                const exists = GM_getValue(key);
                if (exists) {
                    GM_deleteValue(key);
                    Utils.log('已上传的手牌记录已从本地删除:', gameId);
                }
            }
        }
    };

    // ==================== 牌局分析模块 ====================
    const HandAnalysisModule = {
        session: null,
        currentGameId: null,
        currentTableName: null, // 当前桌子名称

        init() {
            this.resetSession();
            this.setupLogObserver();
            this.startTableDetection(); // 启动桌子检测
            Utils.log('牌局分析模块初始化完成');
        },

        resetSession() {
            this.session = {
                gameId: null,
                isHandActive: false,
                processed_this_hand: new Set()
            };
        },

        setupLogObserver() {
            const observer = new MutationObserver((mutations) => {
                mutations.forEach(mutation => {
                    if (mutation.addedNodes.length) {
                        mutation.addedNodes.forEach(node => {
                            if (node.nodeType === 1 && node.classList.contains('message___RlFXd')) {
                                this.parseLog(node);
                            }
                        });
                    }
                });
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true
            });
        },

        parseLog(node) {
            const text = node.textContent.trim();

            // 检测牌局开始：Game + 30-33位十六进制 + started
            const gameIdMatch = text.match(/Game\s+([a-f0-9]{30,33})\s+started/i);
            if (gameIdMatch) {
                const gameId = gameIdMatch[1];
                
                // 如果当前有未完成的牌局，先完成它
                if (this.session.isHandActive && this.session.gameId) {
                    this.completeHand();
                }
                
                // 开始新牌局
                this.session.gameId = gameId;
                this.session.isHandActive = true;
                return;
            }

            // 如果牌局未激活，不处理
            if (!this.session.isHandActive) {
                return;
            }

            // 检测牌局结束：XXX won
            const wonMatch = text.match(/(\S+)\s+won\s+/);
            if (wonMatch) {
                const winner = Utils.cleanName(wonMatch[1]);
                this.completeHand();
                return;
            }

            // 解析玩家行为
            const pE = node.querySelector("em");
            const aE = node.querySelector("span");
            if (pE && aE) {
                let name = Utils.cleanName(pE.textContent);
                if (Utils.isSystemName(name)) return;

                const act = aE.textContent.toLowerCase().trim();

                // 玩家离桌
                if (act.includes("left the table")) {
                    return;
                }

                this.session.processed_this_hand.add(name);
            }
        },

        // 完成牌局并保存记录
        completeHand() {
            if (!this.session.isHandActive || !this.session.gameId) {
                return;
            }

            // 只有至少有2个玩家参与的牌局才保存
            if (this.session.processed_this_hand.size >= 2) {
                const now = Date.now();
                const date = new Date().toISOString().split('T')[0];

                // 记录当前手牌的统计数据
                const handStats = {
                    gameId: this.session.gameId,
                    timestamp: now,
                    date: date,
                    players: Array.from(this.session.processed_this_hand),
                    textContent: this.getFullHandTextContent()
                };

                // 添加META信息到文本内容末尾
                const isoTime = new Date(now).toISOString();
                const tableName = this.currentTableName || 'Unknown_Table';
                const metaLine = `META|${isoTime}|${tableName}|0.5/1`;
                handStats.textContent = handStats.textContent.trim() + '\n' + metaLine;

                // 保存当前手牌记录到本地存储
                if (this.session.gameId && handStats) {
                    DataManager.saveHandRecord(handStats);
                    // 不再自动上传到数据库，改为等待定时批量上传
                }
            }

            // 重置session状态
            this.resetSession();
        },
        
        // 获取当前牌局的完整文本内容
        getFullHandTextContent() {
            // 获取所有的消息元素
            const messages = document.querySelectorAll('.message___RlFXd');
            let content = '';
            
            // 寻找当前牌局开始的位置（Game ID）
            let startIndex = -1;
            for (let i = 0; i < messages.length; i++) {
                const text = messages[i].textContent.trim();
                if (text.includes(`Game ${this.session.gameId}`)) {
                    startIndex = i;
                    break;
                }
            }
            
            // 如果找到了开始位置，则从那里开始收集文本直到牌局结束
            if (startIndex !== -1) {
                for (let i = startIndex; i < messages.length; i++) {
                    const text = messages[i].textContent.trim();
                    content += text + '\n';
                    
                    // 如果检测到牌局结束(won)，则停止收集
                    if (text.includes('won')) {
                        break;
                    }
                }
            } else {
                // 如果没找到特定Game ID的开始，则收集最近的牌局相关消息
                for (let i = 0; i < messages.length; i++) {
                    const text = messages[i].textContent.trim();
                    if (text.includes('Game') && text.includes('started')) {
                        content = text + '\n';
                    } else if (content && text) {
                        content += text + '\n';
                        if (text.includes('won')) {
                            break;
                        }
                    }
                }
            }
            
            return content.trim();
        },

        // 获取当前桌子的名字
        getCurrentTableName() {
            try {
                const tableElement = document.querySelector('#react-root > main > div > div.tableWrap___UGgBj > div');
                if (!tableElement) {
                    return null;
                }

                const computedStyle = window.getComputedStyle(tableElement);
                const backgroundImage = computedStyle.backgroundImage;

                if (!backgroundImage) {
                    return null;
                }

                // background-image 包含两个URL：
                // url("/casino/holdem/images/frames/578_frame.png"), url("/casino/holdem/images/tables_colour/578/578_cats_chance.png")
                // 我们需要提取第二个URL中的桌子名称

                // 先尝试匹配 tables_colour 路径中的桌子图片
                const tableMatch = backgroundImage.match(/\/tables_colour\/\d+\/(\d+_[^"\s]+)\.png/);

                if (tableMatch && tableMatch[1]) {
                    const tableName = tableMatch[1].replace(/^\d+_/, '');
                    return tableName;
                }

                // 如果没有匹配到 tables_colour，尝试匹配任何包含数字前缀的PNG文件名
                const genericMatch = backgroundImage.match(/url\([^)]*\/(\d+_[^"\s]+)\.png[^)]*\)/g);

                if (genericMatch) {
                    // 查找最长的匹配（通常是桌子图片的文件名）
                    let longestMatch = '';
                    for (const match of genericMatch) {
                        const nameMatch = match.match(/\/(\d+_[^"\s]+)\.png/);
                        if (nameMatch && nameMatch[1].length > longestMatch.length) {
                            longestMatch = nameMatch[1];
                        }
                    }

                    if (longestMatch) {
                        const tableName = longestMatch.replace(/^\d+_/, '');
                        return tableName;
                    }
                }

                return null;
            } catch (error) {
                Utils.error('获取桌子名称失败:', error);
                return null;
            }
        },

        // 启动桌子检测
        startTableDetection() {
            // 首次获取桌子名称
            const tableName = this.getCurrentTableName();
            if (tableName) {
                this.currentTableName = tableName;
                Utils.log('当前桌子:', tableName);
            }
            
            // 每2秒检查一次桌子名称
            setInterval(() => {
                const newTableName = this.getCurrentTableName();
                if (newTableName && newTableName !== this.currentTableName) {
                    this.currentTableName = newTableName;
                    Utils.log('桌子已更换:', newTableName);
                }
            }, 2000);
        },

        // 定时批量上传功能
        startBatchUpload() {
            // 随机设置上传间隔（10-15分钟）
            const uploadInterval = 600000 + Math.random() * 300000; // 10-15分钟（毫秒）
            Utils.log(`定时批量上传启动，间隔: ${Math.round(uploadInterval / 60000)} 分钟`);

            setInterval(async () => {
                await this.performBatchUpload();
            }, uploadInterval);

            // 也可以设置一个较短的间隔来检查是否有数据需要上传
            setInterval(async () => {
                const handRecords = DataManager.getLocalHandRecords();
                if (handRecords.length > 0) {
                    Utils.log(`检测到 ${handRecords.length} 条未上传的牌局记录`);
                }
            }, 60000); // 每分钟检查一次
        },

        // 执行批量上传
        async performBatchUpload() {
            try {
                const handRecords = DataManager.getLocalHandRecords();
                if (handRecords.length === 0) {
                    Utils.log('没有牌局记录需要上传');
                    return;
                }

                Utils.log(`开始批量上传 ${handRecords.length} 条牌局记录...`);

                const processor = new PokerDataProcessor(SUPABASE_CONFIG);
                let successCount = 0;
                let failedCount = 0;
                const failedRecords = [];
                const successfulGameIds = []; // 记录成功上传的gameId

                for (let i = 0; i < handRecords.length; i++) {
                    const record = handRecords[i];
                    try {
                        const result = await processor.processHand(record.textContent);
                        
                        if (result.success) {
                            successCount++;
                            // 记录成功上传的gameId，稍后批量删除
                            successfulGameIds.push(record.gameId);
                        } else {
                            failedCount++;
                            failedRecords.push({
                                gameId: record.gameId,
                                error: result.message
                            });
                            Utils.error(`牌局 ${record.gameId} 上传失败: ${result.message}`);
                        }
                    } catch (error) {
                        failedCount++;
                        failedRecords.push({
                            gameId: record.gameId,
                            error: error.message
                        });
                        Utils.error(`上传牌局 ${record.gameId} 时发生错误:`, error);
                    }

                    // 添加延迟以避免过于频繁的请求
                    if (i < handRecords.length - 1) {
                        await new Promise(resolve => setTimeout(resolve, 500));
                    }
                }

                // 批量删除已成功上传的记录
                if (successfulGameIds.length > 0) {
                    DataManager.deleteUploadedRecords(successfulGameIds);
                    Utils.log(`已删除 ${successfulGameIds.length} 条已上传的本地记录`);
                }

                // 输出上传结果
                Utils.log(`批量上传完成！成功: ${successCount}, 失败: ${failedCount}`);
                
                if (failedRecords.length > 0) {
                    Utils.log(`失败的牌局:`, failedRecords);
                }

                // 显示通知
                if (successCount > 0 || failedCount > 0) {
                    GM_notification({
                        title: '批量上传完成',
                        text: `成功上传 ${successCount} 手牌，失败 ${failedCount} 手牌`,
                        timeout: 5000
                    });
                }
            } catch (error) {
                Utils.error('批量上传过程发生错误:', error);
            }
        },



        // 上传单手牌局到数据库 - 已废弃，使用定时批量上传
        async uploadHandToDatabase(handText) {
            // 此方法已废弃，不再使用单手牌上传
            Utils.log('单手牌上传功能已禁用，使用定时批量上传');
        }
    };

    // ==================== 核心处理器类 ====================
    class PokerDataProcessor {
        constructor(supabaseConfig) {
            this.config = supabaseConfig;
            this.playerCache = new Map();
            this.tableCache = new Map();
            this.stats = {
                totalHands: 0,
                success: 0,
                failed: 0,
                lastError: null
            };
        }

        // 处理单局牌局
        async processHand(handText) {
            try {
                // 1. 解析
                const parsedData = this._parseHandHistory(handText);
                if (!parsedData) {
                    throw new Error('解析失败：无法解析牌局文本');
                }

                // 2. 上传
                const result = await this._uploadToDatabase(parsedData);

                this.stats.totalHands++;
                this.stats.success++;

                return {
                    success: true,
                    handId: parsedData.meta.handId,
                    gameId: result.gameId,
                    tableId: result.tableId,
                    players: parsedData.players.length,
                    actions: parsedData.actions.length,
                    message: `手牌 ${parsedData.meta.handId} 处理成功`
                };

            } catch (error) {
                this.stats.totalHands++;
                this.stats.failed++;
                this.stats.lastError = error.message;

                console.error('处理失败:', error);

                return {
                    success: false,
                    error: error.message,
                    message: `处理失败: ${error.message}`
                };
            }
        }

        // 批量处理
        async processBatch(batchText, delay = 500) {
            const handTexts = batchText
                .trim()
                .split(/\n\s*\n/)
                .filter(text => text.trim().length > 0);

            const results = [];
            for (let i = 0; i < handTexts.length; i++) {
                try {
                    const result = await this.processHand(handTexts[i]);
                    results.push(result);

                    // 延迟
                    if (i < handTexts.length - 1 && delay > 0) {
                        await new Promise(resolve => setTimeout(resolve, delay));
                    }
                } catch (error) {
                    results.push({
                        success: false,
                        error: error.message,
                        message: `第 ${i+1} 手牌异常: ${error.message}`
                    });
                }
            }

            return {
                total: handTexts.length,
                results: results,
                summary: {
                    success: results.filter(r => r.success).length,
                    failed: results.filter(r => !r.success).length
                }
            };
        }

        // 解析器实现
        _parseHandHistory(text) {
            const lines = text.trim().split('\n');
            const result = {
                meta: { handId: null, playedAt: null, tableName: null, blinds: null },
                players: new Set(),
                actions: [],
                board: { flop: [], turn: null, river: null },
                showdowns: [],
                winners: [],
                playerOrder: []
            };

            let currentStreet = 'preflop';
            let actionOrder = { preflop: 0, flop: 0, turn: 0, river: 0 };

            for (let line of lines) {
                line = line.trim();
                if (!line) continue;

                // 解析元数据
                if (line.startsWith('META|')) {
                    this._parseMetaLine(line, result.meta);
                    continue;
                }

                // 牌局开始
                const gameStartMatch = line.match(/Game\s+([a-f0-9]{30,33})\s+started/i);
                if (gameStartMatch) {
                    // 确保解析到的handId符合预期格式（30-33位十六进制）且尚未设置
                    const handId = gameStartMatch[1];
                    if (handId && /^[a-f0-9]{30,33}$/.test(handId) && !result.meta.handId) {
                        result.meta.handId = handId;
                    }
                    continue;
                }

                // 公共牌
                if (line.startsWith('The flop:')) {
                    currentStreet = 'flop';
                    this._parseBoardCards(line, result.board, 'flop');
                    continue;
                }
                if (line.startsWith('The turn:')) {
                    currentStreet = 'turn';
                    this._parseBoardCards(line, result.board, 'turn');
                    continue;
                }
                if (line.startsWith('The river:')) {
                    currentStreet = 'river';
                    this._parseBoardCards(line, result.board, 'river');
                    continue;
                }

                // 玩家动作
                if (this._isActionLine(line)) {
                    const action = this._parseActionLine(line, currentStreet);
                    if (action) {
                        action.action_order = ++actionOrder[currentStreet];
                        result.actions.push(action);
                        result.players.add(action.player_name);

                        if (currentStreet === 'preflop' && !result.playerOrder.includes(action.player_name)) {
                            result.playerOrder.push(action.player_name);
                        }
                    }
                    continue;
                }

                // 结果
                this._parseResultLine(line, result);
            }

            // 补全playerOrder
            for (const player of result.players) {
                if (!result.playerOrder.includes(player)) {
                    result.playerOrder.push(player);
                }
            }

            // 转换为数组并计算位置
            result.players = Array.from(result.players);
            this._calculatePositions(result);

            return result;
        }

        _parseMetaLine(line, meta) {
            const parts = line.split('|');
            if (parts.length >= 4) {
                meta.playedAt = parts[1] || new Date().toISOString();
                meta.tableName = parts[2] || '未知牌桌';
                meta.blinds = parts[3] || '0.5/1';
            }
        }

        _parseBoardCards(line, board, street) {
            const match = line.match(/:\s*(.+)/);
            if (!match) return;

            const cards = match[1].trim();
            if (street === 'flop') {
                board.flop = cards.split(',').map(c => c.trim());
            } else if (street === 'turn') {
                board.turn = cards;
            } else if (street === 'river') {
                board.river = cards;
            }
        }

        _isActionLine(line) {
            const keywords = ['folded', 'called', 'raised', 'bet', 'checked', 'posted'];
            return keywords.some(keyword => line.includes(keyword));
        }

        _parseActionLine(line, street) {
            const patterns = [
                { regex: /^(\S+)\s+posted\s+(small|big)\s+blind\s+([\d.]+)\s*BB/, type: 'post' },
                { regex: /^(\S+)\s+folded/, type: 'fold' },
                { regex: /^(\S+)\s+checked/, type: 'check' },
                { regex: /^(\S+)\s+called\s+([\d.]+)\s*BB/, type: 'call' },
                { regex: /^(\S+)\s+bet\s+([\d.]+)\s*BB/, type: 'bet' },
                { regex: /^(\S+)\s+raised\s+([\d.]+)\s*BB/, type: 'raise' }
            ];

            for (const pattern of patterns) {
                const match = line.match(pattern.regex);
                if (!match) continue;

                const action = {
                    street: street,
                    player_name: match[1],
                    raw_text: line
                };

                switch (pattern.type) {
                    case 'post':
                        action.action_type = 'call';
                        action.amount = parseFloat(match[3]);
                        action.is_voluntary = false;
                        action.blind_type = match[2];
                        break;
                    case 'fold':
                        action.action_type = 'fold';
                        action.amount = 0;
                        action.is_voluntary = true;
                        break;
                    case 'check':
                        action.action_type = 'check';
                        action.amount = 0;
                        action.is_voluntary = true;
                        break;
                    case 'call':
                        action.action_type = 'call';
                        action.amount = parseFloat(match[2]);
                        action.is_voluntary = true;
                        break;
                    case 'bet':
                        action.action_type = 'bet';
                        action.amount = parseFloat(match[2]);
                        action.is_voluntary = true;
                        break;
                    case 'raise':
                        action.action_type = 'raise';
                        action.amount = parseFloat(match[2]);
                        action.is_voluntary = true;
                        break;
                }

                return action;
            }

            return null;
        }

        _parseResultLine(line, result) {
            const revealMatch = line.match(/^(\S+)\s+reveals\s+\[([^\]]+)\]\s+\(([^)]+)\)/);
            if (revealMatch) {
                result.showdowns.push({
                    player_name: revealMatch[1],
                    hole_cards: revealMatch[2],
                    hand_description: revealMatch[3]
                });
                result.players.add(revealMatch[1]);
                return;
            }

            const winMatch = line.match(/^(\S+)\s+won\s+([\d.]+)\s*BB\s+with\s+\[([^\]]+)\]\s+\(([^)]+)\)\s+\[([^\]]+)\]/);
            if (winMatch) {
                result.winners.push({
                    player_name: winMatch[1],
                    win_amount: parseFloat(winMatch[2]),
                    hole_cards: winMatch[3],
                    hand_description: winMatch[4]
                });
                result.players.add(winMatch[1]);
                return;
            }

            const simpleMatch = line.match(/^(\S+)\s+won\s+([\d.]+)\s*BB/);
            if (simpleMatch) {
                result.winners.push({
                    player_name: simpleMatch[1],
                    win_amount: parseFloat(simpleMatch[2])
                });
                result.players.add(simpleMatch[1]);
            }
        }

        _calculatePositions(data) {
            const { players, actions, playerOrder, winners } = data;

            let sbPlayer = null, bbPlayer = null;
            for (const action of actions) {
                if (action.blind_type === 'small') sbPlayer = action.player_name;
                if (action.blind_type === 'big') bbPlayer = action.player_name;
            }

            if (!sbPlayer || !bbPlayer) {
                if (playerOrder.length >= 2) {
                    sbPlayer = playerOrder[playerOrder.length - 2] || playerOrder[0];
                    bbPlayer = playerOrder[playerOrder.length - 1] || playerOrder[1];
                }
            }

            let orderedPlayers = [...playerOrder];
            const bbIndex = orderedPlayers.indexOf(bbPlayer);
            if (bbIndex !== -1 && bbIndex !== orderedPlayers.length - 1) {
                orderedPlayers.splice(bbIndex, 1);
                orderedPlayers.push(bbPlayer);
            }

            const positionScheme = this._getPositionScheme(orderedPlayers.length);

            data.positions = {};
            for (let i = 0; i < orderedPlayers.length; i++) {
                const player = orderedPlayers[i];
                data.positions[player] = {
                    seat_number: i,
                    position: positionScheme[i] || 'UNKNOWN',
                    is_sb: player === sbPlayer,
                    is_bb: player === bbPlayer,
                    is_btn: positionScheme[i] === 'BTN'
                };
            }

            this._calculateNetResults(data);
        }

        _getPositionScheme(playerCount) {
            const schemes = {
                2: ['BTN', 'BB'],
                3: ['BTN', 'SB', 'BB'],
                4: ['UTG', 'CO', 'BTN', 'BB'],
                5: ['UTG', 'MP', 'CO', 'BTN', 'BB'],
                6: ['UTG', 'MP', 'HJ', 'CO', 'BTN', 'BB'],
                7: ['UTG', 'UTG+1', 'MP', 'HJ', 'CO', 'BTN', 'BB'],
                8: ['UTG', 'UTG+1', 'UTG+2', 'MP', 'HJ', 'CO', 'BTN', 'BB'],
                9: ['UTG', 'UTG+1', 'UTG+2', 'MP', 'MP+1', 'HJ', 'CO', 'BTN', 'BB']
            };

            return schemes[playerCount] || schemes[6];
        }

        _calculateNetResults(data) {
            const { players, actions, winners, positions } = data;

            const netResults = {};
            players.forEach(player => {
                netResults[player] = 0;
            });

            actions.forEach(action => {
                if (action.amount > 0) {
                    netResults[action.player_name] -= action.amount;
                }
            });

            winners.forEach(winner => {
                netResults[winner.player_name] += winner.win_amount;
            });

            for (const player in positions) {
                positions[player].net_result = netResults[player] || 0;
                positions[player].is_winner = netResults[player] > 0;
            }

            data.netResults = netResults;
        }

        // Supabase请求封装
        async _supabaseRequest(endpoint, method = 'GET', data = null) {
            return new Promise((resolve, reject) => {
                const headers = {
                    'apikey': this.config.anonKey,
                    'Authorization': `Bearer ${this.config.anonKey}`,
                    'Content-Type': 'application/json'
                };

                // 关键修复：对于POST/PUT请求，要求返回插入的数据
                if (method === 'POST' || method === 'PUT') {
                    headers['Prefer'] = 'return=representation';
                } else {
                    headers['Prefer'] = 'return=minimal';
                }

                GM_xmlhttpRequest({
                    method: method,
                    url: `${this.config.url}/rest/v1/${endpoint}`,
                    headers: headers,
                    data: data ? JSON.stringify(data) : null,
                    onload: (response) => {
                        console.log(`API响应 [${method} ${endpoint}]: ${response.status}`);

                        if (response.status >= 200 && response.status < 300) {
                            try {
                                const result = response.responseText ?
                                    JSON.parse(response.responseText) :
                                    [];
                                resolve(result);
                            } catch (e) {
                                console.error('解析响应失败:', e, response.responseText);
                                resolve([]);
                            }
                        } else if (response.status === 409) {
                            // 冲突错误（如唯一约束冲突），解析现有数据
                            try {
                                const existingData = response.responseText ?
                                    JSON.parse(response.responseText) :
                                    [];
                                resolve(existingData);
                            } catch (e) {
                                resolve([]);
                            }
                        } else {
                            reject(new Error(`HTTP ${response.status}: ${response.responseText || '无响应'}`));
                        }
                    },
                    onerror: (error) => {
                        reject(new Error(`网络错误: ${error.status}`));
                    },
                    ontimeout: () => {
                        reject(new Error('请求超时'));
                    }
                });
            });
        }

        async _uploadToDatabase(data) {
            const { meta, players, actions, showdowns, winners, positions, netResults } = data;
            console.log(`开始上传牌局 ${meta.handId}，玩家数: ${players.length}`);

            // 验证handId是否存在
            if (!meta.handId || typeof meta.handId !== 'string' || meta.handId.length < 20) {
                throw new Error('无效的handId: ' + (meta.handId || 'null/undefined'));
            }

            try {
                // 1. 获取或创建牌桌（修复缓存逻辑）
                const tableKey = `${meta.tableName}|${meta.blinds}`;
                let tableId = this.tableCache.get(tableKey);

                if (!tableId) {
                    tableId = await this._getOrCreateTable(meta.tableName, meta.blinds);
                    if (tableId) {
                        this.tableCache.set(tableKey, tableId);
                        console.log(`牌桌获取/创建成功: ${tableId}`);
                    }
                } else {
                    console.log(`从缓存获取牌桌ID: ${tableId}`);
                }

                if (!tableId) {
                    throw new Error(`无法获取牌桌ID: ${meta.tableName}`);
                }

                // 2. 检查手牌是否已存在（修复重复检查）
                const existingGame = await this._findExistingGame(meta.handId);
                if (existingGame && existingGame.id) {
                    console.log(`手牌 ${meta.handId} 已存在，跳过`);
                    return {
                        gameId: existingGame.id,
                        tableId: tableId,
                        skipped: true,
                        message: '手牌已存在'
                    };
                }

                // 3. 计算总底池
                const totalPot = winners.reduce((sum, w) => sum + (w.win_amount || 0), 0);
                console.log(`总底池: ${totalPot} BB`);

                // 4. 插入牌局记录 (games表) - 修复插入逻辑
                const gameId = await this._insertGame(meta, tableId, totalPot, data);
                if (!gameId) {
                    throw new Error('插入牌局记录失败');
                }
                console.log(`牌局记录创建成功: ${gameId}`);

                // 5. 获取或创建所有玩家（修复玩家处理）
                const playerIdMap = new Map();
                console.log(`开始处理 ${players.length} 名玩家...`);

                for (const playerName of players) {
                    const playerId = await this._getOrCreatePlayer(playerName);
                    if (playerId) {
                        playerIdMap.set(playerName, playerId);
                        console.log(`玩家 ${playerName} -> ID: ${playerId}`);
                    } else {
                        console.warn(`玩家 ${playerName} 创建失败，相关记录将被跳过`);
                    }
                }

                // 6. 插入玩家位置记录 - 关键修复
                if (playerIdMap.size > 0) {
                    await this._insertPlayerPositions(gameId, playerIdMap, positions, netResults);
                    console.log(`玩家位置记录插入完成`);
                } else {
                    console.warn('没有有效的玩家ID，跳过位置记录插入');
                }

                // 7. 插入动作记录
                let actionCount = 0;
                if (actions.length > 0 && playerIdMap.size > 0) {
                    actionCount = await this._insertActions(gameId, playerIdMap, actions);
                    console.log(`动作记录插入完成: ${actionCount} 条`);
                }

                // 8. 插入摊牌记录
                if (showdowns.length > 0 && playerIdMap.size > 0) {
                    await this._insertShowdowns(gameId, playerIdMap, showdowns);
                    console.log(`摊牌记录插入完成: ${showdowns.length} 条`);
                }

                // 9. 更新赢家标记（如果需要）
                if (winners.length > 0) {
                    await this._updateWinners(gameId, playerIdMap, winners);
                }

                console.log(`牌局 ${meta.handId} 上传完成`);
                return {
                    success: true,
                    gameId: gameId,
                    tableId: tableId,
                    players: playerIdMap.size,
                    actions: actionCount
                };

            } catch (error) {
                console.error(`上传牌局 ${meta.handId} 失败:`, error);
                throw error;
            }
        }

        /**
         * 获取或创建牌桌 - 修复版
         */
        async _getOrCreateTable(tableName, blinds) {
            try {
                console.log(`查询牌桌: "${tableName}", 盲注: "${blinds}"`);

                // 查询现有牌桌
                const existing = await this._supabaseRequest(
                    `poker_tables?table_name=eq.${encodeURIComponent(tableName)}&blinds=eq.${encodeURIComponent(blinds)}`
                );

                console.log('查询结果:', existing);

                if (existing && Array.isArray(existing) && existing.length > 0) {
                    console.log(`找到现有牌桌，ID: ${existing[0].id}`);
                    return existing[0].id;
                }

                console.log('创建新牌桌...');
                const newTable = await this._supabaseRequest('poker_tables', 'POST', {
                    table_name: tableName,
                    blinds: blinds,
                    max_seats: 9,
                    created_at: new Date().toISOString()
                });

                console.log('创建结果:', newTable);

                // 关键修复：正确处理返回的数据格式
                if (newTable && Array.isArray(newTable) && newTable.length > 0) {
                    const tableId = newTable[0].id;
                    console.log(`牌桌创建成功，ID: ${tableId}`);
                    return tableId;
                } else if (newTable && newTable.id) {
                    // 有些情况下可能返回单个对象而不是数组
                    console.log(`牌桌创建成功，ID: ${newTable.id}`);
                    return newTable.id;
                } else {
                    console.error('创建牌桌但未返回有效数据:', newTable);

                    // 尝试通过查询获取刚刚创建的牌桌
                    console.log('尝试查询刚刚创建的牌桌...');
                    const verifyResult = await this._supabaseRequest(
                        `poker_tables?table_name=eq.${encodeURIComponent(tableName)}&blinds=eq.${encodeURIComponent(blinds)}&order=created_at.desc&limit=1`
                    );

                    if (verifyResult && verifyResult.length > 0) {
                        console.log(`通过验证查询获得牌桌ID: ${verifyResult[0].id}`);
                        return verifyResult[0].id;
                    }

                    return null;
                }

            } catch (error) {
                console.error('获取/创建牌桌失败:', error);
                return null;
            }
        }

        /**
         * 检查手牌是否存在 - 修复版
         */
        async _findExistingGame(handId) {
            if (!handId) {
                console.warn('handId为空，跳过重复检查');
                return null;
            }

            try {
                const data = await this._supabaseRequest(`games?hand_id=eq.${encodeURIComponent(handId)}&select=id,hand_id&limit=1`);

                if (data && Array.isArray(data) && data.length > 0 && data[0].id) {
                    console.log(`发现重复手牌: ${handId}, 游戏ID: ${data[0].id}`);
                    return data[0];
                }

                return null;
            } catch (error) {
                console.error('检查手牌存在失败:', error);
                // 不抛出错误，允许继续处理
                return null;
            }
        }


        async _findExistingGame(handId) {
            if (!handId) return null;

            try {
                const data = await this._supabaseRequest(`games?hand_id=eq.${handId}&limit=1`);
                return data && data.length > 0 ? data[0] : null;
            } catch (error) {
                console.error('检查手牌存在失败:', error);
                return null;
            }
        }

        /**
         * 插入牌局记录 - 修复版（移除了board_cards）
         */
        async _insertGame(meta, tableId, totalPot, data) {
            try {
                const gameData = {
                    hand_id: meta.handId,
                    table_id: tableId,
                    total_pot: totalPot,
                    player_count: data.players.length,
                    played_at: meta.playedAt,
                    created_at: new Date().toISOString()
                };

                console.log('插入games表数据:', gameData);

                const result = await this._supabaseRequest('games', 'POST', [gameData]);

                if (result && Array.isArray(result) && result.length > 0 && result[0].id) {
                    console.log(`games表插入成功，ID: ${result[0].id}`);
                    return result[0].id;
                } else {
                    console.error('games表插入但未返回有效ID:', result);
                    return null;
                }

            } catch (error) {
                console.error('插入牌局记录失败:', error);
                // 尝试提供更详细的错误信息
                if (error.message.includes('400')) {
                    console.error('HTTP 400错误，可能原因:');
                    console.error('1. games表缺少某些字段');
                    console.error('2. 字段类型不匹配');
                    console.error('3. 外键约束失败 (table_id不存在)');
                }
                return null;
            }
        }

        async _getOrCreatePlayer(playerName) {
            if (this.playerCache.has(playerName)) {
                return this.playerCache.get(playerName);
            }

            try {
                const existing = await this._supabaseRequest(
                    `players?username=eq.${encodeURIComponent(playerName)}&limit=1`
                );

                if (existing && existing.length > 0) {
                    this.playerCache.set(playerName, existing[0].id);
                    return existing[0].id;
                }

                const newPlayer = await this._supabaseRequest('players', 'POST', [{
                    username: playerName,
                    created_at: new Date().toISOString()
                }]);

                if (newPlayer[0]?.id) {
                    this.playerCache.set(playerName, newPlayer[0].id);
                    return newPlayer[0].id;
                }

                return null;

            } catch (error) {
                console.error(`获取/创建玩家 ${playerName} 失败:`, error);
                return null;
            }
        }

        /**
         * 插入玩家位置记录 - 修复版
         */
        async _insertPlayerPositions(gameId, playerIdMap, positions, netResults) {
            try {
                const positionRecords = [];

                for (const [playerName, positionInfo] of Object.entries(positions)) {
                    const playerId = playerIdMap.get(playerName);
                    if (!playerId) {
                        console.warn(`玩家 ${playerName} 没有有效ID，跳过位置记录`);
                        continue;
                    }

                    positionRecords.push({
                        game_id: gameId,
                        player_id: playerId,
                        seat_number: positionInfo.seat_number || 0,
                        position: positionInfo.position || 'UNKNOWN',
                        net_result: netResults[playerName] || 0,
                        is_winner: (netResults[playerName] || 0) > 0,
                        is_sb: positionInfo.is_sb || false,
                        is_bb: positionInfo.is_bb || false,
                        is_btn: positionInfo.is_btn || false,
                        created_at: new Date().toISOString()
                    });
                }

                if (positionRecords.length > 0) {
                    console.log(`插入 ${positionRecords.length} 条玩家位置记录`);
                    await this._supabaseRequest('player_positions', 'POST', positionRecords);
                    console.log('玩家位置记录插入成功');
                } else {
                    console.warn('没有有效的玩家位置记录可插入');
                }

            } catch (error) {
                console.error('插入玩家位置记录失败:', error);
                // 不抛出错误，允许其他记录继续插入
            }
        }


        async _insertActions(gameId, playerIdMap, actions) {
            try {
                const actionRecords = [];

                for (const action of actions) {
                    const playerId = playerIdMap.get(action.player_name);
                    if (!playerId) {
                        console.warn(`动作记录跳过: 玩家 ${action.player_name} 没有有效ID`);
                        continue;
                    }

                    actionRecords.push({
                        game_id: gameId,
                        player_id: playerId,
                        street: action.street,
                        action_order: action.action_order,
                        action_type: action.action_type,
                        amount: action.amount || 0,
                        is_voluntary: action.is_voluntary !== false,
                        created_at: new Date().toISOString()
                    });
                }

                if (actionRecords.length === 0) {
                    console.warn('没有有效的动作记录可插入');
                    return 0;
                }

                console.log(`插入 ${actionRecords.length} 条动作记录`);
                await this._supabaseRequest('hand_actions', 'POST', actionRecords);
                console.log('动作记录插入成功');

                return actionRecords.length;

            } catch (error) {
                console.error('插入动作记录失败:', error);
                throw error; // 抛出错误，因为动作记录很重要
            }
        }

         /**
         * 插入摊牌记录 - 修复版
         */
        async _insertShowdowns(gameId, playerIdMap, showdowns) {
            try {
                const showdownRecords = [];

                for (const showdown of showdowns) {
                    const playerId = playerIdMap.get(showdown.player_name);
                    if (!playerId) {
                        console.warn(`摊牌记录跳过: 玩家 ${showdown.player_name} 没有有效ID`);
                        continue;
                    }

                    showdownRecords.push({
                        game_id: gameId,
                        player_id: playerId,
                        hole_cards: showdown.hole_cards || '',
                        final_hand: showdown.hand_description || '',
                        win_amount: 0, // 摊牌表暂时不记录赢取金额，已在player_positions中记录
                        is_winner: false,
                        created_at: new Date().toISOString()
                    });
                }

                if (showdownRecords.length > 0) {
                    console.log(`插入 ${showdownRecords.length} 条摊牌记录`);
                    await this._supabaseRequest('showdowns', 'POST', showdownRecords);
                    console.log('摊牌记录插入成功');
                }

            } catch (error) {
                console.error('插入摊牌记录失败:', error);
                // 不抛出错误，摊牌记录不是核心数据
            }
        }

        /**
         * 更新赢家信息（可选方法，用于额外的赢家标记处理）
         * @param {string} gameId - 牌局ID
         * @param {Map} playerIdMap - 玩家名->ID映射
         * @param {Array} winners - 赢家列表
         */
        async _updateWinners(gameId, playerIdMap, winners) {
            try {
                console.log(`处理赢家信息，赢家数量: ${winners.length}`);

                if (winners.length === 0) {
                    console.log('没有赢家需要处理');
                    return;
                }

                // 由于赢家的输赢结果已经在 _calculateNetResults 中计算
                // 并存储在 player_positions 表的 net_result 和 is_winner 字段中
                // 这里主要做日志记录或额外的赢家标记处理

                for (const winner of winners) {
                    const playerId = playerIdMap.get(winner.player_name);
                    if (playerId) {
                        console.log(`赢家: ${winner.player_name} (ID: ${playerId}), 赢取: ${winner.win_amount || 0} BB`);

                        // 如果需要，可以在这里添加额外的赢家处理逻辑
                        // 例如：更新专门的赢家表、发送通知等
                    }
                }

                console.log('赢家信息处理完成');

            } catch (error) {
                console.error('更新赢家信息失败:', error);
                // 注意：这个方法不是核心功能，所以不抛出错误
                // 让数据上传流程可以继续完成
            }
        }

        getStats() {
            return { ...this.stats };
        }

        reset() {
            this.stats = { totalHands: 0, success: 0, failed: 0, lastError: null };
            this.playerCache.clear();
            this.tableCache.clear();
        }
    }

    // ==================== UI模块（悬浮球和牌局历史查看）====================
    const UIModule = {
        toggleBtn: null,
        controlPanel: null,
        historyModal: null,

        init() {
            this.createStyles();
            this.createHistoryModal();
            this.createControlPanel();
            this.createToggleButton();
            this.createUploaderUI(); // 创建上传界面
            Utils.log('UI模块初始化完成');
        },

        createUploaderUI() {
            // 创建上传界面的容器
            const container = document.createElement('div');
            container.id = 'poker-uploader-container';
            container.style.cssText = `
                position: fixed;
                top: 50px;
                right: 20px;
                width: 500px;
                max-height: 80vh;
                background: white;
                border: 2px solid #333;
                border-radius: 10px;
                box-shadow: 0 5px 20px rgba(0,0,0,0.3);
                z-index: 10000;
                font-family: Arial, sans-serif;
                overflow: hidden;
                display: none;
            `;

            container.innerHTML = `
                <div style="background: linear-gradient(135deg, #2c3e50, #4a6491); color: white; padding: 15px; display: flex; justify-content: space-between; align-items: center;">
                    <h3 style="margin: 0; font-size: 16px;">♠️♥️♣️♦️ VPIP数据上传器</h3>
                    <button id="poker-close-btn" style="background: none; border: none; color: white; font-size: 20px; cursor: pointer; padding: 0; line-height: 1;">×</button>
                </div>

                <div style="padding: 20px;">
                    <div style="margin-bottom: 15px;">
                        <div style="font-weight: bold; margin-bottom: 5px; color: #2c3e50;">Supabase 配置状态</div>
                        <div style="background: #f8f9fa; padding: 10px; border-radius: 5px; border: 1px solid #ddd; font-size: 12px;">
                            <div>项目URL: <span id="config-url" style="color: ${SUPABASE_CONFIG.url.includes('YOUR_PROJECT') ? '#e74c3c' : '#27ae60'};">${SUPABASE_CONFIG.url}</span></div>
                            <div>API密钥: <span style="color: ${SUPABASE_CONFIG.anonKey.includes('YOUR_ANON') ? '#e74c3c' : '#27ae60'};">${SUPABASE_CONFIG.anonKey.substring(0, 10)}...</span></div>
                            <div style="margin-top: 5px; font-weight: bold; color: ${SUPABASE_CONFIG.url.includes('YOUR_PROJECT') || SUPABASE_CONFIG.anonKey.includes('YOUR_ANON') ? '#e74c3c' : '#27ae60'};">
                                ${SUPABASE_CONFIG.url.includes('YOUR_PROJECT') || SUPABASE_CONFIG.anonKey.includes('YOUR_ANON') ? '⚠️ 请先修改脚本中的配置！' : '✓ 配置正常'}
                            </div>
                        </div>
                    </div>

                    <div style="margin-bottom: 15px;">
                        <div style="display: flex; gap: 10px; margin-bottom: 10px;">
                            <button id="poker-upload-batch" style="flex: 1; padding: 10px; background: #3498db; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: bold;">批量上传本地数据</button>
                            <button id="poker-reset" style="flex: 1; padding: 10px; background: #e74c3c; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: bold;">重置统计</button>
                        </div>
                        <div style="display: flex; gap: 10px;">
                            <button id="poker-test-connection" style="flex: 1; padding: 10px; background: #f39c12; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: bold;">测试连接</button>
                            <button id="poker-view-stats" style="flex: 1; padding: 10px; background: #9b59b6; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: bold;">查看统计</button>
                        </div>
                    </div>

                    <div style="margin-bottom: 15px; display: none;" id="poker-progress-container">
                        <div style="font-weight: bold; margin-bottom: 5px; color: #2c3e50;">上传进度</div>
                        <div style="background: #f8f9fa; padding: 10px; border-radius: 5px; border: 1px solid #ddd;">
                            <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                                <span>处理进度</span>
                                <span id="poker-progress-text">0/0</span>
                            </div>
                            <div style="height: 10px; background: #ecf0f1; border-radius: 5px; overflow: hidden;">
                                <div id="poker-progress-bar" style="height: 100%; background: #3498db; width: 0%; transition: width 0.3s;"></div>
                            </div>
                        </div>
                    </div>

                    <div>
                        <div style="font-weight: bold; margin-bottom: 5px; color: #2c3e50;">处理结果</div>
                        <div id="poker-result" style="background: #f8f9fa; padding: 10px; border-radius: 5px; border: 1px solid #ddd; min-height: 50px; max-height: 200px; overflow-y: auto; font-size: 12px;"></div>
                    </div>
                </div>
            `;

            document.body.appendChild(container);

            // 绑定上传界面事件
            this.bindUploaderEvents();
        },

        bindUploaderEvents() {
            const processor = new PokerDataProcessor(SUPABASE_CONFIG);

            // 结果日志函数
            const logResult = (message, type = 'info') => {
                const resultDiv = document.getElementById('poker-result');
                const timestamp = new Date().toLocaleTimeString();
                const colors = {
                    info: '#3498db',
                    success: '#27ae60',
                    warning: '#f39c12',
                    error: '#e74c3c'
                };

                const entry = document.createElement('div');
                entry.style.marginBottom = '5px';
                entry.style.padding = '3px 5px';
                entry.style.borderLeft = `3px solid ${colors[type] || colors.info}`;
                entry.style.backgroundColor = type === 'error' ? '#ffebee' : '#f8f9fa';
                entry.innerHTML = `<span style="color: #7f8c8d; font-size: 10px;">[${timestamp}]</span> <span style="color: ${colors[type] || colors.info};">${message}</span>`;

                resultDiv.appendChild(entry);
                resultDiv.scrollTop = resultDiv.scrollHeight;
            };

            // 关闭上传界面
            document.getElementById('poker-close-btn').addEventListener('click', () => {
                document.getElementById('poker-uploader-container').style.display = 'none';
            });

            // 测试连接
            document.getElementById('poker-test-connection').addEventListener('click', async () => {
                logResult('正在测试Supabase连接...', 'info');

                try {
                    const testUrl = `${SUPABASE_CONFIG.url}/rest/v1/games?select=count`;

                    const result = await new Promise((resolve, reject) => {
                        GM_xmlhttpRequest({
                            method: 'GET',
                            url: testUrl,
                            headers: {
                                'apikey': SUPABASE_CONFIG.anonKey,
                                'Authorization': `Bearer ${SUPABASE_CONFIG.anonKey}`
                            },
                            onload: (response) => {
                                if (response.status === 200) {
                                    resolve(true);
                                } else {
                                    reject(new Error(`状态码: ${response.status}`));
                                }
                            },
                            onerror: (error) => reject(error),
                            ontimeout: () => reject(new Error('连接超时'))
                        });
                    });

                    logResult('✓ Supabase连接测试成功！', 'success');
                    GM_notification({
                        title: '连接测试成功',
                        text: '已成功连接到Supabase数据库',
                        timeout: 3000
                    });

                } catch (error) {
                    logResult(`✗ 连接测试失败: ${error.message}`, 'error');
                    GM_notification({
                        title: '连接测试失败',
                        text: error.message,
                        timeout: 5000
                    });
                }
            });

            // 批量上传本地数据
            document.getElementById('poker-upload-batch').addEventListener('click', async () => {
                const handRecords = DataManager.getLocalHandRecords();
                if (handRecords.length === 0) {
                    logResult('没有本地牌局记录可上传', 'warning');
                    return;
                }

                // 显示进度条
                const progressContainer = document.getElementById('poker-progress-container');
                const progressBar = document.getElementById('poker-progress-bar');
                const progressText = document.getElementById('poker-progress-text');
                progressContainer.style.display = 'block';

                logResult(`开始批量上传 ${handRecords.length} 条本地牌局记录...`, 'info');

                try {
                    let processed = 0;
                    const results = [];

                    for (let i = 0; i < handRecords.length; i++) {
                        try {
                            const result = await processor.processHand(handRecords[i].textContent);
                            results.push(result);
                            processed++;

                            // 更新进度
                            const progress = Math.round((processed / handRecords.length) * 100);
                            progressBar.style.width = `${progress}%`;
                            progressText.textContent = `${processed}/${handRecords.length}`;

                            // 延迟
                            if (i < handRecords.length - 1) {
                                await new Promise(resolve => setTimeout(resolve, 500));
                            }

                        } catch (error) {
                            results.push({
                                success: false,
                                error: error.message
                            });
                            processed++;
                        }
                    }

                    const success = results.filter(r => r.success).length;
                    const failed = results.filter(r => !r.success).length;

                    logResult(`批量上传完成！总计: ${handRecords.length} 手牌`, 'success');
                    logResult(`成功: ${success} 手牌, 失败: ${failed} 手牌`, 'info');

                    if (failed > 0) {
                        logResult('失败的手牌:', 'warning');
                        results.filter(r => !r.success).forEach(r => {
                            logResult(`  ${r.handId || '未知'}: ${r.error || '未知错误'}`, 'error');
                        });
                    }

                    GM_notification({
                        title: '批量上传完成',
                        text: `成功导入 ${success} 手牌`,
                        timeout: 5000
                    });

                } catch (error) {
                    logResult(`批量上传异常: ${error.message}`, 'error');
                } finally {
                    // 隐藏进度条
                    setTimeout(() => {
                        progressContainer.style.display = 'none';
                        progressBar.style.width = '0%';
                        progressText.textContent = '0/0';
                    }, 3000);
                }
            });

            // 重置统计
            document.getElementById('poker-reset').addEventListener('click', () => {
                processor.reset();
                logResult('处理器统计已重置', 'info');
            });

            // 查看统计
            document.getElementById('poker-view-stats').addEventListener('click', () => {
                const stats = processor.getStats();
                logResult('=== 处理统计 ===', 'info');
                logResult(`总处理手牌: ${stats.totalHands}`, 'info');
                logResult(`成功: ${stats.success}`, 'success');
                logResult(`失败: ${stats.failed}`, stats.failed > 0 ? 'error' : 'info');
                if (stats.lastError) {
                    logResult(`最后错误: ${stats.lastError}`, 'warning');
                }
            });
        },

        createStyles() {
            GM_addStyle(`
                .hand-recorder-toggle-btn {
                    position: fixed;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    z-index: 9998;
                    background: linear-gradient(135deg, #3b82f6, #1d4ed8);
                    color: white;
                    border: none;
                    border-radius: 50%;
                    width: 44px;
                    height: 44px;
                    cursor: move;
                    font-size: 20px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    box-shadow: 0 4px 15px rgba(59, 130, 246, 0.4);
                    transition: transform 0.3s ease, box-shadow 0.3s ease;
                    user-select: none;
                    -webkit-user-select: none;
                    -moz-user-select: none;
                    -ms-user-select: none;
                    font-weight: bold;
                }

                .hand-recorder-toggle-btn:hover {
                    transform: scale(1.1);
                    box-shadow: 0 6px 20px rgba(59, 130, 246, 0.6);
                }

                .hand-recorder-control-panel {
                    position: fixed;
                    background: rgba(15, 23, 42, 0.95);
                    border: 1px solid #334155;
                    border-radius: 10px;
                    padding: 16px;
                    z-index: 9999;
                    width: 200px;
                    backdrop-filter: blur(12px);
                    box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
                    display: none;
                }

                .hand-recorder-panel-header {
                    font-weight: 700;
                    color: #60a5fa;
                    margin-bottom: 16px;
                    padding-bottom: 12px;
                    border-bottom: 1px solid #334155;
                    font-size: 14px;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                }

                .hand-recorder-close-btn {
                    cursor: pointer;
                    color: #94a3b8;
                    font-size: 18px;
                    width: 24px;
                    height: 24px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    border-radius: 4px;
                    transition: all 0.2s ease;
                    line-height: 1;
                }

                .hand-recorder-close-btn:hover {
                    color: #f87171;
                    transform: scale(1.1);
                    background: rgba(248, 113, 113, 0.1);
                }

                .hand-recorder-control-button {
                    display: flex;
                    align-items: center;
                    width: 100%;
                    padding: 10px 14px;
                    margin: 8px 0;
                    background: rgba(30, 41, 59, 0.7);
                    color: #e2e8f0;
                    border: 1px solid #475569;
                    border-radius: 8px;
                    cursor: pointer;
                    font-size: 13px;
                    font-weight: 600;
                    transition: all 0.2s ease;
                }

                .hand-recorder-control-button:hover {
                    background: rgba(30, 41, 59, 0.9);
                    transform: translateY(-1px);
                    border-color: #60a5fa;
                }

                .hand-recorder-btn-history { color: #60a5fa; }
                .hand-recorder-btn-upload { color: #3498db; }
                .hand-recorder-btn-clear { color: #f87171; }

                .hand-recorder-history-modal {
                    position: fixed;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    background: rgba(15, 23, 42, 0.98);
                    border: 1px solid #334155;
                    border-radius: 12px;
                    padding: 0;
                    z-index: 10001;
                    width: 80%;
                    max-width: 900px;
                    max-height: 85vh;
                    backdrop-filter: blur(12px);
                    box-shadow: 0 20px 50px -10px rgba(0, 0, 0, 0.5);
                    display: none;
                    overflow: hidden;
                    font-family: "Microsoft YaHei", "PingFang SC", "SimHei", "Noto Sans SC", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                }

                .hand-recorder-history-modal.show {
                    display: block;
                    animation: modalFadeIn 0.3s ease;
                }

                @keyframes modalFadeIn {
                    from {
                        opacity: 0;
                        transform: translate(-50%, -50%) scale(0.95);
                    }
                    to {
                        opacity: 1;
                        transform: translate(-50%, -50%) scale(1);
                    }
                }

                .hand-recorder-history-modal-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 16px 20px;
                    border-bottom: 1px solid #334155;
                    background: rgba(30, 41, 59, 0.5);
                }

                .hand-recorder-history-modal-title {
                    font-weight: 700;
                    font-size: 16px;
                    color: #60a5fa;
                }

                .hand-recorder-history-modal-close {
                    cursor: pointer;
                    color: #94a3b8;
                    font-size: 24px;
                    width: 28px;
                    height: 28px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    border-radius: 4px;
                    transition: all 0.2s ease;
                    line-height: 1;
                }

                .hand-recorder-history-modal-close:hover {
                    color: #f87171;
                    background: rgba(248, 113, 113, 0.1);
                    transform: scale(1.1);
                }

                .hand-recorder-history-content {
                    padding: 16px 20px;
                    overflow-y: auto;
                    max-height: calc(85vh - 60px);
                }

                .hand-recorder-history-item {
                    margin-bottom: 15px;
                    padding: 12px;
                    background: rgba(30, 41, 59, 0.5);
                    border-radius: 6px;
                    border-left: 3px solid #3b82f6;
                }

                .hand-recorder-history-header {
                    display: flex;
                    justify-content: space-between;
                    margin-bottom: 8px;
                    font-weight: 600;
                    color: #e2e8f0;
                }

                .hand-recorder-history-date {
                    color: #94a3b8;
                    font-size: 13px;
                }

                .hand-recorder-history-players {
                    font-size: 13px;
                    color: #94a3b8;
                    margin-bottom: 8px;
                }

                .hand-recorder-history-text {
                    font-family: monospace;
                    font-size: 12px;
                    line-height: 1.4;
                    color: #cbd5e1;
                    white-space: pre-wrap;
                    background: rgba(15, 23, 42, 0.7);
                    padding: 10px;
                    border-radius: 4px;
                    max-height: 400px;
                    overflow-y: auto;
                }
                
                .hand-recorder-history-textarea {
                    width: 100%;
                    min-height: 200px;
                    font-family: monospace;
                    font-size: 12px;
                    line-height: 1.4;
                    padding: 10px;
                    background: rgba(15, 23, 42, 0.7);
                    color: #cbd5e1;
                    border: 1px solid #334155;
                    border-radius: 4px;
                    resize: vertical;
                    white-space: pre;
                    overflow: auto;
                }
                
                .hand-recorder-export-section {
                    margin-top: 15px;
                    padding-top: 15px;
                    border-top: 1px solid #334155;
                }
                
                .hand-recorder-export-btn {
                    display: inline-block;
                    background: rgba(30, 41, 59, 0.7);
                    color: #e2e8f0;
                    border: 1px solid #475569;
                    border-radius: 6px;
                    padding: 8px 12px;
                    cursor: pointer;
                    font-size: 12px;
                    font-weight: 600;
                    transition: all 0.2s ease;
                    margin-right: 10px;
                }
                
                .hand-recorder-export-btn:hover {
                    background: rgba(30, 41, 59, 0.9);
                    transform: translateY(-1px);
                    border-color: #60a5fa;
                }

                .hand-recorder-history-empty {
                    text-align: center;
                    padding: 40px;
                    color: #94a3b8;
                    font-style: italic;
                }
            `);
        },

        createHistoryModal() {
            this.historyModal = document.createElement('div');
            this.historyModal.className = 'hand-recorder-history-modal';
            this.historyModal.id = 'hand-recorder-history-modal';
            this.historyModal.innerHTML = `
                <div class="hand-recorder-history-modal-header">
                    <div class="hand-recorder-history-modal-title">牌局历史记录</div>
                    <div class="hand-recorder-history-modal-close">×</div>
                </div>
                <div class="hand-recorder-history-content" id="hand-recorder-history-content">
                    <div class="hand-recorder-history-empty">暂无牌局记录</div>
                </div>
            `;
            document.body.appendChild(this.historyModal);

            // 绑定关闭按钮事件
            this.historyModal.querySelector('.hand-recorder-history-modal-close').addEventListener('click', () => {
                this.historyModal.classList.remove('show');
            });

            // 点击外部关闭
            this.historyModal.addEventListener('click', (e) => {
                if (e.target === this.historyModal) {
                    this.historyModal.classList.remove('show');
                }
            });
        },

        createControlPanel() {
            this.controlPanel = document.createElement('div');
            this.controlPanel.className = 'hand-recorder-control-panel';
            this.controlPanel.innerHTML = `
                <div class="hand-recorder-panel-header">
                    <div>VPIP数据插件</div>
                    <div class="hand-recorder-close-btn">×</div>
                </div>
                <button class="hand-recorder-control-button hand-recorder-btn-history" id="view-history-btn">
                    <span style="margin-right: 8px;">📋</span> 本地牌局记录
                </button>
                <button class="hand-recorder-control-button hand-recorder-btn-upload" id="view-uploader-btn">
                    <span style="margin-right: 8px;">📤</span> 上传数据
                </button>
                <button class="hand-recorder-control-button hand-recorder-btn-clear" id="clear-history-btn">
                    <span style="margin-right: 8px;">🗑️</span> 清除记录
                </button>
            `;
            document.body.appendChild(this.controlPanel);

            this.bindControlPanelEvents();
        },

        createToggleButton() {
            this.toggleBtn = document.createElement('button');
            this.toggleBtn.className = 'hand-recorder-toggle-btn';
            this.toggleBtn.innerHTML = '🃏';
            this.toggleBtn.setAttribute('data-panel-visible', 'false');

            // 加载上次保存的位置
            const savedPosition = this.loadToggleBtnPosition();
            if (savedPosition) {
                this.toggleBtn.style.left = savedPosition.left;
                this.toggleBtn.style.top = savedPosition.top;
                this.toggleBtn.style.transform = savedPosition.transform || 'none';
                Utils.log('已加载悬浮球保存的位置:', savedPosition);
            }

            // 添加拖动功能
            let isDragging = false;
            let hasMoved = false;
            let touchHandled = false;
            let startX, startY, initialX, initialY;

            // 触摸设备支持
            this.toggleBtn.addEventListener('touchstart', (e) => {
                const touch = e.touches[0];
                startX = touch.clientX;
                startY = touch.clientY;
                initialX = this.toggleBtn.offsetLeft;
                initialY = this.toggleBtn.offsetTop;
                isDragging = true;
                hasMoved = false;
                touchHandled = false;
            });

            this.toggleBtn.addEventListener('touchmove', (e) => {
                if (!isDragging) return;
                e.preventDefault();
                const touch = e.touches[0];
                const deltaX = touch.clientX - startX;
                const deltaY = touch.clientY - startY;
                
                if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
                    hasMoved = true;
                }
                
                this.toggleBtn.style.left = `${initialX + deltaX}px`;
                this.toggleBtn.style.top = `${initialY + deltaY}px`;
            });

            this.toggleBtn.addEventListener('touchend', (e) => {
                isDragging = false;
                if (hasMoved) {
                    const position = {
                        left: this.toggleBtn.style.left,
                        top: this.toggleBtn.style.top,
                        transform: this.toggleBtn.style.transform
                    };
                    this.saveToggleBtnPosition(position);
                }
                if (!hasMoved) {
                    e.stopPropagation();
                    e.preventDefault();
                    touchHandled = true;
                    
                    const isVisible = this.toggleBtn.getAttribute('data-panel-visible') === 'true';
                    const newState = !isVisible;
                    
                    this.toggleBtn.setAttribute('data-panel-visible', newState.toString());
                    this.controlPanel.style.display = newState ? 'block' : 'none';
                    
                    this.toggleBtn.style.transform = newState ? 'rotate(90deg)' : 'rotate(0deg)';

                    if (newState) {
                        this.positionPanelNearToggle();
                    }
                }
            });

            // 鼠标设备支持
            this.toggleBtn.addEventListener('mousedown', (e) => {
                startX = e.clientX;
                startY = e.clientY;
                initialX = this.toggleBtn.offsetLeft;
                initialY = this.toggleBtn.offsetTop;
                isDragging = true;
                hasMoved = false;
                e.preventDefault();
            });

            document.addEventListener('mousemove', (e) => {
                if (!isDragging) return;
                const deltaX = e.clientX - startX;
                const deltaY = e.clientY - startY;
                
                if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
                    hasMoved = true;
                }
                
                this.toggleBtn.style.left = `${initialX + deltaX}px`;
                this.toggleBtn.style.top = `${initialY + deltaY}px`;
            });

            document.addEventListener('mouseup', (e) => {
                if (isDragging) {
                    if (hasMoved) {
                        const position = {
                            left: this.toggleBtn.style.left,
                            top: this.toggleBtn.style.top,
                            transform: this.toggleBtn.style.transform
                        };
                        this.saveToggleBtnPosition(position);
                    }
                    isDragging = false;
                }
            });

            // 点击事件
            this.toggleBtn.addEventListener('click', (e) => {
                if (hasMoved) {
                    e.stopPropagation();
                    return;
                }
                
                if (touchHandled) {
                    e.stopPropagation();
                    touchHandled = false;
                    return;
                }
                
                e.stopPropagation();

                const isVisible = this.toggleBtn.getAttribute('data-panel-visible') === 'true';
                const newState = !isVisible;

                this.toggleBtn.setAttribute('data-panel-visible', newState.toString());
                this.controlPanel.style.display = newState ? 'block' : 'none';

                this.toggleBtn.style.transform = newState ? 'rotate(90deg)' : 'rotate(0deg)';

                if (newState) {
                    this.positionPanelNearToggle();
                }

                const position = {
                    left: this.toggleBtn.style.left,
                    top: this.toggleBtn.style.top,
                    transform: this.toggleBtn.style.transform
                };
                this.saveToggleBtnPosition(position);
            });

            document.body.appendChild(this.toggleBtn);
        },

        bindControlPanelEvents() {
            // 辅助函数：复位悬浮球角度
            const resetToggleButton = () => {
                if (this.toggleBtn) {
                    this.toggleBtn.setAttribute('data-panel-visible', 'false');
                    this.toggleBtn.style.transform = 'rotate(0deg)';
                }
            };

            // 查看历史按钮
            document.getElementById('view-history-btn').addEventListener('click', () => {
                this.showHistoryModal();
                this.controlPanel.style.display = 'none';
                resetToggleButton();
            });

            // 上传数据按钮
            document.getElementById('view-uploader-btn').addEventListener('click', () => {
                const uploader = document.getElementById('poker-uploader-container');
                uploader.style.display = 'block';
                this.controlPanel.style.display = 'none';
                resetToggleButton();
            });

            // 清除记录按钮
            document.getElementById('clear-history-btn').addEventListener('click', () => {
                if (confirm('确定要清除所有牌局记录吗？此操作不可恢复。')) {
                    DataManager.clearAllHandRecords();
                    alert('所有牌局记录已清除！');
                }
                this.controlPanel.style.display = 'none';
                resetToggleButton();
            });

            // 关闭按钮
            const closeBtn = this.controlPanel.querySelector('.hand-recorder-close-btn');
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.controlPanel.style.display = 'none';
                resetToggleButton();
            });
        },

        // 动态定位控制面板到悬浮球旁边
        positionPanelNearToggle() {
            const btnRect = this.toggleBtn.getBoundingClientRect();
            const panelRect = this.controlPanel.getBoundingClientRect();
            const padding = 10;

            let left, top;

            left = btnRect.right + padding;
            top = btnRect.top;

            if (left + panelRect.width > window.innerWidth - padding) {
                left = btnRect.left - panelRect.width - padding;
            }

            if (top + panelRect.height > window.innerHeight - padding) {
                top = window.innerHeight - panelRect.height - padding;
            }

            if (top < padding) {
                top = padding;
            }

            if (left < padding) {
                left = padding;
            }

            this.controlPanel.style.left = `${left}px`;
            this.controlPanel.style.top = `${top}px`;
            this.controlPanel.style.right = 'auto';
            this.controlPanel.style.bottom = 'auto';
        },

        // 显示历史记录模态框
        showHistoryModal() {
            const contentDiv = document.getElementById('hand-recorder-history-content');
            const handRecords = DataManager.getLocalHandRecords();

            if (handRecords.length === 0) {
                contentDiv.innerHTML = '<div class="hand-recorder-history-empty">暂无牌局记录</div>';
            } else {
                let html = '';
                handRecords.forEach(record => {
                    const dateStr = new Date(record.timestamp).toLocaleString();
                    html += `
                        <div class="hand-recorder-history-item">
                            <div class="hand-recorder-history-header">
                                <div>牌局 ID: ${record.gameId.substring(0, 8)}...</div>
                                <div class="hand-recorder-history-date">${dateStr}</div>
                            </div>
                            <div class="hand-recorder-history-players">玩家: ${record.players.length} 人</div>
                            <div class="hand-recorder-history-text">${record.textContent || '暂无文本记录'}</div>
                        </div>
                    `;
                });
                contentDiv.innerHTML = html;
            }

            this.historyModal.classList.add('show');
        },

        // 保存悬浮球位置
        saveToggleBtnPosition(position) {
            try {
                GM_setValue('hand_recorder_toggle_btn_position', JSON.stringify(position));
                Utils.log('悬浮球位置已保存:', position);
                return true;
            } catch (e) {
                Utils.error('保存悬浮球位置失败:', e);
                return false;
            }
        },

        // 加载悬浮球位置
        loadToggleBtnPosition() {
            try {
                const data = GM_getValue('hand_recorder_toggle_btn_position', null);
                if (data) {
                    return JSON.parse(data);
                }
                return null;
            } catch (e) {
                Utils.error('加载悬浮球位置失败:', e);
                return null;
            }
        }
    };

    // ==================== 主应用程序 ====================
    const HandRecorderApp = {
        init() {
            Utils.log(`VPIP数据上传插件 v${CONFIG.VERSION} 正在启动...`);

            // 初始化UI模块
            UIModule.init();

            // 初始化牌局分析模块
            HandAnalysisModule.init();

            // 启动定时批量上传功能
            HandAnalysisModule.startBatchUpload();

            // 设置全局点击事件监听
            this.setupGlobalEvents();

            Utils.log('VPIP数据上传插件 初始化完成');
        },

        setupGlobalEvents() {
            // 全局点击事件处理（隐藏控制面板和历史模态框）
            document.addEventListener('click', (e) => {
                const toggleBtn = e.target.closest('.hand-recorder-toggle-btn');
                const controlPanel = e.target.closest('.hand-recorder-control-panel');
                const historyModal = e.target.closest('.hand-recorder-history-modal');

                // 如果点击的是历史模态框内部，什么都不做
                if (historyModal) {
                    return;
                }

                // 如果点击的不是toggle按钮或控制面板，则隐藏控制面板
                if (!toggleBtn && !controlPanel) {
                    // 隐藏控制面板
                    if (UIModule.controlPanel && UIModule.controlPanel.style.display === 'block') {
                        UIModule.controlPanel.style.display = 'none';
                        if (UIModule.toggleBtn) {
                            UIModule.toggleBtn.setAttribute('data-panel-visible', 'false');
                            UIModule.toggleBtn.style.transform = 'rotate(0deg)';
                        }
                    }
                }
            });
        }
    };

    // ==================== 启动应用 ====================
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => HandRecorderApp.init());
    } else {
        HandRecorderApp.init();
    }

})();