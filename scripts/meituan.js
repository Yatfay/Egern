// 美团系去广告（Egern 原生脚本）
// 来源：zirawell/R-Store Res/Scripts/AntiAd/meituan.js（美团 linglong 图片）
//       与 zirawell/Ad-Cleaner Collection/js/dianping.js（大众点评图片，
//       同作者对 R-Store 旧版 dianping.js 的修订），按 Egern ctx API 重写。
// 两个入口共用一份脚本，模块里按 match 分开挂载；入口正则已先过滤，
// 这里再按 URL 分派一次是防御性的。
// 注意：原脚本是挂在 http-response 上的 response 脚本，这里保持同样的挂载方式，
// 只用 ctx.request 的 URL 与请求头做判断，不读响应体。
// 2026-11-27：DP_SCRIPT 开关已并入模块的 DP_OFF 总开关，脚本内不再判断。

function hasHeader(headers, name) {
  return headers ? headers.has(name) : false;
}

// ---------- 美团：p*.meituan.net/linglong/ 图片 ----------
// 原逻辑：按请求头与图片尺寸判断是不是广告图；广告图返回 204，内容图透传。
function meituanLinglong(ctx) {
  const url = ctx.request.url;
  const headers = ctx.request.headers;
  // 会员权益图片修复：@1sc 结尾的保留。注意原脚本把这个判断写在 urlRegex
  // 分支里，但带 @1sc 的 URL 永远匹配不上那个带 $ 锚点的正则，所以原判断
  // 是死代码、实际并不生效；这里提到分支前，让它真正起作用。
  if (url.endsWith('@1sc')) return undefined;
  const urlRegex = /^https?:\/\/p\d\.meituan\.net\/linglong\/\w+\.(gif|jpg|webp|png)$/;
  const iconRegex1 = /\.(gif|jpg|webp|png)@(132w_96h|186w_135h|1284w|250w_0h|400w_0h|700w_0h|1200w_0h)/;
  const iconRegex2 = /%(4088h_88w|40115h_115w|4047h_189w|40157h_189w)_1e_1l\.(gif|jpg|webp|png)/;
  let removeFlag = true;
  if (urlRegex.test(url)) {
    // 带 ai/dt/al/u 任一请求头的当作广告
    const traceKey = ['ai', 'dt', 'al', 'u'].some((k) => hasHeader(headers, k));
    removeFlag = traceKey ? true : false;
  } else {
    const atIndex = url.lastIndexOf('@');
    const dimStr = atIndex === -1 ? '-1' : url.substring(atIndex + 1);
    // 方形尺寸（宽高相等或差 1）的是内容图，保留
    if (dimStr !== '-1' && isSquare(dimStr)) removeFlag = false;
    // 图标尺寸保留
    if (iconRegex1.test(url) || iconRegex2.test(url)) removeFlag = false;
  }
  if (removeFlag) return { status: 204, headers: {}, body: '' };
  return undefined;
}

function isSquare(str) {
  const w = str.match(/(\d+)w/);
  const h = str.match(/(\d+)h/);
  if (!w || !h) return false;
  const width = parseInt(w[1], 10);
  const height = parseInt(h[1], 10);
  return width === height || Math.abs(width - height) === 1;
}

// ---------- 大众点评：img.meituan.net/dpmobile/ ----------
// 新逻辑（zirawell/Ad-Cleaner Collection/js/dianping.js，同作者对 R-Store 旧版的修订）：
// 只要请求带 m-shark-traceid 请求头即视为广告请求，返回 204；其余透传。
// 旧版还要同时满足“有 m-traceid、无 ai/dt/al/u 身份头”才拦截，并对 .gif /
// &lossless=1 返回 1x1 透明图；新版把这两项都去掉了。goodsawardpic 不再走脚本，
// 由模块里的 url_rewrite 整路径 reject-img（同 Ad-Cleaner）。
function dianpingImage(ctx) {
  const headers = ctx.request.headers;
  if (hasHeader(headers, 'm-shark-traceid')) return { status: 204, headers: {}, body: '' };
  return undefined;
}

export default async function (ctx) {
  const url = ctx.request.url;
  if (url.includes('/linglong/')) return meituanLinglong(ctx);
  if (url.includes('/dpmobile/') || url.includes('/goodsawardpic/')) return dianpingImage(ctx);
  return undefined;
}
