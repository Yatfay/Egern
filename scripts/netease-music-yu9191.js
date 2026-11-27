// 网易云音乐去广告（Yu9191 版，Egern 原生脚本）
// 来源：Yu9191/NeteasemusicAd@2026-11-25（src/ 未压缩源码），按 Egern ctx API 重写。
// eapi 响应为 AES-128-ECB 加密（密钥 e82ckenh8dichen8），需先解密再改 JSON、再加密；
// 若解密或解析失败则原样透传。
// AES 实现与仓库内 netease-music.js 相同（已用平台加密算法对照验证）。
//
// 未移植的部分（见模块文件注释）：
// - 设置页（wyy-settings 请求入口 + 侧边栏设置入口注入）：BoxJS 式应用内设置页，
//   Egern 没有等价机制；全部开关与输入框改由模块 env_schema 提供。
// - 假 VIP 解锁（vip.mjs）：源码中未接入路由的死代码，且引用不存在的 function/vip.mjs；
//   属于解锁而非去广告，不移植。
// - 歌曲播放菜单 songMore：路由表里有但 .lpx 没有对应脚本入口，从不触发，死代码，不移植。
//
// 环境变量（由模块 compat_arguments 传入）：
//   底部 Tab（true = 隐藏）：FX / MY / DT / GZ / SOU；自定义名称 SY_NAME / WD_NAME /
//   MY_NAME / DT_NAME / FX_NAME / SOU_NAME；顺序 BOTTOM_ORDER（逗号分隔，空 = 原顺序）
//   顶部 Tab（true = 显示）：XD / YY / BK / TS / HDTAB；自定义名称 XD_NAME / TJ_NAME /
//   YY_NAME / BK_NAME / TS_NAME；顺序 TOP_ORDER
//   首页卡片（true = 显示）：PRGG / PRDRD / PRSCVPT / PRST / HMPR / PRRR / PRRK /
//   PRMST / PRCN / PRPRS / PRRSS
//   关注列表：FOLLOW_TIP（true = 显示“没关注你”提示）、FOLLOW_TEXT（提示文字，空 = 默认）
//   调试：LogLevel（off / error / warn / info / debug / all，默认 info）

const EAPI_KEY = new TextEncoder().encode('e82ckenh8dichen8');

// ---------- AES-128-ECB（FIPS-197，纯 JS 实现） ----------
const SBOX = [
  0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,
  0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,
  0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,
  0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,
  0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,
  0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,
  0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,
  0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,
  0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,
  0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,
  0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,
  0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,
  0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,
  0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,
  0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,
  0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16
];
const INV_SBOX = [
  0x52,0x09,0x6a,0xd5,0x30,0x36,0xa5,0x38,0xbf,0x40,0xa3,0x9e,0x81,0xf3,0xd7,0xfb,
  0x7c,0xe3,0x39,0x82,0x9b,0x2f,0xff,0x87,0x34,0x8e,0x43,0x44,0xc4,0xde,0xe9,0xcb,
  0x54,0x7b,0x94,0x32,0xa6,0xc2,0x23,0x3d,0xee,0x4c,0x95,0x0b,0x42,0xfa,0xc3,0x4e,
  0x08,0x2e,0xa1,0x66,0x28,0xd9,0x24,0xb2,0x76,0x5b,0xa2,0x49,0x6d,0x8b,0xd1,0x25,
  0x72,0xf8,0xf6,0x64,0x86,0x68,0x98,0x16,0xd4,0xa4,0x5c,0xcc,0x5d,0x65,0xb6,0x92,
  0x6c,0x70,0x48,0x50,0xfd,0xed,0xb9,0xda,0x5e,0x15,0x46,0x57,0xa7,0x8d,0x9d,0x84,
  0x90,0xd8,0xab,0x00,0x8c,0xbc,0xd3,0x0a,0xf7,0xe4,0x58,0x05,0xb8,0xb3,0x45,0x06,
  0xd0,0x2c,0x1e,0x8f,0xca,0x3f,0x0f,0x02,0xc1,0xaf,0xbd,0x03,0x01,0x13,0x8a,0x6b,
  0x3a,0x91,0x11,0x41,0x4f,0x67,0xdc,0xea,0x97,0xf2,0xcf,0xce,0xf0,0xb4,0xe6,0x73,
  0x96,0xac,0x74,0x22,0xe7,0xad,0x35,0x85,0xe2,0xf9,0x37,0xe8,0x1c,0x75,0xdf,0x6e,
  0x47,0xf1,0x1a,0x71,0x1d,0x29,0xc5,0x89,0x6f,0xb7,0x62,0x0e,0xaa,0x18,0xbe,0x1b,
  0xfc,0x56,0x3e,0x4b,0xc6,0xd2,0x79,0x20,0x9a,0xdb,0xc0,0xfe,0x78,0xcd,0x5a,0xf4,
  0x1f,0xdd,0xa8,0x33,0x88,0x07,0xc7,0x31,0xb1,0x12,0x10,0x59,0x27,0x80,0xec,0x5f,
  0x60,0x51,0x7f,0xa9,0x19,0xb5,0x4a,0x0d,0x2d,0xe5,0x7a,0x9f,0x93,0xc9,0x9c,0xef,
  0xa0,0xe0,0x3b,0x4d,0xae,0x2a,0xf5,0xb0,0xc8,0xeb,0xbb,0x3c,0x83,0x53,0x99,0x61,
  0x17,0x2b,0x04,0x7e,0xba,0x77,0xd6,0x26,0xe1,0x69,0x14,0x63,0x55,0x21,0x0c,0x7d
];
const RCON = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];

function xtime(a) { return ((a << 1) ^ ((a & 0x80) ? 0x1b : 0)) & 0xff; }
function mul(a, b) {
  let r = 0;
  while (b) { if (b & 1) r ^= a; a = xtime(a); b >>= 1; }
  return r;
}
function expandKey(key) {
  const w = new Uint8Array(176);
  w.set(key);
  for (let i = 4; i < 44; i++) {
    let t0 = w[(i - 1) * 4], t1 = w[(i - 1) * 4 + 1], t2 = w[(i - 1) * 4 + 2], t3 = w[(i - 1) * 4 + 3];
    if (i % 4 === 0) {
      const r = RCON[i / 4 - 1];
      const u0 = SBOX[t1] ^ r, u1 = SBOX[t2], u2 = SBOX[t3], u3 = SBOX[t0];
      t0 = u0; t1 = u1; t2 = u2; t3 = u3;
    }
    w[i * 4] = w[(i - 4) * 4] ^ t0;
    w[i * 4 + 1] = w[(i - 4) * 4 + 1] ^ t1;
    w[i * 4 + 2] = w[(i - 4) * 4 + 2] ^ t2;
    w[i * 4 + 3] = w[(i - 4) * 4 + 3] ^ t3;
  }
  return w;
}
function addRoundKey(s, w, round) { for (let i = 0; i < 16; i++) s[i] ^= w[round * 16 + i]; }
function subBytes(s) { for (let i = 0; i < 16; i++) s[i] = SBOX[s[i]]; }
function invSubBytes(s) { for (let i = 0; i < 16; i++) s[i] = INV_SBOX[s[i]]; }
function shiftRows(s) {
  let t;
  t = s[1]; s[1] = s[5]; s[5] = s[9]; s[9] = s[13]; s[13] = t;
  t = s[2]; s[2] = s[10]; s[10] = t; t = s[6]; s[6] = s[14]; s[14] = t;
  t = s[3]; s[3] = s[15]; s[15] = s[11]; s[11] = s[7]; s[7] = t;
}
function invShiftRows(s) {
  let t;
  t = s[13]; s[13] = s[9]; s[9] = s[5]; s[5] = s[1]; s[1] = t;
  t = s[2]; s[2] = s[10]; s[10] = t; t = s[6]; s[6] = s[14]; s[14] = t;
  t = s[7]; s[7] = s[11]; s[11] = s[15]; s[15] = s[3]; s[3] = t;
}
function mixColumns(s) {
  for (let c = 0; c < 4; c++) {
    const i = c * 4, a = s[i], b = s[i + 1], d = s[i + 2], e = s[i + 3];
    s[i] = mul(a, 2) ^ mul(b, 3) ^ d ^ e;
    s[i + 1] = a ^ mul(b, 2) ^ mul(d, 3) ^ e;
    s[i + 2] = a ^ b ^ mul(d, 2) ^ mul(e, 3);
    s[i + 3] = mul(a, 3) ^ b ^ d ^ mul(e, 2);
  }
}
function invMixColumns(s) {
  for (let c = 0; c < 4; c++) {
    const i = c * 4, a = s[i], b = s[i + 1], d = s[i + 2], e = s[i + 3];
    s[i] = mul(a, 14) ^ mul(b, 11) ^ mul(d, 13) ^ mul(e, 9);
    s[i + 1] = mul(a, 9) ^ mul(b, 14) ^ mul(d, 11) ^ mul(e, 13);
    s[i + 2] = mul(a, 13) ^ mul(b, 9) ^ mul(d, 14) ^ mul(e, 11);
    s[i + 3] = mul(a, 11) ^ mul(b, 13) ^ mul(d, 9) ^ mul(e, 14);
  }
}
function encryptBlock(w, block) {
  const s = new Uint8Array(block);
  addRoundKey(s, w, 0);
  for (let round = 1; round < 10; round++) { subBytes(s); shiftRows(s); mixColumns(s); addRoundKey(s, w, round); }
  subBytes(s); shiftRows(s); addRoundKey(s, w, 10);
  return s;
}
function decryptBlock(w, block) {
  const s = new Uint8Array(block);
  addRoundKey(s, w, 10);
  for (let round = 9; round >= 1; round--) { invShiftRows(s); invSubBytes(s); addRoundKey(s, w, round); invMixColumns(s); }
  invShiftRows(s); invSubBytes(s); addRoundKey(s, w, 0);
  return s;
}
function pkcs7Pad(data) {
  const pad = 16 - (data.length % 16);
  const out = new Uint8Array(data.length + pad);
  out.set(data);
  out.fill(pad, data.length);
  return out;
}
function pkcs7Unpad(data) {
  if (data.length === 0 || data.length % 16 !== 0) throw new Error('bad length');
  const pad = data[data.length - 1];
  if (pad < 1 || pad > 16) throw new Error('bad padding');
  for (let i = 0; i < pad; i++) if (data[data.length - 1 - i] !== pad) throw new Error('bad padding');
  return data.slice(0, data.length - pad);
}
function aesEcbEncrypt(data, key) {
  const w = expandKey(key);
  const padded = pkcs7Pad(data);
  const out = new Uint8Array(padded.length);
  for (let i = 0; i < padded.length; i += 16) out.set(encryptBlock(w, padded.slice(i, i + 16)), i);
  return out;
}
function aesEcbDecrypt(data, key) {
  if (data.length % 16 !== 0) throw new Error('bad length');
  const w = expandKey(key);
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i += 16) out.set(decryptBlock(w, data.slice(i, i + 16)), i);
  return pkcs7Unpad(out);
}

// ---------- 环境变量与默认值（database.mjs） ----------
// 开关在模块里以布尔值声明，脚本收到的是 "true"/"false" 字符串；数字与字符串按需归一。
const DEFAULTS = {
  FX: 0, MY: 1, DT: 0, GZ: 1, SOU: 1,
  SY_NAME: '', WD_NAME: '', MY_NAME: '', DT_NAME: '', FX_NAME: '', SOU_NAME: '',
  XD: 1, YY: 0, BK: 0, TS: 0, HDTAB: 0,
  XD_NAME: '', TJ_NAME: '', YY_NAME: '', BK_NAME: '', TS_NAME: '',
  BOTTOM_ORDER: '', TOP_ORDER: '',
  FOLLOW_TIP: 1, FOLLOW_TEXT: '',
  PRGG: 0, PRDRD: 0, PRSCVPT: 0, PRST: 0,
  HMPR: 0, PRRR: 1, PRRK: 0, PRMST: 0, PRCN: 1,
  PRPRS: 1, PRRSS: 1,
  LogLevel: 'info',
};

function envInt(ctx, key) {
  const v = ctx.env ? ctx.env[key] : undefined;
  if (v === undefined || v === null || v === '') return DEFAULTS[key];
  if (v === true || v === 'true') return 1;
  if (v === false || v === 'false') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : DEFAULTS[key];
}
function envStr(ctx, key) {
  const v = ctx.env ? ctx.env[key] : undefined;
  if (v === undefined || v === null) return DEFAULTS[key];
  return String(v);
}
function buildSettings(ctx) {
  const s = {};
  for (const [k, def] of Object.entries(DEFAULTS)) {
    s[k] = typeof def === 'number' ? envInt(ctx, k) : envStr(ctx, k);
  }
  return s;
}

// ---------- 日志（LogLevel：off / error / warn / info / debug / all，默认 info） ----------
const LOG_LEVELS = { off: 0, error: 1, warn: 2, info: 3, debug: 4, all: 5 };
let logLevel = 3;
function log(level, msg) {
  if ((LOG_LEVELS[level] ?? 3) > logLevel) return;
  try {
    if (typeof console === 'undefined') return;
    if (level === 'error') console.error('[WYY] ' + msg);
    else if (level === 'warn') console.warn('[WYY] ' + msg);
    else console.log('[WYY] ' + msg);
  } catch (e) { /* 日志失败不影响主流程 */ }
}

// ---------- URL 与加解密（源自 Yu9191 Crypto.mjs / url.mjs） ----------
function extractPath(url) {
  const m = url.match(/(?:^https?:\/\/[^/]+)\/(?:x?e?api)(\/[a-z0-9-/]+)(\?.*)?/);
  return m ? m[1] : null;
}
function isGzipped(u8) {
  return u8.length >= 2 && u8[0] === 0x1f && u8[1] === 0x8b;
}
async function tryGunzip(ctx, u8) {
  try {
    if (ctx.compress && typeof ctx.compress.gunzip === 'function') {
      const g = await ctx.compress.gunzip(u8);
      if (g && g.length) return g;
    }
  } catch (e) { /* 解压失败则保留原值 */ }
  return u8;
}
// 解密响应体为 JSON：HTTP 层 gzip 剥离 → AES → 内层 gzip → JSON；失败时按明文 JSON 兜底。
async function decryptBody(ctx, body) {
  let u8 = body;
  if (!u8 || !u8.length) return null;
  if (isGzipped(u8)) u8 = await tryGunzip(ctx, u8);
  try {
    let plain = aesEcbDecrypt(u8, EAPI_KEY);
    if (plain.length > 0) {
      if (isGzipped(plain)) plain = await tryGunzip(ctx, plain);
      const obj = JSON.parse(new TextDecoder('utf-8').decode(plain));
      if (obj && typeof obj === 'object') return obj;
    }
  } catch (e) { /* 走明文兜底 */ }
  try {
    const obj = JSON.parse(new TextDecoder('utf-8').decode(u8));
    if (obj && typeof obj === 'object') return obj;
  } catch (e) { /* 解密失败 */ }
  return null;
}
function encryptBody(obj) {
  return aesEcbEncrypt(new TextEncoder().encode(JSON.stringify(obj)), EAPI_KEY);
}

// ---------- Tab 顺序（源自 Yu9191 order.mjs） ----------
function parseOrder(order, defaults) {
  const picked = typeof order === 'string' && order
    ? order.split(',').filter((id, i, a) => defaults.includes(id) && a.indexOf(id) === i)
    : [];
  return [...picked, ...defaults.filter(id => !picked.includes(id))];
}
function sortByOrder(list, order, keyOf) {
  const ids = typeof order === 'string' && order ? order.split(',') : [];
  if (!ids.length) return list;
  const rank = item => {
    const i = ids.indexOf(keyOf(item));
    return i < 0 ? ids.length : i;
  };
  return list
    .map((item, idx) => [item, idx])
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1])
    .map(([item]) => item);
}

// ---------- 处理器（源自 Yu9191 process/handlers/，按 Egern ctx 改写） ----------

// 评论：单条去装饰（楼层、批量评论、回复预加载共用）。
function cleanComment(c) {
  if (!c || typeof c !== 'object') return;
  if (c.user?.followed === false) c.user.followed = true;
  if (c.user) {
    c.user.vipRights = null;
    c.user.avatarDetail = null;
  }
  c.userBizLevels = null;
  c.pendantData = null;
  if (c.tag) {
    c.tag.extDatas = [];
    c.tag.contentPicDatas = null;
  }
}
function commentFloor(s) {
  if (s.data?.ownerComment?.user) {
    s.data.ownerComment.user.vipRights = null;
    s.data.ownerComment.user.avatarDetail = {};
    s.data.ownerComment.pendantData = null;
  }
  for (const c of s.data?.comments ?? []) cleanComment(c);
}
function commentReplyPreload(s) {
  for (const replies of Object.values(s.data?.preloadCommentMap ?? {})) {
    if (Array.isArray(replies)) replies.forEach(cleanComment);
  }
}
// 评论区插入的推荐动态：清空记录。
function commentInserted(s) {
  if (!s.data) return;
  s.data.records = [];
  s.data.count = 0;
}

// 批量接口：清评论 tips、社交事件广告、ad/get 广告位；评论列表脱敏；
// 清 feed 推荐、话题列表、付费下载入口。
function batch(s) {
  const clearData = (k, v = {}) => { if (s[k]?.data) s[k].data = v; };
  clearData('/api/comment/tips/v2/get', { count: 0, offset: 0, records: [] });
  clearData('/api/social/event/bff/ad/resources');
  clearData('/api/ad/get', { code: 200, ads: {} });
  for (const c of s['/api/v2/resource/comments']?.data?.comments ?? []) cleanComment(c);
  const insKey = '/api/comment/feed/inserted/resources';
  if (s[insKey]?.data) {
    s[insKey].data = {};
    if (s[insKey].trp?.rules) s[insKey].trp.rules = [];
  }
  const topicKey = '/api/event/rcmd/topic/list';
  if (s[topicKey]?.data?.topicList) s[topicKey].data.topicList = [];
  const orderKey = '/api/platform/song/bff/grading/song/order/entrance';
  if (s[orderKey]?.data?.songOrderEntrance) s[orderKey].data.songOrderEntrance = {};
}

// 我的页运营推广位（私房推荐 + 票务）清除。
function userInfo(s) {
  s.fmConfig = null;
  s.ticketConfig = null;
}

// 免流推广弹窗：全清。
function flowPopup(s) {
  if (s.data) s.data = {};
}

// 收银台广告弹窗清除。
function cashier(s) {
  if (s.data?.cashierTabPopup) s.data.cashierTabPopup = {};
}

// 我的页顶部横幅（MyPageBar / MyPageBarRN）。
function myPageBar(s) {
  if (s.data?.crossPlatformResource?.positionCode?.startsWith('MyPageBar')) {
    s.data.crossPlatformResource = {};
  }
}

// 侧边栏：只移除 AI 写歌入口（原插件还会在此注入“去广告设置”入口，
// 该入口打开的是 BoxJS 式应用内设置页，Egern 没有等价机制，已剔除；
// 全部开关改由模块 env_schema 提供，见模块文件）。
function trimSideBar(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 8) return 0;
  let n = 0;
  if (Array.isArray(node)) {
    if (node.some(e => e?.code === 'msg_center')) {
      for (let i = node.length - 1; i >= 0; i--) {
        if (node[i]?.code === 'ai_songwriting') { node.splice(i, 1); n++; }
      }
    } else if (node.some(e => e?.sideBarItemData3?.code === 'msg_center')) {
      for (let i = node.length - 1; i >= 0; i--) {
        if (node[i]?.sideBarItemData3?.code === 'ai_songwriting') { node.splice(i, 1); n++; }
      }
    }
  }
  for (const v of Object.values(node)) n += trimSideBar(v, depth + 1);
  return n;
}
function positionResource(s) {
  myPageBar(s);
  const done = trimSideBar(s.data);
  if (done) log('debug', '侧边栏已移除 AI 写歌入口，处理 ' + done + ' 处');
}

// 关注列表：没回关的用户显示提示（FOLLOW_TIP 开关，FOLLOW_TEXT 文字，空 = 默认）。
// 注意：这不是去广告，是原插件自带的一项界面提示功能；Keywos 版模块有意略去了同类功能，
// 此处按 Yu9191 原样保留，可用 FOLLOW_TIP 开关关闭。
function followList(s, settings) {
  if (settings.FOLLOW_TIP !== 1) return;
  const message = settings.FOLLOW_TEXT || '这人没关注你哦';
  for (const r of s.data?.records ?? []) {
    if (r.mutualFollowDay === null) {
      r.showContent = { message, time: 1e12, active: true, boxContent: {} };
    }
  }
}

// 底部 Tab：过滤、按 BOTTOM_ORDER 排序、改名；发现页移除“直播”。
const BOTTOM_TAB_NAMES = { MY: '漫游', DT: '笔记', FX: '发现', GZ: '关注', SOU: '搜索' };
function bottomTab(s, settings) {
  const hideTabs = Object.keys(BOTTOM_TAB_NAMES)
    .filter(k => settings[k] === 1)
    .map(k => BOTTOM_TAB_NAMES[k]);
  if (!s.data?.commonResourceList) return;
  // 至少保留 1 个 Tab，避免 UI 崩溃
  const filtered = s.data.commonResourceList.filter(i => !hideTabs.includes(i.title));
  // 按原始标题排序，改名在后
  s.data.commonResourceList = sortByOrder(
    filtered.length > 0 ? filtered : s.data.commonResourceList.slice(0, 1),
    settings.BOTTOM_ORDER,
    i => i.title
  );
  for (const i of s.data.commonResourceList) {
    if (i.title === '首页' && settings.SY_NAME) i.title = settings.SY_NAME;
    if (i.title === '我的' && settings.WD_NAME) i.title = settings.WD_NAME;
    if (i.title === '漫游' && settings.MY_NAME) i.title = settings.MY_NAME;
    if (i.title === '笔记' && settings.DT_NAME) i.title = settings.DT_NAME;
    if (i.title === '搜索' && settings.SOU_NAME) i.title = settings.SOU_NAME;
    if (i.title === '发现') {
      if (settings.FX_NAME) i.title = settings.FX_NAME;
      if (i.subCommonResourceList) {
        i.subCommonResourceList = i.subCommonResourceList.filter(y => y.title !== '直播');
      }
    }
  }
}

// 顶部 Tab：过滤、按 TOP_ORDER 排序、按 *_NAME 改名；清空 adminList 与引导气泡。
const TOP_TAB_SWITCH = { fastPlay: 'XD', music: 'YY', podcast: 'BK', vBook: 'TS' };
const TOP_TAB_NAME = { fastPlay: 'XD_NAME', rcmd: 'TJ_NAME', music: 'YY_NAME', podcast: 'BK_NAME', vBook: 'TS_NAME' };
const TOP_ALWAYS_HIDDEN = new Set(['freeListen', 'ai-generate-song']);
function topTab(s, settings) {
  if (s.data?.commonResourceList) {
    const shown = s.data.commonResourceList.filter(i => {
      if (TOP_ALWAYS_HIDDEN.has(i.resCode)) return false;
      const key = TOP_TAB_SWITCH[i.resCode];
      if (key && settings[key] !== 1) return false;
      if (i.trp_type === 'musicTopTabIntervene' && settings.HDTAB !== 1) return false;
      return true;
    });
    s.data.commonResourceList = sortByOrder(shown, settings.TOP_ORDER, i => i.resCode);
    for (const i of s.data.commonResourceList) {
      const name = TOP_TAB_NAME[i.resCode] && settings[TOP_TAB_NAME[i.resCode]];
      if (name) i.title = name;
    }
  }
  if (s.data?.adminList) s.data.adminList = [];
  if (s.data?.guideInfo?.adminList) s.data.guideInfo.adminList = [];
}

// ---------- 首页（源自 Yu9191 home.mjs） ----------
// 首页推荐卡片 setting key → bizCode 映射。
const BLOCK_MAP = {
  PRGG: 'PAGE_RECOMMEND_GREETING',
  PRDRD: 'PAGE_RECOMMEND_DAILY_RECOMMEND',
  PRSCVPT: 'PAGE_RECOMMEND_SPECIAL_CLOUD_VILLAGE_PLAYLIST',
  PRST: 'PAGE_RECOMMEND_SHORTCUT',
  HMPR: 'HOMEPAGE_MUSIC_PARTNER',
  PRRR: 'PAGE_RECOMMEND_RADAR',
  PRRK: 'PAGE_RECOMMEND_RANK',
  PRMST: 'PAGE_RECOMMEND_MY_SHEET',
  PRCN: 'PAGE_RECOMMEND_COMBINATION',
  PRPRS: 'PAGE_RECOMMEND_PRIVATE_RCMD_SONG',
  PRRSS: 'PAGE_RECOMMEND_RED_SIMILAR_SONG',
};

// 清理问候语卡片中带遥测 / 广告字段的子项。
function cleanGreetingEntries(entries) {
  for (const d of entries ?? []) {
    if (d.summary) d.summary = '';
    if (d.extraMap) d.extraMap = {};
    if (d.trp_id) d.trp_id = '';
    if (d.log) d.log = {};
    if (d.icon) d.icon = '';
    if (d.actionUrl) d.actionUrl = '';
    if (d.s_ctrp) d.s_ctrp = '';
    if (d.resourceType) d.resourceType = '';
  }
}
function allowedBizCodes(settings) {
  return Object.keys(BLOCK_MAP)
    .filter(k => settings[k] === 1)
    .map(k => BLOCK_MAP[k]);
}

// 首页 Banner 移除活动 / 广告类型。
function homepageBlock(s) {
  if (!Array.isArray(s.data?.blocks)) return;
  for (const blk of s.data.blocks) {
    if (blk.showType === 'BANNER' && blk.extInfo?.banners) {
      blk.extInfo.banners = blk.extInfo.banners.filter(
        y => !['活动', '广告'].includes(y.typeTitle)
      );
      break;
    }
  }
}

// 发现页移除顶部 Banner。
function discovery(s) {
  if (s.data?.blockCodeOrderList) {
    try {
      s.data.blockCodeOrderList = JSON.stringify(
        JSON.parse(s.data.blockCodeOrderList).filter(i => i !== 'PAGE_DISCOVERY_BANNER')
      );
    } catch (e) { /* 保持原值 */ }
  }
  if (Array.isArray(s.data?.blocks)) {
    s.data.blocks = s.data.blocks.filter(i => i.bizCode !== 'PAGE_DISCOVERY_BANNER');
  }
}

// 按白名单过滤 JSON 字符串化的 blockCode 列表。
function filterCodeListJson(jsonStr, allowed) {
  try {
    const arr = JSON.parse(jsonStr);
    return JSON.stringify(arr.filter(i => allowed.includes(i)));
  } catch (e) {
    return jsonStr;
  }
}

// 推荐页全量加载：按 BLOCK_MAP 过滤 blocks，问候语再清理子项。
function rcmdResource(s, settings) {
  const allowed = allowedBizCodes(settings);
  if (!s.data) return;
  if (Array.isArray(s.data.blocks)) {
    s.data.blocks = s.data.blocks.filter(b => allowed.includes(b.bizCode));
    const greeting = s.data.blocks.find(b => b.bizCode === 'PAGE_RECOMMEND_GREETING');
    if (greeting?.dslData) {
      for (const ds of Object.values(greeting.dslData)) {
        cleanGreetingEntries(ds.commonResourceList);
      }
    }
  }
  if (typeof s.data.blockCodeOrderList === 'string') {
    s.data.blockCodeOrderList = filterCodeListJson(s.data.blockCodeOrderList, allowed);
  }
  if (typeof s.data.algDemoteBlockCodeOrderList === 'string') {
    s.data.algDemoteBlockCodeOrderList = filterCodeListJson(s.data.algDemoteBlockCodeOrderList, allowed);
  }
  if (Array.isArray(s.data.requestBlockOrder)) {
    s.data.requestBlockOrder = s.data.requestBlockOrder.filter(i => allowed.includes(i));
  }
  // 斩断懒加载链条：避免 multi/refresh 把过滤掉的卡片反复拉回。
  if ('hasMore' in s.data) s.data.hasMore = false;
  if ('cursor' in s.data) s.data.cursor = -1;
}

// 推荐页增量刷新：同时兼容
// - 旧结构：{ data: [{ blockCode, block: {...} }, ...] }
// - 新结构：{ data: { blocks: [{ bizCode, ... }], cursor, hasMore } }
function rcmdRefresh(s, settings) {
  const allowed = allowedBizCodes(settings);
  if (Array.isArray(s.data)) {
    s.data = s.data.filter(i => allowed.includes(i.blockCode));
    const greeting = s.data.find(i => i.blockCode === 'PAGE_RECOMMEND_GREETING');
    if (greeting?.block?.dslData) {
      for (const ds of Object.values(greeting.block.dslData)) {
        cleanGreetingEntries(ds.commonResourceList);
      }
    }
    return;
  }
  // 新结构：复用 rcmdResource 逻辑
  rcmdResource(s, settings);
}

// ---------- 路由（源自 Yu9191 process/handlers/index.mjs） ----------
// 仅收录 .lpx 脚本入口实际触发的 15 条；songMore 路由表里有但无入口，从不触发，已剔除。
const HANDLERS = {
  '/batch': batch,
  '/v2/resource/comment/floor/get': commentFloor,
  '/resource/comments/reply/preload': commentReplyPreload,
  '/comment/feed/inserted/resources/combined': commentInserted,
  '/v1/user/info': userInfo,
  '/sp/flow/popup/query': flowPopup,
  '/vipactivity/app/cashier/setting/get': cashier,
  '/link/position/show/resource': positionResource,
  '/user/follow/users/mixed/get/v2': followList,
  '/link/home/framework/tab': bottomTab,
  '/link/home/framework/top/tab': topTab,
  '/homepage/block/page': homepageBlock,
  '/link/page/discovery/resource/show': discovery,
  '/link/page/rcmd/resource/show': rcmdResource,
  '/link/page/rcmd/block/resource/multi/refresh': rcmdRefresh,
};

export default async function (ctx) {
  let buf;
  try { buf = new Uint8Array(await ctx.response.arrayBuffer()); } catch (e) { return; }
  if (!buf || buf.length === 0) return;

  const path = extractPath(ctx.request.url);
  if (!path) return;
  const handler = HANDLERS[path];
  if (!handler) return;

  const level = envStr(ctx, 'LogLevel') || 'info';
  logLevel = LOG_LEVELS[level] ?? 3;

  const s = await decryptBody(ctx, buf);
  if (!s) {
    log('error', '解密失败: ' + path);
    return;
  }
  const settings = buildSettings(ctx);
  log('debug', path);

  try {
    handler(s, settings);
  } catch (e) {
    log('error', '处理 ' + path + ' 异常: ' + (e?.message || e));
    return;
  }
  return { body: encryptBody(s) };
}
