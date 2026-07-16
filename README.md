# 销售广告中台

静态运营看板，包含：

- 月度广告数据复盘
- 无效低效看板
- 领星规则看板
- 批量投放看板

页面默认读取 `data/sales_ads_dashboard_data.json`。前端与数据处理脚本解耦，后续迁移公司内网或接入 API 时，只需修改 `assets/config.js` 中的数据地址。

## 本地预览

在项目目录运行：

```bash
python3 -m http.server 8765
```

浏览器打开：

```text
http://127.0.0.1:8765/
```

## 更新数据

先在销售中台输入文件目录运行统一数据脚本：

```bash
cd ~/Desktop/Codex销售中台输入文件
python3 build_sales_ads_dashboard_data.py --copy-module-json
```

然后用新生成的文件覆盖：

```text
data/sales_ads_dashboard_data.json
```

## GitHub Pages

该项目不需要构建工具。将整个目录推送到 GitHub 仓库后，在仓库设置中选择：

```text
Settings -> Pages -> Deploy from a branch -> main / root
```

页面发布后，GitHub Pages 会直接提供 `index.html`、`assets/` 和 `data/`。

## 内网/API 迁移

将 `assets/config.js` 改为公司接口地址：

```js
window.DASHBOARD_DATA_URL = "/api/sales-ads-dashboard";
```

接口返回结构保持与当前统一 JSON 一致，页面代码无需改动。
