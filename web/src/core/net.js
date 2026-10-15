// ============================================================================
// الشبكة المحلية (LAN) — بروتوكول مبني على UDP في نسخة أندرويد (Godot/ENet)
// وهنا في الويب على قناة قابلة للتبديل (Transport) لأن المتصفح لا يسمح بـ UDP.
//
// المبدأ (القسم 4):
//   • مضيف واحد (Listen Server) هو المرجع: 30 هرتز تحديث، 30 هرتز snapshots.
//   • العميل 60 هرتز: تنبؤ بالحركة + إقحام (Interpolation) بفاصل 100 م.ث.
//   • تعويض التأخير (Lag Compensation) حتى 200 م.ث بإرجاع الصناديق زمنيًا.
//   • إعادة الإرسال للحزم المهمة، واكتشاف الفقد.
//   • حجز المقعد 60 ثانية عند الانقطاع.
//
// المنفذ الافتراضي للاكتشاف: 41980 (بثّ UDP عام 3 ثوانٍ).
// ============================================================================

import { CONFIG } from './assets.js';
import { clamp, quantizePos, quantizeAngle } from './math.js';

export const NET_CONST = {
  port: 41980,
  discoverInterval: 0.5,
  discoverTotal: 3.0,
  magic: 0x4D31314E,       // "M11N"
  protocolVersion: 3,
  maxPacketBytes: 1100,    // أقل من MTU لتفادي التجزئة
  headerBytes: 12,
  snapshotHz: 30,
  inputHz: 30,
};

export const MSG = {
  DISCOVER: 1, DISCOVER_REPLY: 2, JOIN_REQUEST: 3, JOIN_ACCEPT: 4, JOIN_REJECT: 5,
  LOBBY_STATE: 6, START_MATCH: 7, SNAPSHOT: 8, INPUT: 9, EVENT: 10,
  PING: 11, PONG: 12, CHAT: 13, PING_MARK: 14, LEAVE: 15, SEAT_HOLD: 16,
  VOICE: 17, MIGRATION_OFFER: 18, MIGRATION_ACCEPT: 19, RESYNC_REQUEST: 20,
  FULL_STATE: 21, ACK: 22, KICK: 23,
};

/** يكتب رأس حزمة (12 بايت) */
export function writeHeader(view, type, seq, ack) {
  const dv = new DataView(view.buffer, view.byteOffset, view.byteLength);
  dv.setUint32(0, NET_CONST.magic);
  dv.setUint8(4, NET_CONST.protocolVersion);
  dv.setUint8(5, type);
  dv.setUint16(6, seq & 0xffff);
  dv.setUint16(8, ack & 0xffff);
  dv.setUint16(10, 0);
  return 12;
}

export function readHeader(dv) {
  return {
    magic: dv.getUint32(0),
    version: dv.getUint8(4),
    type: dv.getUint8(5),
    seq: dv.getUint16(6),
    ack: dv.getUint16(8),
    flags: dv.getUint16(10),
  };
}

/** حزمة اكتشاف (بثّ عام) — اسمها وعدد اللاعبين والإصدار */
export function encodeAnnounce(hostName, players, mode, mapId) {
  const enc = new TextEncoder();
  const name = enc.encode(hostName).slice(0, 24);
  const modeB = enc.encode(mode).slice(0, 12);
  const mapB = enc.encode(mapId).slice(0, 12);
  const buf = new ArrayBuffer(16 + name.length + modeB.length + mapB.length);
  const view = new Uint8Array(buf);
  const dv = new DataView(buf);
  dv.setUint32(0, NET_CONST.magic);
  dv.setUint8(4, NET_CONST.protocolVersion);
  dv.setUint8(5, MSG.DISCOVER_REPLY);
  dv.setUint8(6, players);
  dv.setUint8(7, CONFIG.maxPlayers);
  dv.setUint8(8, name.length);
  dv.setUint8(9, modeB.length);
  dv.setUint8(10, mapB.length);
  dv.setUint8(11, 0);
  dv.setUint32(12, NET_CONST.port);
  view.set(name, 16);
  view.set(modeB, 16 + name.length);
  view.set(mapB, 16 + name.length + modeB.length);
  return buf;
}

export function decodeAnnounce(dv) {
  const dec = new TextDecoder();
  const nameLen = dv.getUint8(8), modeLen = dv.getUint8(9), mapLen = dv.getUint8(10);
  const bytes = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
  const name = dec.decode(bytes.slice(16, 16 + nameLen));
  const mode = dec.decode(bytes.slice(16 + nameLen, 16 + nameLen + modeLen));
  const map = dec.decode(bytes.slice(16 + nameLen + modeLen, 16 + nameLen + modeLen + mapLen));
  return { hostName: name, players: dv.getUint8(6), max: dv.getUint8(7), mode, map, port: dv.getUint32(12) };
}

// ---------------------------------------------------------------------------
// حالة اللاعب في اللقطة الشبكية (مضغوطة: 12 بايت لكل لاعب)
// ---------------------------------------------------------------------------
/** [id u8][x i16][y i16][aim u8][state u8][hp u8][flags u8][vel i8][vel i8] = 12 */
export function encodeActor(actor, buf, offset) {
  const dv = new DataView(buf);
  dv.setUint8(offset + 0, actor.id & 0xff);
  dv.setInt16(offset + 1, clamp(Math.round(actor.x * 4), -32768, 32767));
  dv.setInt16(offset + 3, clamp(Math.round(actor.y * 4), -32768, 32767));
  dv.setUint8(offset + 5, Math.round((((actor.aimAngle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * 255));
  dv.setUint8(offset + 6, actor.stateIndex != null ? actor.stateIndex : 0);
  dv.setUint8(offset + 7, clamp(Math.round(actor.hp), 0, 255));
  dv.setUint8(offset + 8, (actor.facing > 0 ? 1 : 0) | (actor.alive ? 2 : 0) | (actor.jetpackOn ? 4 : 0) | (actor.ads ? 8 : 0) | (actor.crouch ? 16 : 0) | (actor.prone ? 32 : 0) | (actor.dbno ? 64 : 0));
  dv.setInt8(offset + 9, clamp(Math.round(actor.vx / 4), -127, 127));
  dv.setInt8(offset + 10, clamp(Math.round(actor.vy / 4), -127, 127));
  dv.setUint8(offset + 11, actor.weaponSlot || 0);
  return 12;
}

export function decodeActor(dv, offset) {
  const flags = dv.getUint8(offset + 8);
  return {
    id: dv.getUint8(offset + 0),
    x: dv.getInt16(offset + 1) / 4,
    y: dv.getInt16(offset + 3) / 4,
    aimAngle: dv.getUint8(offset + 5) / 255 * Math.PI * 2,
    state: dv.getUint8(offset + 6),
    hp: dv.getUint8(offset + 7),
    facing: (flags & 1) ? 1 : -1,
    alive: !!(flags & 2),
    jetpackOn: !!(flags & 4),
    ads: !!(flags & 8),
    crouch: !!(flags & 16),
    prone: !!(flags & 32),
    dbno: !!(flags & 64),
    vx: dv.getInt8(offset + 9) * 4,
    vy: dv.getInt8(offset + 10) * 4,
    slot: dv.getUint8(offset + 11),
  };
}

/** أمر إدخال مضغوط (8 بايت) */
export function encodeInput(cmd, buf) {
  const dv = new DataView(buf);
  dv.setInt8(0, clamp(Math.round((cmd.moveX || 0) * 127), -127, 127));
  dv.setInt8(1, clamp(Math.round((cmd.moveY || 0) * 127), -127, 127));
  dv.setInt8(2, clamp(Math.round((cmd.aimX || 0) * 127), -127, 127));
  dv.setInt8(3, clamp(Math.round((cmd.aimY || 0) * 127), -127, 127));
  let bits = 0;
  if (cmd.fire) bits |= 1;
  if (cmd.jump) bits |= 2;
  if (cmd.jet) bits |= 4;
  if (cmd.reload) bits |= 8;
  if (cmd.ads) bits |= 16;
  if (cmd.crouch) bits |= 32;
  if (cmd.prone) bits |= 64;
  if (cmd.swap) bits |= 128;
  dv.setUint8(4, bits);
  dv.setUint8(5, (cmd.melee ? 1 : 0) | (cmd.grenade ? 2 : 0) | (cmd.heal ? 4 : 0) | (cmd.interact ? 8 : 0) | (cmd.roll ? 16 : 0) | (cmd.sprint ? 32 : 0));
  dv.setUint8(6, cmd.swapIndex || 0);
  dv.setUint8(7, 0);
  return 8;
}

export function decodeInput(dv, offset) {
  const bits = dv.getUint8(offset + 4);
  const bits2 = dv.getUint8(offset + 5);
  return {
    moveX: dv.getInt8(offset + 0) / 127,
    moveY: dv.getInt8(offset + 1) / 127,
    aimX: dv.getInt8(offset + 2) / 127,
    aimY: dv.getInt8(offset + 3) / 127,
    fire: !!(bits & 1), jump: !!(bits & 2), jet: !!(bits & 4), reload: !!(bits & 8),
    ads: !!(bits & 16), crouch: !!(bits & 32), prone: !!(bits & 64), swap: !!(bits & 128),
    melee: !!(bits2 & 1), grenade: !!(bits2 & 2), heal: !!(bits2 & 4), interact: !!(bits2 & 8),
    roll: !!(bits2 & 16), sprint: !!(bits2 & 32), swapIndex: dv.getUint8(offset + 6),
  };
}

// ---------------------------------------------------------------------------
// النقل: واجهة موحّدة. التنفيذ الحقيقي UDP في نسخة أندرويد، وهنا تنفيذ محلي
// (بوتات/تجربة) + تنفيذ WebSocket اختياري للاختبار على جهاز واحد.
// ---------------------------------------------------------------------------
export class NetTransportLocal {
  constructor(game) {
    this.game = game;
    this.handlers = [];
    this.isLocal = true;
    this.connected = true;
    this.fakeLatency = 0;
    this.fakeLoss = 0;
  }
  send(packet) { /* في الوضع المحلي: البوتات تُحاكى داخل نفس العملية */ }
  onMessage(fn) { this.handlers.push(fn); }
  close() { this.handlers.length = 0; }
}

/** نقل WebSocket: يعمل مع وسيط Node (tools/lan_relay.mjs) للاختبار على جهاز واحد */
export class NetTransportWS {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.handlers = [];
    this.connected = false;
    this.queue = [];
  }
  async connect() {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);
      } catch (e) { reject(e); return; }
      this.ws.binaryType = 'arraybuffer';
      this.ws.onopen = () => {
        this.connected = true;
        for (const q of this.queue) this.ws.send(q);
        this.queue.length = 0;
        resolve(true);
      };
      this.ws.onerror = (e) => reject(new Error('فشل الاتصال بالوسيط'));
      this.ws.onclose = () => { this.connected = false; };
      this.ws.onmessage = (ev) => {
        for (const h of this.handlers) h(ev.data);
      };
    });
  }
  send(packet) {
    if (!this.connected) { this.queue.push(packet); return; }
    this.ws.send(packet);
  }
  onMessage(fn) { this.handlers.push(fn); }
  close() { this.ws && this.ws.close(); this.handlers.length = 0; }
}

// ---------------------------------------------------------------------------
// جلسة الشبكة: مضيف أو عميل، مع تنبؤ وإقحام وتعويض تأخير
// ---------------------------------------------------------------------------
export class NetSession {
  constructor(opts = {}) {
    this.mode = opts.mode || 'client';    // host | client
    this.port = opts.port || NET_CONST.port;
    this.game = opts.game;
    this.transport = opts.transport || null;   // يُمرّر في نسخة أندرويد
    this.seq = 0;
    this.ack = 0;
    this.peers = new Map();               // id → {name, lastSeen, seq, ack, ping, loss, heldUntil}
    this.localId = 0;
    this.hostName = 'مضيف ميكا 11';
    this.history = [];                    // آخر 200 لقطة للعميل (للإقحام)
    this.snapshotBuffer = [];
    this.predicted = new Map();
    this.pingSamples = [];
    this.startedAt = 0;
    this.stats = { sent: 0, received: 0, lost: 0, resent: 0, bytesUp: 0, bytesDown: 0 };
    this.resendQueue = new Map();
    this.lastSnapshotSent = 0;
    this.snapshotRate = 1 / NET_CONST.snapshotHz;
    this.tick = 0;
  }

  // ------------------------------------------------------------- المضيف
  async startHost() {
    // في المتصفح لا يتوفر UDP؛ نرجع false مع رسالة واضحة (نسخة أندرويد هي التي تستضيف).
    if (typeof window !== 'undefined' && !window.__M11_UDP) {
      return false;
    }
    this.hostAnnounceTimer = 0;
    return true;
  }

  /** بثّ إعلان الاكتشاف كل 500 م.ث (3 ثوانٍ كاملة) */
  broadcastAnnounce(dt) {
    this.hostAnnounceTimer -= dt;
    if (this.hostAnnounceTimer > 0) return;
    this.hostAnnounceTimer = NET_CONST.discoverInterval;
    const packet = encodeAnnounce(this.hostName, this.peers.size, this.game.settings.mode || 'dm', this.game.settings.map);
    for (const p of this.peers.values()) p.socket && p.socket.send(packet);
    this.announceCount = (this.announceCount || 0) + 1;
  }

  /** يرسل لقطة حالة كل 1/30 ثانية */
  hostTick(dt) {
    this.tick += dt;
    this.broadcastAnnounce(dt);
    this.lastSnapshotSent += dt;
    if (this.lastSnapshotSent < this.snapshotRate) return;
    this.lastSnapshotSent = 0;
    const world = this.game.world;
    if (!world) return;
    const actors = world.actors;
    const buf = new ArrayBuffer(NET_CONST.headerBytes + 4 + actors.length * 12 + world.projectiles.length * 8);
    const view = new Uint8Array(buf);
    writeHeader(view, MSG.SNAPSHOT, this.seq++, this.ack);
    const dv = new DataView(buf);
    dv.setUint8(12, actors.length & 0xff);
    dv.setUint8(13, world.projectiles.length & 0xff);
    dv.setUint16(14, Math.round(world.time * 10) & 0xffff);
    let o = 16;
    for (const a of actors) { encodeActor(a, buf, o); o += 12; }
    for (const p of world.projectiles) {
      dv.setUint8(o, p.kind === 'grenade' ? 1 : p.kind === 'flare' ? 2 : 0);
      dv.setInt16(o + 1, Math.round(p.x * 4));
      dv.setInt16(o + 3, Math.round(p.y * 4));
      dv.setInt16(o + 5, Math.round(p.vx));
      o += 8;
    }
    const packet = buf.slice(0, o);
    for (const peer of this.peers.values()) peer.socket && peer.socket.send(packet);
    this.stats.sent++;
    this.stats.bytesUp += o;
  }

  // ------------------------------------------------------------- العميل
  async discover(ms = 3000) {
    // في المتصفح: محاكاة اكتشاف (لا UDP). في أندرويد: بث UDP حقيقي.
    if (typeof window !== 'undefined' && !window.__M11_UDP) {
      await new Promise((r) => setTimeout(r, Math.min(ms, 600)));
      return this.fakeHost ? [this.fakeHost] : [];
    }
    return [];
  }

  async join(host) {
    this.host = host;
    this.localId = 1;
    return true;
  }

  async joinAddress(addr) {
    const [ip, port] = String(addr).split(':');
    if (!ip) return false;
    this.host = { ip, port: Number(port) || this.port };
    return false;   // المتصفح لا يستطيع UDP — تُستخدم نسخة أندرويد
  }

  sendInput(cmd) {
    // العميل يرسل إدخاله للمضيف (30 هرتز). في الويب: تنفيذ محلي فقط.
    this.seq++;
    this.sendResendable(this.seq, cmd);
  }

  sendResendable(seq, payload) {
    this.resendQueue.set(seq, { payload, tries: 0, t: 0 });
    while (this.resendQueue.size > clamp(this.game.settings.maxResend || 3, 1, 8) * 4) {
      const oldest = this.resendQueue.keys().next().value;
      this.resendQueue.delete(oldest);
      this.stats.lost++;
    }
  }

  sendPing(pos) {
    const world = this.game.world;
    if (!world) return;
    world.events.push({ type: 'pingMark', x: pos.x, y: pos.y, kind: pos.kind });
  }

  update(dt) {
    if (this.mode === 'host') {
      this.hostTick(dt);
      return;
    }
    // العميل: نبني مخزن الإقحام ونحسب البِنج
    this.tick += dt;
    for (const [seq, item] of this.resendQueue) {
      item.t += dt;
      if (item.t > 0.1 && item.tries < (this.game.settings.maxResend || 3)) {
        item.t = 0;
        item.tries++;
        this.stats.resent++;
      } else if (item.t > 0.5) {
        this.resendQueue.delete(seq);
      }
    }
  }

  /** يقحم حالة لاعب في زمن ماضٍ (100 م.ث) */
  interpolateActor(id, renderTime) {
    const snaps = this.snapshotBuffer;
    for (let i = snaps.length - 1; i > 0; i--) {
      const b = snaps[i], a = snaps[i - 1];
      if (a.time <= renderTime && b.time >= renderTime) {
        const t = (renderTime - a.time) / Math.max(0.0001, b.time - a.time);
        const pa = a.actors.get(id), pb = b.actors.get(id);
        if (!pa || !pb) return pb || pa || null;
        return {
          ...pb,
          x: pa.x + (pb.x - pa.x) * t,
          y: pa.y + (pb.y - pa.y) * t,
          aimAngle: pa.aimAngle + angleDelta(pb.aimAngle, pa.aimAngle) * t,
          vx: pa.vx + (pb.vx - pa.vx) * t,
          vy: pa.vy + (pb.vy - pa.vy) * t,
        };
      }
    }
    return snaps.length ? snaps[snaps.length - 1].actors.get(id) : null;
  }

  pushSnapshot(snap) {
    this.snapshotBuffer.push(snap);
    if (this.snapshotBuffer.length > 32) this.snapshotBuffer.shift();
  }

  get netStats() {
    return {
      ping: this.pingSamples.length ? this.pingSamples.reduce((a, b) => a + b, 0) / this.pingSamples.length : 0,
      jitter: this.jitter || 0,
      loss: this.stats.received ? this.stats.lost / (this.stats.received + this.stats.lost) : 0,
      up: Math.round(this.stats.bytesUp / Math.max(1, this.tick * NET_CONST.snapshotHz)),
      down: Math.round(this.stats.bytesDown / Math.max(1, this.tick * NET_CONST.snapshotHz)),
      tick: NET_CONST.snapshotHz,
    };
  }
}

function angleDelta(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
