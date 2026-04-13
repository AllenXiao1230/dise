import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const DICE_MODEL_URL = "./models/dice.glb";

const cv = document.getElementById("c");
const cw = document.getElementById("cw");
const controls = document.getElementById("controls");
const bm = document.getElementById("bm");
const bp = document.getElementById("bp");
const cdis = document.getElementById("cdis");
const hint = document.getElementById("hint");

const renderer = new THREE.WebGLRenderer({
  canvas: cv,
  antialias: true,
  alpha: true,
});
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor(0x000000, 0);

const scene = new THREE.Scene();

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 4000);
camera.up.set(0, 0, 1);
scene.add(camera);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.72);
const hemiLight = new THREE.HemisphereLight(0xd9e9ff, 0x29364b, 1.12);
const dirLight = new THREE.DirectionalLight(0xfff4df, 1.6);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(2048, 2048);
scene.add(ambientLight, hemiLight, dirLight, dirLight.target);

const floorVisual = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1),
  new THREE.MeshStandardMaterial({
    color: 0x13243c,
    roughness: 0.95,
    metalness: 0.03,
    transparent: true,
    opacity: 0.55,
  })
);
floorVisual.receiveShadow = true;
scene.add(floorVisual);

const floorShadow = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1),
  new THREE.ShadowMaterial({
    color: 0x000000,
    opacity: 0.24,
  })
);
floorShadow.receiveShadow = true;
scene.add(floorShadow);

const grid = new THREE.GridHelper(1, 24, 0x45638a, 0x233750);
grid.rotation.x = Math.PI / 2;
const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
gridMaterials.forEach((mat) => {
  mat.transparent = true;
  mat.opacity = 0.42;
});
scene.add(grid);

const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const ndc = new THREE.Vector2();
const CAMERA_DIR = new THREE.Vector3(1.12, -1.18, 0.92).normalize();

let W = 0;
let H = 0;
let VIEW_PAD_X = 24;
let VIEW_PAD_TOP = 84;
let VIEW_PAD_BOTTOM = 28;

// Quaternion helpers
function qNorm(q) {
  const l = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
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

function getViewportProfile() {
  const shortSide = Math.min(W, H);
  const longSide = Math.max(W, H);
  return {
    shortSide,
    longSide,
    isPhone: shortSide < 520,
    isTablet: shortSide >= 520 && shortSide < 900,
    isDesktop: shortSide >= 900,
  };
}

const FACE_NORMALS = [
  [0, 0, 1],
  [0, 0, -1],
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
];

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
let INERTIA = (2 / 3) * MASS * (HALF * 2) * (HALF * 2) / 6;
let diceCount = 1;
let rolling = false;
let raf = null;
let dice = [];
let lastTs = null;
let gT = 0;
const MODEL_METRICS = {
  size: new THREE.Vector3(1, 1, 1),
  halfHeight: 0.5,
  maxRadiusXY: Math.sqrt(0.5),
};
let diceTemplate = createFallbackDiceTemplate();

const WORLD_BOUNDS = {
  minX: -220,
  maxX: 220,
  minY: -220,
  maxY: 220,
};

function createFallbackDiceTemplate() {
  const root = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({
      color: 0xf1e5d0,
      roughness: 0.76,
      metalness: 0.02,
    })
  );
  body.castShadow = true;
  body.receiveShadow = true;
  root.add(body);
  return root;
}

function updateTemplateMetrics(object) {
  object.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  box.getSize(size);
  MODEL_METRICS.size.copy(size);
  MODEL_METRICS.halfHeight = Math.max(0.5, size.z * 0.5);
  MODEL_METRICS.maxRadiusXY = Math.max(Math.hypot(size.x, size.y) * 0.5, 0.5);
}

function setModelShadowFlags(object) {
  object.traverse((node) => {
    if (!node.isMesh) return;
    node.castShadow = true;
    node.receiveShadow = true;
    if (Array.isArray(node.material)) {
      node.material = node.material.map((mat) => mat.clone());
    } else if (node.material) {
      node.material = node.material.clone();
    }
  });
}

function normalizeDiceTemplate(source) {
  const wrapper = new THREE.Group();
  const content = source.clone(true);
  setModelShadowFlags(content);

  const box = new THREE.Box3().setFromObject(content);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  const maxDim = Math.max(size.x, size.y, size.z) || 1;

  content.position.sub(center);
  content.scale.multiplyScalar(1 / maxDim);

  // glTF assets are commonly authored Y-up; rotate once into this scene's Z-up world.
  wrapper.rotation.x = Math.PI / 2;
  wrapper.add(content);
  updateTemplateMetrics(wrapper);
  return wrapper;
}

function makeDiceVisual() {
  return diceTemplate.clone(true);
}

async function loadDiceTemplate() {
  const loader = new GLTFLoader();
  hint.textContent = "載入 GLB 中…";
  try {
    const gltf = await loader.loadAsync(DICE_MODEL_URL);
    diceTemplate = normalizeDiceTemplate(gltf.scene);
    recalcSceneMetrics();
    dice.forEach((die) => die.refreshVisual());
    if (!rolling) hint.textContent = "點擊擲骰";
  } catch (error) {
    console.warn(`Failed to load ${DICE_MODEL_URL}. Falling back to a simple cube.`, error);
    if (!rolling) hint.textContent = "未找到 models/dice.glb，暫用方塊";
  }
}

function getDieFootprint() {
  return Math.max(HALF * 1.14, HALF * 1.98 * MODEL_METRICS.maxRadiusXY);
}

function clampPointToBounds(point, margin = getDieFootprint()) {
  return [
    clamp(point[0], WORLD_BOUNDS.minX + margin, WORLD_BOUNDS.maxX - margin),
    clamp(point[1], WORLD_BOUNDS.minY + margin, WORLD_BOUNDS.maxY - margin),
  ];
}

function getResponsiveDieHalf() {
  const { shortSide, longSide, isPhone, isDesktop } = getViewportProfile();
  const areaScale = Math.sqrt((W * H) / (390 * 844));
  const aspectBias = clamp(longSide / Math.max(shortSide, 1), 1, 1.95);
  const deviceBias = isPhone ? 0.9 : isDesktop ? 1.08 : 1;
  const countBias = clamp(1 - Math.max(0, diceCount - 1) * 0.045, 0.72, 1);
  return clamp(Math.round(22 * areaScale * deviceBias * (1 / Math.pow(aspectBias, 0.08)) * countBias), 18, 34);
}

function getResponsiveViewHeight() {
  const { isPhone, isDesktop } = getViewportProfile();
  const countBias = 1 + Math.max(0, diceCount - 1) * (isPhone ? 0.07 : 0.05);
  const orientationBias = W > H ? 0.94 : 1.04;
  const baseHeight = HALF * (isPhone ? 20.8 : isDesktop ? 17.2 : 18.6);
  return clamp(baseHeight * countBias * orientationBias, 320, 760);
}

function clampExistingDiceToBounds() {
  const margin = getDieFootprint();
  dice.forEach((die) => {
    die.syncScale();
    const clamped = clampPointToBounds(die.pos, margin);
    die.pos[0] = clamped[0];
    die.pos[1] = clamped[1];
    die.pos[2] = Math.max(die.pos[2], die.getRestingHeight());
    die.syncVisual();
  });
}

function screenToFloor(sx, sy) {
  ndc.x = (sx / W) * 2 - 1;
  ndc.y = -(sy / H) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);
  const point = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(groundPlane, point)) return [0, 0];
  return [point.x, point.y];
}

function updateCamera() {
  const aspect = W / H;
  const viewHeight = getResponsiveViewHeight();
  const halfViewHeight = viewHeight / 2;
  const halfViewWidth = halfViewHeight * aspect;

  camera.left = -halfViewWidth;
  camera.right = halfViewWidth;
  camera.top = halfViewHeight;
  camera.bottom = -halfViewHeight;
  camera.near = 0.1;
  camera.far = viewHeight * 8;

  const focus = new THREE.Vector3(0, 0, HALF * 0.7);
  camera.position.copy(CAMERA_DIR).multiplyScalar(viewHeight * 2.2).add(focus);
  camera.lookAt(focus);
  camera.updateProjectionMatrix();
}

function updateWorldBounds() {
  const samples = [
    [VIEW_PAD_X, VIEW_PAD_TOP],
    [W * 0.5, VIEW_PAD_TOP],
    [W - VIEW_PAD_X, VIEW_PAD_TOP],
    [VIEW_PAD_X, H * 0.5],
    [W - VIEW_PAD_X, H * 0.5],
    [VIEW_PAD_X, H - VIEW_PAD_BOTTOM],
    [W * 0.5, H - VIEW_PAD_BOTTOM],
    [W - VIEW_PAD_X, H - VIEW_PAD_BOTTOM],
  ].map(([sx, sy]) => screenToFloor(sx, sy));

  const margin = getDieFootprint() * 1.08;
  let minX = Math.min(...samples.map((point) => point[0])) + margin;
  let maxX = Math.max(...samples.map((point) => point[0])) - margin;
  let minY = Math.min(...samples.map((point) => point[1])) + margin;
  let maxY = Math.max(...samples.map((point) => point[1])) - margin;

  const minSpan = HALF * (9 + diceCount * 1.15);
  if (maxX - minX < minSpan) {
    const cx = (minX + maxX) * 0.5;
    minX = cx - minSpan * 0.5;
    maxX = cx + minSpan * 0.5;
  }
  if (maxY - minY < minSpan) {
    const cy = (minY + maxY) * 0.5;
    minY = cy - minSpan * 0.5;
    maxY = cy + minSpan * 0.5;
  }

  WORLD_BOUNDS.minX = minX;
  WORLD_BOUNDS.maxX = maxX;
  WORLD_BOUNDS.minY = minY;
  WORLD_BOUNDS.maxY = maxY;
}

function updateFloorAndLights() {
  const floorSpan = HALF * (16 + diceCount * 2.1);
  const width = Math.max(floorSpan, WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX + HALF * 8);
  const depth = Math.max(floorSpan, WORLD_BOUNDS.maxY - WORLD_BOUNDS.minY + HALF * 8);
  const cx = (WORLD_BOUNDS.minX + WORLD_BOUNDS.maxX) * 0.5;
  const cy = (WORLD_BOUNDS.minY + WORLD_BOUNDS.maxY) * 0.5;
  const span = Math.max(width, depth);

  floorVisual.position.set(cx, cy, -0.4);
  floorShadow.position.set(cx, cy, 0.02);
  floorVisual.scale.set(width, depth, 1);
  floorShadow.scale.set(width, depth, 1);

  grid.position.set(cx, cy, 0.08);
  grid.scale.setScalar(span);

  dirLight.position.set(cx + span * 0.32, cy - span * 0.28, HALF * 20);
  dirLight.target.position.set(cx, cy, HALF * 0.65);

  dirLight.shadow.camera.left = -span * 0.62;
  dirLight.shadow.camera.right = span * 0.62;
  dirLight.shadow.camera.top = span * 0.62;
  dirLight.shadow.camera.bottom = -span * 0.62;
  dirLight.shadow.camera.near = 1;
  dirLight.shadow.camera.far = HALF * 42;
  dirLight.shadow.bias = -0.00008;
  dirLight.shadow.normalBias = 0.018;
  dirLight.shadow.camera.updateProjectionMatrix();
}

function recalcSceneMetrics() {
  const rect = cw.getBoundingClientRect();
  const controlsRect = controls.getBoundingClientRect();
  W = Math.max(320, Math.round(rect.width));
  H = Math.max(420, Math.round(rect.height));

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(W, H, false);

  HALF = getResponsiveDieHalf();
  INERTIA = (2 / 3) * MASS * (HALF * 2) * (HALF * 2) / 6;

  const { isPhone } = getViewportProfile();
  VIEW_PAD_X = clamp(W * (isPhone ? 0.052 : 0.04), 20, 44);
  VIEW_PAD_TOP = clamp(controlsRect.bottom - rect.top + (isPhone ? 24 : 20), 78, Math.max(isPhone ? 108 : 96, H * (isPhone ? 0.21 : 0.18)));
  VIEW_PAD_BOTTOM = clamp(H * (isPhone ? 0.062 : 0.05), 24, 46);

  updateCamera();
  updateWorldBounds();
  updateFloorAndLights();
  clampExistingDiceToBounds();
}

class Die {
  constructor(delay, spawnPos, launchVel) {
    this.delay = delay;
    this.pos = [
      clamp(spawnPos[0] + (Math.random() - 0.5) * HALF * 0.08, WORLD_BOUNDS.minX, WORLD_BOUNDS.maxX),
      clamp(spawnPos[1] + (Math.random() - 0.5) * HALF * 0.08, WORLD_BOUNDS.minY, WORLD_BOUNDS.maxY),
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

    this.root = new THREE.Group();
    this.visual = null;
    this.refreshVisual();
    scene.add(this.root);
    this.syncVisual();
  }

  refreshVisual() {
    if (this.visual) this.root.remove(this.visual);
    this.visual = makeDiceVisual();
    this.root.add(this.visual);
    this.syncScale();
  }

  syncScale() {
    if (!this.visual) return;
    this.visual.scale.setScalar(HALF * 1.98);
  }

  syncVisual() {
    this.root.position.set(this.pos[0], this.pos[1], this.pos[2]);
    this.root.quaternion.set(this.q[1], this.q[2], this.q[3], this.q[0]);
  }

  dispose() {
    scene.remove(this.root);
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

  constrainToBounds() {
    if (this.pos[0] < WORLD_BOUNDS.minX) {
      this.pos[0] = WORLD_BOUNDS.minX;
      if (this.vel[0] < 0) this.vel[0] *= -0.48;
      this.vel[1] *= 0.94;
    } else if (this.pos[0] > WORLD_BOUNDS.maxX) {
      this.pos[0] = WORLD_BOUNDS.maxX;
      if (this.vel[0] > 0) this.vel[0] *= -0.48;
      this.vel[1] *= 0.94;
    }

    if (this.pos[1] < WORLD_BOUNDS.minY) {
      this.pos[1] = WORLD_BOUNDS.minY;
      if (this.vel[1] < 0) this.vel[1] *= -0.48;
      this.vel[0] *= 0.94;
    } else if (this.pos[1] > WORLD_BOUNDS.maxY) {
      this.pos[1] = WORLD_BOUNDS.maxY;
      if (this.vel[1] > 0) this.vel[1] *= -0.48;
      this.vel[0] *= 0.94;
    }
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
    this.q = qNorm([
      this.q[0] + dq[0] * dt,
      this.q[1] + dq[1] * dt,
      this.q[2] + dq[2] * dt,
      this.q[3] + dq[3] * dt,
    ]);

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
        const jn = -((1 + RESTITUTION) * vNorm) / denom;
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
        this.omega = add3(this.omega, scale3(recoveryAxis, (recoveryStrength * dt * 60) / recoveryLen));
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

    this.constrainToBounds();

    const speed = len3(this.vel) + len3(this.omega) * 0.1;
    if (this.pos[2] <= HALF + 1 && speed < SETTLE_SPEED) {
      this.settleTimer += dt;
      if (this.settleTimer > SETTLE_TIME) this.settleNow();
    } else {
      this.settleTimer = 0;
    }

    if (this.life > FORCE_SETTLE_TIME) this.settleNow();
  }
}

function clearDice() {
  dice.forEach((die) => die.dispose());
  dice = [];
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

  const j = -((1 + 0.35) * vN) / 2;
  if (!a.settled) {
    a.vel[0] -= j * nx;
    a.vel[1] -= j * ny;
  }
  if (!b.settled) {
    b.vel[0] += j * nx;
    b.vel[1] += j * ny;
  }
}

function renderScene() {
  dice.forEach((die) => die.syncVisual());
  renderer.render(scene, camera);
}

function loop(ts) {
  if (lastTs === null) lastTs = ts;
  const dt = Math.min((ts - lastTs) / 1000, 0.033);
  lastTs = ts;
  gT += dt;

  const subSteps = Math.max(5, Math.min(8, Math.ceil(dt / (1 / 300))));
  const sdt = dt / subSteps;
  for (let step = 0; step < subSteps; step++) {
    dice.forEach((die) => {
      if (gT >= die.delay) die.active = true;
      die.step(sdt);
    });
    for (let i = 0; i < dice.length; i++) {
      for (let j = i + 1; j < dice.length; j++) collideDice(dice[i], dice[j]);
    }
  }

  if (gT > FORCE_SETTLE_TIME) dice.forEach((die) => die.settleNow());

  renderScene();

  const allDone = dice.length > 0 && dice.every((die) => die.settled);
  if (!allDone) {
    raf = requestAnimationFrame(loop);
  } else {
    rolling = false;
    hint.style.display = "block";
    if (hint.textContent === "載入 GLB 中…") hint.textContent = "點擊擲骰";
  }
}

function getPointerPos(event) {
  const rect = cv.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function rollDice(event) {
  if (rolling) return;

  const pointer = event ? getPointerPos(event) : { x: W / 2, y: H * 0.34 };
  const floorPoint = screenToFloor(pointer.x, pointer.y);
  const margin = getDieFootprint() * 1.04;
  const spawnBase = clampPointToBounds(floorPoint, margin);

  const aimPoint = screenToFloor(W * 0.5, H * 0.68);
  const target = clampPointToBounds(aimPoint, margin);

  let throwDir = [target[0] - spawnBase[0], target[1] - spawnBase[1], 0];
  if (len3(throwDir) < 18) throwDir = [0, 1, 0];
  throwDir = norm3(throwDir);

  const sideDir = [-throwDir[1], throwDir[0], 0];
  const pathLen = len3([target[0] - spawnBase[0], target[1] - spawnBase[1], 0]);
  const baseSpeed = clamp(260 + pathLen * 0.36, 260, 360);
  const burstOffset = Math.random() * Math.PI * 2;

  rolling = true;
  lastTs = null;
  gT = 0;
  if (raf) cancelAnimationFrame(raf);
  hint.style.display = "none";
  clearDice();

  dice = Array.from({ length: diceCount }, (_, i) => {
    let spawnPos;
    let launchVel;

    if (diceCount === 1) {
      spawnPos = clampPointToBounds(spawnBase, margin);
      const forwardSpeed = baseSpeed + (Math.random() - 0.5) * 26;
      const sideSpeed = (Math.random() - 0.5) * 14;
      launchVel = [
        throwDir[0] * forwardSpeed + sideDir[0] * sideSpeed,
        throwDir[1] * forwardSpeed + sideDir[1] * sideSpeed,
        390 + Math.random() * 110,
      ];
    } else {
      const angle = burstOffset + i * (Math.PI * 2 / diceCount) + (Math.random() - 0.5) * 0.22;
      const radialDir = [Math.cos(angle), Math.sin(angle), 0];
      const tangentDir = [-radialDir[1], radialDir[0], 0];
      const spawnRadius = HALF * (1.9 + 0.16 * diceCount);
      const spawnJitter = HALF * 0.38;
      spawnPos = clampPointToBounds(add3(
        add3(spawnBase, scale3(radialDir, spawnRadius)),
        scale3(tangentDir, (Math.random() - 0.5) * spawnJitter)
      ), margin);
      const outwardSpeed = baseSpeed + 62 + (Math.random() - 0.5) * 36;
      const swirlSpeed = (Math.random() - 0.5) * 24;
      launchVel = [
        radialDir[0] * outwardSpeed + tangentDir[0] * swirlSpeed,
        radialDir[1] * outwardSpeed + tangentDir[1] * swirlSpeed,
        420 + Math.random() * 118,
      ];
    }

    return new Die(i * 0.055, spawnPos, launchVel);
  });

  raf = requestAnimationFrame(loop);
}

function chg(delta) {
  if (rolling) return;
  const next = diceCount + delta;
  if (next < 1 || next > 8) return;
  diceCount = next;
  cdis.textContent = `${next} 顆`;
  bm.disabled = next <= 1;
  bp.disabled = next >= 8;
  recalcSceneMetrics();
  renderScene();
}

bm.addEventListener("click", () => chg(-1));
bp.addEventListener("click", () => chg(1));
cv.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  rollDice(event);
});
window.addEventListener("resize", () => {
  recalcSceneMetrics();
  renderScene();
});

bm.disabled = true;
updateTemplateMetrics(diceTemplate);
recalcSceneMetrics();
renderScene();
loadDiceTemplate();
