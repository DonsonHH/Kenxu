// Announcement copy is versioned so a new notice is never hidden by an older
// notice's browser-local 24-hour preference. No subscription material belongs here.
const US3='Aether@US3🇺🇸';
export function userAnnouncements(nodes){
 if(!nodes.some(node=>node.name===US3))return [];
 return [{
  id:'us3-launch',revision:'2026-10-26.1',publishedAt:'2026-10-26',
  title:'美国 US3 新线路已上线',
  nodeName:US3,quota:'2 TB / 月',quotaLabel:'整机共享流量',
  message:'下载数据集、模型或其他大文件时，建议切换到普通美国 US3 线路。',
  steps:['先在客户端更新 Kenxu 订阅。','在「Donson - Proxy」中选择「'+US3+'」，完成下载后可切回原来的线路。'],
  note:'2 TB 为 US3 整台服务器每月共享额度，并非每人额度；住宅 IPv6 线路使用另一份额度。',
 }];
}
