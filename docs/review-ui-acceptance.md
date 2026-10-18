# 三批交互打磨：合并验收与兼容性收尾

日期：2026-10-18（北京时间）。基线：`43d0258`。这是三批结束后的验收收尾，不是新增第四套视觉设计；没有推送或部署。

## 第三批复查与实际发现

先重新阅读选择器、教程阅读观察器、两端 CSS 与前两批弹窗交互，复跑第三批专项及原教程回归。常规行为通过；扩大验收后发现两个此前未覆盖的问题，并按失败测试 → 修复 → 同路径重测处理。

| Before | After | Why |
| --- | --- | --- |
| 高对比度下，系统替换了按钮背景和阴影，选中／未选中看起来一致 | 只在 forced-colors 模式给选中项增加系统色静态轮廓，焦点使用独立虚线轮廓 | 不依赖颜色和阴影识别选中状态，也不禁用用户系统配色 |
| WebKit 的鼠标点击不一定先聚焦按钮，弹窗从 activeElement 记错返回点 | 各调用处传入真实 opener，并在原生 showModal 前聚焦它 | 保留原生关闭恢复，不猜测浏览器、加计时器或劫持原型 |

高对比度复现时：选中与未选中 computed background 相同，文字相同，box-shadow 为 none，选中 outline-style 为 none；修复后显示 1px solid 系统色轮廓。处理依据见 [MDN forced-colors](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/forced-colors)，没有通过 forced-color-adjust:none 覆盖用户偏好。

WebKit 的复现记录中，点击编辑按钮后 activeElement 仍为主内容区而非按钮。仅依据 activeElement 建返回点不足。修复是明确已有交互的触发者；新建、编辑、重置、账号用量及节点用量全部覆盖，不改变请求、授权或表单处理。临时诊断日志已移除。

## 合并验收范围

- `test/browser-acceptance.mjs` 纳入常规浏览器回归：高对比度下的图表／设备／步骤／管理端页签；连续 12 次页面与设备切换只保留一组四步观察器；隐藏或退出后观察器目标为零。
- 移除浏览器的 IntersectionObserver 后，真实登录、设备选择、手动步骤和个人订阅导航仍可使用。15 秒空闲窗口内没有新增用量读取或持续装饰动画；不把这段检查夸大为长时压力测试。
- `test/browser-compatibility.mjs` 是独立跨引擎检查：真实登录错误及重试、键盘范围选择、复制后的按钮几何、教程指令、2x DPR 的 390px 深色布局、手机菜单焦点、低动态、全部原生弹窗返回点、真实 401 清理，以及个人导出逐字节不变。
- 所有浏览器均为无个人资料的隔离实例；测试使用临时 SQLite 与虚构凭据。剪贴板只在浏览器边界模拟，不读取 OS 剪贴板，不连接真实节点或第三方服务。
- 全套回归曾出现全局「关闭」定位歧义；测试现明确点击目标弹窗，同时新增“只打开一个弹窗、其余均 inert”的断言。没有用单纯重跑、跳过安全断言或去掉焦点检查掩盖失败。

### 跨引擎结果

本机已安装的运行时实测，无浏览器下载：

| 引擎 | 版本 | 结果 | 顶层过渡支持 |
| --- | --- | --- | --- |
| Edge | 155.0.4283.45 | 上述专项通过 | 支持，测试原生过渡路径 |
| Firefox | 155.0 | 上述专项通过 | overlay 不支持，测试即时降级路径 |
| WebKit | 26.6 | 上述专项通过 | overlay 不支持，测试即时降级路径 |

WebKit 运行时不是实机 Safari／iPhone 验证。跨引擎专项不是每个引擎都执行全部常规回归；不要把这两种覆盖范围混称。

## 资源测量

从三批改动前的 `ffac2cc` 到本轮构建文件：

| 产物 | 原始大小变化 | gzip 原大小 → 当前大小 |
| --- | --- | --- |
| public/client.js | +8,513 字节 | 23,751 → 26,643 字节 |
| public/portal.css | +7,063 字节 | 17,724 → 19,184 字节 |

两个文件合计 gzip 增加 4,352 字节（4.25 KiB），未增加运行时依赖。这是本地压缩体积，不是线上传输、LCP、FPS 或延迟测试。未使用虚构性能提升百分比。

## 可复跑命令

```powershell
node scripts/build.mjs
node --run test
$env:PLAYWRIGHT_CHANNEL='msedge'
node --run test:browser
node --run test:compat
```

跨引擎脚本默认使用已经安装且版本匹配的 Playwright 引擎，找不到的会在结果中明确记录 skipped，不自动安装。可通过 `PLAYWRIGHT_FIREFOX_EXECUTABLE`／`PLAYWRIGHT_WEBKIT_EXECUTABLE` 指向本机已有兼容运行时。本轮明确指定了本机缓存路径，三项均实测通过，无 skipped。

`PLAYWRIGHT_COMPAT_ENGINES` 可选 `edge,firefox,webkit` 中的逗号列表；默认三种。体积对比为可选项：设置 `KENXU_UI_BASELINE=ffac2cc` 才读取历史 Git 对象，浅克隆未设置时仍可运行功能检查。机器结果在忽略目录 `test-output/acceptance/results.json` 与 `test-output/compatibility/results.json`，含版本、覆盖和生成时间。

## 边界与 verdict

未改变页面布局、正常配色、教程内容、分流、节点、计量、API、账号、Cloudflare 或生产进程。旧的 `prototypes/round-one/` 保留但不进入构建或本次提交。

本轮只新增两个兼容性修复和可复跑验收，没有再添加动效。Approve 的范围是上述当前本地源码与测试；正式上线仍须另行确认推送／部署。最终构建与完整回归结论在提交前记录。

最终结论：79 项核心测试通过，17 个常规浏览器回归脚本完整串行运行并成功退出，三引擎兼容性专项均通过且没有 skipped。`client.js` 与 `portal.css` 重复构建后的 SHA-256 一致；语法检查、`git diff --check` 通过，临时诊断已清理。已查看修复后的高对比度选择框和 WebKit 2x DPR 手机截图；未发现需要阻止本次本地提交的遗留问题。
