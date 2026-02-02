# 将项目推送到 GitHub 的步骤

## 第一步：安装 Git
1. 访问 https://git-scm.com/download/win 下载 Git for Windows
2. 安装 Git，确保在安装过程中选择 "Add Git to PATH" 选项
3. 安装完成后，重新打开命令提示符

## 第二步：配置 Git（首次使用时）
打开命令提示符，运行以下命令：
```bash
git config --global user.name "你的GitHub用户名"
git config --global user.email "你的邮箱地址"
```

## 第三步：初始化项目并推送
1. 打开命令提示符，导航到项目目录：
```bash
cd C:\Users\Administrator\Nutstore\1\数据库版本\poker-tracker-website
```

2. 初始化 Git 仓库（如果尚未初始化）：
```bash
git init
git add .
git commit -m "Initial commit: 扑克数据追踪器项目"
```

3. 在 GitHub 上创建一个新的仓库：
   - 登录 GitHub
   - 点击 "New repository" 按钮
   - 输入仓库名称（例如：poker-tracker-website）
   - 选择 "Public" 或 "Private"
   - 不要勾选 "Initialize this repository with a README"
   - 点击 "Create repository"

4. 将本地仓库连接到 GitHub 仓库：
```bash
git remote add origin https://github.com/你的用户名/你的仓库名.git
git branch -M main
git push -u origin main
```

## 第四步：用于静态部署的注意事项
由于这是一个前端项目，你可以通过以下方式在 GitHub Pages 上部署：
1. 推送代码到 GitHub 后，在 GitHub 仓库页面点击 "Settings"
2. 在左侧菜单中选择 "Pages"
3. 在 "Source" 部分选择 "Deploy from a branch"
4. 选择 "main" 分支和 "/" 文件夹
5. 点击 "Save"

## 如果遇到错误
如果推送过程中遇到错误，可以尝试以下步骤：
1. 检查远程仓库地址是否正确：`git remote -v`
2. 如果地址错误，重新设置：`git remote set-url origin https://github.com/你的用户名/你的仓库名.git`
3. 如果有冲突，可能需要先拉取远程代码：`git pull origin main --allow-unrelated-histories`

## 项目特性
这是一个完整的扑克数据追踪网站，包含以下功能：
- 玩家数据查询和分析
- 专业的扑克统计指标（VPIP、PFR、3Bet等）
- 排行榜功能
- 手牌范围可视化
- 响应式设计，支持移动设备