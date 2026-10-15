// Trigonometry that gives the same result, to the last bit, on every JavaScript
// engine. JavaScript only promises exact results for + - * / and Math.sqrt;
// Math.sin, cos, tan, atan2, and hypot may differ in the last bit between engines
// and versions (Chrome 155 and Node 24 differ on about 6% of arguments), and one
// such bit is enough to make a demo recorded in a browser diverge when it's
// replayed elsewhere. The sim uses these instead (tests/math/trig.test.ts checks it
// uses no other Math function that isn't exact).
//
// Adapted from fdlibm 5.3 (k_sin.c, k_cos.c, e_rem_pio2.c, s_atan.c, e_atan2.c),
// which carries this notice:
//
//   Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
//   Developed at SunPro, a Sun Microsystems, Inc. business.
//   Permission to use, copy, modify, and distribute this
//   software is freely granted, provided that this notice
//   is preserved.
//
// Changes: argument reduction uses only fdlibm's medium-size path, which is
// accurate to 2^19 * pi/2 (about 823,550); past that, instead of __kernel_rem_pio2,
// the argument is first folded into one turn with %, which JavaScript defines
// exactly, so results stay deterministic though less accurate (the sim's angles
// are never that large). The medium path skips its table lookup for the fast
// case, and tan is sin / cos.

// The high 32 bits of a double, as fdlibm's __HI, and a double from high bits with the low ones 0.
const bits = new DataView(new ArrayBuffer(8));
function high(x: number): number {
  bits.setFloat64(0, x);
  return bits.getInt32(0);
}
function fromHigh(hi: number): number {
  bits.setInt32(0, hi);
  bits.setInt32(4, 0);
  return bits.getFloat64(0);
}

// k_sin.c and k_cos.c: sin and cos on [-pi/4, pi/4], of x + y, where y is the tail of a reduced argument.
const S1 = -1.66666666666666324348e-1;
const S2 = 8.33333333332248946124e-3;
const S3 = -1.98412698298579493134e-4;
const S4 = 2.75573137070700676789e-6;
const S5 = -2.50507602534068634195e-8;
const S6 = 1.58969099521155010221e-10;
const C1 = 4.16666666666666019037e-2;
const C2 = -1.38888888888741095749e-3;
const C3 = 2.48015872894767294178e-5;
const C4 = -2.75573143513906633035e-7;
const C5 = 2.08757232129817482790e-9;
const C6 = -1.13596475577881948265e-11;

function kernelSin(x: number, y: number, hasTail: boolean): number {
  if ((high(x) & 0x7fffffff) < 0x3e400000) return x; // |x| < 2^-27
  const z = x * x;
  const v = z * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  return hasTail ? x - ((z * (0.5 * y - v * r) - y) - v * S1) : x + v * (S1 + z * r);
}

function kernelCos(x: number, y: number): number {
  const ix = high(x) & 0x7fffffff;
  if (ix < 0x3e400000) return 1; // |x| < 2^-27
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  if (ix < 0x3fd33333) return 1 - (0.5 * z - (z * r - x * y)); // |x| < 0.3
  const qx = ix > 0x3fe90000 ? 0.28125 : fromHigh(ix - 0x00200000); // x/4, roughly
  const hz = 0.5 * z - qx;
  const a = 1 - qx;
  return a - (hz - (z * r - x * y));
}

// e_rem_pio2.c: x reduced to y0 + y1 in [-pi/4, pi/4], returning n where x = n * pi/2 + y0 + y1.
const INV_PIO2 = 6.36619772367581382433e-1;
const PIO2_1 = 1.57079632673412561417;
const PIO2_1T = 6.07710050650619224932e-11;
const PIO2_2 = 6.07710050630396597660e-11;
const PIO2_2T = 2.02226624879595063154e-21;
const PIO2_3 = 2.02226624871116645580e-21;
const PIO2_3T = 8.47842766036889956997e-32;
/** The high bits of 2^19 * pi/2: the largest argument the medium-size reduction is accurate for. */
const MEDIUM_MAX = 0x413921fb;
const TWO_PI = 6.28318530717958647692;
let y0 = 0;
let y1 = 0;

function reduce(x: number): number {
  const hx = high(x);
  const ix = hx & 0x7fffffff;
  if (ix <= 0x3fe921fb) {
    y0 = x;
    y1 = 0;
    return 0;
  }
  if (ix < 0x4002d97c) {
    // |x| < 3pi/4: n is 1 or -1
    const sign = hx > 0 ? 1 : -1;
    let z = x - sign * PIO2_1;
    if (ix !== 0x3ff921fb) {
      y0 = z - sign * PIO2_1T;
      y1 = (z - y0) - sign * PIO2_1T;
    } else {
      // near pi/2: more bits of pi
      z -= sign * PIO2_2;
      y0 = z - sign * PIO2_2T;
      y1 = (z - y0) - sign * PIO2_2T;
    }
    return sign;
  }
  const t = Math.abs(x);
  if (ix > MEDIUM_MAX) return reduce(hx < 0 ? -(t % TWO_PI) : t % TWO_PI);
  const n = Math.floor(t * INV_PIO2 + 0.5);
  let r = t - n * PIO2_1;
  let w = n * PIO2_1T;
  const j = ix >> 20;
  y0 = r - w;
  if (j - ((high(y0) >> 20) & 0x7ff) > 16) {
    // cancellation: a second, then maybe a third, round with more bits of pi
    let u = r;
    w = n * PIO2_2;
    r = u - w;
    w = n * PIO2_2T - ((u - r) - w);
    y0 = r - w;
    if (j - ((high(y0) >> 20) & 0x7ff) > 49) {
      u = r;
      w = n * PIO2_3;
      r = u - w;
      w = n * PIO2_3T - ((u - r) - w);
      y0 = r - w;
    }
  }
  y1 = (r - y0) - w;
  if (hx < 0) {
    y0 = -y0;
    y1 = -y1;
    return -n;
  }
  return n;
}

export function sin(x: number): number {
  const ix = high(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kernelSin(x, 0, false);
  if (ix >= 0x7ff00000) return NaN;
  switch (reduce(x) & 3) {
    case 0:
      return kernelSin(y0, y1, true);
    case 1:
      return kernelCos(y0, y1);
    case 2:
      return -kernelSin(y0, y1, true);
    default:
      return -kernelCos(y0, y1);
  }
}

export function cos(x: number): number {
  const ix = high(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kernelCos(x, 0);
  if (ix >= 0x7ff00000) return NaN;
  switch (reduce(x) & 3) {
    case 0:
      return kernelCos(y0, y1);
    case 1:
      return -kernelSin(y0, y1, true);
    case 2:
      return -kernelCos(y0, y1);
    default:
      return kernelSin(y0, y1, true);
  }
}

export const tan = (x: number): number => sin(x) / cos(x);

// s_atan.c
const ATAN_HI = [4.63647609000806093515e-1, 7.85398163397448278999e-1, 9.82793723247329054082e-1, 1.57079632679489655800];
const ATAN_LO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
const AT = [
  3.33333333333329318027e-1, -1.99999999998764832476e-1, 1.42857142725034663711e-1, -1.11111104054623557880e-1,
  9.09088713343650656196e-2, -7.69187620504482999495e-2, 6.66107313738753120669e-2, -5.83357013379057348645e-2,
  4.97687799461593236017e-2, -3.65315727442169155270e-2, 1.62858201153657823623e-2,
];

export function atan(x: number): number {
  const hx = high(x);
  const ix = hx & 0x7fffffff;
  if (ix >= 0x44100000) {
    // |x| >= 2^66
    if (Number.isNaN(x)) return x;
    return hx > 0 ? ATAN_HI[3]! + ATAN_LO[3]! : -ATAN_HI[3]! - ATAN_LO[3]!;
  }
  let id: number;
  if (ix < 0x3fdc0000) {
    // |x| < 0.4375
    if (ix < 0x3e200000) return x; // |x| < 2^-29
    id = -1;
  } else {
    x = Math.abs(x);
    if (ix < 0x3ff30000) {
      // |x| < 1.1875
      if (ix < 0x3fe60000) {
        id = 0;
        x = (2 * x - 1) / (2 + x);
      } else {
        id = 1;
        x = (x - 1) / (x + 1);
      }
    } else if (ix < 0x40038000) {
      // |x| < 2.4375
      id = 2;
      x = (x - 1.5) / (1 + 1.5 * x);
    } else {
      id = 3;
      x = -1 / x;
    }
  }
  const z = x * x;
  const w = z * z;
  const s1 = z * (AT[0]! + w * (AT[2]! + w * (AT[4]! + w * (AT[6]! + w * (AT[8]! + w * AT[10]!)))));
  const s2 = w * (AT[1]! + w * (AT[3]! + w * (AT[5]! + w * (AT[7]! + w * AT[9]!))));
  if (id < 0) return x - x * (s1 + s2);
  const result = ATAN_HI[id]! - ((x * (s1 + s2) - ATAN_LO[id]!) - x);
  return hx < 0 ? -result : result;
}

// e_atan2.c
const PI = 3.1415926535897931160;
const PI_O_2 = 1.5707963267948965580;
const PI_LO = 1.2246467991473531772e-16;

export function atan2(y: number, x: number): number {
  if (Number.isNaN(x) || Number.isNaN(y)) return NaN;
  if (x === 1) return atan(y);
  const negativeY = y < 0 || Object.is(y, -0);
  const negativeX = x < 0 || Object.is(x, -0);
  if (y === 0) return negativeX ? (negativeY ? -PI : PI) : y; // atan2(±0, +x) is ±0; atan2(±0, -x) is ±pi
  if (x === 0) return negativeY ? -PI_O_2 : PI_O_2;
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    if (!Number.isFinite(y)) {
      const angle = !Number.isFinite(x) ? (negativeX ? 3 * (PI / 4) : PI / 4) : PI_O_2;
      return negativeY ? -angle : angle;
    }
    return negativeX ? (negativeY ? -PI : PI) : negativeY ? -0 : 0; // x is infinite, y finite
  }
  const k = ((high(y) & 0x7fffffff) - (high(x) & 0x7fffffff)) >> 20;
  let z: number;
  if (k > 60) z = PI_O_2 + 0.5 * PI_LO; // |y/x| > 2^60
  else if (negativeX && k < -60) z = 0; // |y|/x < -2^60
  else z = atan(Math.abs(y / x));
  if (!negativeX) return negativeY ? -z : z;
  return negativeY ? (z - PI_LO) - PI : PI - (z - PI_LO);
}

/** The length of (x, y), as sqrt(x*x + y*y), which is exact to the last bit everywhere (Math.hypot isn't). */
export const hypot = (x: number, y: number): number => Math.sqrt(x * x + y * y);
