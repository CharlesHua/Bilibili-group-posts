
# Bilibili-group-posts  分组显示动态 Chrome 扩展

这是一个 Chrome 扩展，用于在 Bilibili 动态页按关注分组查看动态。通过该扩展，你可以更方便地分组查看你关注的UP主的动态。

## 功能特性

- **按分组查看动态**：在 Bilibili 动态页，按关注分组筛选动态。
- **手动更新分组**：支持手动更新关注分组数据。
- **自动更新**：每天自动更新分组数据。（待检查）

## 安装步骤

### 1. 下载代码
将项目代码下载到本地：

```bash
git clone https://github.com/你的用户名/你的仓库名.git
```

### 2. 加载扩展
1. 打开 Chrome 浏览器，进入 `chrome://extensions/`。
2. 启用右上角的 **开发者模式**。
3. 点击 **加载已解压的扩展程序**，选择项目根目录。

### 3. 使用扩展
1. 打开 Bilibili 网站并登录。
2. 点击扩展图标，弹出分组管理页面，可以勾选哪些分组显示在动态页中。

注意，第一次关闭扩展图标的页面时，可能无法记录修改，请多试几次。

3. 在 Bilibili 动态页(t.bilibili.com)，选择想要查看的分组tab，将显示该组的动态。显示动态较少时，需要手动向下翻动页面，触发加载。

## 文件结构

```
bilibili-group-dynamics-extension/
├── manifest.json          # 扩展配置文件
├── background.js          # 后台脚本，负责定时更新分组数据
├── content.js             # 内容脚本，负责在 Bilibili 动态页面插入分组功能
├── popup.js               # 弹出页面脚本，负责分组管理 UI 逻辑
├── popup.html             # 弹出页面 HTML
├── icon.png               # 扩展图标
└── README.md              # 项目说明文件
```

## 开发指南

### 依赖
- Chrome 浏览器（支持 Manifest V3）。

### 修改代码
1. 修改 `content.js` 可以调整动态筛选逻辑。
2. 修改 `popup.js` 和 `popup.html` 可以调整分组管理页面的 UI 和行为。
3. 修改 `background.js` 可以调整分组数据的更新逻辑。

### 调试
1. 打开 Chrome 开发者工具（F12），切换到 **扩展** 标签页。
2. 在 **Service Worker** 部分调试 `background.js`。
3. 在 **Content Script** 部分调试 `content.js`。

## 贡献指南

欢迎提交 Issue 和 Pull Request！如果你有新的功能建议或发现了 Bug，请随时反馈。

## 许可证

本项目基于 [MIT 许可证](LICENSE) 开源。

>>>>>>> c34655c (Initial commit)
>>>>>>> fd64f82 (first commit)
