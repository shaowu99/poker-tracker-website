# 扑克数据追踪器 (Poker Tracker)

这是一个专业的扑克玩家数据分析平台，用于分析玩家的统计数据、手牌历史和表现。

## 功能特性

- **玩家查询**：输入玩家用户名，查看详细统计数据
- **专业HUD数据**：VPIP、PFR、3Bet等专业扑克统计指标
- **位置分析**：按不同位置分析玩家表现
- **手牌范围可视化**：直观展示玩家的手牌选择范围
- **排行榜**：按牌桌统计玩家排名和胜率
- **实时数据**：从数据库获取最新的玩家数据

## 技术栈

- **前端**：HTML5, CSS3, JavaScript (ES6+)
- **样式**：Tailwind CSS
- **数据库**：Supabase (PostgreSQL)
- **后端**：Node.js (HTTP Server)

## 文件结构

```
poker-tracker-website/
├── index.html          # 首页
├── player.html         # 玩家详情页
├── leaderboard.html    # 排行榜页
├── css/
│   └── style.css       # 自定义样式
├── js/
│   ├── app.js          # 主应用逻辑
│   ├── supabase-client.js  # Supabase 客户端
│   └── cache-manager.js    # 缓存管理器
├── lib/
│   └── supabase.js     # Supabase 库
├── server.js           # Node.js 服务器
└── README.md
```

## 本地运行

1. 克隆项目
2. 安装依赖：
   ```bash
   npm install
   ```
3. 启动服务器：
   ```bash
   node server.js
   ```
4. 访问 `http://127.0.0.1:8080`

## 静态部署

该项目可以作为静态网站部署到 GitHub Pages、Netlify、Vercel 等平台。只需上传所有文件即可。

## 数据库配置

项目使用 Supabase 连接数据库，需要配置以下环境变量：

- `SUPABASE_URL`：Supabase 项目 URL
- `SUPABASE_ANON_KEY`：Supabase 匿名密钥

配置信息在 `lib/supabase.js` 中设置。

## 项目截图

![Poker Tracker Screenshot](screenshot.png) <!-- 需要添加实际截图 -->

## 贡献

欢迎提交 Issue 和 Pull Request 来改进项目。

## 许可证

MIT