import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

/** Stored models are meshopt-compressed (see lib/server/assets.ts). */
const gltfLoader = () => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { STLExporter } from "three/addons/exporters/STLExporter.js";
import type { Difficulty, MotionRig, TeardownObject } from "../types";
import { buildPractice, type MotionOp } from "./practice";
import { sfx } from "./sfx";

export type Finish = "original" | "clay" | "wire";

export interface EngineCallbacks {
  onPlaced: (placed: number, total: number) => void;
  onMiss: () => void;
  onComplete: () => void;
}

interface Pose {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
}

interface Part {
  name: string;
  /** Which object on the bench this part belongs to. */
  owner: number;
  /** Group centred on the part's geometry; this is what moves. */
  pivot: THREE.Group;
  mesh: THREE.Mesh;
  home: Pose;
  tray: Pose;
  loose: boolean;
  placed: boolean;
  ghost: THREE.Mesh | null;
  size: number;
  height: number;
  /** Small fixed parts ride along with the loose part they sit on. */
  riders: THREE.Mesh[];
  original: THREE.Material | THREE.Material[];
}

interface Slot {
  size: number;
  x: number;
}

/** Objects on a bench shrink and spread out in a row as their number grows. */
function slotFor(index: number, count: number): Slot {
  const size = count <= 1 ? 2.3 : count === 2 ? 1.8 : count === 3 ? 1.5 : 1.25;
  return { size, x: (index - (count - 1) / 2) * size * 1.35 };
}

interface RigJoint {
  mover: THREE.Group;
  type: "revolute" | "continuous" | "prismatic";
  axis: THREE.Vector3;
  lower: number;
  upper: number;
}

interface Tween {
  target: THREE.Object3D;
  from: Pose;
  to: Pose;
  start: number;
  dur: number;
  ease: (t: number) => number;
  done?: () => void;
}

const SNAP_PX: Record<Difficulty, number> = { easy: 78, medium: 58, hard: 42 };
const LOOSE_COUNT: Record<Difficulty, number> = { easy: 5, medium: 9, hard: 18 };

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const easeOutBack = (t: number) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

const MAT_GREEN = 0x1d4a44;

/** A cutting-mat texture: the surface every workshop takes things apart on. */
function matTexture(): THREE.Texture {
  const size = 512;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  g.fillStyle = "#1d4a44";
  g.fillRect(0, 0, size, size);
  const cells = 10;
  const step = size / cells;
  for (let i = 0; i <= cells; i++) {
    const major = i % 5 === 0;
    g.strokeStyle = major ? "rgba(214,236,224,0.34)" : "rgba(214,236,224,0.13)";
    g.lineWidth = major ? 2 : 1;
    g.beginPath();
    g.moveTo(i * step, 0);
    g.lineTo(i * step, size);
    g.moveTo(0, i * step);
    g.lineTo(size, i * step);
    g.stroke();
  }
  // Yellow registration crosses at the major intersections.
  g.strokeStyle = "rgba(244,196,48,0.75)";
  g.lineWidth = 2;
  for (const x of [0, size / 2, size]) {
    for (const y of [0, size / 2, size]) {
      g.beginPath();
      g.moveTo(x - 9, y);
      g.lineTo(x + 9, y);
      g.moveTo(x, y - 9);
      g.lineTo(x, y + 9);
      g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(16, 16);
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class TeardownEngine {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private stage = new THREE.Group();
  private parts: Part[] = [];
  private tweens: Tween[] = [];
  private raf = 0;
  private clock = new THREE.Clock();
  private disposed = false;
  private ro: ResizeObserver;
  private difficulty: Difficulty = "easy";
  private shattered = false;
  private finished = false;
  private showReference = false;
  private held: Part | null = null;
  private hinted: Part | null = null;
  private hintUntil = 0;
  private dragPlane = new THREE.Plane();
  private dragOffset = new THREE.Vector3();
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private slots: Slot[] = [];
  private practice: ({ motion: (t: number) => MotionOp[]; matrix: THREE.Matrix4 } | null)[] = [];
  private motionRoots: THREE.Object3D[] = [];
  private payoffStart = 0;
  private rigJoints: RigJoint[] = [];
  private finish: Finish = "original";
  private clay = new THREE.MeshStandardMaterial({ color: 0xd8d2c2, roughness: 0.92 });
  private wire = new THREE.MeshBasicMaterial({ color: 0xbfe9d9, wireframe: true });
  private ghostRef = new THREE.MeshBasicMaterial({ color: 0xe9f3ec, transparent: true, opacity: 0.2, depthWrite: false });
  private ghostNear = new THREE.MeshBasicMaterial({ color: 0xf4c430, transparent: true, opacity: 0.5, depthWrite: false });
  private reduceMotion = false;
  private framing = 0;

  constructor(private canvas: HTMLCanvasElement, private cb: EngineCallbacks) {
    this.reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene.background = new THREE.Color(MAT_GREEN);
    this.scene.fog = new THREE.Fog(MAT_GREEN, 13, 30);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.75;

    this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
    this.camera.position.set(4.4, 3.9, 6.6);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 0.95, 0);
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.minDistance = 4.5;
    this.controls.maxDistance = 13;
    this.controls.maxPolarAngle = 1.46;
    this.controls.autoRotate = !this.reduceMotion;
    this.controls.autoRotateSpeed = 0.9;

    const key = new THREE.DirectionalLight(0xfff4de, 2.6);
    key.position.set(4, 8, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = key.shadow.camera.bottom = -7;
    key.shadow.camera.right = key.shadow.camera.top = 7;
    key.shadow.bias = -0.0004;
    key.shadow.radius = 5;
    this.scene.add(key, new THREE.HemisphereLight(0xdff5ea, 0x16302c, 0.55));

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 80),
      new THREE.MeshStandardMaterial({ map: matTexture(), roughness: 0.95 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground, this.stage);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas.parentElement ?? canvas);
    this.resize();

    canvas.addEventListener("pointerdown", this.onDown);
    canvas.addEventListener("pointermove", this.onMove);
    canvas.addEventListener("pointerup", this.onUp);
    canvas.addEventListener("pointercancel", this.onUp);

    this.loop();
  }

  // ---------- loading ----------

  /**
   * Loads one object, or several side by side as a "bench" whose parts all
   * end up in the same pile.
   */
  async load(
    objects: TeardownObject[],
    difficulty: Difficulty,
    onProgress?: (fraction: number) => void,
  ): Promise<{ total: number; partCount: number }> {
    this.reset();
    this.difficulty = difficulty;
    this.slots = objects.map((_, i) => slotFor(i, objects.length));

    // Each download reports its own share; the bar shows the average.
    const shares: number[] = objects.map((o) => (o.source === "practice" ? 1 : 0));
    const report = () => onProgress?.(shares.reduce((a, b) => a + b, 0) / shares.length);

    const roots = await Promise.all(
      objects.map(async (object, i) => {
        if (object.source === "practice") return buildPractice(object.id);
        if (!object.partsUrl) throw new Error(`${object.name} has no parts file.`);
        const gltf = await gltfLoader().loadAsync(object.partsUrl, (e) => {
          if (!e.lengthComputable || !e.total) return;
          shares[i] = Math.min(1, e.loaded / e.total);
          report();
        });
        shares[i] = 1;
        report();
        return { group: gltf.scene, motion: null };
      }),
    );
    if (this.disposed) return { total: 0, partCount: 0 };

    const box = new THREE.Box3();
    const centre = new THREE.Vector3();
    const dims = new THREE.Vector3();
    roots.forEach((built, owner) => {
      const wrapper = this.normalise(built.group, this.slots[owner]);
      this.practice[owner] = built.motion ? { motion: built.motion, matrix: built.group.matrixWorld.clone() } : null;
      const meshes: THREE.Mesh[] = [];
      wrapper.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && m.geometry) meshes.push(m);
      });
      if (meshes.length < 2) {
        throw new Error(`${objects[owner].name} came back as a single piece, so there is nothing to take apart.`);
      }
      for (const mesh of meshes) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        box.setFromObject(mesh);
        box.getCenter(centre);
        box.getSize(dims);
        const pivot = new THREE.Group();
        pivot.position.copy(centre);
        this.stage.add(pivot);
        pivot.attach(mesh);
        this.parts.push({
          name: mesh.name || mesh.parent?.name || "Part",
          owner,
          pivot,
          mesh,
          home: { pos: centre.clone(), quat: new THREE.Quaternion() },
          tray: { pos: centre.clone(), quat: new THREE.Quaternion() },
          loose: false,
          placed: true,
          ghost: null,
          size: dims.length(),
          height: dims.y,
          riders: [],
          original: mesh.material,
        });
      }
    });

    // Each object keeps its largest part in place as an anchor. Of the rest,
    // the biggest come loose, up to the limit for this difficulty.
    const anchors = objects.map((_, owner) =>
      this.parts.filter((p) => p.owner === owner).reduce((a, p) => (p.size > a.size ? p : a)),
    );
    this.parts
      .filter((p) => !anchors.includes(p))
      .sort((a, b) => b.size - a.size)
      .slice(0, LOOSE_COUNT[difficulty])
      .forEach((p) => (p.loose = true));

    const loose = this.parts.filter((p) => p.loose);
    // A fixed part left hanging in mid-air looks broken, so each one travels
    // with whichever part of its own object is closest to it.
    for (const p of this.parts) {
      const anchor = anchors[p.owner];
      if (p.loose || p === anchor) continue;
      let host = anchor;
      let best = Infinity;
      for (const q of [anchor, ...loose.filter((l) => l.owner === p.owner)]) {
        const d = q.home.pos.distanceTo(p.home.pos) - q.size * 0.25;
        if (d < best) {
          best = d;
          host = q;
        }
      }
      if (host !== anchor) {
        host.pivot.attach(p.pivot);
        host.riders.push(p.mesh);
      }
    }
    loose.forEach((p) => {
      box.setFromObject(p.pivot);
      p.height = box.getSize(dims).y;
      const ghost = new THREE.Mesh(p.mesh.geometry, this.ghostRef);
      ghost.applyMatrix4(p.mesh.matrixWorld);
      ghost.visible = false;
      ghost.renderOrder = 2;
      this.stage.add(ghost);
      p.ghost = ghost;
    });

    this.applyFinish();
    return { total: loose.length, partCount: this.parts.length };
  }

  /** Scale to the slot's size and stand the object on the mat at the slot's position. */
  private normalise(root: THREE.Object3D, slot: Slot): THREE.Group {
    const wrapper = new THREE.Group();
    wrapper.add(root);
    this.scene.add(wrapper);
    const box = new THREE.Box3().setFromObject(wrapper);
    const dims = box.getSize(new THREE.Vector3());
    wrapper.scale.setScalar(slot.size / Math.max(dims.x, dims.y, dims.z, 1e-6));
    box.setFromObject(wrapper);
    const centre = box.getCenter(new THREE.Vector3());
    wrapper.position.set(slot.x - centre.x, -box.min.y + 0.01, -centre.z);
    wrapper.updateMatrixWorld(true);
    return wrapper;
  }

  private reset() {
    this.stage.clear();
    this.parts = [];
    this.tweens = [];
    this.shattered = false;
    this.finished = false;
    this.held = null;
    this.hinted = null;
    this.practice = [];
    this.rigJoints = [];
    this.motionRoots = [];
    for (const child of [...this.scene.children]) {
      if (child.type === "Group" && child !== this.stage) this.scene.remove(child);
    }
    this.controls.autoRotate = !this.reduceMotion;
  }

  // ---------- play ----------

  shatter() {
    if (this.shattered) return;
    this.shattered = true;
    this.controls.autoRotate = false;
    sfx.shatter();
    const now = performance.now();
    const loose = this.parts.filter((p) => p.loose);
    // Parts land in an arc on the player's side of the object, so nothing
    // hides behind it or in front of where it has to go back.
    const facing = Math.atan2(this.camera.position.z, this.camera.position.x);
    const portrait = this.camera.aspect < 1;
    // Phones get a tighter fan in three rows, seen from further back.
    const spread = portrait ? 0.62 : Math.min(2.0, 0.5 + loose.length * 0.2);
    // Step back far enough to see the whole pile: more on phones and on benches.
    const back = (portrait ? 1.3 : 1) * (1 + 0.14 * Math.max(0, this.slots.length - 1));
    if (back > 1) {
      const eye = this.camera.position.clone().sub(this.controls.target);
      this.camera.position.copy(this.controls.target).add(eye.setLength(Math.min(12.8, eye.length() * back)));
    }
    loose.forEach((p, i) => {
      const k = loose.length === 1 ? 0.15 : i / (loose.length - 1);
      const angle = facing + (k - 0.5) * 2 * spread;
      // A wider bench pushes the pile further out so it clears the objects.
      const reach = Math.max(0, this.slots.length - 1) * 0.5;
      const ring = reach + (portrait ? 2.1 + (i % 3) * 0.95 : loose.length > 7 && i % 2 === 1 ? 3.5 : loose.length < 4 ? 2.2 : 2.6);
      p.tray.pos.set(Math.cos(angle) * ring, p.height / 2 + 0.02, Math.sin(angle) * ring);
      p.tray.quat.identity();
      if (this.difficulty === "hard") {
        p.tray.quat.setFromEuler(new THREE.Euler(0, 0.6 + Math.random() * 5, 0));
      }
    });
    loose
      .forEach((p, i) => {
        p.placed = false;
        this.tweens.push({
          target: p.pivot,
          from: { pos: p.pivot.position.clone(), quat: p.pivot.quaternion.clone() },
          to: p.tray,
          start: now + (this.reduceMotion ? 0 : i * 28),
          dur: this.reduceMotion ? 1 : 620,
          ease: easeOutBack,
        });
      });
    this.refreshGhosts();
  }

  /** Shows where one unplaced part belongs. Returns false if nothing is left. */
  hint(): boolean {
    const target = this.held ?? this.parts.find((p) => p.loose && !p.placed);
    if (!target || this.finished || !this.shattered) return false;
    this.hinted = target;
    this.hintUntil = performance.now() + 3200;
    sfx.hint();
    if (target !== this.held) {
      const up = target.tray.pos.clone().add(new THREE.Vector3(0, 0.45, 0));
      this.tweens.push({
        target: target.pivot,
        from: { pos: target.pivot.position.clone(), quat: target.pivot.quaternion.clone() },
        to: { pos: up, quat: target.tray.quat },
        start: performance.now(),
        dur: 220,
        ease: easeOutCubic,
        done: () => {
          if (!target.placed && this.held !== target) this.moveTo(target, target.tray, 380, easeInOut);
        },
      });
    }
    this.refreshGhosts();
    return true;
  }

  setReference(on: boolean) {
    this.showReference = on;
    this.refreshGhosts();
  }

  setFinish(f: Finish) {
    this.finish = f;
    this.applyFinish();
  }

  private applyFinish() {
    for (const p of this.parts) {
      p.mesh.material = this.finish === "clay" ? this.clay : this.finish === "wire" ? this.wire : p.original;
    }
  }

  private refreshGhosts(near: Part | null = null) {
    const hintLive = this.hinted && performance.now() < this.hintUntil ? this.hinted : null;
    for (const p of this.parts) {
      if (!p.ghost) continue;
      const strong = !p.placed && (p === near || p === hintLive);
      p.ghost.visible = !p.placed && this.shattered && (strong || this.showReference);
      p.ghost.material = strong ? this.ghostNear : this.ghostRef;
    }
  }

  private moveTo(p: Part, to: Pose, dur: number, ease: (t: number) => number, done?: () => void) {
    this.tweens = this.tweens.filter((t) => t.target !== p.pivot);
    this.tweens.push({
      target: p.pivot,
      from: { pos: p.pivot.position.clone(), quat: p.pivot.quaternion.clone() },
      to,
      start: performance.now(),
      dur: this.reduceMotion ? 1 : dur,
      ease,
      done,
    });
  }

  // ---------- pointer ----------

  private setPointer(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  private pickAt(e: PointerEvent): { part: Part; point: THREE.Vector3 } | null {
    this.setPointer(e);
    const live = this.parts.filter((p) => p.loose && !p.placed);
    const hit = this.raycaster.intersectObjects(live.flatMap((p) => [p.mesh, ...p.riders]), false)[0];
    if (!hit) return null;
    const part = live.find((p) => p.mesh === hit.object || p.riders.includes(hit.object as THREE.Mesh));
    return part ? { part, point: hit.point } : null;
  }

  private screenDistance(a: THREE.Vector3, b: THREE.Vector3): number {
    const r = this.canvas.getBoundingClientRect();
    const pa = a.clone().project(this.camera);
    const pb = b.clone().project(this.camera);
    return Math.hypot(((pa.x - pb.x) * r.width) / 2, ((pa.y - pb.y) * r.height) / 2);
  }

  private onDown = (e: PointerEvent) => {
    if (!this.shattered || this.finished) return;
    const hit = this.pickAt(e);
    if (!hit) return;
    this.held = hit.part;
    this.tweens = this.tweens.filter((t) => t.target !== hit.part.pivot);
    this.controls.enabled = false;
    this.canvas.setPointerCapture(e.pointerId);
    const normal = this.camera.getWorldDirection(new THREE.Vector3()).negate();
    this.dragPlane.setFromNormalAndCoplanarPoint(normal, hit.point);
    this.dragOffset.copy(hit.part.pivot.position).sub(hit.point);
    this.canvas.style.cursor = "grabbing";
    sfx.pick();
  };

  private onMove = (e: PointerEvent) => {
    if (!this.held) {
      if (this.shattered && !this.finished && e.pointerType === "mouse") {
        this.canvas.style.cursor = this.pickAt(e) ? "grab" : "";
      }
      return;
    }
    this.setPointer(e);
    const p = this.raycaster.ray.intersectPlane(this.dragPlane, new THREE.Vector3());
    if (!p) return;
    p.add(this.dragOffset);
    p.y = Math.max(p.y, 0.05);
    this.held.pivot.position.copy(p);
    const near = this.screenDistance(p, this.held.home.pos) < SNAP_PX[this.difficulty];
    // Turning to the right orientation as it nears home is the cue that it fits.
    this.held.pivot.quaternion.slerp(near ? this.held.home.quat : this.held.tray.quat, 0.25);
    this.refreshGhosts(near ? this.held : null);
  };

  private onUp = (e: PointerEvent) => {
    const part = this.held;
    if (!part) return;
    this.held = null;
    this.controls.enabled = true;
    this.canvas.style.cursor = "";
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);

    const near = this.screenDistance(part.pivot.position, part.home.pos) < SNAP_PX[this.difficulty];
    if (!near) {
      sfx.miss();
      this.cb.onMiss();
      this.moveTo(part, part.tray, 420, easeInOut);
      this.refreshGhosts();
      return;
    }

    part.placed = true;
    if (this.hinted === part) this.hinted = null;
    const loose = this.parts.filter((p) => p.loose);
    const placed = loose.filter((p) => p.placed).length;
    sfx.snap(placed / loose.length);
    this.moveTo(part, part.home, 190, easeOutBack);
    this.refreshGhosts();
    this.cb.onPlaced(placed, loose.length);
    if (placed === loose.length) {
      this.finished = true;
      window.setTimeout(() => {
        if (!this.disposed) {
          sfx.complete();
          this.cb.onComplete();
        }
      }, 260);
    }
  };

  // ---------- payoff ----------

  /**
   * Rebuilt objects prove they work. Each object on the bench plays the joints
   * Lux3D found for it; practice objects play their built-in motion.
   */
  async playPayoff(rigs: (MotionRig | undefined)[]) {
    this.controls.autoRotate = !this.reduceMotion;
    this.controls.autoRotateSpeed = 1.6;
    this.payoffStart = this.clock.getElapsedTime() || 0.001;
    await Promise.all(rigs.map((rig, owner) => (rig ? this.mountRig(rig, owner).catch(() => undefined) : undefined)));
  }

  private async mountRig(rig: MotionRig, owner: number) {
    const loader = gltfLoader();
    const links = new Map<string, THREE.Group>();
    await Promise.all(
      rig.links.map(async (link) => {
        const group = new THREE.Group();
        group.name = link.name;
        links.set(link.name, group);
        if (!link.meshUrl) return;
        const visual = (await loader.loadAsync(link.meshUrl)).scene;
        visual.position.set(...link.xyz);
        visual.rotation.set(link.rpy[0], link.rpy[1], link.rpy[2], "ZYX");
        visual.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) m.castShadow = m.receiveShadow = true;
        });
        group.add(visual);
      }),
    );
    if (this.disposed || !this.finished) return;

    const children = new Set(rig.joints.map((j) => j.child));
    const rootLink = rig.links.find((l) => !children.has(l.name));
    const root = rootLink && links.get(rootLink.name);
    if (!root) return;
    const moving: RigJoint[] = [];
    for (const joint of rig.joints) {
      const parent = links.get(joint.parent);
      const child = links.get(joint.child);
      if (!parent || !child) continue;
      const frame = new THREE.Group();
      frame.position.set(...joint.xyz);
      frame.rotation.set(joint.rpy[0], joint.rpy[1], joint.rpy[2], "ZYX");
      const mover = new THREE.Group();
      mover.add(child);
      frame.add(mover);
      parent.add(frame);
      if (joint.type === "fixed") continue;
      // A hinge free to spin all the way round is shown as a gentle swing instead.
      const wide = joint.type === "revolute" && joint.upper - joint.lower > 2.4;
      moving.push({
        mover,
        type: joint.type,
        axis: new THREE.Vector3(...joint.axis).normalize(),
        lower: wide ? -0.7 : joint.lower,
        upper: wide ? 0.7 : joint.upper,
      });
    }
    this.motionRoots.push(this.normalise(root, this.slots[owner]));
    this.rigJoints.push(...moving);
    // The jointed copy takes over from the loose parts for this object only.
    for (const p of this.parts) if (p.owner === owner) p.pivot.visible = false;
  }

  private applyRig(t: number) {
    this.rigJoints.forEach((j, i) => {
      // Ease between the joint's own limits, each joint slightly out of step.
      const k = 0.5 - 0.5 * Math.cos(t * 2.2 + i * 0.9);
      const q = j.type === "continuous" ? t * 1.5 : j.lower + (j.upper - j.lower) * k;
      if (j.type === "prismatic") j.mover.position.copy(j.axis).multiplyScalar(q);
      else j.mover.quaternion.setFromAxisAngle(j.axis, q);
    });
  }

  private applyPracticeMotion(t: number) {
    const m = new THREE.Matrix4();
    const scale = new THREE.Vector3();
    this.practice.forEach((entry, owner) => {
      if (!entry) return;
      const mine = this.parts.filter((p) => p.owner === owner);
      const inv = entry.matrix.clone().invert();
      const byName = new Map<string, THREE.Matrix4>();
      for (const op of entry.motion(t)) {
        if ("glow" in op) {
          for (const p of mine) {
            if (!op.parts.includes(p.name)) continue;
            const mat = p.original as THREE.MeshStandardMaterial;
            if (mat.emissive) mat.emissiveIntensity = op.glow;
          }
          continue;
        }
        if ("translate" in op) {
          m.makeTranslation(...op.translate);
        } else {
          const pivot = new THREE.Vector3(...op.pivot);
          m.makeTranslation(pivot.x, pivot.y, pivot.z)
            .multiply(new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(...op.axis).normalize(), op.angle))
            .multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
        }
        for (const name of op.parts) {
          const acc = byName.get(name) ?? new THREE.Matrix4();
          byName.set(name, m.clone().multiply(acc));
        }
      }
      for (const p of mine) {
        const local = byName.get(p.name);
        if (!local) continue;
        const world = entry.matrix.clone().multiply(local).multiply(inv);
        const home = new THREE.Matrix4().compose(p.home.pos, p.home.quat, new THREE.Vector3(1, 1, 1));
        world.multiply(home).decompose(p.pivot.position, p.pivot.quaternion, scale);
      }
    });
  }

  // ---------- output ----------

  snapshot(): string {
    this.renderer.render(this.scene, this.camera);
    return this.canvas.toDataURL("image/jpeg", 0.9);
  }

  /** Every part laid out on one plate as a binary STL, scaled to millimetres. */
  exportPlate(longestMm = 120): Blob {
    const plate = new THREE.Group();
    const box = new THREE.Box3();
    const dims = new THREE.Vector3();
    const centre = new THREE.Vector3();
    const mm = longestMm / 2.3;
    let x = 0;
    let z = 0;
    let rowDepth = 0;
    for (const p of [...this.parts].sort((a, b) => b.size - a.size)) {
      const clone = new THREE.Mesh(p.mesh.geometry.clone());
      clone.geometry.applyMatrix4(p.mesh.matrixWorld);
      box.setFromObject(clone);
      box.getSize(dims);
      box.getCenter(centre);
      if (x + dims.x > 2.6) {
        x = 0;
        z += rowDepth + 0.08;
        rowDepth = 0;
      }
      clone.geometry.translate(x - box.min.x, -box.min.y, z - box.min.z);
      clone.geometry.scale(mm, mm, mm);
      // STL convention is Z up.
      clone.geometry.rotateX(Math.PI / 2);
      x += dims.x + 0.08;
      rowDepth = Math.max(rowDepth, dims.z);
      plate.add(clone);
    }
    plate.updateMatrixWorld(true);
    const data = new STLExporter().parse(plate, { binary: true }) as unknown as DataView;
    return new Blob([data.buffer as ArrayBuffer], { type: "model/stl" });
  }

  /** -1 leaves room on the right, 1 on the left, 0 centres the object. */
  setFraming(side: -1 | 0 | 1) {
    this.framing = side;
    this.resize();
  }

  /** Development aid: place every part instantly. */
  solve() {
    const loose = this.parts.filter((p) => p.loose);
    loose.forEach((p) => {
      p.placed = true;
      this.moveTo(p, p.home, 300, easeOutCubic);
    });
    this.refreshGhosts();
    this.finished = true;
    this.cb.onPlaced(loose.length, loose.length);
    window.setTimeout(() => this.cb.onComplete(), 400);
  }

  // ---------- frame ----------

  private resize() {
    const el = this.canvas.parentElement ?? this.canvas;
    const w = el.clientWidth || 1;
    const h = el.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Pull back on tall screens so the tray of parts stays in view.
    this.camera.fov = w / h < 0.8 ? 58 : w / h < 1.2 ? 46 : 36;
    // On wide screens the object slides aside to leave room for a panel.
    if (w / h > 1.25 && this.framing !== 0) this.camera.setViewOffset(w, h, -this.framing * w * 0.15, 0, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();

    this.tweens = this.tweens.filter((tw) => {
      if (now < tw.start) return true;
      const k = Math.min(1, (now - tw.start) / tw.dur);
      const e = tw.ease(k);
      tw.target.position.lerpVectors(tw.from.pos, tw.to.pos, e);
      tw.target.quaternion.slerpQuaternions(tw.from.quat, tw.to.quat, Math.min(1, Math.max(0, e)));
      if (k >= 1) {
        tw.done?.();
        return false;
      }
      return true;
    });

    if (this.hinted && now > this.hintUntil) {
      this.hinted = null;
      this.refreshGhosts();
    }
    this.ghostNear.opacity = 0.38 + Math.sin(now / 130) * 0.16;

    if (this.finished && this.payoffStart && !this.reduceMotion) {
      const t = this.clock.getElapsedTime() - this.payoffStart;
      this.applyRig(t);
      if (this.tweens.length === 0) this.applyPracticeMotion(t);
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.canvas.removeEventListener("pointerdown", this.onDown);
    this.canvas.removeEventListener("pointermove", this.onMove);
    this.canvas.removeEventListener("pointerup", this.onUp);
    this.canvas.removeEventListener("pointercancel", this.onUp);
    this.controls.dispose();
    this.renderer.dispose();
  }
}
