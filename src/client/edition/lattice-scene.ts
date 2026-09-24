import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  cubeCatalog,
  pointAt,
  type LatticeState,
  type Point3,
} from "../../shared/edition-game";

export type ViewName = "isometric" | "front" | "top" | "side";
export type SceneModel = {
  game: LatticeState;
  selected: number | null;
  layer: number;
  isolate: boolean;
  showCubes: boolean;
  trace: string | null;
};
const palette = {
  paper: 0xf7f8f5,
  line: 0xc5cdc6,
  empty: 0xb9c2b8,
  teal: 0x087c79,
  orange: 0xc9563a,
};

// A shared analytic lighting shader gives every node a ceramic surface and a soft rim.
// Selection changes material, never canonical ownership or scoring data.
const vertexShader = `
  varying vec3 vNormal;
  varying vec3 vPosition;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 view = modelViewMatrix * vec4(position, 1.0);
    vPosition = view.xyz;
    gl_Position = projectionMatrix * view;
  }
`;
const fragmentShader = `
  uniform vec3 uColor;
  uniform float uAlpha;
  uniform float uSelected;
  uniform float uTime;
  varying vec3 vNormal;
  varying vec3 vPosition;
  void main() {
    vec3 n = normalize(vNormal);
    vec3 light = normalize(vec3(-0.6, 0.9, 1.4));
    float diffuse = max(dot(n, light), 0.0);
    float rim = pow(1.0 - max(dot(n, normalize(-vPosition)), 0.0), 2.0);
    float glint = pow(max(dot(reflect(-light, n), normalize(-vPosition)), 0.0), 24.0);
    vec3 color = uColor * (0.55 + 0.55 * diffuse) + vec3(0.22) * glint;
    color += rim * (0.08 + uSelected * (0.18 + 0.06 * sin(uTime * 2.0)));
    gl_FragColor = vec4(color, uAlpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function nodeMaterial(color: number, selected = false): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uAlpha: { value: 1 },
      uSelected: { value: selected ? 1 : 0 },
      uTime: { value: 0 },
    },
    transparent: true,
  });
}

function position(point: Point3, size: number): THREE.Vector3 {
  const middle = (size - 1) / 2;
  // Z is height in the inspector; Y increases away from the front view.
  return new THREE.Vector3(
    point.x - middle,
    point.z - middle,
    middle - point.y,
  );
}

export class LatticeScene {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(34, 1, 0.1, 60);
  private controls: OrbitControls;
  private nodes: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>[] = [];
  private geometry = new THREE.SphereGeometry(0.085, 20, 16);
  private materials = [
    nodeMaterial(palette.empty),
    nodeMaterial(palette.teal),
    nodeMaterial(palette.orange),
  ];
  private selectedMaterial = nodeMaterial(palette.teal, true);
  private lattice = new THREE.Group();
  private completed = new THREE.Group();
  private plane: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.13, 0.011, 8, 48),
    new THREE.MeshBasicMaterial({ color: palette.teal, depthTest: false }),
  );
  private selectionLines = new THREE.Group();
  private layerLines = new THREE.Group();
  private labels: { element: HTMLSpanElement; position: THREE.Vector3 }[] = [];
  private selectionLabel: HTMLSpanElement;
  private resizeObserver: ResizeObserver;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private pointerDown: {
    x: number;
    y: number;
    id: number;
    dragged: boolean;
  } | null = null;
  private model: SceneModel;
  private frame = 0;
  private disposed = false;
  private lost = false;
  private view: ViewName = "isometric";
  private reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  constructor(
    private host: HTMLElement,
    model: SceneModel,
    private onSelect: (index: number) => void,
    private onStatus: (message: string | null) => void,
    interactive = true,
  ) {
    this.model = model;
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "low-power",
    });
    // Scene background survives WebGL context restoration; renderer clear state does not.
    this.scene.background = new THREE.Color(palette.paper);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.canvas = this.renderer.domElement;
    this.canvas.setAttribute(
      "aria-label",
      interactive
        ? "Rotatable three-dimensional lattice. Use the layer inspector to select points with the keyboard."
        : "Three-dimensional lattice preview.",
    );
    this.canvas.setAttribute("role", "img");
    this.host.append(this.canvas);
    this.selectionLabel = document.createElement("span");
    this.selectionLabel.className = "spatial-selection";
    this.selectionLabel.setAttribute("aria-hidden", "true");
    this.host.append(this.selectionLabel);
    // Unconnected controls retain camera math without installing host gestures.
    this.controls = new OrbitControls(
      this.camera,
      interactive ? this.canvas : null,
    );
    this.controls.enableDamping = false;
    this.controls.enablePan = false;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 18;
    this.controls.rotateSpeed = 0.65;
    this.controls.zoomSpeed = 0.65;
    this.controls.minPolarAngle = 0.02;
    this.controls.maxPolarAngle = Math.PI - 0.02;
    this.controls.addEventListener("change", this.render);
    this.scene.add(
      this.lattice,
      this.completed,
      this.selectionLines,
      this.layerLines,
      this.ring,
    );
    this.ring.renderOrder = 4;
    this.plane = new THREE.Mesh(
      new THREE.PlaneGeometry(3.5, 3.5),
      new THREE.MeshBasicMaterial({
        color: palette.teal,
        opacity: 0.035,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.plane.rotation.x = -Math.PI / 2;
    this.scene.add(this.plane);
    this.makeNodes(model.game.size);
    this.setView("isometric");
    this.update(model);
    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(host);
    this.resize();
    if (interactive) {
      this.canvas.addEventListener("pointerdown", this.onPointerDown);
      this.canvas.addEventListener("pointermove", this.onPointerMove);
      this.canvas.addEventListener("pointerup", this.onPointerUp);
      this.canvas.addEventListener("pointercancel", this.onPointerCancel);
    }
    this.canvas.addEventListener("webglcontextlost", this.onContextLost);
    this.canvas.addEventListener(
      "webglcontextrestored",
      this.onContextRestored,
    );
    document.addEventListener("visibilitychange", this.onVisibility);
    this.reducedMotion.addEventListener("change", this.onVisibility);
  }

  private makeNodes(size: number): void {
    this.disposeGroup(this.lattice);
    for (const label of this.labels) label.element.remove();
    this.labels = [];
    this.nodes = [];
    for (let index = 0; index < size ** 3; index++) {
      const mesh = new THREE.Mesh(this.geometry, this.materials[0]!);
      mesh.position.copy(position(pointAt(index, size), size));
      mesh.userData.index = index;
      this.nodes.push(mesh);
      this.scene.add(mesh);
    }
    const segments: THREE.Vector3[] = [];
    for (let a = 0; a < size; a++)
      for (let b = 0; b < size; b++) {
        for (const axis of ["x", "y", "z"] as const) {
          const start =
            axis === "x"
              ? { x: 0, y: a, z: b }
              : axis === "y"
                ? { x: a, y: 0, z: b }
                : { x: a, y: b, z: 0 };
          segments.push(
            position(start, size),
            position({ ...start, [axis]: size - 1 }, size),
          );
        }
      }
    const grid = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(segments),
      new THREE.LineBasicMaterial({
        color: palette.line,
        transparent: true,
        opacity: 0.62,
      }),
    );
    this.lattice.add(grid);
    for (const [axis, color] of [
      ["x", palette.orange],
      ["y", palette.teal],
      ["z", 0x455998],
    ] as const) {
      const from = { x: -0.12, y: -0.12, z: -0.12 };
      const to = { ...from, [axis]: size - 0.85 };
      const line = new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints([
          position(from, size),
          position(to, size),
        ]),
        new THREE.LineBasicMaterial({
          color,
          transparent: true,
          opacity: 0.55,
        }),
      );
      this.lattice.add(line);
      const element = document.createElement("span");
      element.className = "spatial-label";
      element.textContent = axis.toUpperCase();
      element.style.color = `#${color.toString(16).padStart(6, "0")}`;
      element.setAttribute("aria-hidden", "true");
      this.host.append(element);
      this.labels.push({ element, position: position(to, size) });
    }
  }

  private disposeGroup(group: THREE.Group): void {
    group.traverse((child) => {
      if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
        child.geometry.dispose();
        const materials = Array.isArray(child.material)
          ? child.material
          : [child.material];
        for (const material of materials) material.dispose();
      }
    });
    group.clear();
  }

  private cubeEdges(
    origin: Point3,
    side: number,
    color: number,
    opacity: number,
    dashed = false,
  ): THREE.LineSegments {
    const box = new THREE.BoxGeometry(side, side, side);
    const geometry = new THREE.EdgesGeometry(box);
    box.dispose();
    const material = dashed
      ? new THREE.LineDashedMaterial({
          color,
          transparent: true,
          opacity,
          dashSize: 0.075,
          gapSize: 0.055,
          depthTest: false,
        })
      : new THREE.LineBasicMaterial({
          color,
          transparent: true,
          opacity,
          depthTest: false,
        });
    const edges = new THREE.LineSegments(geometry, material);
    edges.position.copy(
      position(
        {
          x: origin.x + side / 2,
          y: origin.y + side / 2,
          z: origin.z + side / 2,
        },
        this.model.game.size,
      ),
    );
    edges.renderOrder = 2;
    if (dashed) edges.computeLineDistances();
    return edges;
  }

  update(model: SceneModel): void {
    const old = this.model;
    this.model = model;
    if (this.nodes.length !== model.game.board.length) {
      for (const mesh of this.nodes) this.scene.remove(mesh);
      this.makeNodes(model.game.size);
      this.setView(this.view);
    }
    const { game, layer, selected, isolate } = model;
    for (const [index, mesh] of this.nodes.entries()) {
      const owner = game.board[index]!;
      const onLayer = pointAt(index, game.size).z === layer;
      mesh.visible = !isolate || onLayer;
      mesh.material =
        selected === index && owner === 0
          ? this.selectedMaterial
          : this.materials[owner]!;
      mesh.scale.setScalar(owner === 0 ? 1 : 1.12);
    }
    this.selectedMaterial.uniforms.uColor!.value = new THREE.Color(
      game.turn === 1 ? palette.teal : palette.orange,
    );
    this.ring.material.color.set(
      game.turn === 1 ? palette.teal : palette.orange,
    );
    this.ring.visible = selected !== null;
    this.selectionLabel.hidden = selected === null;
    if (selected !== null) {
      const point = pointAt(selected, game.size);
      this.selectionLabel.textContent = `X ${point.x + 1} · Y ${point.y + 1} · Z ${point.z + 1}`;
      this.selectionLabel.style.color = game.turn === 1 ? "#087c79" : "#c9563a";
    }
    if (selected !== null && this.nodes[selected])
      this.ring.position.copy(this.nodes[selected]!.position);
    this.plane.position.y = layer - (game.size - 1) / 2;
    this.plane.scale.setScalar(game.size / 4);
    this.plane.visible = !isolate;
    this.lattice.visible = !isolate;
    for (const label of this.labels) label.element.hidden = isolate;
    this.disposeGroup(this.layerLines);
    if (isolate) {
      const segments: THREE.Vector3[] = [];
      for (let row = 0; row < game.size; row++) {
        segments.push(
          position({ x: row, y: 0, z: layer }, game.size),
          position({ x: row, y: game.size - 1, z: layer }, game.size),
        );
        segments.push(
          position({ x: 0, y: row, z: layer }, game.size),
          position({ x: game.size - 1, y: row, z: layer }, game.size),
        );
      }
      this.layerLines.add(
        new THREE.LineSegments(
          new THREE.BufferGeometry().setFromPoints(segments),
          new THREE.LineBasicMaterial({
            color: palette.line,
            transparent: true,
            opacity: 0.7,
          }),
        ),
      );
    }
    if (
      old.game !== game ||
      old.showCubes !== model.showCubes ||
      old.trace !== model.trace ||
      old.isolate !== isolate ||
      old.layer !== layer ||
      this.completed.children.length === 0
    ) {
      this.disposeGroup(this.completed);
      if (model.showCubes)
        for (const cube of game.cubes) {
          this.completed.add(
            this.cubeEdges(
              cube.origin,
              cube.side,
              cube.owner === 1 ? palette.teal : palette.orange,
              isolate ? 0.2 : 0.76,
            ),
          );
        }
      const trace = cubeCatalog(game.size).find(
        (cube) => cube.id === model.trace,
      );
      if (trace)
        this.completed.add(
          this.cubeEdges(
            trace.origin,
            trace.side,
            game.turn === 1 ? palette.teal : palette.orange,
            0.55,
            true,
          ),
        );
    }
    this.disposeGroup(this.selectionLines);
    if (selected !== null) {
      const selectedPoint = pointAt(selected, game.size);
      const cross: THREE.Vector3[] = [];
      for (const axis of ["x", "y", "z"] as const)
        cross.push(
          position({ ...selectedPoint, [axis]: 0 }, game.size),
          position({ ...selectedPoint, [axis]: game.size - 1 }, game.size),
        );
      this.selectionLines.add(
        new THREE.LineSegments(
          new THREE.BufferGeometry().setFromPoints(cross),
          new THREE.LineDashedMaterial({
            color: game.turn === 1 ? palette.teal : palette.orange,
            transparent: true,
            opacity: 0.5,
            dashSize: 0.03,
            gapSize: 0.06,
          }),
        ),
      );
      for (const line of this.selectionLines.children)
        if (line instanceof THREE.LineSegments) line.computeLineDistances();
    }
    this.render();
    cancelAnimationFrame(this.frame);
    this.animate();
  }

  setView(view: ViewName): void {
    this.view = view;
    const distance = this.model.game.size === 3 ? 7.2 : 9.4;
    const direction =
      view === "front"
        ? new THREE.Vector3(0, 0.001, 1)
        : view === "top"
          ? new THREE.Vector3(0, 1, 0.001)
          : view === "side"
            ? new THREE.Vector3(1, 0.001, 0)
            : new THREE.Vector3(1.1, 0.55, 1.3);
    this.camera.position.copy(direction.normalize().multiplyScalar(distance));
    this.controls.target.set(0, 0, 0);
    this.controls.update();
    this.render();
  }

  rotate(horizontal: number, vertical: number): void {
    const sphere = new THREE.Spherical().setFromVector3(this.camera.position);
    sphere.theta += horizontal;
    sphere.phi = THREE.MathUtils.clamp(
      sphere.phi + vertical,
      0.05,
      Math.PI - 0.05,
    );
    this.camera.position.setFromSpherical(sphere);
    this.controls.update();
    this.render();
  }

  zoom(amount: number): void {
    this.camera.position.multiplyScalar(amount);
    this.camera.position.setLength(
      THREE.MathUtils.clamp(
        this.camera.position.length(),
        this.controls.minDistance,
        this.controls.maxDistance,
      ),
    );
    this.controls.update();
    this.render();
  }

  private resize = (): void => {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    this.camera.aspect = width / height;
    // A vertical lattice should never be clipped by the narrower mobile view.
    this.camera.fov = width < height ? 34 / this.camera.aspect : 34;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.render();
  };

  private onPointerDown = (event: PointerEvent): void => {
    if (this.pointerDown) this.pointerDown.dragged = true;
    else
      this.pointerDown = {
        x: event.clientX,
        y: event.clientY,
        id: event.pointerId,
        dragged: false,
      };
  };
  private onPointerMove = (event: PointerEvent): void => {
    if (
      this.pointerDown &&
      Math.hypot(
        event.clientX - this.pointerDown.x,
        event.clientY - this.pointerDown.y,
      ) > 6
    )
      this.pointerDown.dragged = true;
  };
  private onPointerCancel = (): void => {
    this.pointerDown = null;
  };
  private onPointerUp = (event: PointerEvent): void => {
    const down = this.pointerDown;
    this.pointerDown = null;
    if (!down || down.dragged || down.id !== event.pointerId || this.lost)
      return;
    const bounds = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      (-(event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    // A visible occupied node still captures inspection; it must not silently select an empty point behind it.
    const hit = this.raycaster.intersectObjects(
      this.nodes.filter((mesh) => mesh.visible),
      false,
    )[0];
    if (hit) this.onSelect(hit.object.userData.index as number);
  };
  private onContextLost = (event: Event): void => {
    event.preventDefault();
    this.lost = true;
    this.onStatus(
      "3D view interrupted. You can keep playing with the layer inspector.",
    );
    cancelAnimationFrame(this.frame);
  };
  private onContextRestored = (): void => {
    this.lost = false;
    this.onStatus(null);
    this.resize();
    this.animate();
  };
  private onVisibility = (): void => {
    cancelAnimationFrame(this.frame);
    if (!document.hidden) {
      this.render();
      this.animate();
    }
  };
  private render = (): void => {
    if (this.disposed || this.lost) return;
    this.ring.quaternion.copy(this.camera.quaternion);
    this.renderer.render(this.scene, this.camera);
    for (const label of this.labels)
      this.positionLabel(label.element, label.position);
    if (this.model.selected !== null)
      this.positionLabel(this.selectionLabel, this.ring.position, 14);
  };
  private positionLabel(
    element: HTMLElement,
    point: THREE.Vector3,
    offset = 0,
  ): void {
    const projected = point.clone().project(this.camera);
    const x = ((projected.x + 1) * this.host.clientWidth) / 2;
    const y = ((1 - projected.y) * this.host.clientHeight) / 2;
    element.style.left = `${Math.max(5, Math.min(this.host.clientWidth - element.offsetWidth - 5, x + offset))}px`;
    element.style.top = `${Math.max(5, Math.min(this.host.clientHeight - 25, y - 10))}px`;
  }
  private animate = (): void => {
    if (
      this.disposed ||
      this.lost ||
      document.hidden ||
      this.reducedMotion.matches ||
      this.model.selected === null ||
      this.model.game.winner !== null
    )
      return;
    this.selectedMaterial.uniforms.uTime!.value = performance.now() / 1000;
    this.render();
    this.frame = requestAnimationFrame(this.animate);
  };

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.controls.removeEventListener("change", this.render);
    // Three's disconnect assumes a DOM element, even for unconnected controls.
    if (this.controls.domElement) this.controls.dispose();
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerCancel);
    this.canvas.removeEventListener("webglcontextlost", this.onContextLost);
    this.canvas.removeEventListener(
      "webglcontextrestored",
      this.onContextRestored,
    );
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.reducedMotion.removeEventListener("change", this.onVisibility);
    this.disposeGroup(this.lattice);
    this.disposeGroup(this.completed);
    this.disposeGroup(this.selectionLines);
    this.disposeGroup(this.layerLines);
    this.geometry.dispose();
    for (const material of [...this.materials, this.selectedMaterial])
      material.dispose();
    this.ring.geometry.dispose();
    this.ring.material.dispose();
    this.plane.geometry.dispose();
    this.plane.material.dispose();
    this.renderer.dispose();
    for (const label of this.labels) label.element.remove();
    this.selectionLabel.remove();
    this.canvas.remove();
  }
}
