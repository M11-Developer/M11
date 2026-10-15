// ============================================================================
// نظام الصوت — WebAudio مع قنوات منفصلة، صوت موضعي ثنائي الأبعاد،
// كتم ترددات عند وجود جدار (Low-pass)، موسيقى متكيفة، وشات صوتي محلي.
// (القسم 12 من دفتر المشروع)
// ============================================================================

export const AUDIO_FILES = {
  weapons: ['pistol', 'smg', 'ar', 'sr', 'shotgun', 'lmg', 'energy', 'launcher', 'melee'],
  weaponDist: ['near', 'mid', 'far'],
  explosions: ['grenade', 'explosion', 'big', 'flash'],
  impacts: ['dirt', 'metal', 'wood', 'water', 'concrete', 'glass', 'flesh'],
  footsteps: ['metal_0', 'metal_1', 'metal_2', 'wood_0', 'wood_1', 'wood_2',
    'water_0', 'water_1', 'water_2', 'dirt_0', 'dirt_1', 'dirt_2',
    'concrete_0', 'concrete_1', 'concrete_2'],
  reload: ['pistol', 'smg', 'ar', 'sr', 'shotgun', 'lmg', 'energy', 'launcher', 'melee'],
  ui: ['click', 'back', 'confirm', 'error', 'kill', 'headshot', 'level_up', 'pickup', 'hitmarker'],
  ambience: ['desert_wind', 'city_far', 'base_hum', 'forest_night', 'rain', 'battle_distant'],
  music: ['menu_theme', 'lobby_theme', 'br_calm', 'br_final', 'dm_fast', 'victory', 'defeat'],
  voices: ['male_low', 'male_mid', 'female_mid', 'female_high'],
  voiceKinds: ['effort', 'pain', 'death', 'victory', 'taunt'],
};

export const DEFAULT_AUDIO = {
  master: 0.9, music: 0.55, sfx: 0.9, voice: 0.8, ui: 0.7, ambience: 0.5,
  muteAll: false, voiceChat: false, pushToTalk: true, proximityVoice: true,
};

export class AudioSystem {
  constructor(settings = DEFAULT_AUDIO) {
    this.settings = { ...DEFAULT_AUDIO, ...settings };
    this.ctx = null;
    this.buffers = new Map();
    this.base = 'assets/audio/';
    this.currentMusic = null;
    this.musicGain = null;
    this.ambienceNodes = [];
    this.ready = false;
    this.voiceStream = null;
    this.voicePeers = new Map();
    this.listeners = {};
  }

  /** يجب أن يُنادى بعد أول تفاعل من المستخدم (سياسة المتصفحات) */
  async init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -8;
    this.comp.knee.value = 12;
    this.comp.ratio.value = 4;
    this.master.connect(this.comp);
    this.comp.connect(ctx.destination);
    // قنوات
    this.buses = {};
    for (const name of ['music', 'sfx', 'voice', 'ui', 'ambience']) {
      const g = ctx.createGain();
      g.connect(this.master);
      this.buses[name] = g;
    }
    this.applySettings();
    this.ready = true;
  }

  applySettings(s = null) {
    if (s) Object.assign(this.settings, s);
    if (!this.ctx) return;
    const st = this.settings;
    this.master.gain.value = st.muteAll ? 0 : st.master;
    for (const name of ['music', 'sfx', 'voice', 'ui', 'ambience']) {
      this.buses[name].gain.value = st[name];
    }
  }

  async loadAll(onProgress) {
    const list = [];
    for (const d of AUDIO_FILES.weapons) {
      for (const dist of AUDIO_FILES.weaponDist) list.push(`weapons/${d}_${dist}`);
    }
    for (const k of AUDIO_FILES.explosions) list.push(`explosions/${k}`);
    for (const k of AUDIO_FILES.impacts) list.push(`impacts/${k}`);
    for (const k of AUDIO_FILES.footsteps) list.push(`footsteps/${k}`);
    for (const k of AUDIO_FILES.reload) list.push(`reload/${k}`);
    for (const k of AUDIO_FILES.ui) list.push(`ui/${k}`);
    for (const k of AUDIO_FILES.ambience) list.push(`ambience/${k}`);
    for (const k of AUDIO_FILES.music) list.push(`music/${k}`);
    for (const v of AUDIO_FILES.voices) for (const k of AUDIO_FILES.voiceKinds) list.push(`voices/${v}_${k}`);
    let done = 0;
    const concurrency = 6;
    const queue = [...list];
    const worker = async () => {
      while (queue.length) {
        const key = queue.shift();
        try {
          await this.load(key);
        } catch (e) { /* بعض الملفات قد تكون اختيارية */ }
        done++;
        if (onProgress) onProgress(done, list.length, key);
      }
    };
    await Promise.all(Array.from({ length: concurrency }, worker));
    return done;
  }

  async load(key) {
    if (this.buffers.has(key)) return this.buffers.get(key);
    const res = await fetch(this.base + key + '.ogg');
    if (!res.ok) throw new Error('صوت غير موجود: ' + key);
    const data = await res.arrayBuffer();
    const buf = await this.ctx.decodeAudioData(data);
    this.buffers.set(key, buf);
    return buf;
  }

  /**
   * يشغّل صوتًا موضعيًا. opts: {volume, pan, lowpass, rate, bus, loop, x, y, listener}
   */
  play(key, opts = {}) {
    if (!this.ready || this.settings.muteAll) return null;
    const buf = this.buffers.get(key);
    if (!buf) return null;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = opts.rate || 1;
    let node = src;
    if (opts.lowpass) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = Math.max(180, opts.lowpass);
      lp.Q.value = 0.4;
      node.connect(lp);
      node = lp;
    }
    const gain = ctx.createGain();
    gain.gain.value = opts.volume != null ? opts.volume : 1;
    node.connect(gain);
    let out = gain;
    if (opts.pan != null && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, opts.pan));
      gain.connect(p);
      out = p;
    }
    out.connect(this.buses[opts.bus || 'sfx']);
    src.loop = !!opts.loop;
    src.start(0);
    src.onended = () => {
      try { gain.disconnect(); } catch (e) { /* تجاهل */ }
    };
    return { src, gain };
  }

  /** صوت موضعي: توهين بالمسافة + اتجاه + كتم عند وجود حائل */
  playPositional(key, x, y, listener, opts = {}) {
    const dx = x - listener.x, dy = y - listener.y;
    const d = Math.hypot(dx, dy);
    const maxD = opts.maxDistance || 900;
    if (d > maxD) return null;
    const vol = Math.pow(1 - d / maxD, opts.falloff || 1.6) * (opts.volume != null ? opts.volume : 1);
    if (vol < 0.02) return null;
    const pan = Math.max(-1, Math.min(1, dx / 320));
    let lowpass = 0;
    if (opts.occluded) lowpass = 900 + Math.max(0, 1 - d / maxD) * 2600;
    return this.play(key, { ...opts, volume: vol, pan, lowpass: lowpass || opts.lowpass });
  }

  // ---------------------------------------------------------------- الموسيقى
  playMusic(track, { fade = 1.2, volume = 1, loop = true } = {}) {
    if (!this.ready) return;
    if (this.currentMusic && this.currentMusic.key === track) return;
    this.stopMusic(fade);
    const buf = this.buffers.get('music/' + track);
    if (!buf) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = loop;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(g);
    g.connect(this.buses.music);
    src.start(0);
    g.gain.linearRampToValueAtTime(volume, ctx.currentTime + fade);
    this.currentMusic = { key: track, src, gain: g, volume };
  }

  stopMusic(fade = 0.8) {
    if (!this.currentMusic) return;
    const { src, gain, volume } = this.currentMusic;
    const ctx = this.ctx;
    try {
      gain.gain.cancelScheduledValues(ctx.currentTime);
      gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + fade);
      src.stop(ctx.currentTime + fade + 0.05);
    } catch (e) { /* تجاهل */ }
    this.currentMusic = null;
  }

  /** موسيقى متكيفة مع شدة اللعب (BR هادئة ← نهائية متوترة) */
  setMusicIntensity(v) {
    this.intensity = v;
  }

  async playAmbience(kind, volume = 1) {
    if (!this.ready) return;
    this.stopAmbience();
    const buf = this.buffers.get('ambience/' + kind);
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    src.connect(g);
    g.connect(this.buses.ambience);
    src.start(0);
    g.gain.linearRampToValueAtTime(volume, this.ctx.currentTime + 1.5);
    this.ambienceNodes.push({ src, gain: g });
  }

  stopAmbience(fade = 0.6) {
    for (const { src, gain } of this.ambienceNodes) {
      try {
        gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + fade);
        src.stop(this.ctx.currentTime + fade + 0.05);
      } catch (e) { /* تجاهل */ }
    }
    this.ambienceNodes = [];
  }

  // ---------------------------------------------------------------- الشات الصوتي
  /**
   * يشغّل شاتًا صوتيًا محليًا عبر WebRTC (يُضاف المسار إلى اتصالات الأقران).
   * يعمل داخل الشبكة المحلية فقط بلا أي خدمة خارجية.
   */
  async enableVoiceChat() {
    if (this.voiceStream) return this.voiceStream;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      video: false,
    });
    this.voiceStream = stream;
    return stream;
  }

  attachVoiceTo(peerConnection) {
    if (!this.voiceStream) return;
    for (const track of this.voiceStream.getAudioTracks()) {
      peerConnection.addTrack(track, this.voiceStream);
    }
  }

  /** يشغّل صوت لاعب آخر (Stream من WebRTC) مع توهين حسب المسافة */
  playRemoteVoice(id, stream, getDistance, proximity = true) {
    const el = document.createElement('audio');
    el.srcObject = stream;
    el.autoplay = true;
    el.muted = !this.settings.voiceChat;
    this.voicePeers.set(id, { el, getDistance, proximity });
    el.play().catch(() => { /* يننتظر تفاعل المستخدم */ });
    return el;
  }

  setMicMuted(muted) {
    if (!this.voiceStream) return;
    for (const t of this.voiceStream.getAudioTracks()) t.enabled = !muted;
  }

  updateVoice(dt) {
    for (const [, v] of this.voicePeers) {
      const d = v.getDistance ? v.getDistance() : 0;
      const near = Math.max(0, 1 - d / 420);
      v.el.volume = this.settings.proximityVoice && v.proximity
        ? Math.max(0.05, near) * this.settings.voice
        : this.settings.voice;
    }
  }
}

export const audio = new AudioSystem();
