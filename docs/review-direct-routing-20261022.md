# 2026-10-22：高流量目的主机精确直连

本次为私有配置源的全站规则变更，不是门户代码发布。不改变节点、授权、凭据、个人组选项、订阅链接或历史账本；不重启门户、节点、采集器或 Tunnel，不自动操作本机客户端。

## 匹配范围

在现有规则之前加入以下四条精确规则，其他规则原序保留：

```yaml
- DOMAIN,api.wanfeng.me,DIRECT
- DOMAIN,amd.entitlenow.com,DIRECT
- DOMAIN,amd-ax-dl.entitlenow.com,DIRECT
- DOMAIN,amd-ax-dlf.entitlenow.com,DIRECT
```

不对整个 `wanfeng.me` 或 `entitlenow.com` 使用后缀通配，不改变 OpenAI／Claude／其他 AI 的既有分流。保留此前的 `DOMAIN,cdn.4399ssjj.com,DIRECT`。

## 核查证据

- 用户截图中的主机名与门户现存连接字节记录吻合。API 主机以上传为主；AMD 字节以下载为主。只查询这些目的主机的汇总，不复制其他用户的完整浏览历史或来源 IP。
- Windows 本机运行中的 Clash 为 rule 模式，TUN 关闭，默认路由未见透明代理接管。显式绕过 HTTP 代理进行直连对照，没有切换节点或修改系统代理。
- 使用默认 TLS 证书校验的 Node 请求，API 首页直连返回 200，未提供密钥的 `/v1/models` 返回 JSON 401 `API_KEY_REQUIRED`；代理路径返回相同应用状态。未发送密钥或发起付费模型请求。
- `amd.entitlenow.com` 直连返回 200；`amd-ax-dl.entitlenow.com` 根目录返回 302，指向 `amd-ax-dlf.entitlenow.com`，后者直连返回 200。因此补充这个明确观察到的下载跳转主机，而不是扩大整个域名。
- Windows curl 对 API 的首次请求遇到证书吊销服务离线，直连和代理均出现。没有使用 `-k` 或关闭 TLS 校验；另用默认验证的 Node TLS 栈完成应用层对照。不把 Windows 吊销查询失败当作目的站不可直连。

[AMD 官方下载说明](https://www.amd.com/en/products/software/adaptive-socs-and-fpgas/licensing-faq.html)确认工具下载使用 Akamai／entitlenow。[官方支持论坛中的下载记录](https://adaptivesupport.amd.com/s/question/0D74U000007uWhKSAU/vivado-20241-installation-hangs-at-generating-installed-device-list-on-ubuntu-22041-lts?language=en_US)也包含该下载主机。用途说明、实际可达性与吞吐速度分别判断：本次没有使用 AMD 登录状态获取新的签名地址，也没有为测试下载大文件，不能将根目录返回 200／302 称为大文件速度验证。

## 变更与验收

本地隔离夹具已验证规则去重、顺序、Clash／Stash 输出和节点专用 Shadowrocket 输出；79 项核心回归通过。执行前检查现有用户全部继承全局规则，发现个人补充／独立模式时脚本拒绝继续，避免“改全局”却漏掉账号。

维护工具和原规则备份保留在私有目录，不提交源配置、密钥、订阅 URL 或数据库。写入采用事务和前置状态比对；修改后按源内容及已交付正文核查仅有这四条差异，历史账本按变更前截止点核查，避免将期间正常新增用量当作变更。

线上已写入并核查：7 个普通账号均使用全局规则，其中 6 个当前具备领取条件。逐份读取其 Clash、Stash、Shadowrocket 共 18 份配置，在回环与公网入口分别核对；Clash／Stash 只有这四条精确规则的差异，Shadowrocket 正文保持不变。原 4399 规则保留。账号、授权、个人规则及组选项、计量凭据、签名密钥和截止点前历史账本摘要一致，数据库完整性及外键检查通过。

初次写入后的订阅读取发生网络超时。未重复 apply、改节点或放宽断言；独立只读 verify 随后在两个入口全部通过。超时的具体原因未确认，不据此声称修复了门户或网络问题。维护脚本只输出错误首行，避免失败差异携带私有配置。私有原规则备份权限为 0600。

Review：通过上述规则变更与远程交付检查。没有新增宽泛后缀规则、扩大节点权限、重置历史账本或主动打断用户连接。入口可达性不是大文件吞吐量保证，后续下载体验由正常使用反馈确认。

Clash／Stash 用户刷新原订阅即可取得规则。更新周期仍为 720 分钟；已有连接不会因服务端规则改变而自动改道，必要时由用户重连对应下载／API 会话。Shadowrocket 当前是纯节点订阅，不携带分流规则，本次保持原状。
