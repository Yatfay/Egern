// 京东去广告 —— Egern 原生移植
// 移植自：zbsdsb 京东去广告 v2（loon-adblock-plugins JD_remove_ads_v2.js，2026-08-12，基于 RuCu6 / Maasea / kelee 原插件）
// 融合：zirawell R-Store jd.js（2026-05-20）的 readCustomSurfaceList 底部导航过滤与订单页细节清理
// 适配京东 App 15.9.50+ 新协议：响应体可能整体 base64 编码；无广告可清时原样放行
// Egern 运行时：export default async (ctx)，ctx.response.text() 读响应体，return { body } 改写，不返回即透传

export default async function(ctx) {
  const url = ctx.request.url;
  if (!/^https?:\/\/api\.m\.jd\.(com|hk)\/client\.action/.test(url)) return;
  const body = await ctx.response.text();
  if (!body || typeof body !== 'string') return;

  // ---------- 纯 JS base64 / UTF-8 工具（不依赖 atob / btoa / TextDecoder） ----------
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

  function b64DecodeBytes(str) {
    str = str.replace(/\s+/g, '').replace(/=+$/, '');
    const out = [];
    let buf = 0, bits = 0;
    for (let i = 0; i < str.length; i++) {
      const c = B64.indexOf(str[i]);
      if (c === -1) continue;
      buf = (buf << 6) | c;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out.push((buf >> bits) & 0xff);
      }
    }
    return out;
  }

  function bytesToUtf8(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 8192) {
      s += String.fromCharCode.apply(null, bytes.slice(i, i + 8192));
    }
    try { return decodeURIComponent(escape(s)); } catch (e) { return s; }
  }

  function utf8ToBytes(s) {
    return unescape(encodeURIComponent(s));
  }

  function b64EncodeStr(str) {
    const bytes = utf8ToBytes(str);
    let out = '';
    let i = 0;
    while (i < bytes.length) {
      const c1 = bytes.charCodeAt(i++) & 0xff;
      const c2 = i < bytes.length ? bytes.charCodeAt(i++) & 0xff : NaN;
      const c3 = i < bytes.length ? bytes.charCodeAt(i++) & 0xff : NaN;
      out += B64[c1 >> 2];
      out += B64[((c1 & 3) << 4) | ((isNaN(c2) ? 0 : c2) >> 4)];
      out += isNaN(c2) ? '=' : B64[((c2 & 15) << 2) | ((isNaN(c3) ? 0 : c3) >> 6)];
      out += isNaN(c3) ? '=' : B64[c3 & 63];
    }
    return out;
  }

  // ---------- 广告清洗规则 ----------
  // 楼层黑名单（合并自原插件各接口规则，按 mId 匹配）
  const FLOOR_BLACKLIST = [
    // 物流页
    'banner', 'jdDeliveryBanner',
    // 订单页
    'bannerFloor', 'bpDynamicFloor', 'plusFloor',
    // 我的页
    'bigSaleFloor', 'buyOften', 'newAttentionCard', 'newBigSaleFloor',
    'newStyleAttentionCard', 'newsFloor', 'noticeFloor', 'recommendfloor'
  ];

  // 首页 welcomeHome 广告楼层（按 type 匹配）
  const HOMEFLOOR_DEL = [
    'bottomXview', // 底部悬浮通栏推广
    'float',       // 悬浮推广小圆图
    'photoCeiling',// 顶部通栏动图推广
    'ruleFloat',   // 资质与规则
    'searchIcon',  // 右上角消费券
    'topRotate',   // 左上角 logo
    'tabBarAtmosphere' // 底部悬浮通栏推广
  ];

  // 我的页 iconToolFloor 保留入口（排序用）
  const ICON_SORT = [
    'applezhushou', 'lingjindouxin', 'dongdongnongchangxin', 'chongwangwang',
    'kehufuwu', 'xianzhiguanjia', 'wenyisheng', 'jijianfuwu',
    'zhuanzuanhongbao', 'huanletaojin'
  ];

  // 底部导航 readCustomSurfaceList 保留入口（zirawell）
  const CUSTOM_SURFACE_NAME_INCLUDE = [
    'index',      // 首页
    'messagenew', // 消息
    'cart',       // 购物车
    'home'        // 我的
  ];

  function cleanFloors(p) {
    let changed = false;
    if (!Array.isArray(p.floors) || p.floors.length === 0) return false;
    const before = p.floors.length;
    p.floors = p.floors.filter(f => {
      if (!f || typeof f !== 'object') return true;
      if (FLOOR_BLACKLIST.indexOf(f.mId) !== -1) return false;
      return true;
    });
    if (p.floors.length !== before) changed = true;

    for (const f of p.floors) {
      if (!f || typeof f !== 'object') continue;
      const d = f.data;
      if (f.mId === 'basefloorinfo' && d && typeof d === 'object') {
        // 我的页：弹窗 / 底部会员续费横幅 / 右下角动图
        if (d.commonPopup !== undefined) { delete d.commonPopup; changed = true; }
        if (d.commonPopup_dynamic !== undefined) { delete d.commonPopup_dynamic; changed = true; }
        if (Array.isArray(d.commonTips) && d.commonTips.length) { d.commonTips = []; changed = true; }
        if (Array.isArray(d.commonWindows) && d.commonWindows.length) { d.commonWindows = []; changed = true; }
        if (d.floatLayer !== undefined) { delete d.floatLayer; changed = true; }
      } else if (f.mId === 'iconToolFloor' && d && typeof d === 'object' && Array.isArray(d.nodes)) {
        // 我的页：底部工具栏只留常用入口
        for (let gi = 0; gi < d.nodes.length; gi++) {
          if (Array.isArray(d.nodes[gi]) && d.nodes[gi].length) {
            const beforeLen = d.nodes[gi].length;
            d.nodes[gi] = d.nodes[gi]
              .filter(i => i && ICON_SORT.indexOf(i.functionId) !== -1)
              .sort((a, b) => ICON_SORT.indexOf(a.functionId) - ICON_SORT.indexOf(b.functionId));
            if (d.nodes[gi].length !== beforeLen) changed = true;
          }
        }
      } else if (f.mId === 'orderIdFloor' && d && typeof d === 'object') {
        // 我的页：发布评价提醒
        if (d.commentRemindInfo && Array.isArray(d.commentRemindInfo.infos) && d.commentRemindInfo.infos.length) {
          d.commentRemindInfo.infos = [];
          changed = true;
        }
      } else if (f.mId === 'userinfo' && d && typeof d === 'object') {
        // 我的页：开通 plus 会员卡片
        if (d.newPlusBlackCard !== undefined) { delete d.newPlusBlackCard; changed = true; }
      } else if (f.mId === 'virtualServiceCenter' && d && typeof d === 'object') {
        // 订单页服务中心：去掉「精选特惠」卡片（zirawell）
        if (Array.isArray(d.virtualServiceCenters)) {
          for (const item of d.virtualServiceCenters) {
            if (Array.isArray(item?.serviceList)) {
              const beforeLen = item.serviceList.length;
              item.serviceList = item.serviceList.filter(c => c?.serviceTitle !== '精选特惠');
              if (item.serviceList.length !== beforeLen) changed = true;
            }
          }
        }
      } else if (f.mId === 'customerServiceFloor' && d && typeof d === 'object') {
        // 订单页客户服务：去掉「点此获得更多服务」引导（zirawell）
        if (d.moreText) {
          delete d.moreIcon;
          delete d.moreIcon_dark;
          d.moreText = ' ';
          changed = true;
        }
      }
    }
    return changed;
  }

  function cleanPayload(p) {
    let changed = false;

    // 开屏广告（start / startup 完整配置）
    if (Array.isArray(p.images)) {
      if (p.images.length) { p.images = []; changed = true; }
      if (p.showTimesDaily !== undefined) { p.showTimesDaily = 0; changed = true; }
    }

    // 首页配置 welcomeHome
    if (Array.isArray(p.floorList) && p.floorList.length) {
      const before = p.floorList.length;
      p.floorList = p.floorList.filter(i => !(i && HOMEFLOOR_DEL.indexOf(i.type) !== -1));
      if (p.floorList.length !== before) changed = true;
    }
    if (Array.isArray(p.webViewFloorList) && p.webViewFloorList.length) {
      p.webViewFloorList = [];
      changed = true;
    }

    // 物流页 deliverLayer / orderTrackBusiness
    if (p.bannerInfo !== undefined) { delete p.bannerInfo; changed = true; }

    // 新品页 getTabHomeInfo
    if (p.result && typeof p.result === 'object') {
      if (p.result.iconInfo !== undefined) { delete p.result.iconInfo; changed = true; }
      if (p.result.roofTop !== undefined) { delete p.result.roofTop; changed = true; }
    }

    // 订单页 / 我的页 / 物流页 楼层清洗（含 others.floors，新版个人页结构）
    if (cleanFloors(p)) changed = true;
    if (p.others && typeof p.others === 'object' && cleanFloors(p.others)) changed = true;

    return changed;
  }

  // 底部导航 readCustomSurfaceList：只保留首页 / 消息 / 购物车 / 我的（zirawell）
  function cleanNav(root) {
    let changed = false;
    if (!root || typeof root !== 'object') return false;
    const modeMap = root.result?.modeMap;
    if (!modeMap || typeof modeMap !== 'object') return false;
    for (const mode of ['dark', 'normal']) {
      const nav = modeMap[mode]?.navigationAll;
      if (Array.isArray(nav) && nav.length) {
        const kept = nav.filter(i => CUSTOM_SURFACE_NAME_INCLUDE.includes(i?.functionId));
        if (kept.length !== nav.length) { modeMap[mode].navigationAll = kept; changed = true; }
      }
    }
    return changed;
  }

  // ---------- 主流程 ----------
  // 大响应直接放行（如 basicConfig 800KB，无广告清洗点）
  if (body.length > 2000000) return;

  let obj = null;
  let isB64 = false;

  // 1) 明文 JSON（老协议 / 非 base64 响应）
  try {
    obj = JSON.parse(body);
  } catch (e) {
    // 2) base64 JSON（京东 15.9.50+ 新协议）
    if (/^[A-Za-z0-9+/=]+$/.test(body) && body.length % 4 === 0) {
      try {
        obj = JSON.parse(bytesToUtf8(b64DecodeBytes(body)));
        isB64 = true;
      } catch (e2) { obj = null; }
    }
  }

  if (!obj || typeof obj !== 'object') return;

  // 解包装：{"code":..,"data":{..}} → 清洗 data 层；其它结构 → 直接清洗
  let target = obj;
  if (!Array.isArray(obj) && obj.data && typeof obj.data === 'object') {
    target = obj.data;
  }

  let changed = cleanPayload(target);
  if (cleanNav(obj)) changed = true;
  if (target !== obj && cleanNav(target)) changed = true;

  if (!changed) return;
  return { body: isB64 ? b64EncodeStr(JSON.stringify(obj)) : JSON.stringify(obj) };
}
