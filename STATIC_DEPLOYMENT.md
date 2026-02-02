# 扑克数据追踪器 - 静态网站配置

## GitHub Pages 部署信息

### 部署步骤
1. 将代码推送到 GitHub 仓库的 `main` 分支
2. 在仓库设置中启用 GitHub Pages
3. 选择 `main` 分支作为源

### 静态资源说明
- 所有 HTML 文件都使用相对路径引用 CSS 和 JavaScript 文件
- 使用 CDN 加载外部资源（如 Tailwind CSS）
- 客户端使用 Supabase 进行数据库连接

### 部署注意事项
1. 确保所有文件路径正确（CSS、JS、图片等）
2. 检查外部资源链接是否可用
3. 验证网站在不同浏览器中的兼容性

### 项目结构
```
/
├── index.html          # 首页
├── player.html         # 玩家详情页
├── leaderboard.html    # 排行榜页
├── test-connection.html # 数据库连接测试页
├── test-db.html       # 数据库测试页
├── css/
│   └── style.css      # 自定义样式
├── js/
│   ├── app.js         # 主应用逻辑
│   ├── supabase-client.js # Supabase 客户端
│   └── cache-manager.js # 缓存管理
├── lib/
│   └── supabase.js    # Supabase 库文件
├── .gitignore         # Git 忽略文件配置
├── package.json       # Node.js 依赖配置
└── server.js          # 本地开发服务器
```

### 静态部署要求
- 项目使用纯 HTML/CSS/JavaScript，无需服务器端处理
- 所有数据通过 JavaScript 和 Supabase API 从数据库获取
- 适合静态托管服务（GitHub Pages、Netlify、Vercel 等）

### GitHub Pages 配置
- 源代码分支: `main`
- 部署目录: `/ (root)`
- 自定义域名: (可选)

### 本地开发服务器
项目包含一个简单的 Node.js 服务器 (`server.js`) 用于本地开发和测试。

### 环境变量
如果需要部署到生产环境，请在 `lib/supabase.js` 中配置 Supabase 项目 URL 和匿名密钥。