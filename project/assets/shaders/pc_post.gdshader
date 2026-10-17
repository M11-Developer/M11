// ============================================================================
// تحسينات العرض الخاصة بنسخة الكمبيوتر (PC).
// تُطبَّق كطبقة نهائية فوق كل شيء (CanvasLayer عليا) وتضيف:
//   • Bloom خفيف حول مصادر الضوء والمؤثرات (8 عينات — رخيص على كرت الشاشة)
//   • تدريج ألوان سينمائي: ظلال باردة + إضاءات دافئة (المظهر المطلوب في §3)
//   • Vignette ناعم يركز العين على مركز الشاشة
//   • حبيبات فيلم ثابتة الشدة (لا "تغلي" على الأجهزة الضعيفة)
// لا يُستخدم في نسخة الجوال إطلاقًا — يُحمَّل فقط عند OS.has_feature("pc").
// ============================================================================
shader_type canvas_item;

uniform sampler2D screen_tex : hint_screen_texture, filter_linear_mipmap;
uniform float bloom_strength : hint_range(0.0, 1.5) = 0.42;
uniform float bloom_threshold : hint_range(0.0, 1.0) = 0.68;
uniform float vignette_strength : hint_range(0.0, 1.5) = 0.55;
uniform float grain_amount : hint_range(0.0, 0.12) = 0.028;
uniform float saturation : hint_range(0.0, 2.0) = 1.10;
uniform float warm_highlights : hint_range(0.0, 0.3) = 0.075;
uniform float cool_shadows : hint_range(0.0, 0.3) = 0.06;
uniform float contrast : hint_range(0.8, 1.4) = 1.05;

// ضجيج عشوائي سريع (بدون تكسچر خارجي)
float hash(vec2 p) {
	p = fract(p * vec2(123.34, 456.21));
	p += dot(p, p + 45.32);
	return fract(p.x * p.y);
}

// أخذ عينات دائرية حول البكسل لجمع الإضاءة العالية فقط
vec3 bloom_sample(vec2 uv, vec2 px, float stride_px) {
	vec3 acc = vec3(0.0);
	float radius = stride_px;
	for (int i = 0; i < 8; i++) {
		float a = float(i) * 0.7853981634; // 45°
		vec2 off = vec2(cos(a), sin(a)) * px * radius;
		vec3 c = texture(screen_tex, uv + off).rgb;
		// نأخذ فقط ما يتجاوز عتبة الإضاءة (مصابيح، نار، وميض فوهة السلاح)
		float luma = dot(c, vec3(0.299, 0.587, 0.114));
		if (luma > bloom_threshold) {
			acc += (c - bloom_threshold) / max(1.0 - bloom_threshold, 0.001);
		}
	}
	return acc * 0.125;
}

void fragment() {
	vec2 uv = SCREEN_UV;
	vec3 col = texture(screen_tex, uv).rgb;

	// 1) Bloom
	vec3 glow = bloom_sample(uv, SCREEN_PIXEL_SIZE, 2.5)
	          + bloom_sample(uv, SCREEN_PIXEL_SIZE, 6.0) * 0.8;
	col += glow * bloom_strength;

	// 2) تدريج ألوان: ظلال باردة + إضاءات دافئة
	float luma = dot(col, vec3(0.299, 0.587, 0.114));
	col += vec3(-0.4, 0.05, 0.7) * cool_shadows * (1.0 - luma);
	col += vec3(0.7, 0.35, -0.3) * warm_highlights * luma;

	// 3) التشبّع والتباين
	vec3 gray = vec3(luma);
	col = mix(gray, col, saturation);
	col = (col - 0.5) * contrast + 0.5;

	// 4) Vignette
	float d = distance(uv, vec2(0.5)) * 1.4142;
	float vig = smoothstep(0.55, 1.15, d);
	col *= 1.0 - vig * vignette_strength;

	// 5) حبيبات فيلم (تتغير 12 مرة/ثانية لتبقى ناعمة)
	vec2 grain_uv = uv * vec2(1920.0, 1080.0) + vec2(floor(TIME * 12.0) * 37.0);
	float g = hash(floor(grain_uv)) - 0.5;
	col += g * grain_amount;

	COLOR = vec4(clamp(col, vec3(0.0), vec3(1.0)), 1.0);
}
