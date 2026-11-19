import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { useEditorStore, type RuntimeMeshCache } from '../store/editorStore';
import { getProceduralCanvasTexture, releaseProceduralCanvasTexture } from './proceduralTextures';

interface ManagedMeshEntry {
  group: THREE.Group;
  mesh: THREE.Mesh;
  wireframe: THREE.LineSegments;
  cache: RuntimeMeshCache | null;
  materialHash: string;
}

export const Viewport3D: React.FC = () => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [viewportError, setViewportError] = useState('');
  const [hoverInfo, setHoverInfo] = useState<string>('');
  const [webgpuAvailable, setWebgpuAvailable] = useState<boolean>(false);

  // Imperative refs for Three.js objects so we never recreate WebGL contexts
  const threeRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    orbit: OrbitControls;
    transform: TransformControls;
    subProxy: THREE.Object3D;
    gridGroup: THREE.Group;
    avatarRefMesh: THREE.Group;
    entries: Map<string, ManagedMeshEntry>;
    vertexInstanced: THREE.InstancedMesh;
    selectedEdgeLines: THREE.LineSegments;
    selectedFaceMesh: THREE.Mesh;
    raycaster: THREE.Raycaster;
    isDraggingSubGizmo: boolean;
    lastSubProxyPos: THREE.Vector3;
  } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator;
    setWebgpuAvailable(hasWebGPU);

    // Force high-performance WebGL2 context
    const canvas = document.createElement('canvas');
    const gl2 = canvas.getContext('webgl2', {
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
    }) as WebGL2RenderingContext | null;

    if (!gl2) {
      setViewportError('WebGL2 is unavailable. You can still open projects and export meshes.');
      return;
    }
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, context: gl2, antialias: true });
    } catch {
      setViewportError('Could not start the 3D viewport.');
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(el.clientWidth || 800, el.clientHeight || 600);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const surface = getComputedStyle(el).getPropertyValue('--app-bg').trim();
    scene.background = new THREE.Color(surface || '#101012');

    const camera = new THREE.PerspectiveCamera(
      50,
      (el.clientWidth || 800) / Math.max(1, el.clientHeight || 600),
      0.05,
      3000
    );
    camera.position.set(8.5, 6.5, 9.5);
    camera.lookAt(0, 1.5, 0);

    // Studio 3-point technical lighting
    const hemi = new THREE.HemisphereLight(0xdbeafe, 0x1e222a, 0.85);
    scene.add(hemi);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.45);
    keyLight.position.set(14, 24, 16);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 80;
    const d = 24;
    keyLight.shadow.camera.left = -d;
    keyLight.shadow.camera.right = d;
    keyLight.shadow.camera.top = d;
    keyLight.shadow.camera.bottom = -d;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x60a5fa, 0.45);
    rimLight.position.set(-16, 10, -14);
    scene.add(rimLight);

    // Roblox Stud-calibrated technical grid (1 minor cell = 1 Stud, major = 4 Studs = classic Baseplate tile)
    const gridGroup = new THREE.Group();
    const minorGrid = new THREE.GridHelper(128, 128, 0x2a2e37, 0x1e2128);
    minorGrid.position.y = -0.002;
    const majorGrid = new THREE.GridHelper(128, 32, 0x3b4252, 0x2b303c);
    majorGrid.position.y = 0;

    // X (Red) and Z (Blue) Blender/Studio world axis lines
    const axisGeoX = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-64, 0.004, 0),
      new THREE.Vector3(64, 0.004, 0),
    ]);
    const axisGeoZ = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0.004, -64),
      new THREE.Vector3(0, 0.004, 64),
    ]);
    const axisX = new THREE.Line(axisGeoX, new THREE.LineBasicMaterial({ color: 0xdc2626 }));
    const axisZ = new THREE.Line(axisGeoZ, new THREE.LineBasicMaterial({ color: 0x2563eb }));
    gridGroup.add(minorGrid, majorGrid, axisX, axisZ);
    scene.add(gridGroup);

    // R15 Roblox Avatar Scale Reference Rig (5 Studs tall, 4 Studs wide, 2 Studs deep)
    const avatarRefMesh = new THREE.Group();
    const buildGhostBox = (w: number, h: number, dp: number, x: number, y: number, z: number) => {
      const g = new THREE.BoxGeometry(w, h, dp);
      const edges = new THREE.EdgesGeometry(g);
      g.dispose();
      const line = new THREE.LineSegments(
        edges,
        new THREE.LineBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.55 })
      );
      line.position.set(x, y, z);
      return line;
    };
    // Head (1.2x1.2x1.2), Torso (2x2x1), Arms (1x2x1), Legs (1x2x1) -> Total height = 5.2 studs
    avatarRefMesh.add(
      buildGhostBox(2, 2, 1, 5.5, 3.0, 0),    // Torso
      buildGhostBox(1.2, 1.2, 1.2, 5.5, 4.6, 0), // Head
      buildGhostBox(0.95, 2, 1, 3.95, 3.0, 0), // Left Arm
      buildGhostBox(0.95, 2, 1, 7.05, 3.0, 0), // Right Arm
      buildGhostBox(0.95, 2, 1, 4.98, 1.0, 0), // Left Leg
      buildGhostBox(0.95, 2, 1, 6.02, 1.0, 0)  // Right Leg
    );
    avatarRefMesh.visible = false;
    scene.add(avatarRefMesh);

    // OrbitControls & TransformControls
    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.09;
    orbit.screenSpacePanning = true;
    orbit.maxDistance = 600;
    orbit.minDistance = 0.4;

    const transform = new TransformControls(camera, renderer.domElement);
    transform.setSize(0.82);
    // In Three.js r165+, TransformControls extends Controls and getHelper() returns the Object3D gizmo
    const transformHelper =
      typeof (transform as any).getHelper === 'function'
        ? (transform as any).getHelper()
        : (transform as unknown as THREE.Object3D);
    scene.add(transformHelper);

    const subProxy = new THREE.Object3D();
    scene.add(subProxy);

    // InstancedMesh for high-performance Vertex Handle rendering (1 draw call for up to 16,384 vertices!)
    const handleGeo = new THREE.BoxGeometry(0.11, 0.11, 0.11);
    const handleMat = new THREE.MeshBasicMaterial({ depthTest: false, transparent: true, opacity: 0.95 });
    const vertexInstanced = new THREE.InstancedMesh(handleGeo, handleMat, 16384);
    vertexInstanced.count = 0;
    vertexInstanced.renderOrder = 20;
    vertexInstanced.frustumCulled = false;
    scene.add(vertexInstanced);

    // Selected Edge highlight overlay
    const selectedEdgeLines = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xf59e0b, depthTest: false, linewidth: 2 })
    );
    selectedEdgeLines.renderOrder = 19;
    selectedEdgeLines.frustumCulled = false;
    scene.add(selectedEdgeLines);

    // Selected Face highlight overlay
    const selectedFaceMesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({
        color: 0x3b82f6,
        transparent: true,
        opacity: 0.34,
        side: THREE.DoubleSide,
        depthTest: false,
      })
    );
    selectedFaceMesh.renderOrder = 18;
    selectedFaceMesh.frustumCulled = false;
    scene.add(selectedFaceMesh);

    const ctxObj = {
      renderer,
      scene,
      camera,
      orbit,
      transform,
      subProxy,
      gridGroup,
      avatarRefMesh,
      entries: new Map<string, ManagedMeshEntry>(),
      vertexInstanced,
      selectedEdgeLines,
      selectedFaceMesh,
      raycaster: new THREE.Raycaster(),
      isDraggingSubGizmo: false,
      lastSubProxyPos: new THREE.Vector3(),
    };
    threeRef.current = ctxObj;

    // TransformControls event wiring (Object mode + Sub-object Vertex/Edge/Face gizmo displacement!)
    transform.addEventListener('dragging-changed', (ev: any) => {
      const dragging = Boolean(ev.value);
      orbit.enabled = !dragging;
      const st = useEditorStore.getState();
      if (dragging) {
        if (st.mode === 'object') {
          st.pushUndo('Gizmo Transform');
        } else {
          st.pushUndo(`Move ${st.mode}`);
          ctxObj.isDraggingSubGizmo = true;
          ctxObj.lastSubProxyPos.copy(subProxy.position);
        }
      } else {
        ctxObj.isDraggingSubGizmo = false;
      }
    });

    transform.addEventListener('objectChange', () => {
      const st = useEditorStore.getState();
      if (!st.selectedNodeId) return;

      if (st.mode === 'object') {
        const entry = ctxObj.entries.get(st.selectedNodeId);
        if (!entry) return;
        const g = entry.group;
        const deg = THREE.MathUtils.radToDeg;
        st.updateNodeTransform(
          st.selectedNodeId,
          {
            position: [
              Number(g.position.x.toFixed(4)),
              Number(g.position.y.toFixed(4)),
              Number(g.position.z.toFixed(4)),
            ],
            rotation: [
              Number(deg(g.rotation.x).toFixed(2)),
              Number(deg(g.rotation.y).toFixed(2)),
              Number(deg(g.rotation.z).toFixed(2)),
            ],
            scale: [
              Number(g.scale.x.toFixed(4)),
              Number(g.scale.y.toFixed(4)),
              Number(g.scale.z.toFixed(4)),
            ],
          },
          false
        );
      } else if (ctxObj.isDraggingSubGizmo) {
        const entry = ctxObj.entries.get(st.selectedNodeId);
        if (!entry) return;
        const worldDelta = subProxy.position.clone().sub(ctxObj.lastSubProxyPos);
        if (worldDelta.lengthSq() > 1e-9) {
          ctxObj.lastSubProxyPos.copy(subProxy.position);
          // Convert world-space delta to object local-space delta
          const invMat = new THREE.Matrix4().copy(entry.group.matrixWorld).invert();
          const localDelta = worldDelta.transformDirection(invMat);
          const len = subProxy.position.distanceTo(ctxObj.lastSubProxyPos);
          void len;
          // Accurate local delta with scale:
          const p0Local = entry.group.worldToLocal(subProxy.position.clone().sub(worldDelta));
          const p1Local = entry.group.worldToLocal(subProxy.position.clone());
          const dLocal = p1Local.sub(p0Local);
          st.translateSelectedElements([dLocal.x, dLocal.y, dLocal.z]);
        }
      }
    });

    // ResizeObserver for responsive panel collapsing
    const resizeObs = new ResizeObserver((entries) => {
      for (const e of entries) {
        const w = Math.max(100, e.contentRect.width);
        const h = Math.max(100, e.contentRect.height);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      }
    });
    resizeObs.observe(el);

    // Render loop + telemetry
    let animId = 0;
    let frames = 0;
    let lastFpsTick = performance.now();

    const animate = () => {
      animId = requestAnimationFrame(animate);
      const t0 = performance.now();
      orbit.update();
      renderer.render(scene, camera);
      const dt = performance.now() - t0;
      frames++;

      const now = performance.now();
      if (now - lastFpsTick >= 1000) {
        const fps = Math.round((frames * 1000) / (now - lastFpsTick));
        useEditorStore
          .getState()
          .setTelemetry(fps, renderer.info.render.calls, Number(dt.toFixed(2)), gl2 ? 'WebGL2' : 'WebGL2');
        frames = 0;
        lastFpsTick = now;
      }
    };
    animate();

    return () => {
      cancelAnimationFrame(animId);
      resizeObs.disconnect();
      orbit.dispose();
      transform.dispose();
      scene.traverse((object) => {
        const renderable = object as THREE.Mesh;
        renderable.geometry?.dispose();
        const materials = Array.isArray(renderable.material) ? renderable.material : [renderable.material];
        materials.forEach((material) => {
          if (material instanceof THREE.MeshStandardMaterial) releaseProceduralCanvasTexture(material.map);
          material?.dispose();
        });
      });
      renderer.dispose();
      renderer.forceContextLoss();
      if (renderer.domElement.parentElement === el) {
        el.removeChild(renderer.domElement);
      }
      threeRef.current = null;
    };
  }, []);

  // Synchronize Zustand state -> Three.js Scene Graph incrementally
  const sceneDoc = useEditorStore((s) => s.scene);
  const meshCache = useEditorStore((s) => s.meshCache);
  const mode = useEditorStore((s) => s.mode);
  const gizmoMode = useEditorStore((s) => s.gizmoMode);
  const shading = useEditorStore((s) => s.shading);
  const showWireframeOverlay = useEditorStore((s) => s.showWireframeOverlay);
  const showGrid = useEditorStore((s) => s.showGrid);
  const showRobloxAvatarScale = useEditorStore((s) => s.showRobloxAvatarScale);
  const snapEnabled = useEditorStore((s) => s.snapEnabled);
  const selectedNodeId = useEditorStore((s) => s.selectedNodeId);
  const selectedVertices = useEditorStore((s) => s.selectedVertices);
  const selectedEdges = useEditorStore((s) => s.selectedEdges);
  const selectedFaces = useEditorStore((s) => s.selectedFaces);

  useEffect(() => {
    const ctx = threeRef.current;
    if (!ctx) return;

    ctx.gridGroup.visible = showGrid;
    ctx.avatarRefMesh.visible = showRobloxAvatarScale;

    // Snap settings calibrated to Roblox Studs & Degrees
    if (snapEnabled) {
      ctx.transform.setTranslationSnap(sceneDoc.gridSnapStuds || 0.5);
      ctx.transform.setRotationSnap(THREE.MathUtils.degToRad(sceneDoc.angleSnapDeg || 15));
      ctx.transform.setScaleSnap(0.1);
    } else {
      ctx.transform.setTranslationSnap(null);
      ctx.transform.setRotationSnap(null);
      ctx.transform.setScaleSnap(null);
    }

    const activeIds = new Set(sceneDoc.nodes.map((n) => n.id));
    // Prune deleted meshes & free GPU buffers
    for (const [id, entry] of ctx.entries.entries()) {
      if (!activeIds.has(id)) {
        if (ctx.transform.object === entry.group) ctx.transform.detach();
        ctx.scene.remove(entry.group);
        entry.mesh.geometry.dispose();
        entry.wireframe.geometry.dispose();
        const material = entry.mesh.material as THREE.MeshStandardMaterial;
        releaseProceduralCanvasTexture(material.map);
        material.dispose();
        (entry.wireframe.material as THREE.Material).dispose();
        ctx.entries.delete(id);
      }
    }

    // Create or incrementally update active nodes
    for (const node of sceneDoc.nodes) {
      if (node.type !== 'mesh') continue;
      const cache = meshCache[node.id];
      if (!cache) continue;

      const matSpec =
        sceneDoc.materials.find((m) => m.id === node.materialId) || sceneDoc.materials[0];
      const matHash = JSON.stringify({ matSpec, shading });

      let entry = ctx.entries.get(node.id);
      if (!entry) {
        const group = new THREE.Group();
        const geom = new THREE.BufferGeometry();
        const mat = new THREE.MeshStandardMaterial();
        const mesh = new THREE.Mesh(geom, mat);
        mesh.castShadow = node.castShadow;
        mesh.receiveShadow = true;
        mesh.userData = { nodeId: node.id };

        const wireGeom = new THREE.BufferGeometry();
        const wireMat = new THREE.LineBasicMaterial({
          color: 0x0b0c0e,
          transparent: true,
          opacity: 0.48,
        });
        const wireframe = new THREE.LineSegments(wireGeom, wireMat);
        wireframe.renderOrder = 2;

        group.add(mesh, wireframe);
        ctx.scene.add(group);
        entry = { group, mesh, wireframe, cache: null, materialHash: '' };
        ctx.entries.set(node.id, entry);
      }

      entry.group.visible = node.visible;
      // Avoid fighting active gizmo drag in object mode
      if (!(mode === 'object' && ctx.transform.dragging && ctx.transform.object === entry.group)) {
        entry.group.position.set(node.position[0], node.position[1], node.position[2]);
        entry.group.rotation.set(
          THREE.MathUtils.degToRad(node.rotation[0]),
          THREE.MathUtils.degToRad(node.rotation[1]),
          THREE.MathUtils.degToRad(node.rotation[2])
        );
        entry.group.scale.set(node.scale[0], node.scale[1], node.scale[2]);
      }
      entry.group.updateMatrixWorld();

      // Incremental Geometry Buffer Update (only when cache.version advances!)
      if (entry.cache !== cache) {
        const rb = cache.render;
        let geometry = entry.mesh.geometry;
        const position = geometry.getAttribute('position');
        const index = geometry.getIndex();
        if (position?.array.length === rb.positions.length && index?.array.length === rb.indices.length) {
          for (const [name, values] of [['position', rb.positions], ['normal', rb.normals], ['uv', rb.uvs]] as const) {
            const attribute = geometry.getAttribute(name) as THREE.BufferAttribute;
            (attribute.array as Float32Array).set(values);
            attribute.needsUpdate = true;
          }
          (index.array as Uint32Array).set(rb.indices);
          index.needsUpdate = true;
        } else {
          geometry.dispose();
          geometry = new THREE.BufferGeometry();
          geometry.setAttribute('position', new THREE.BufferAttribute(rb.positions.slice(), 3));
          geometry.setAttribute('normal', new THREE.BufferAttribute(rb.normals.slice(), 3));
          geometry.setAttribute('uv', new THREE.BufferAttribute(rb.uvs.slice(), 2));
          geometry.setIndex(new THREE.BufferAttribute(rb.indices.slice(), 1));
          entry.mesh.geometry = geometry;
        }
        geometry.computeBoundingSphere();

        // Update topology wireframe segments (true quad/ngon edges, not triangulated diagonals!)
        const wirePos = new Float32Array(rb.wireframePairs.length * 3);
        const rawCoords = cache.soup.coords;
        for (let i = 0; i < rb.wireframePairs.length; i++) {
          const v = rb.wireframePairs[i];
          wirePos[i * 3] = rawCoords[v * 3];
          wirePos[i * 3 + 1] = rawCoords[v * 3 + 1];
          wirePos[i * 3 + 2] = rawCoords[v * 3 + 2];
        }
        const previousWire = entry.wireframe.geometry;
        const wire = previousWire.getAttribute('position') as THREE.BufferAttribute | undefined;
        if (wire?.array.length === wirePos.length) {
          (wire.array as Float32Array).set(wirePos);
          wire.needsUpdate = true;
        } else {
          previousWire.dispose();
          entry.wireframe.geometry = new THREE.BufferGeometry();
          entry.wireframe.geometry.setAttribute('position', new THREE.BufferAttribute(wirePos, 3));
        }
        entry.wireframe.geometry.computeBoundingSphere();

        entry.cache = cache;
      }

      // Material update
      if (entry.materialHash !== matHash && matSpec) {
        const m = entry.mesh.material as THREE.MeshStandardMaterial;
        const previousTexture = m.map;
        if (shading === 'wireframe') {
          m.color.set('#60a5fa');
          m.wireframe = true;
          m.map = null;
          m.roughness = 0.5;
          m.metalness = 0.1;
          m.emissive.set('#000000');
          m.opacity = 1;
          m.transparent = false;
        } else if (shading === 'solid') {
          m.color.set('#8b93a1');
          m.wireframe = false;
          m.map = null;
          m.roughness = 0.48;
          m.metalness = 0.12;
          m.emissive.set('#000000');
          m.opacity = 1;
          m.transparent = false;
        } else {
          m.color.set(matSpec.color);
          m.roughness = matSpec.roughness;
          m.metalness = matSpec.metalness;
          m.emissive.set(matSpec.emissive || '#000000');
          m.emissiveIntensity = matSpec.emissiveIntensity || 0;
          m.opacity = matSpec.opacity ?? 1;
          m.transparent = (matSpec.opacity ?? 1) < 0.99;
          m.wireframe = Boolean(matSpec.wireframe);
          m.map = getProceduralCanvasTexture(matSpec.color, matSpec.texture);
        }
        releaseProceduralCanvasTexture(previousTexture);
        m.flatShading = Boolean(matSpec.flatShading);
        m.needsUpdate = true;
        entry.materialHash = matHash;
      }

      const isSelectedObj = node.id === selectedNodeId;
      entry.wireframe.visible =
        shading !== 'wireframe' && (showWireframeOverlay || (isSelectedObj && mode !== 'object'));
      const wm = entry.wireframe.material as THREE.LineBasicMaterial;
      wm.color.set(isSelectedObj ? (mode === 'object' ? 0x3b82f6 : 0x64748b) : 0x111318);
      wm.opacity = isSelectedObj ? 0.85 : 0.35;
    }

    // Sub-object Overlays (Instanced Vertices, Highlighted Edges, Highlighted Faces) + Gizmo Attachment
    ctx.vertexInstanced.count = 0;
    ctx.selectedEdgeLines.visible = false;
    ctx.selectedFaceMesh.visible = false;

    const selEntry = selectedNodeId ? ctx.entries.get(selectedNodeId) : undefined;
    const selCache = selectedNodeId ? meshCache[selectedNodeId] : undefined;

    if (!selEntry || !selCache || !selEntry.group.visible) {
      ctx.transform.detach();
      return;
    }

    if (mode === 'object') {
      if (gizmoMode === 'select') {
        ctx.transform.detach();
      } else {
        ctx.transform.setMode(gizmoMode);
        if (ctx.transform.object !== selEntry.group) {
          ctx.transform.attach(selEntry.group);
        }
      }
      return;
    }

    // Edit Modes: Vertex / Edge / Face
    const matWorld = selEntry.group.matrixWorld;
    const coords = selCache.soup.coords;
    const dummy = new THREE.Object3D();
    const colorUnsel = new THREE.Color(0x94a3b8);
    const colorSel = new THREE.Color(0xf59e0b);

    // 1. Vertex Mode Instanced Handles
    if (mode === 'vertex') {
      const vCount = Math.min(selCache.topology.vertexCount, 16384);
      const selSet = new Set(selectedVertices);
      ctx.vertexInstanced.count = vCount;
      for (let v = 0; v < vCount; v++) {
        dummy.position.set(coords[v * 3], coords[v * 3 + 1], coords[v * 3 + 2]).applyMatrix4(matWorld);
        const s = selSet.has(v) ? 1.35 : 0.85;
        dummy.scale.set(s, s, s);
        dummy.updateMatrix();
        ctx.vertexInstanced.setMatrixAt(v, dummy.matrix);
        ctx.vertexInstanced.setColorAt(v, selSet.has(v) ? colorSel : colorUnsel);
      }
      ctx.vertexInstanced.instanceMatrix.needsUpdate = true;
      if (ctx.vertexInstanced.instanceColor) ctx.vertexInstanced.instanceColor.needsUpdate = true;
    }

    // 2. Selected Edges Overlay
    if (mode === 'edge' && selectedEdges.length > 0) {
      const pts: number[] = [];
      const pA = new THREE.Vector3();
      const pB = new THREE.Vector3();
      for (const eid of selectedEdges) {
        const e = selCache.topology.edges[eid];
        if (!e) continue;
        pA.set(coords[e.v0 * 3], coords[e.v0 * 3 + 1], coords[e.v0 * 3 + 2]).applyMatrix4(matWorld);
        pB.set(coords[e.v1 * 3], coords[e.v1 * 3 + 1], coords[e.v1 * 3 + 2]).applyMatrix4(matWorld);
        pts.push(pA.x, pA.y, pA.z, pB.x, pB.y, pB.z);
      }
      ctx.selectedEdgeLines.geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(new Float32Array(pts), 3)
      );
      ctx.selectedEdgeLines.visible = pts.length > 0;
    }

    // 3. Selected Faces Overlay
    if (mode === 'face' && selectedFaces.length > 0) {
      const fPts: number[] = [];
      const p0 = new THREE.Vector3();
      const p1 = new THREE.Vector3();
      const p2 = new THREE.Vector3();
      for (const fid of selectedFaces) {
        const verts = selCache.topology.getFaceVertices(fid);
        if (verts.length < 3) continue;
        p0.set(coords[verts[0] * 3], coords[verts[0] * 3 + 1], coords[verts[0] * 3 + 2]).applyMatrix4(matWorld);
        for (let i = 1; i < verts.length - 1; i++) {
          p1.set(coords[verts[i] * 3], coords[verts[i] * 3 + 1], coords[verts[i] * 3 + 2]).applyMatrix4(matWorld);
          p2.set(coords[verts[i + 1] * 3], coords[verts[i + 1] * 3 + 1], coords[verts[i + 1] * 3 + 2]).applyMatrix4(matWorld);
          fPts.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
        }
      }
      ctx.selectedFaceMesh.geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(new Float32Array(fPts), 3)
      );
      ctx.selectedFaceMesh.visible = fPts.length > 0;
    }

    // 4. Position Sub-Object Proxy Gizmo at Centroid of Selected Elements
    if (!ctx.isDraggingSubGizmo) {
      const centroidVerts: number[] = [];
      if (mode === 'vertex') centroidVerts.push(...selectedVertices);
      else if (mode === 'edge') {
        selectedEdges.forEach((eid) => {
          const e = selCache.topology.edges[eid];
          if (e) centroidVerts.push(e.v0, e.v1);
        });
      } else if (mode === 'face') {
        selectedFaces.forEach((fid) => centroidVerts.push(...selCache.topology.getFaceVertices(fid)));
      }

      if (centroidVerts.length > 0 && gizmoMode !== 'select') {
        const c = new THREE.Vector3();
        const tmp = new THREE.Vector3();
        for (const v of centroidVerts) {
          tmp.set(coords[v * 3], coords[v * 3 + 1], coords[v * 3 + 2]).applyMatrix4(matWorld);
          c.add(tmp);
        }
        c.multiplyScalar(1 / centroidVerts.length);
        ctx.subProxy.position.copy(c);
        ctx.subProxy.rotation.set(0, 0, 0);
        ctx.subProxy.scale.set(1, 1, 1);
        ctx.transform.setMode('translate');
        if (ctx.transform.object !== ctx.subProxy) {
          ctx.transform.attach(ctx.subProxy);
        }
      } else {
        ctx.transform.detach();
      }
    }
  }, [
    sceneDoc,
    meshCache,
    mode,
    gizmoMode,
    shading,
    showWireframeOverlay,
    showGrid,
    showRobloxAvatarScale,
    snapEnabled,
    selectedNodeId,
    selectedVertices,
    selectedEdges,
    selectedFaces,
  ]);

  // Pointer Picking for Objects, Vertices, Edges (incl. Alt+Click Edge Loop!), and Faces
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const ctx = threeRef.current;
    const el = containerRef.current;
    if (!ctx || !el || ctx.transform.dragging) return;
    // If TransformControls is hovered (axis handle active), let gizmo consume pointer down
    if ((ctx.transform as any).axis) return;

    const rect = el.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    ctx.raycaster.setFromCamera(ndc, ctx.camera);

    const st = useEditorStore.getState();
    const additive = e.shiftKey;

    if (st.mode === 'object') {
      const meshes: THREE.Object3D[] = [];
      ctx.entries.forEach((entry) => {
        if (entry.group.visible) meshes.push(entry.mesh);
      });
      const hits = ctx.raycaster.intersectObjects(meshes, false);
      if (hits.length > 0) {
        const hitId = hits[0].object.userData.nodeId as string;
        st.selectNode(hitId);
      } else if (!additive) {
        st.selectNode(null);
      }
      return;
    }

    // Sub-object picking on active mesh
    if (!st.selectedNodeId) return;
    const entry = ctx.entries.get(st.selectedNodeId);
    const cache = st.meshCache[st.selectedNodeId];
    if (!entry || !cache) return;

    if (st.mode === 'vertex') {
      const hits = ctx.raycaster.intersectObject(ctx.vertexInstanced, false);
      if (hits.length > 0 && hits[0].instanceId !== undefined) {
        st.selectElements('vertex', [hits[0].instanceId], additive);
        setHoverInfo(`Vertex #${hits[0].instanceId}`);
      } else if (!additive) {
        st.clearElementSelection();
      }
      return;
    }

    const meshHits = ctx.raycaster.intersectObject(entry.mesh, false);
    if (meshHits.length === 0) {
      if (!additive) st.clearElementSelection();
      return;
    }

    const hit = meshHits[0];
    const triIdx = hit.faceIndex ?? 0;
    const polyFaceIdx = cache.render.triToFace[triIdx] ?? 0;

    if (st.mode === 'face') {
      st.selectElements('face', [polyFaceIdx], additive);
      setHoverInfo(`Face #${polyFaceIdx} (${cache.topology.getFaceVertices(polyFaceIdx).length}-gon)`);
    } else if (st.mode === 'edge') {
      // Find closest half-edge of hit polygon to world hit.point
      const localPt = entry.group.worldToLocal(hit.point.clone());
      const hes = cache.topology.getFaceHalfEdges(polyFaceIdx);
      const coords = cache.soup.coords;
      let bestEdgeId = -1;
      let bestDist = Infinity;

      const segA = new THREE.Vector3();
      const segB = new THREE.Vector3();
      const line = new THREE.Line3();
      const closest = new THREE.Vector3();

      for (const he of hes) {
        segA.set(coords[he.origin * 3], coords[he.origin * 3 + 1], coords[he.origin * 3 + 2]);
        segB.set(coords[he.target * 3], coords[he.target * 3 + 1], coords[he.target * 3 + 2]);
        line.set(segA, segB);
        line.closestPointToPoint(localPt, true, closest);
        const d = closest.distanceTo(localPt);
        if (d < bestDist) {
          bestDist = d;
          const match = cache.topology.edges.find(
            (ed) =>
              (ed.v0 === Math.min(he.origin, he.target) && ed.v1 === Math.max(he.origin, he.target))
          );
          if (match) bestEdgeId = match.id;
        }
      }

      if (bestEdgeId >= 0) {
        if (e.altKey) {
          st.selectEdgeLoop(bestEdgeId, additive);
          setHoverInfo(`Edge Loop from #${bestEdgeId}`);
        } else {
          st.selectElements('edge', [bestEdgeId], additive);
          setHoverInfo(`Edge #${bestEdgeId}`);
        }
      }
    }
  };

  const setCameraPreset = (preset: 'front' | 'right' | 'top' | 'iso' | 'focus') => {
    const ctx = threeRef.current;
    if (!ctx) return;
    const target = new THREE.Vector3(0, 1.5, 0);
    const st = useEditorStore.getState();
    if (st.selectedNodeId) {
      const node = st.scene.nodes.find((n) => n.id === st.selectedNodeId);
      if (node) target.set(node.position[0], node.position[1], node.position[2]);
    }
    ctx.orbit.target.copy(target);
    if (preset === 'front') ctx.camera.position.set(target.x, target.y + 1, target.z + 11);
    else if (preset === 'right') ctx.camera.position.set(target.x + 11, target.y + 1, target.z);
    else if (preset === 'top') ctx.camera.position.set(target.x, target.y + 14, target.z + 0.01);
    else ctx.camera.position.set(target.x + 8, target.y + 6, target.z + 9);
    ctx.orbit.update();
  };

  return (
    <section
      id="viewport-3d-panel"
      className="relative flex-1 h-full bg-[#141619] overflow-hidden border-r border-[var(--border)]"
    >
      {viewportError && <p role="status" className="absolute inset-x-4 top-1/2 text-center text-[var(--text-secondary)]">{viewportError}</p>}
      {/* Top Viewport HUD Overlay */}
      <div className="meshforge-viewport-hud absolute top-2 left-2 right-2 z-10 flex items-center justify-between pointer-events-none">
        <div className="flex items-center gap-1.5 pointer-events-auto">
          {/* Interaction Mode Switcher (Blender 1/2/3/Tab) */}
          <div className="flex items-center bg-[var(--surface)]/95 border border-[var(--border)] rounded-md p-0.5 text-[11px]">
            {(
              [
                { id: 'object', label: 'Object', key: '4' },
                { id: 'vertex', label: 'Vertex', key: '1' },
                { id: 'edge', label: 'Edge', key: '2' },
                { id: 'face', label: 'Face', key: '3' },
              ] as const
            ).map((m) => (
              <button
                key={m.id}
                onClick={() => useEditorStore.getState().setMode(m.id)}
                className={`px-2 py-1 rounded font-medium transition-colors ${
                  mode === m.id
                    ? 'bg-[var(--mesh-accent-fill)] text-white'
                    : 'text-[var(--text-secondary)] hover:text-white hover:bg-[var(--surface-hover)]'
                }`}
                title={`${m.label} Mode (${m.key})`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {/* Snap & Reference Toggles */}
          <div className="flex items-center bg-[var(--surface)]/95 border border-[var(--border)] rounded-md p-0.5 text-[11px]">
            <button
              onClick={() => useEditorStore.getState().toggleFlag('snapEnabled')}
              className={`px-2 py-1 rounded font-mono ${
                snapEnabled ? 'bg-[var(--surface-hover)] text-[var(--accent)]' : 'text-[var(--text-secondary)]'
              }`}
              title="Snap to Roblox Stud increments"
            >
              Snap:{sceneDoc.gridSnapStuds}st
            </button>
            <button
              onClick={() => useEditorStore.getState().toggleFlag('showGrid')}
              className={`px-2 py-1 rounded ${
                showGrid ? 'text-[var(--text-primary)] bg-[var(--surface-hover)]' : 'text-[var(--text-muted)]'
              }`}
            >
              Grid
            </button>
            <button
              onClick={() => useEditorStore.getState().toggleFlag('showRobloxAvatarScale')}
              className={`px-2 py-1 rounded ${
                showRobloxAvatarScale ? 'bg-[#173326] text-[#34d399]' : 'text-[var(--text-secondary)] hover:text-white'
              }`}
              title="Toggle R15 Roblox Avatar Scale Rig (5 Studs tall)"
            >
              R15 Rig
            </button>
          </div>
        </div>

        {/* Right HUD: Shading + Camera Views */}
        <div className="flex items-center gap-1.5 pointer-events-auto">
          <div className="flex items-center bg-[var(--surface)]/95 border border-[var(--border)] rounded-md p-0.5 text-[11px]">
            {(['wireframe', 'solid', 'material'] as const).map((sh) => (
              <button
                key={sh}
                onClick={() => useEditorStore.getState().setShading(sh)}
                className={`px-2 py-1 rounded capitalize ${
                  shading === sh
                    ? 'bg-[var(--surface-hover)] text-white font-medium'
                    : 'text-[var(--text-secondary)] hover:text-white'
                }`}
              >
                {sh}
              </button>
            ))}
            <button
              onClick={() => useEditorStore.getState().toggleFlag('showWireframeOverlay')}
              className={`px-2 py-1 rounded border-l border-[var(--border)] ml-0.5 ${
                showWireframeOverlay ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'
              }`}
              title="Overlay Quad/N-gon Topology Wireframe"
            >
              Edges
            </button>
          </div>

          <div className="hidden xl:flex items-center bg-[var(--surface)]/95 border border-[var(--border)] rounded-md p-0.5 text-[11px] font-mono">
            {(['front', 'right', 'top', 'iso', 'focus'] as const).map((cam) => (
              <button
                key={cam}
                onClick={() => setCameraPreset(cam)}
                className="px-1.5 py-1 text-[var(--text-secondary)] hover:text-white hover:bg-[var(--surface-hover)] rounded uppercase"
              >
                {cam}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom-Left Viewport Telemetry Overlay */}
      <div className="absolute bottom-2 left-2.5 z-10 pointer-events-none flex items-center gap-2 text-[11px] font-mono text-[var(--text-muted)] bg-[#141619]/85 px-2 py-0.5 rounded-md border border-[var(--border)]">
        <span>Unit: 1 Stud (0.28m)</span>
        <span>|</span>
        <span>Up: {sceneDoc.upAxis}</span>
        {webgpuAvailable && <span className="text-[#34d399]">| WebGPU Ready</span>}
        {hoverInfo && (
          <>
            <span>|</span>
            <span className="text-[#f59e0b]">{hoverInfo}</span>
          </>
        )}
      </div>

      {/* WebGL2 Canvas Mount */}
      <div
        ref={containerRef}
        onPointerDown={handlePointerDown}
        className="w-full h-full cursor-crosshair"
      />
    </section>
  );
};
