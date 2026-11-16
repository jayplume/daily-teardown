import * as THREE from "three";

/** A rigid move applied to some parts while the rebuilt object shows that it works. */
export type MotionOp =
  | { parts: string[]; pivot: [number, number, number]; axis: [number, number, number]; angle: number }
  | { parts: string[]; translate: [number, number, number] }
  | { parts: string[]; glow: number };

export interface PracticeBuild {
  group: THREE.Group;
  /** Returns the pose at time t (seconds), in the object's own coordinates. */
  motion: (t: number) => MotionOp[];
}

function mat(color: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.1, ...opts });
}

function part(name: string, geo: THREE.BufferGeometry, material: THREE.Material, pos: [number, number, number], rot?: [number, number, number]) {
  const m = new THREE.Mesh(geo, material);
  m.name = name;
  m.position.set(...pos);
  if (rot) m.rotation.set(...rot);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

const wave = (t: number, speed = 1) => Math.sin(t * speed * Math.PI * 2);

function lamp(): PracticeBuild {
  const g = new THREE.Group();
  const enamel = mat(0xe8b923, { roughness: 0.35, metalness: 0.2 });
  const steel = mat(0x9aa3a0, { roughness: 0.3, metalness: 0.8 });
  const dark = mat(0x26302e, { roughness: 0.6 });

  g.add(part("Base", new THREE.CylinderGeometry(0.55, 0.62, 0.12, 48), enamel, [0, 0.06, 0]));
  g.add(part("Switch", new THREE.CylinderGeometry(0.07, 0.07, 0.07, 20), dark, [0.32, 0.15, 0.2]));
  g.add(part("Pivot", new THREE.SphereGeometry(0.1, 24, 16), steel, [0, 0.2, 0]));
  g.add(part("Lower arm", new THREE.CylinderGeometry(0.035, 0.035, 0.9, 16), steel, [-0.19, 0.6, 0], [0, 0, 0.42]));
  g.add(part("Elbow", new THREE.CylinderGeometry(0.075, 0.075, 0.12, 20), dark, [-0.37, 1.01, 0], [Math.PI / 2, 0, 0]));
  g.add(part("Upper arm", new THREE.CylinderGeometry(0.03, 0.03, 0.8, 16), steel, [-0.04, 1.24, 0], [0, 0, -0.96]));
  g.add(part("Shade", new THREE.ConeGeometry(0.36, 0.42, 40, 1, true), new THREE.MeshStandardMaterial({ color: 0xe8b923, roughness: 0.35, metalness: 0.2, side: THREE.DoubleSide }), [0.42, 1.36, 0], [0, 0, -0.5]));
  g.add(part("Bulb", new THREE.SphereGeometry(0.12, 24, 16), new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xffd36b, emissiveIntensity: 0.15, roughness: 0.2 }), [0.48, 1.26, 0]));

  return {
    group: g,
    motion: (t) => {
      const nod = wave(t, 0.45) * 0.28;
      return [
        { parts: ["Upper arm", "Shade", "Bulb"], pivot: [-0.37, 1.01, 0], axis: [0, 0, 1], angle: nod },
        { parts: ["Bulb"], glow: 1.6 + wave(t, 0.9) * 1.2 },
      ];
    },
  };
}

function robot(): PracticeBuild {
  const g = new THREE.Group();
  const tin = mat(0xd9482b, { roughness: 0.4, metalness: 0.5 });
  const pale = mat(0xe9e4d4, { roughness: 0.5, metalness: 0.3 });
  const dark = mat(0x1f2a28, { roughness: 0.5, metalness: 0.4 });
  const eye = new THREE.MeshStandardMaterial({ color: 0xfff1a8, emissive: 0xffc93c, emissiveIntensity: 0.4 });

  g.add(part("Body", new THREE.BoxGeometry(0.8, 0.9, 0.5), tin, [0, 1.05, 0]));
  g.add(part("Chest plate", new THREE.BoxGeometry(0.5, 0.36, 0.06), pale, [0, 1.15, 0.27]));
  g.add(part("Head", new THREE.BoxGeometry(0.56, 0.44, 0.44), pale, [0, 1.78, 0]));
  g.add(part("Left eye", new THREE.CylinderGeometry(0.075, 0.075, 0.05, 20), eye, [-0.13, 1.82, 0.23], [Math.PI / 2, 0, 0]));
  g.add(part("Right eye", new THREE.CylinderGeometry(0.075, 0.075, 0.05, 20), eye, [0.13, 1.82, 0.23], [Math.PI / 2, 0, 0]));
  g.add(part("Antenna", new THREE.CylinderGeometry(0.02, 0.02, 0.3, 10), dark, [0, 2.15, 0]));
  g.add(part("Left arm", new THREE.BoxGeometry(0.16, 0.7, 0.18), dark, [-0.52, 1.1, 0]));
  g.add(part("Right arm", new THREE.BoxGeometry(0.16, 0.7, 0.18), dark, [0.52, 1.1, 0]));
  g.add(part("Left leg", new THREE.BoxGeometry(0.24, 0.6, 0.3), dark, [-0.2, 0.3, 0]));
  g.add(part("Right leg", new THREE.BoxGeometry(0.24, 0.6, 0.3), dark, [0.2, 0.3, 0]));
  g.add(part("Wind-up key", new THREE.TorusGeometry(0.11, 0.03, 10, 24), pale, [0, 1.05, -0.36]));

  return {
    group: g,
    motion: (t) => [
      { parts: ["Right arm"], pivot: [0.52, 1.4, 0], axis: [1, 0, 0], angle: -1.9 + wave(t, 1.4) * 0.45 },
      { parts: ["Left arm"], pivot: [-0.52, 1.4, 0], axis: [1, 0, 0], angle: wave(t, 0.7) * 0.4 },
      { parts: ["Head", "Left eye", "Right eye", "Antenna"], pivot: [0, 1.78, 0], axis: [0, 1, 0], angle: wave(t, 0.35) * 0.5 },
      { parts: ["Wind-up key"], pivot: [0, 1.05, -0.36], axis: [0, 0, 1], angle: t * 3 },
      { parts: ["Left eye", "Right eye"], glow: 1.2 + wave(t, 1.4) * 0.8 },
    ],
  };
}

function camera(): PracticeBuild {
  const g = new THREE.Group();
  const leather = mat(0x24302d, { roughness: 0.85 });
  const chrome = mat(0xc9cfcc, { roughness: 0.25, metalness: 0.9 });
  const black = mat(0x121a18, { roughness: 0.4, metalness: 0.3 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x3d6f8f, roughness: 0.05, metalness: 0.2, clearcoat: 1 });
  const flashMat = new THREE.MeshStandardMaterial({ color: 0xf4f1e6, emissive: 0xffffff, emissiveIntensity: 0.05 });

  g.add(part("Body", new THREE.BoxGeometry(1.5, 0.8, 0.5), leather, [0, 0.5, 0]));
  g.add(part("Top plate", new THREE.BoxGeometry(1.5, 0.16, 0.5), chrome, [0, 0.98, 0]));
  g.add(part("Lens barrel", new THREE.CylinderGeometry(0.34, 0.36, 0.34, 40), black, [0, 0.5, 0.42], [Math.PI / 2, 0, 0]));
  g.add(part("Focus ring", new THREE.CylinderGeometry(0.31, 0.31, 0.16, 40), chrome, [0, 0.5, 0.66], [Math.PI / 2, 0, 0]));
  g.add(part("Front glass", new THREE.CylinderGeometry(0.24, 0.24, 0.05, 40), glass, [0, 0.5, 0.76], [Math.PI / 2, 0, 0]));
  g.add(part("Viewfinder", new THREE.BoxGeometry(0.34, 0.22, 0.4), black, [-0.12, 1.17, 0]));
  g.add(part("Shutter button", new THREE.CylinderGeometry(0.07, 0.07, 0.08, 20), chrome, [0.5, 1.1, 0.08]));
  g.add(part("Winder", new THREE.CylinderGeometry(0.13, 0.13, 0.1, 28), chrome, [-0.55, 1.11, 0]));
  g.add(part("Flash", new THREE.BoxGeometry(0.26, 0.16, 0.06), flashMat, [0.5, 0.74, 0.27]));

  return {
    group: g,
    motion: (t) => {
      const cycle = t % 2.4;
      const press = cycle > 1.5 && cycle < 1.7 ? -0.035 : 0;
      const flash = cycle > 1.6 && cycle < 1.78 ? 9 : 0.05;
      const zoom = (Math.sin(t * 1.3) * 0.5 + 0.5) * 0.14;
      return [
        { parts: ["Focus ring", "Front glass"], translate: [0, 0, zoom] },
        { parts: ["Focus ring"], pivot: [0, 0.5, 0], axis: [0, 0, 1], angle: zoom * 9 },
        { parts: ["Shutter button"], translate: [0, press, 0] },
        { parts: ["Winder"], pivot: [-0.55, 1.11, 0], axis: [0, 1, 0], angle: t * 1.6 },
        { parts: ["Flash"], glow: flash },
      ];
    },
  };
}

export function buildPractice(id: string): PracticeBuild {
  if (id === "practice-robot") return robot();
  if (id === "practice-camera") return camera();
  return lamp();
}
