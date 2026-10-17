// ============================================================================
// التحكم — عصا مزدوجة لمس + كيبورد/فأرة + يد بلوتوث (Gamepad)
// كل الإعدادات قابلة للتخصيص (القسم 11): موضع/حجم/شفافية الأزرار، ثابت/عائم،
// حساسية، تصويب بالجيروسكوب، إطلاق تلقائي، تخطيط Claw، اهتزاز.
// ============================================================================

import { CONFIG } from './assets.js';
import { clamp } from './math.js';

export const DEFAULT_CONTROLS = {
  stickSize: 62,
  stickAlpha: 0.55,
  buttonAlpha: 0.6,
  joystickMode: 'floating',   // floating | fixed
  sensitivity: 1.0,
  aimSensitivity: 1.0,
  autoFire: false,
  gyro: false,
  haptics: true,
  clawLayout: 2,              // 2 | 3 | 4 أصابع
  leftHanded: false,
  tapToFire: true,
  holdToAim: false,
  showLaser: true,
  aimAssist: 0.35,
};

export class Input {
  constructor(canvas, controls = DEFAULT_CONTROLS) {
    this.canvas = canvas;
    this.controls = { ...DEFAULT_CONTROLS, ...controls };
    this.keys = new Set();
    this.pressed = new Set();
    this.released = new Set();
    // عصا الحركة (يسار) وعصا التصويب (يمين)
    this.move = { x: 0, y: 0, active: false, id: null, ox: 0, oy: 0, cx: 0, cy: 0, mag: 0 };
    this.aim = { x: 0, y: 0, active: false, id: null, ox: 0, oy: 0, cx: 0, cy: 0, mag: 0 };
    this.buttons = new Map();     // أزرار الواجهة (تُبنى من HUD)
    this.actions = {};            // حالة الأزرار المنطقية
    this.touches = new Map();
    this.mouse = { x: 0, y: 0, down: false, rightDown: false, dx: 0, dy: 0, wheel: 0 };
    // مؤشر موحّد للفأرة واللمس — تستخدمه القوائم وشاشة النتائج (كانت القوائم
    // تعمل بالكيبورد فقط، فيصبح من المستحيل التنقّل على الهاتف بلا لوحة مفاتيح)
    this.pointer = { x: 0, y: 0, down: false, justDown: false, justUp: false, touch: false };
    this.gamepad = null;
    this.gyro = { x: 0, y: 0, enabled: false };
    this.hapticsEnabled = true;
    this.lastAimAngle = 0;
    this._bind();
  }

  setControls(c) {
    Object.assign(this.controls, c);
  }

  _bind() {
    const c = this.canvas;
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this.released.add(e.code);
    });
    addEventListener('blur', () => {
      this.keys.clear();
      this.move.active = false;
      this.aim.active = false;
    });
    // لمس
    const t = (ev) => this._touchHandler(ev);
    c.addEventListener('touchstart', t, { passive: false });
    c.addEventListener('touchmove', t, { passive: false });
    c.addEventListener('touchend', t, { passive: false });
    c.addEventListener('touchcancel', t, { passive: false });
    // فأرة (سطح المكتب للتجربة)
    c.addEventListener('mousemove', (e) => {
      this._usedMouse = true;
      this._setPointerFromMouse(e);
    });
    c.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        this.mouse.down = true;
        this._setPointerFromMouse(e);
        this.pointer.touch = false;
        this.pointer.down = true;
        this.pointer.justDown = true;
      }
      if (e.button === 2) this.mouse.rightDown = true;
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        this.mouse.down = false;
        this.pointer.down = false;
        this.pointer.justUp = true;
      }
      if (e.button === 2) this.mouse.rightDown = false;
    });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('wheel', (e) => {
      this.mouse.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });
    addEventListener('gamepadconnected', (e) => { this.gamepad = e.gamepad; });
    addEventListener('gamepaddisconnected', () => { this.gamepad = null; });
    // جيروسكوب (يحتاج إذنًا على iOS)
    addEventListener('deviceorientation', (e) => {
      if (!this.gyro.enabled) return;
      this.gyro.x = (e.gamma || 0) / 45;
      this.gyro.y = (e.beta || 0) / 45;
    });
  }

  async enableGyro() {
    if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
      try {
        const p = await DeviceOrientationEvent.requestPermission();
        this.gyro.enabled = p === 'granted';
      } catch (e) {
        this.gyro.enabled = false;
      }
    } else {
      this.gyro.enabled = true;
    }
    return this.gyro.enabled;
  }

  _setPointerFromMouse(e) {
    const r = this.canvas.getBoundingClientRect();
    this.mouse.x = ((e.clientX - r.left) / r.width) * this.canvas.width;
    this.mouse.y = ((e.clientY - r.top) / r.height) * this.canvas.height;
    this.pointer.x = this.mouse.x;
    this.pointer.y = this.mouse.y;
  }

  _touchHandler(ev) {
    ev.preventDefault();
    this._usedTouch = true;
    const rect = this.canvas.getBoundingClientRect();
    const sx = this.canvas.width / rect.width;
    const sy = this.canvas.height / rect.height;
    const toLocal = (t) => ({
      x: (t.clientX - rect.left) * sx,
      y: (t.clientY - rect.top) * sy,
    });
    // مؤشر القوائم/اللمس: أوّل لمسة تحدد الموضع، وآخر رفع ينهي الضغطة
    if (ev.touches && ev.touches.length) {
      const p0 = toLocal(ev.touches[0]);
      this.pointer.x = p0.x;
      this.pointer.y = p0.y;
      this.pointer.touch = true;
      if (ev.type === 'touchstart' && !this.pointer.down) {
        this.pointer.down = true;
        this.pointer.justDown = true;
      }
    } else if (ev.type === 'touchend' || ev.type === 'touchcancel') {
      if (this.pointer.down) {
        this.pointer.down = false;
        this.pointer.justUp = true;
      }
    }
    const live = new Set();
    for (const t of ev.touches) {
      const p = toLocal(t);
      live.add(t.identifier);
      // هل اللمسة على زر واجهة؟
      let onButton = false;
      for (const [name, b] of this.buttons) {
        if (this._inButton(p, b)) {
          if (!this.touches.has(t.identifier)) this.actions[name + '_pressed'] = true;
          this.touches.set(t.identifier, { button: name, ...p });
          this.actions[name] = true;
          onButton = true;
          break;
        }
      }
      if (onButton) continue;
      const st = this.touches.get(t.identifier);
      if (st && st.button) {
        // انزلقت اللمسة خارج الزر
        if (!this._inButton(p, this.buttons.get(st.button))) {
          this.actions[st.button] = false;
          this.touches.delete(t.identifier);
          continue;
        }
        this.touches.set(t.identifier, { button: st.button, ...p });
        continue;
      }
      // في وضع اليد اليسرى ينعكس دور العصوين: الحركة يمينًا والتصويب يسارًا
      const left = this.controls.leftHanded
        ? p.x > this.canvas.width * 0.55
        : p.x < this.canvas.width * 0.45;
      const stick = left ? this.move : this.aim;
      if (st && st.stick === (left ? 'move' : 'aim')) {
        this._updateStick(stick, p.x, p.y);
        this.touches.set(t.identifier, { stick: left ? 'move' : 'aim', ...p });
      } else if (!st) {
        const mode = this.controls.joystickMode;
        if (mode === 'fixed') {
          const cx = left ? this.canvas.width * 0.16 : this.canvas.width * 0.84;
          const cy = this.canvas.height * 0.72;
          if (Math.hypot(p.x - cx, p.y - cy) > 70) {
            this.touches.set(t.identifier, { tap: true, ...p });
            this._tapAim(p.x, p.y);
            continue;
          }
          stick.ox = cx; stick.oy = cy;
        } else {
          stick.ox = p.x; stick.oy = p.y;
        }
        stick.id = t.identifier;
        stick.active = true;
        stick.cx = p.x; stick.cy = p.y;
        stick.x = 0; stick.y = 0; stick.mag = 0;
        this.touches.set(t.identifier, { stick: left ? 'move' : 'aim', ...p });
      }
    }
    // إعادة ضبط ما انتهى
    for (const [id, st] of [...this.touches]) {
      if (!live.has(id)) {
        if (st.button) this.actions[st.button] = false;
        if (st.stick === 'move') { this._resetStick(this.move); }
        if (st.stick === 'aim') { this._resetStick(this.aim); }
        this.touches.delete(id);
      }
    }
  }

  _inButton(p, b) {
    if (!b) return false;
    const dx = p.x - b.x, dy = p.y - b.y;
    return dx * dx + dy * dy <= b.r * b.r;
  }

  _updateStick(stick, x, y) {
    const r = this.controls.stickSize;
    let dx = x - stick.ox, dy = y - stick.oy;
    const len = Math.hypot(dx, dy);
    if (len > r) {
      dx *= r / len; dy *= r / len;
    }
    stick.cx = stick.ox + dx;
    stick.cy = stick.oy + dy;
    stick.mag = Math.min(1, len / r);
    const n = Math.max(1e-4, len);
    stick.x = dx / n * stick.mag;
    stick.y = dy / n * stick.mag;
  }

  _resetStick(s) {
    s.active = false; s.id = null; s.x = 0; s.y = 0; s.mag = 0;
  }

  _tapAim(x, y) {
    // نقر مباشر على الشاشة = تصويب نحو النقطة (وضع Tap-to-aim)
    this._tapTarget = { x, y };
  }

  /** يحدّث حالات الأزرار لكل إطار */
  update(dt) {
    this._readGamepad(dt);
    // تجميع أوامر اللعبة
    const a = this.actions;
    const k = this.keys;
    const cmd = {
      moveX: 0, moveY: 0, jet: false, jump: false, jumpHeld: false,
      fire: false, aimActive: false, reload: false, crouch: false, prone: false,
      melee: false, grenade: false, heal: false, swap: false, sprint: false,
      interact: false, ping: false, scoreboard: false, wheel: this.mouse.wheel,
      aimX: 0, aimY: 0, aimMag: 0, tapTarget: null,
      lean: 0, roll: false, slide: false,
    };
    // لمس
    if (this.move.active) { cmd.moveX += this.move.x; cmd.moveY += this.move.y; }
    if (this.aim.active && this.aim.mag > 0.22) {
      cmd.aimActive = true;
      cmd.aimX = this.aim.x; cmd.aimY = this.aim.y; cmd.aimMag = this.aim.mag;
      cmd.fire = true;   // في وضع العصا المزدوجة: الإطلاق أثناء التصويب
    }
    // كيبورد
    if (k.has('KeyA') || k.has('ArrowLeft')) cmd.moveX -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) cmd.moveX += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) cmd.jet = true;
    if (k.has('KeyS') || k.has('ArrowDown')) cmd.moveY += 1;
    if (k.has('Space')) { cmd.jumpHeld = true; if (this.pressed.has('Space')) cmd.jump = true; }
    if (this.mouse.down) cmd.fire = true;
    if (this.mouse.rightDown) cmd.aimActive = true;
    if (this.pressed.has('KeyR')) cmd.reload = true;
    if (this.pressed.has('KeyF')) cmd.melee = true;
    if (this.pressed.has('KeyG')) cmd.grenade = true;
    if (this.pressed.has('KeyQ')) cmd.heal = true;
    if (this.pressed.has('KeyE')) cmd.interact = true;
    if (this.pressed.has('KeyC')) cmd.prone = true;
    if (this.pressed.has('ControlLeft')) cmd.crouch = true;
    if (this.pressed.has('ShiftLeft')) cmd.roll = true;
    if (k.has('ShiftLeft')) cmd.sprint = true;
    if (this.pressed.has('Tab')) cmd.scoreboard = true;
    if (this.pressed.has('KeyV')) cmd.ping = true;
    if (this.pressed.has('Digit1')) cmd.swap = 1;
    if (this.pressed.has('Digit2')) cmd.swap = 2;
    if (this.pressed.has('Digit3')) cmd.swap = 3;
    // أزرار الواجهة
    if (a.fire) cmd.fire = true;
    if (a.jump || a.jump_pressed) cmd.jump = true;
    if (a.jump) cmd.jumpHeld = true;
    if (a.jetpack) cmd.jet = true;
    if (a.reload) cmd.reload = true;
    if (a.crouch) cmd.crouch = true;
    if (a.prone) cmd.prone = true;
    if (a.melee) cmd.melee = true;
    if (a.grenade) cmd.grenade = true;
    if (a.heal) cmd.heal = true;
    if (a.swap) cmd.swap = true;
    if (a.interact) cmd.interact = true;
    if (a.ping) cmd.ping = true;
    if (a.sprint) cmd.sprint = true;
    if (a.scoreboard) cmd.scoreboard = true;
    // الماوس: تصويب نحو المؤشر (سطح المكتب)
    if (this._tapTarget) {
      cmd.tapTarget = this._tapTarget;
      this._tapTarget = null;
    }
    cmd.isTouch = !!this._usedTouch;
    // مدخلات الفأرة/اللوحة: نُمرّر نقطة المؤشر ليصوّب اللاعب نحوها
    if (this._usedMouse) {
      cmd.pointer = { x: this.mouse.x, y: this.mouse.y, down: this.mouse.down, right: this.mouse.rightDown };
    }
    // يد التحكم (Gamepad)
    if (this.gpState) {
      const g = this.gpState;
      cmd.moveX += g.lx;
      cmd.moveY += g.ly > 0.3 ? 1 : 0;
      if (g.ry < -0.3) cmd.jet = true;
      if (g.jump) { cmd.jump = true; cmd.jumpHeld = true; }
      if (g.fire) cmd.fire = true;
      if (g.reload) cmd.reload = true;
      if (g.melee) cmd.melee = true;
      if (g.grenade) cmd.grenade = true;
      if (Math.abs(g.rx) > 0.2 || Math.abs(g.ry) > 0.2) {
        cmd.aimX = g.rx; cmd.aimY = g.ry; cmd.aimActive = true; cmd.aimMag = Math.hypot(g.rx, g.ry);
        cmd.fire = cmd.fire || Math.hypot(g.rx, g.ry) > 0.7;
      }
    }
    // جيروسكوب
    if (this.gyro.enabled) {
      cmd.gyroX = this.gyro.x;
      cmd.gyroY = this.gyro.y;
    }
    this.mouse.wheel = 0;
    return cmd;
  }

  _readGamepad(dt) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads && pads[0];
    if (!gp) return;
    const dz = (v) => (Math.abs(v) > 0.18 ? v : 0);
    this.gpState = {
      lx: dz(gp.axes[0] || 0), ly: dz(gp.axes[1] || 0),
      rx: dz(gp.axes[2] || 0), ry: dz(gp.axes[3] || 0),
      fire: gp.buttons[7] && gp.buttons[7].pressed,
      jump: gp.buttons[0] && gp.buttons[0].pressed,
      jet: gp.buttons[0] && gp.buttons[0].pressed,
      reload: gp.buttons[2] && gp.buttons[2].pressed,
      melee: gp.buttons[1] && gp.buttons[1].pressed,
      grenade: gp.buttons[5] && gp.buttons[5].pressed,
    };
  }

  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.pointer.justDown = false;
    this.pointer.justUp = false;
    for (const key of Object.keys(this.actions)) {
      if (key.endsWith('_pressed')) delete this.actions[key];
    }
  }

  /** اهتزاز الجهاز (Haptics) — القسم 11 */
  vibrate(ms = 12) {
    if (!this.hapticsEnabled || !this.controls.haptics) return;
    if (navigator.vibrate) navigator.vibrate(ms);
    const gp = navigator.getGamepads && navigator.getGamepads()[0];
    if (gp && gp.vibrationActuator) {
      try { gp.vibrationActuator.playEffect('dual-rumble', { duration: ms, strongMagnitude: 0.4, weakMagnitude: 0.3 }); } catch (e) { /* تجاهل */ }
    }
  }
}

/**
 * يحوّل نقطة على الشاشة الداخلية (640×360) إلى نقطة في العالم.
 * يطابق تحويل الكاميرا العكسي في camera.apply تمامًا.
 */
export function screenToWorld(cam, x, y, viewW = CONFIG.internalWidth, viewH = CONFIG.internalHeight) {
  const z = cam.zoom || 1;
  const ox = Math.round(-cam.left + cam.shakeX);
  const oy = Math.round(-cam.top + cam.shakeY);
  if (z === 1) return { x: x - ox, y: y - oy };
  const k = 1 - z;
  return { x: (x - (ox + k * viewW * 0.5)) / z, y: (y - (oy + k * viewH * 0.5)) / z };
}

/** يحوّل نقطة عالم إلى نقطة شاشة داخلية */
export function worldToScreen(cam, x, y, viewW = CONFIG.internalWidth, viewH = CONFIG.internalHeight) {
  const z = cam.zoom || 1;
  const ox = Math.round(-cam.left + cam.shakeX);
  const oy = Math.round(-cam.top + cam.shakeY);
  if (z === 1) return { x: x + ox, y: y + oy };
  const k = 1 - z;
  return { x: x * z + ox + k * viewW * 0.5, y: y * z + oy + k * viewH * 0.5 };
}
