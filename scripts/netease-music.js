// 网易云音乐去广告（Egern 原生脚本）
// 来源：Keywos wyres.js（zirawell 转载），按 Egern ctx API 重写。
// eapi 响应为 AES-128-ECB 加密（密钥 e82ckenh8dichen8），需先解密再改 JSON、再加密；
// 若解密或解析失败则原样透传。仅去广告与界面净化，原脚本中的伪 VIP 解锁与
// “显示未关注你”伪造已剔除（见模块文件注释）。
//
// 环境变量（由模块 compat_arguments 传入，true/false 字符串）：
//   MY / DT / FX：隐藏底部漫游 / 笔记 / 发现标签
//   PRGG / PRRK / PRDRD / PRSCVPT / PRST / PRRR / HMPR / PRMST / PRCN：隐藏首页各区块

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

// ---------- 响应处理 ----------
const BLOCK_CODE = {
  PRGG: 'PAGE_RECOMMEND_GREETING',
  PRDRD: 'PAGE_RECOMMEND_DAILY_RECOMMEND',
  PRSCVPT: 'PAGE_RECOMMEND_SPECIAL_CLOUD_VILLAGE_PLAYLIST',
  PRST: 'PAGE_RECOMMEND_SHORTCUT',
  HMPR: 'HOMEPAGE_MUSIC_PARTNER',
  PRRR: 'PAGE_RECOMMEND_RADAR',
  PRRK: 'PAGE_RECOMMEND_RANK',
  PRMST: 'PAGE_RECOMMEND_MY_SHEET',
  PRCN: 'PAGE_RECOMMEND_COMBINATION',
};
const TAB_TITLE = { MY: '漫游', DT: '笔记', FX: '发现' };

function envBool(ctx, key, def) {
  const v = ctx.env ? ctx.env[key] : undefined;
  if (v === undefined || v === null || v === '') return def;
  return String(v) === 'true';
}
// 首页保留的区块：开关为 true 表示隐藏该区块
function keepCodes(ctx) {
  const keep = [];
  for (const [key, code] of Object.entries(BLOCK_CODE)) {
    const hideByDefault = { PRGG: true, PRRR: true, PRMST: true, PRCN: true }[key] === true;
    if (!envBool(ctx, key, hideByDefault)) keep.push(code);
  }
  return keep;
}
// 评论区净化：去掉乐迷、星评、关注等图标（原脚本行为；单条异常不影响整批）
function cleanComments(comments) {
  if (!Array.isArray(comments)) return;
  for (const c of comments) {
    try {
      if (!c || typeof c !== 'object') continue;
      if (c.user) {
        if (c.user.followed === false) c.user.followed = true;
        c.user.vipRights = null;
        c.user.avatarDetail = null;
        c.userBizLevels = null;
      }
      c.pendantData = null;
      if (c.tag) { c.tag.extDatas = []; c.tag.contentPicDatas = null; }
    } catch (e) { /* 单条跳过 */ }
  }
}
// 问候语区块内容清空（原脚本用 forEach 赋值把列表置空，此处直接写清效果）
function clearGreeting(blocks) {
  if (!Array.isArray(blocks)) return;
  for (const b of blocks) {
    if (!b || b.bizCode !== 'PAGE_RECOMMEND_GREETING') continue;
    const dsl = b.dslData;
    if (!dsl || typeof dsl !== 'object') continue;
    for (const k of Object.keys(dsl)) {
      const item = dsl[k];
      if (item && Array.isArray(item.commonResourceList)) item.commonResourceList = [];
    }
  }
}

function handleBatch(s) {
  // 各子接口广告置空
  if (s['/api/comment/tips/v2/get']?.data) s['/api/comment/tips/v2/get'].data = { count: 0, offset: 0, records: [] };
  if (s['/api/social/event/bff/ad/resources']?.data) s['/api/social/event/bff/ad/resources'].data = {};
  if (s['/api/ad/get']?.data) s['/api/ad/get'].data = { code: 200, ads: {} };
  // 评论区净化
  cleanComments(s['/api/v2/resource/comments']?.data?.comments);
  // 评论区插入的推广位清空
  const feed = s['/api/comment/feed/inserted/resources'];
  if (feed?.data) { feed.data = {}; if (feed.trp?.rules) feed.trp.rules = []; }
  // 话题推荐清空
  if (s['/api/event/rcmd/topic/list']?.data?.topicList) s['/api/event/rcmd/topic/list'].data.topicList = [];
  // 歌曲打分入口清空
  if (s['/api/platform/song/bff/grading/song/order/entrance']?.data?.songOrderEntrance) {
    s['/api/platform/song/bff/grading/song/order/entrance'].data.songOrderEntrance = {};
  }
}

export default async function (ctx) {
  let buf;
  try { buf = new Uint8Array(await ctx.response.arrayBuffer()); } catch (e) { return; }
  if (!buf || buf.length === 0) return;

  const isAeapi = ctx.request.headers.get('x-aeapi') === 'true';
  let plain;
  try {
    plain = aesEcbDecrypt(buf, EAPI_KEY);
    if (isAeapi) {
      const g = await ctx.compress.gunzip(plain);
      if (!g) return;
      plain = g;
    }
  } catch (e) { return; } // 解密失败：非加密响应或已失效，原样透传

  let s;
  try { s = JSON.parse(new TextDecoder('utf-8').decode(plain)); } catch (e) { return; }

  const pathMatch = ctx.request.url.match(/^(?:https?:\/\/[^/]+)\/(?:e?api)(\/[a-z0-9\-/]+)/);
  const path = pathMatch ? pathMatch[1] : null;
  if (!path) return;

  switch (path) {
    case '/batch':
      handleBatch(s);
      break;
    case '/v2/resource/comment/floor/get': {
      const owner = s.data?.ownerComment;
      if (owner?.user) { owner.user.vipRights = null; owner.user.avatarDetail = {}; owner.user.pendantData = null; }
      cleanComments(s.data?.comments);
      break;
    }
    case '/link/position/show/resource': {
      const r = s.data?.crossPlatformResource;
      if (r?.positionCode === 'MyPageBar') s.data.crossPlatformResource = {};
      break;
    }
    case '/link/home/framework/tab': {
      // 隐藏底部标签：开关 true 即隐藏
      const hide = [];
      if (envBool(ctx, 'MY', true)) hide.push(TAB_TITLE.MY);
      if (envBool(ctx, 'DT', false)) hide.push(TAB_TITLE.DT);
      if (envBool(ctx, 'FX', true)) hide.push(TAB_TITLE.FX);
      const list = s.data?.commonResourceList;
      if (Array.isArray(list)) {
        s.data.commonResourceList = list.filter((i) => !hide.includes(i.title));
        for (const i of s.data.commonResourceList) {
          if (i.title === '发现' && Array.isArray(i.subCommonResourceList)) {
            i.subCommonResourceList = i.subCommonResourceList.filter((y) => y.title !== '播客');
          }
        }
      }
      break;
    }
    case '/homepage/block/page': {
      if (Array.isArray(s.data?.blocks)) {
        for (const b of s.data.blocks) {
          if (b?.showType === 'BANNER' && Array.isArray(b.extInfo?.banners)) {
            b.extInfo.banners = b.extInfo.banners.filter((y) => !['活动', '广告'].includes(y.typeTitle));
            break;
          }
        }
      }
      break;
    }
    case '/link/page/discovery/resource/show': {
      if (typeof s.data?.blockCodeOrderList === 'string') {
        try {
          s.data.blockCodeOrderList = JSON.stringify(
            JSON.parse(s.data.blockCodeOrderList).filter((i) => i !== 'PAGE_DISCOVERY_BANNER')
          );
        } catch (e) { /* 保持原值 */ }
      }
      if (Array.isArray(s.data?.blocks)) {
        s.data.blocks = s.data.blocks.filter((i) => i.bizCode !== 'PAGE_DISCOVERY_BANNER');
      }
      break;
    }
    case '/link/page/rcmd/resource/show': {
      const keep = keepCodes(ctx);
      if (Array.isArray(s.data?.blocks)) {
        s.data.blocks = s.data.blocks.filter((i) => keep.includes(i.bizCode));
        if (s.data.blocks.length > 0) clearGreeting(s.data.blocks);
      }
      if (typeof s.data?.blockCodeOrderList === 'string') {
        try {
          s.data.blockCodeOrderList = JSON.stringify(
            JSON.parse(s.data.blockCodeOrderList).filter((i) => keep.includes(i))
          );
        } catch (e) { /* 保持原值 */ }
      }
      break;
    }
    case '/link/page/rcmd/block/resource/multi/refresh': {
      const keep = keepCodes(ctx);
      if (Array.isArray(s.data)) {
        s.data = s.data.filter((i) => keep.includes(i.blockCode));
        if (s.data.length > 0) {
          for (const item of s.data) {
            if (item.blockCode === 'PAGE_RECOMMEND_GREETING') {
              const dsl = item.block?.dslData;
              if (dsl && typeof dsl === 'object') {
                for (const k of Object.keys(dsl)) {
                  const v = dsl[k];
                  if (v && Array.isArray(v.commonResourceList)) v.commonResourceList = [];
                }
              }
            }
          }
        }
      }
      break;
    }
    default:
      return; // 未覆盖的接口原样透传
  }

  // 原脚本只加密 JSON 字符串，不再 gzip
  const out = new TextEncoder().encode(JSON.stringify(s));
  return { body: aesEcbEncrypt(out, EAPI_KEY) };
}
