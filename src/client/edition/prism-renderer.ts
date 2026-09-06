import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { PrismState } from "../../shared/edition-game";
import type { ProjectedPoint } from "./prism-projection";

const COLORS = [0xe5e8d6, 0xf58d77, 0xa0ddc5] as const;
export interface PrismRenderer {
  state(game: PrismState): void;
  hover(index: number): void;
  flat(enabled: boolean): void;
  dispose(): void;
}

const surfaceVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Thin-film interference is confined to the glass edge. The centre remains
// quiet so material effects never conceal point ownership or square geometry.
const glassFragment = /* glsl */ `
  varying vec2 vUv;
  uniform float uTime;
  uniform vec2 uTouch;
  uniform float uAge;
  void main() {
    vec2 p = vUv - 0.5;
    float edgeDistance = min(min(vUv.x, 1.0-vUv.x), min(vUv.y, 1.0-vUv.y));
    float rim = exp(-edgeDistance * 100.0);
    float grain = fract(sin(dot(vUv * 190.0, vec2(12.9898,78.233))) * 43758.5453);
    vec3 film = 0.5 + 0.5*cos(vec3(0.0,2.1,4.2) + edgeDistance*210.0 + p.x*7.0 + uTime*0.15);
    float distanceToTouch = length(vUv-uTouch);
    float ripple = exp(-pow((distanceToTouch-uAge*0.27)*23.0,2.0))*exp(-uAge*1.8);
    float glow = exp(-dot(p-vec2(-0.2,0.2),p-vec2(-0.2,0.2))*3.0);
    float cloud = sin(p.x*9.0+sin(p.y*4.0))*sin(p.y*6.0-p.x);
    vec3 base = vec3(0.015,0.027,0.025) + glow*vec3(0.011,0.016,0.015) + cloud*0.002;
    gl_FragColor = vec4(base + film*rim*0.055 + grain*0.002 + ripple*vec3(0.05,0.08,0.06),0.92);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const squareFragment = /* glsl */ `
  varying vec2 vUv;
  uniform vec3 uColor;
  uniform float uTime;
  void main() {
    float d = min(min(vUv.x,1.0-vUv.x), min(vUv.y,1.0-vUv.y));
    float rim = exp(-d*36.0);
    float sheen = pow(max(0.0, sin((vUv.x+vUv.y)*3.2-uTime*0.24)),10.0);
    gl_FragColor = vec4(uColor*(0.68+rim*0.48),0.07+rim*0.20+sheen*0.045);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function position(index: number, height = 0.19): THREE.Vector3 {
  return new THREE.Vector3(
    (index % 8) - 3.5,
    height,
    Math.floor(index / 8) - 3.5,
  );
}

function release(object: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  object.traverse((item) => {
    if (item instanceof THREE.Mesh || item instanceof THREE.LineSegments) {
      geometries.add(item.geometry);
      const values = Array.isArray(item.material)
        ? item.material
        : [item.material];
      values.forEach((material) => materials.add(material));
    }
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}

export function createPrismRenderer(
  canvas: HTMLCanvasElement,
  onProject: (points: ProjectedPoint[]) => void,
  onUnavailable: () => void,
): PrismRenderer {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  const board = new THREE.Group();
  scene.add(board);
  scene.add(new THREE.AmbientLight(0xe4f5ea, 1.3));
  const keyLight = new THREE.DirectionalLight(0xfff0dc, 2.8);
  keyLight.position.set(-5, 10, -4);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0x92cfbc, 2);
  fillLight.position.set(5, 4, 6);
  scene.add(fillLight);

  const slab = new THREE.Mesh(
    new RoundedBoxGeometry(8.7, 0.2, 8.7, 2, 0.085),
    new THREE.MeshPhysicalMaterial({
      color: 0x38544a,
      metalness: 0.35,
      roughness: 0.18,
      transparent: true,
      opacity: 0.58,
      clearcoat: 1,
      clearcoatRoughness: 0.1,
    }),
  );
  slab.position.y = -0.065;
  board.add(slab);
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(slab.geometry),
    new THREE.LineBasicMaterial({
      color: 0xa1b7a4,
      transparent: true,
      opacity: 0.7,
    }),
  );
  edges.position.copy(slab.position);
  board.add(edges);
  const glass = new THREE.ShaderMaterial({
    vertexShader: surfaceVertex,
    fragmentShader: glassFragment,
    uniforms: {
      uTime: { value: 0 },
      uTouch: { value: new THREE.Vector2(-1, -1) },
      uAge: { value: 10 },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const surface = new THREE.Mesh(new THREE.PlaneGeometry(8.62, 8.62), glass);
  surface.rotation.x = -Math.PI / 2;
  surface.position.y = 0.048;
  surface.renderOrder = 0;
  board.add(surface);

  const pointGroups: THREE.Group[] = [];
  const emptyGeometry = new THREE.SphereGeometry(0.044, 12, 8);
  const emptyMaterial = new THREE.MeshStandardMaterial({
    color: COLORS[0],
    emissive: COLORS[0],
    emissiveIntensity: 0.65,
    roughness: 0.2,
  });
  const diamondGeometry = new THREE.ConeGeometry(0.135, 0.105, 4);
  const diamondMaterial = new THREE.MeshStandardMaterial({
    color: 0xbf6657,
    emissive: COLORS[1],
    emissiveIntensity: 0.25,
    metalness: 0.45,
    roughness: 0.22,
  });
  const ringGeometry = new THREE.TorusGeometry(0.112, 0.031, 8, 32);
  const ringMaterial = new THREE.MeshStandardMaterial({
    color: COLORS[2],
    emissive: COLORS[2],
    emissiveIntensity: 0.23,
    metalness: 0.3,
    roughness: 0.2,
  });
  for (let index = 0; index < 64; index++) {
    const group = new THREE.Group();
    group.position.copy(position(index));
    const empty = new THREE.Mesh(emptyGeometry, emptyMaterial);
    const diamond = new THREE.Mesh(diamondGeometry, diamondMaterial);
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.rotation.x = -Math.PI / 2;
    group.add(empty, diamond, ring);
    diamond.visible = false;
    ring.visible = false;
    board.add(group);
    pointGroups.push(group);
  }
  const selection = new THREE.Mesh(
    new THREE.TorusGeometry(0.21, 0.013, 6, 48),
    new THREE.MeshBasicMaterial({
      color: 0xf2efe3,
      transparent: true,
      opacity: 0.9,
    }),
  );
  selection.rotation.x = -Math.PI / 2;
  selection.visible = false;
  board.add(selection);
  const lastMarker = new THREE.Mesh(
    new THREE.RingGeometry(0.225, 0.239, 40),
    new THREE.MeshBasicMaterial({
      color: 0xe9eee5,
      transparent: true,
      opacity: 0.38,
      side: THREE.DoubleSide,
    }),
  );
  lastMarker.rotation.x = -Math.PI / 2;
  lastMarker.visible = false;
  board.add(lastMarker);
  let completed = new THREE.Group();
  board.add(completed);
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let reduced = motion.matches;
  let flat = false;
  let frame = 0;
  let disposed = false;
  let lastMoveAt = -10;
  let revision = -1;
  let elapsed = 0;
  let lastTimestamp = 0;
  let game: PrismState | undefined;

  const render = () => renderer.render(scene, camera);
  function project(): void {
    camera.updateMatrixWorld();
    onProject(
      Array.from({ length: 64 }, (_, index) => {
        const p = position(index).project(camera);
        return { x: (p.x + 1) * 50, y: (1 - p.y) * 50 };
      }),
    );
  }
  function resize(): void {
    if (disposed) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    renderer.setSize(rect.width, rect.height, false);
    camera.aspect = rect.width / rect.height;
    // Keep the complete slab in frame, including at narrow mobile widths.
    const distance = 18;
    camera.position.set(
      0,
      flat ? distance : distance * 0.78,
      flat ? 0.001 : distance * 0.63,
    );
    camera.lookAt(0, 0, 0.45);
    camera.zoom = 1;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    const bounds = [-4.35, 4.35].flatMap((x) =>
      [-4.35, 4.35].map((z) => new THREE.Vector3(x, 0, z).project(camera)),
    );
    const maxX = Math.max(...bounds.map((point) => Math.abs(point.x)));
    const maxY = Math.max(...bounds.map((point) => Math.abs(point.y)));
    camera.zoom = Math.min(0.96 / maxX, 0.9 / maxY);
    camera.updateProjectionMatrix();
    project();
    render();
  }
  function animate(timestamp: number): void {
    if (disposed || document.hidden || reduced) {
      frame = 0;
      return;
    }
    const delta = lastTimestamp
      ? Math.min((timestamp - lastTimestamp) / 1000, 0.06)
      : 0;
    lastTimestamp = timestamp;
    elapsed += delta;
    glass.uniforms.uTime!.value = elapsed;
    glass.uniforms.uAge!.value = elapsed - lastMoveAt;
    completed.children.forEach((child) => {
      if (
        child instanceof THREE.Mesh &&
        child.material instanceof THREE.ShaderMaterial
      )
        child.material.uniforms.uTime!.value = elapsed;
    });
    render();
    frame = requestAnimationFrame(animate);
  }
  function resume(): void {
    cancelAnimationFrame(frame);
    frame = 0;
    lastTimestamp = 0;
    if (!document.hidden && !reduced && !disposed)
      frame = requestAnimationFrame(animate);
    else if (!disposed) render();
  }
  function motionChanged(): void {
    reduced = motion.matches;
    resume();
  }
  function contextLost(event: Event): void {
    event.preventDefault();
    onUnavailable();
  }
  function update(next: PrismState): void {
    game = next;
    pointGroups.forEach((group, index) =>
      group.children.forEach((child, owner) => {
        child.visible = owner === next.board[index];
      }),
    );
    release(completed);
    board.remove(completed);
    completed = new THREE.Group();
    board.add(completed);
    for (const square of next.completed) {
      const corners = square.corners.map((index) => position(index, 0.078));
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(
          corners.flatMap((p) => [p.x, p.y, p.z]),
          3,
        ),
      );
      geometry.setAttribute(
        "uv",
        new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2),
      );
      geometry.setIndex([0, 1, 2, 0, 2, 3]);
      const material = new THREE.ShaderMaterial({
        vertexShader: surfaceVertex,
        fragmentShader: squareFragment,
        uniforms: {
          uColor: { value: new THREE.Color(COLORS[square.owner]) },
          uTime: { value: elapsed },
        },
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.renderOrder = 1;
      completed.add(mesh);
      for (let edge = 0; edge < 4; edge++) {
        const from = corners[edge]!;
        const to = corners[(edge + 1) % 4]!;
        const direction = new THREE.Vector3().subVectors(to, from);
        const line = new THREE.Mesh(
          new THREE.CylinderGeometry(0.009, 0.009, direction.length(), 6),
          new THREE.MeshBasicMaterial({
            color: COLORS[square.owner],
            transparent: true,
            opacity: 0.72,
          }),
        );
        line.position.copy(from).add(to).multiplyScalar(0.5);
        line.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          direction.normalize(),
        );
        line.renderOrder = 2;
        completed.add(line);
      }
    }
    const last = next.history.at(-1);
    lastMarker.visible = Boolean(last);
    if (last) {
      lastMarker.position.copy(position(last.index, 0.21));
      if (revision !== next.revision) {
        lastMoveAt = elapsed;
        glass.uniforms.uTouch!.value.set(
          ((last.index % 8) - 3.5) / 8.62 + 0.5,
          0.5 - (Math.floor(last.index / 8) - 3.5) / 8.62,
        );
      }
    }
    revision = next.revision;
    if (next.winner !== null) selection.visible = false;
    render();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  document.addEventListener("visibilitychange", resume);
  motion.addEventListener("change", motionChanged);
  canvas.addEventListener("webglcontextlost", contextLost);
  resize();
  resume();
  return {
    state: update,
    hover(index) {
      selection.visible =
        index >= 0 && game?.board[index] === 0 && game.winner === null;
      if (selection.visible) selection.position.copy(position(index, 0.2));
      render();
    },
    flat(enabled) {
      flat = enabled;
      resize();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("visibilitychange", resume);
      motion.removeEventListener("change", motionChanged);
      canvas.removeEventListener("webglcontextlost", contextLost);
      release(scene);
      renderer.dispose();
    },
  };
}
