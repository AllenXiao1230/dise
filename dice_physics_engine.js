const cv = document.getElementById("c");
const ctx = cv.getContext("2d");
const cw = document.getElementById("cw");
const bm = document.getElementById("bm");
const bp = document.getElementById("bp");
const cdis = document.getElementById("cdis");
const hint = document.getElementById("hint");

let W = 0, H = 0;

// Quaternion helpers
function qMul(a, b) {
  return [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
  ];
}

function qNorm(q) {
  const l = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

function qIdent() {
  return [1, 0, 0, 0];
}

function qRotV(q, v) {
  const [w, x, y, z] = q;
  const [vx, vy, vz] = v;
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return [
    vx + w * tx + y * tz - z * ty,
    vy + w * ty + z * tx - x * tz,
    vz + w * tz + x * ty - y * tx,
  ];
}

function qDeriv(q, omega) {
  const [ox, oy, oz] = omega;
  return [
    -0.5 * (q[1] * ox + q[2] * oy + q[3] * oz),
    0.5 * (q[0] * ox + q[3] * oy - q[2] * oz),
    0.5 * (q[0] * oy - q[3] * ox + q[1] * oz),
    0.5 * (q[0] * oz + q[2] * ox - q[1] * oy),
  ];
}

function qToMat(q) {
  const [w, x, y, z] = q;
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
  ];
}

function matMulV(m, v) {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function len3(v) {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

function scale3(v, s) {
  return [v[0] * s, v[1] * s, v[2] * s];
}

function add3(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function sub3(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function norm3(v) {
  const l = len3(v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function qFromAxisAngle(axis, angle) {
  const n = norm3(axis);
  const s = Math.sin(angle / 2);
  return qNorm([Math.cos(angle / 2), n[0] * s, n[1] * s, n[2] * s]);
}

function qFromTo(from, to) {
  const a = norm3(from);
  const b = norm3(to);
  const d = dot3(a, b);
  if (d > 0.9999) return qIdent();
  if (d < -0.9999) {
    const axis = len3(cross3(a, [1, 0, 0])) > 0.001 ? cross3(a, [1, 0, 0]) : cross3(a, [0, 1, 0]);
    return qFromAxisAngle(axis, Math.PI);
  }
  const axis = cross3(a, b);
  return qNorm([1 + d, axis[0], axis[1], axis[2]]);
}

function lerp2(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function quadPoint(pts, u, v) {
  const left = lerp2(pts[0], pts[3], v);
  const right = lerp2(pts[1], pts[2], v);
  return lerp2(left, right, u);
}

function avg2(pts) {
  const s = pts.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: s.x / pts.length, y: s.y / pts.length };
}

function insetQuad(pts, scale) {
  const c = avg2(pts);
  return pts.map((p) => ({ x: c.x + (p.x - c.x) * scale, y: c.y + (p.y - c.y) * scale }));
}

function drawQuadPath(pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
}

// Projection
const ISO = Math.PI / 6;
const ISO_C = Math.cos(ISO), ISO_S = Math.sin(ISO);
const VIEW_DIR = norm3([1, 1, 1]);
const LIGHT_DIR = norm3([-0.6, -0.4, 1.25]);

function iso(x, y, z) {
  return { x: W / 2 + (x - y) * ISO_C, y: H * 0.60 + (x + y) * ISO_S - z };
}

function screenToFloor(sx, sy, z = 0) {
  const a = (sx - W / 2) / ISO_C;
  const b = (sy - H * 0.60 + z) / ISO_S;
  return [(a + b) / 2, (b - a) / 2];
}

// Die faces
const FACE_DEFS = [
  { normal: [0, 0, 1], value: 1, corners: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
  { normal: [0, 0, -1], value: 6, corners: [[-1, 1, -1], [1, 1, -1], [1, -1, -1], [-1, -1, -1]] },
  { normal: [1, 0, 0], value: 3, corners: [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]] },
  { normal: [-1, 0, 0], value: 4, corners: [[-1, 1, -1], [-1, -1, -1], [-1, -1, 1], [-1, 1, 1]] },
  { normal: [0, 1, 0], value: 2, corners: [[-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1]] },
  { normal: [0, -1, 0], value: 5, corners: [[1, -1, -1], [-1, -1, -1], [-1, -1, 1], [1, -1, 1]] },
];
const FACE_NORMALS = FACE_DEFS.map((face) => face.normal);
const DOTS = {
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [0, 2], [2, 0], [2, 2]],
  5: [[0, 0], [0, 2], [1, 1], [2, 0], [2, 2]],
  6: [[0, 0], [0, 1], [0, 2], [2, 0], [2, 1], [2, 2]],
};

// Physics constants
const GRAVITY = 2350;
const RESTITUTION = 0.1;
const MU_ROLL = 0.9;
const MU_SPIN = 0.36;
const FLOOR_Z = 0;
const MASS = 1;
const MICRO_BOUNCE_SPEED = 16;
const SETTLE_SPEED = 6;
const SETTLE_TIME = 0.18;
const FORCE_SETTLE_TIME = 2;
const STABLE_SLIDE_SPEED = 34;
const STABLE_ANG_SPEED = 12;
const TILT_RECOVERY_FORCE = 22;
const TILT_RECOVERY_DOT = 0.58;

let HALF = 22;
let INERTIA = 2 / 3 * MASS * (HALF * 2) * (HALF * 2) / 6;
let WALL_BOUND = 230;
let GRID_SPACING = 42;
let GRID_LINES = 7;

let diceCount = 1;
let rolling = false;
let raf = null;
let dice = [];
let lastTs = null;
let gT = 0;

function recalcSceneMetrics() {
  const rect = cw.getBoundingClientRect();
  W = Math.max(320, Math.round(rect.width));
  H = Math.max(420, Math.round(rect.height));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = Math.round(W * dpr);
  cv.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = true;
  HALF = clamp(Math.round(Math.min(W, H) * 0.052), 20, 30);
  INERTIA = 2 / 3 * MASS * (HALF * 2) * (HALF * 2) / 6;
  WALL_BOUND = Math.max(HALF * 5, Math.min(W * 0.42, H * 0.52));
  GRID_SPACING = clamp(Math.round(Math.min(W, H) * 0.086), 36, 72);
  GRID_LINES = Math.ceil(WALL_BOUND / GRID_SPACING) + 2;
}

function renderScene() {
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#0a1020";
  ctx.fillRect(0, 0, W, H);
  drawFloor();
  const sorted = [...dice].sort((a, b) => dot3(a.pos, VIEW_DIR) - dot3(b.pos, VIEW_DIR));
  sorted.forEach((d) => d.draw());
}

class Die {
  constructor(delay, spawnPos, launchVel) {
    this.delay = delay;
    this.pos = [
      clamp(spawnPos[0] + (Math.random() - 0.5) * HALF * 0.24, -WALL_BOUND + HALF, WALL_BOUND - HALF),
      clamp(spawnPos[1] + (Math.random() - 0.5) * HALF * 0.24, -WALL_BOUND + HALF, WALL_BOUND - HALF),
      HALF + 20 + Math.random() * 12,
    ];
    this.vel = [
      launchVel[0] + (Math.random() - 0.5) * 12,
      launchVel[1] + (Math.random() - 0.5) * 12,
      launchVel[2] + Math.random() * 36,
    ];
    this.q = qNorm([1 + Math.random() * 0.12, Math.random() * 0.34, Math.random() * 0.34, Math.random() * 0.34]);
    this.omega = [(Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 10];
    this.active = false;
    this.settled = false;
    this.settleTimer = 0;
    this.life = 0;
    this.alpha = 1;
  }

  getUpFaceInfo(mat = qToMat(this.q)) {
    let bestDot = -Infinity;
    let bestFace = 0;
    FACE_NORMALS.forEach((normal, i) => {
      const worldNormal = matMulV(mat, normal);
      if (worldNormal[2] > bestDot) {
        bestDot = worldNormal[2];
        bestFace = i;
      }
    });
    return { faceIdx: bestFace, dot: bestDot };
  }

  getRestingHeight(mat = qToMat(this.q)) {
    let minZ = Infinity;
    for (let sx = -1; sx <= 1; sx += 2) {
      for (let sy = -1; sy <= 1; sy += 2) {
        for (let sz = -1; sz <= 1; sz += 2) {
          const cornerZ = matMulV(mat, [sx * HALF, sy * HALF, sz * HALF])[2];
          if (cornerZ < minZ) minZ = cornerZ;
        }
      }
    }
    return -minZ;
  }

  settleNow() {
    if (this.settled) return;
    this.settled = true;
    this.active = false;
    this.vel = [0, 0, 0];
    this.omega = [0, 0, 0];
    this.q = qNorm(this.q);
    const mat = qToMat(this.q);
    this.pos[2] = this.getRestingHeight(mat);
  }

  step(dt) {
    if (!this.active || this.settled) return;
    this.life += dt;

    this.vel[2] -= GRAVITY * dt;
    this.pos = add3(this.pos, scale3(this.vel, dt));

    const dq = qDeriv(this.q, this.omega);
    this.q = qNorm([this.q[0] + dq[0] * dt, this.q[1] + dq[1] * dt, this.q[2] + dq[2] * dt, this.q[3] + dq[3] * dt]);

    const mat = qToMat(this.q);
    let penetration = 0;
    let contactCount = 0;
    let contactVelSum = [0, 0, 0];
    let contactPtSum = [0, 0, 0];

    for (let sx = -1; sx <= 1; sx += 2) {
      for (let sy = -1; sy <= 1; sy += 2) {
        for (let sz = -1; sz <= 1; sz += 2) {
          const local = [sx * HALF, sy * HALF, sz * HALF];
          const world = add3(this.pos, matMulV(mat, local));
          if (world[2] < FLOOR_Z) {
            const depth = FLOOR_Z - world[2];
            if (depth > penetration) penetration = depth;
            contactCount++;
            contactPtSum = add3(contactPtSum, world);
            const r = sub3(world, this.pos);
            const vContact = add3(this.vel, cross3(this.omega, r));
            contactVelSum = add3(contactVelSum, vContact);
          }
        }
      }
    }

    if (contactCount > 0 && penetration > 0) {
      this.pos[2] += penetration;

      const cp = scale3(contactPtSum, 1 / contactCount);
      const r = sub3(cp, this.pos);
      const vRel = scale3(contactVelSum, 1 / contactCount);
      const vNorm = vRel[2];

      if (vNorm < -MICRO_BOUNCE_SPEED) {
        const rCrossN = [r[1], -r[0], 0];
        const denom = 1 / MASS + dot3(rCrossN, scale3(rCrossN, 1 / INERTIA));
        const jn = -(1 + RESTITUTION) * vNorm / denom;
        this.vel[2] += jn / MASS;
        const torque = scale3(cross3(r, [0, 0, jn]), 1 / INERTIA);
        this.omega = add3(this.omega, torque);
      } else {
        this.vel[2] = 0;
      }

      const vTan = [vRel[0], vRel[1], 0];
      const vtLen = len3(vTan);
      if (vtLen > 2) {
        const friction = -Math.min(MU_ROLL * Math.abs(this.vel[2] + 0.1), vtLen);
        const fDir = scale3(vTan, friction / vtLen);
        this.vel[0] += fDir[0] / MASS;
        this.vel[1] += fDir[1] / MASS;
        const ft = cross3(r, [fDir[0], fDir[1], 0]);
        this.omega = add3(this.omega, scale3(ft, 1 / INERTIA));
      }

      this.omega[2] *= 1 - MU_SPIN * dt * 60;

      const groundLinear = Math.pow(0.94, dt * 60);
      const groundAngular = Math.pow(0.86, dt * 60);
      this.vel[0] *= groundLinear;
      this.vel[1] *= groundLinear;
      this.omega[0] *= groundAngular;
      this.omega[1] *= groundAngular;
      this.omega[2] *= groundAngular;
      if (Math.abs(this.vel[2]) < MICRO_BOUNCE_SPEED) this.vel[2] = 0;

      const upInfo = this.getUpFaceInfo(mat);
      const angSpeed = len3(this.omega);
      const worldUpNormal = matMulV(mat, FACE_NORMALS[upInfo.faceIdx]);
      const recoveryAxis = cross3(worldUpNormal, [0, 0, 1]);
      const recoveryLen = len3(recoveryAxis);
      if (recoveryLen > 0.0001 && vtLen < STABLE_SLIDE_SPEED && angSpeed < STABLE_ANG_SPEED && upInfo.dot > TILT_RECOVERY_DOT) {
        const slideFactor = clamp(1 - vtLen / STABLE_SLIDE_SPEED, 0, 1);
        const spinFactor = clamp(1 - angSpeed / STABLE_ANG_SPEED, 0, 1);
        const settleBias = clamp((upInfo.dot - TILT_RECOVERY_DOT) / (1 - TILT_RECOVERY_DOT), 0, 1);
        const recoveryStrength = TILT_RECOVERY_FORCE * slideFactor * spinFactor * (0.35 + 0.65 * settleBias);
        this.omega = add3(this.omega, scale3(recoveryAxis, recoveryStrength * dt * 60 / recoveryLen));
      }

      const settleBias = clamp((upInfo.dot - TILT_RECOVERY_DOT) / (1 - TILT_RECOVERY_DOT), 0, 1);
      const slideFactor = clamp(1 - vtLen / (STABLE_SLIDE_SPEED * 1.15), 0, 1);
      const spinFactor = clamp(1 - angSpeed / (STABLE_ANG_SPEED * 1.15), 0, 1);
      const smoothGrip = 0.28 + 0.72 * slideFactor * spinFactor * (0.45 + 0.55 * settleBias);
      const extraLinearDrag = Math.pow(1 - 0.12 * smoothGrip, dt * 60);
      const extraAngularDrag = Math.pow(1 - 0.18 * smoothGrip, dt * 60);
      this.vel[0] *= extraLinearDrag;
      this.vel[1] *= extraLinearDrag;
      this.omega[0] *= extraAngularDrag;
      this.omega[1] *= extraAngularDrag;
    }

    this.vel[0] *= Math.pow(0.994, dt * 60);
    this.vel[1] *= Math.pow(0.994, dt * 60);
    this.omega[0] *= Math.pow(0.97, dt * 60);
    this.omega[1] *= Math.pow(0.97, dt * 60);
    this.omega[2] *= Math.pow(0.97, dt * 60);

    if (Math.abs(this.pos[0]) > WALL_BOUND) {
      this.vel[0] *= -0.5;
      this.pos[0] = Math.sign(this.pos[0]) * WALL_BOUND;
    }
    if (Math.abs(this.pos[1]) > WALL_BOUND) {
      this.vel[1] *= -0.5;
      this.pos[1] = Math.sign(this.pos[1]) * WALL_BOUND;
    }

    const speed = len3(this.vel) + len3(this.omega) * 0.1;
    if (this.pos[2] <= HALF + 1 && speed < SETTLE_SPEED) {
      this.settleTimer += dt;
      if (this.settleTimer > SETTLE_TIME) this.settleNow();
    } else {
      this.settleTimer = 0;
    }
    if (this.life > FORCE_SETTLE_TIME) this.settleNow();
  }

  draw() {
    const mat = qToMat(this.q);
    const [px, py, pz] = this.pos;
    const s = HALF;
    ctx.globalAlpha = this.alpha;

    const sc = iso(px, py, 0);
    const h = Math.max(0, pz - this.getRestingHeight(mat));
    const ss = Math.max(0.22, 1 - h / 160);
    ctx.beginPath();
    ctx.ellipse(sc.x, sc.y, s * 1.0 * ss, s * 0.5 * ss, 0, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(0,0,0,${0.48 - ss * 0.12})`;
    ctx.fill();
    ctx.globalAlpha = this.alpha;

    const faces = FACE_DEFS.map((face) => {
      const worldNormal = matMulV(mat, face.normal);
      const visibility = dot3(worldNormal, VIEW_DIR);
      if (visibility <= 0.02) return null;
      const worldCorners = face.corners.map(([x, y, z]) => add3(this.pos, matMulV(mat, [x * s, y * s, z * s])));
      const pts = worldCorners.map(([x, y, z]) => iso(x, y, z));
      const center = worldCorners.reduce((acc, p) => add3(acc, p), [0, 0, 0]).map((v) => v / 4);
      return {
        value: face.value,
        pts,
        depth: dot3(center, VIEW_DIR),
        light: clamp(0.72 + Math.max(0, dot3(worldNormal, LIGHT_DIR)) * 0.22 + Math.max(0, worldNormal[2]) * 0.08, 0.58, 1),
      };
    }).filter(Boolean).sort((a, b) => a.depth - b.depth);

    ctx.lineJoin = "round";
    faces.forEach((face) => {
      const tone = Math.round(78 * face.light + 12);
      const inner = insetQuad(face.pts, 0.86);
      const highlight = insetQuad(face.pts, 0.93);
      const bounds = face.pts.reduce((acc, p) => ({
        minX: Math.min(acc.minX, p.x),
        maxX: Math.max(acc.maxX, p.x),
        minY: Math.min(acc.minY, p.y),
        maxY: Math.max(acc.maxY, p.y),
      }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });

      drawQuadPath(face.pts);
      ctx.fillStyle = `hsl(38 23% ${tone}%)`;
      ctx.fill();
      ctx.strokeStyle = "rgba(88,73,58,0.85)";
      ctx.lineWidth = 1.15;
      ctx.stroke();

      ctx.save();
      drawQuadPath(face.pts);
      ctx.clip();
      const sheen = ctx.createLinearGradient(face.pts[0].x, face.pts[0].y, face.pts[2].x, face.pts[2].y);
      sheen.addColorStop(0, "rgba(255,255,255,0.20)");
      sheen.addColorStop(0.42, "rgba(255,255,255,0.05)");
      sheen.addColorStop(1, "rgba(0,0,0,0.16)");
      ctx.fillStyle = sheen;
      ctx.fillRect(bounds.minX - 4, bounds.minY - 4, bounds.maxX - bounds.minX + 8, bounds.maxY - bounds.minY + 8);
      ctx.restore();

      drawQuadPath(inner);
      ctx.strokeStyle = "rgba(255,248,235,0.16)";
      ctx.lineWidth = 0.9;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(highlight[0].x, highlight[0].y);
      ctx.lineTo(highlight[1].x, highlight[1].y);
      ctx.moveTo(highlight[0].x, highlight[0].y);
      ctx.lineTo(highlight[3].x, highlight[3].y);
      ctx.strokeStyle = "rgba(255,255,255,0.22)";
      ctx.lineWidth = 1.1;
      ctx.stroke();

      const dl = DOTS[face.value];
      if (!dl) return;
      const pipRadius = clamp(Math.hypot(face.pts[1].x - face.pts[0].x, face.pts[1].y - face.pts[0].y) * 0.085, 2.6, 4.1);
      dl.forEach(([row, col]) => {
        const pt = quadPoint(face.pts, (col + 0.5) / 3, (row + 0.5) / 3);
        ctx.beginPath();
        ctx.arc(pt.x + pipRadius * 0.18, pt.y + pipRadius * 0.22, pipRadius * 1.03, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0,0,0,0.18)";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, pipRadius, 0, Math.PI * 2);
        ctx.fillStyle = "#161411";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(pt.x - pipRadius * 0.22, pt.y - pipRadius * 0.2, pipRadius * 0.38, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.08)";
        ctx.fill();
      });
    });
    ctx.globalAlpha = 1;
  }
}

function collideDice(a, b) {
  if ((!a.active || !b.active) || (a.settled && b.settled)) return;
  const dx = b.pos[0] - a.pos[0];
  const dy = b.pos[1] - a.pos[1];
  const dist = Math.sqrt(dx * dx + dy * dy);
  const minD = HALF * 2.18;
  if (dist > minD || dist < 0.01) return;
  const pen = minD - dist;
  const nx = dx / dist;
  const ny = dy / dist;
  if (!a.settled) {
    a.pos[0] -= nx * pen * 0.5;
    a.pos[1] -= ny * pen * 0.5;
  }
  if (!b.settled) {
    b.pos[0] += nx * pen * 0.5;
    b.pos[1] += ny * pen * 0.5;
  }
  const vRel = [b.vel[0] - a.vel[0], b.vel[1] - a.vel[1], 0];
  const vN = vRel[0] * nx + vRel[1] * ny;
  if (vN > 0) return;
  const j = -(1 + 0.35) * vN / 2;
  if (!a.settled) {
    a.vel[0] -= j * nx;
    a.vel[1] -= j * ny;
  }
  if (!b.settled) {
    b.vel[0] += j * nx;
    b.vel[1] += j * ny;
  }
}

function drawFloor() {
  const sp = GRID_SPACING;
  const lines = GRID_LINES;
  ctx.strokeStyle = "#1e2d4a";
  ctx.lineWidth = 0.6;
  for (let i = -lines; i <= lines; i++) {
    const a = iso(i * sp, -lines * sp, 0);
    const b = iso(i * sp, lines * sp, 0);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    const c = iso(-lines * sp, i * sp, 0);
    const d = iso(lines * sp, i * sp, 0);
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(d.x, d.y);
    ctx.stroke();
  }
}

function loop(ts) {
  if (lastTs === null) lastTs = ts;
  const dt = Math.min((ts - lastTs) / 1000, 0.033);
  lastTs = ts;
  gT += dt;

  const SUB = Math.max(5, Math.min(8, Math.ceil(dt / (1 / 300))));
  const sdt = dt / SUB;
  for (let s = 0; s < SUB; s++) {
    dice.forEach((d) => {
      if (gT >= d.delay) d.active = true;
      d.step(sdt);
    });
    for (let i = 0; i < dice.length; i++) {
      for (let j = i + 1; j < dice.length; j++) collideDice(dice[i], dice[j]);
    }
  }
  if (gT > FORCE_SETTLE_TIME) dice.forEach((d) => d.settleNow());

  renderScene();

  const allDone = dice.length > 0 && dice.every((d) => d.settled);
  if (!allDone) {
    raf = requestAnimationFrame(loop);
  } else {
    rolling = false;
    hint.style.display = "block";
  }
}

function getPointerPos(e) {
  const rect = cv.getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
  };
}

function rollDice(e) {
  if (rolling) return;
  const pointer = e ? getPointerPos(e) : { x: W / 2, y: H * 0.34 };
  const floorPoint = screenToFloor(pointer.x, pointer.y, 0);
  const spawnBase = [
    clamp(floorPoint[0], -WALL_BOUND * 0.78, WALL_BOUND * 0.78),
    clamp(floorPoint[1], -WALL_BOUND * 0.78, WALL_BOUND * 0.78),
  ];
  const target = [spawnBase[0] * -0.18, spawnBase[1] * -0.28 + GRID_SPACING * 0.7];
  let throwDir = [target[0] - spawnBase[0], target[1] - spawnBase[1], 0];
  if (len3(throwDir) < 18) throwDir = [0, 1, 0];
  throwDir = norm3(throwDir);
  const sideDir = [-throwDir[1], throwDir[0], 0];
  const pathLen = len3([target[0] - spawnBase[0], target[1] - spawnBase[1], 0]);
  const baseSpeed = clamp(255 + pathLen * 0.34, 255, 340);
  const burstOffset = Math.random() * Math.PI * 2;

  rolling = true;
  lastTs = null;
  gT = 0;
  if (raf) cancelAnimationFrame(raf);
  hint.style.display = "none";

  dice = Array.from({ length: diceCount }, (_, i) => {
    let spawnPos;
    let launchVel;
    if (diceCount === 1) {
      spawnPos = add3(spawnBase, scale3(sideDir, 0));
      const forwardSpeed = baseSpeed + (Math.random() - 0.5) * 26;
      const sideSpeed = (Math.random() - 0.5) * 14;
      launchVel = [
        throwDir[0] * forwardSpeed + sideDir[0] * sideSpeed,
        throwDir[1] * forwardSpeed + sideDir[1] * sideSpeed,
        380 + Math.random() * 96,
      ];
    } else {
      const angle = burstOffset + i * (Math.PI * 2 / diceCount) + (Math.random() - 0.5) * 0.22;
      const radialDir = [Math.cos(angle), Math.sin(angle), 0];
      const tangentDir = [-radialDir[1], radialDir[0], 0];
      const spawnRadius = HALF * (1.85 + 0.14 * diceCount);
      const spawnJitter = HALF * 0.35;
      spawnPos = add3(add3(spawnBase, scale3(radialDir, spawnRadius)), scale3(tangentDir, (Math.random() - 0.5) * spawnJitter));
      const outwardSpeed = baseSpeed + 55 + (Math.random() - 0.5) * 34;
      const swirlSpeed = (Math.random() - 0.5) * 22;
      launchVel = [
        radialDir[0] * outwardSpeed + tangentDir[0] * swirlSpeed,
        radialDir[1] * outwardSpeed + tangentDir[1] * swirlSpeed,
        410 + Math.random() * 108,
      ];
    }
    return new Die(i * 0.055, spawnPos, launchVel);
  });

  raf = requestAnimationFrame(loop);
}

function chg(d) {
  if (rolling) return;
  const n = diceCount + d;
  if (n < 1 || n > 8) return;
  diceCount = n;
  cdis.textContent = n + " 顆";
  bm.disabled = n <= 1;
  bp.disabled = n >= 8;
  renderScene();
}

bm.addEventListener("click", () => chg(-1));
bp.addEventListener("click", () => chg(1));
cv.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  rollDice(e);
});
window.addEventListener("resize", () => {
  recalcSceneMetrics();
  renderScene();
});

bm.disabled = true;
recalcSceneMetrics();
renderScene();
