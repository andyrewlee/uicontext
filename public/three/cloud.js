import * as THREE from 'three/webgpu';
import { float, vec3, vec4, If, Break, Fn, smoothstep, texture3D, uniform } from 'three/tsl';
import { RaymarchingBox } from 'three/addons/tsl/utils/Raymarching.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';

const existingApp = window.__THREE_CLOUD_APP__;
if (existingApp && typeof existingApp.dispose === 'function') {
  existingApp.dispose();
}

function init() {
  let renderer;
  try {
    renderer = new THREE.WebGPURenderer({ antialias: true });
  } catch (err) {
    console.error('WebGPU renderer failed to start', err);
    const info = document.getElementById('info');
    if (info) {
      const warning = document.createElement('p');
      warning.textContent = 'WebGPU is not available in this browser.';
      warning.style.marginLeft = 'auto';
      warning.style.fontSize = '0.8rem';
      info.appendChild(warning);
    }
    return null;
  }

  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 0, 1.5);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false;

  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 32;

  const context = canvas.getContext('2d');
  if (!context) {
    console.error('Failed to create 2D context for sky gradient');
    renderer.dispose();
    return null;
  }

  const gradient = context.createLinearGradient(0, 0, 0, 32);
  gradient.addColorStop(0.0, '#014a84');
  gradient.addColorStop(0.5, '#0561a0');
  gradient.addColorStop(1.0, '#437ab6');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 1, 32);

  const skyMap = new THREE.CanvasTexture(canvas);
  skyMap.colorSpace = THREE.SRGBColorSpace;

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(10),
    new THREE.MeshBasicNodeMaterial({ map: skyMap, side: THREE.BackSide })
  );
  scene.add(sky);

  const size = 128;
  const data = new Uint8Array(size * size * size);
  const scale = 0.05;
  const perlin = new ImprovedNoise();
  const vector = new THREE.Vector3();
  let i = 0;

  for (let z = 0; z < size; z += 1) {
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const d = 1.0 - vector.set(x, y, z).subScalar(size / 2).divideScalar(size).length();
        data[i] = (128 + 128 * perlin.noise((x * scale) / 1.5, y * scale, (z * scale) / 1.5)) * d * d;
        i += 1;
      }
    }
  }

  const texture = new THREE.Data3DTexture(data, size, size, size);
  texture.format = THREE.RedFormat;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;

  const transparentRaymarchingTexture = Fn(({ texture: tex, range = float(0.1), threshold = float(0.25), opacity = float(0.25), steps = float(100) }) => {
    const finalColor = vec4(0).toVar();

    RaymarchingBox(steps, ({ positionRay }) => {
      const mapValue = float(tex.sample(positionRay.add(0.5)).r).toVar();

      mapValue.assign(
        smoothstep(threshold.sub(range), threshold.add(range), mapValue).mul(opacity)
      );

      const shading = tex
        .sample(positionRay.add(vec3(-0.01)))
        .r.sub(tex.sample(positionRay.add(vec3(0.01))).r);

      const col = shading.mul(3.0).add(positionRay.x.add(positionRay.y).mul(0.25)).add(0.2);

      finalColor.rgb.addAssign(finalColor.a.oneMinus().mul(mapValue).mul(col));
      finalColor.a.addAssign(finalColor.a.oneMinus().mul(mapValue));

      If(finalColor.a.greaterThanEqual(0.95), () => {
        Break();
      });
    });

    return finalColor;
  });

  const baseColor = uniform(new THREE.Color(0x798aa0));
  const range = uniform(0.1);
  const threshold = uniform(0.25);
  const opacity = uniform(0.25);
  const steps = uniform(100);

  const cloud3d = transparentRaymarchingTexture({
    texture: texture3D(texture, null, 0),
    range,
    threshold,
    opacity,
    steps,
  });

  const finalCloud = cloud3d.setRGB(cloud3d.rgb.add(baseColor));

  const material = new THREE.NodeMaterial();
  material.colorNode = finalCloud;
  material.side = THREE.BackSide;
  material.transparent = true;

  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  scene.add(mesh);

  function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  function animate() {
    mesh.rotation.y = -performance.now() / 7500;
    renderer.render(scene, camera);
  }

  window.addEventListener('resize', onWindowResize);

  const dispose = () => {
    window.removeEventListener('resize', onWindowResize);
    renderer.setAnimationLoop(null);
    controls.dispose();
    mesh.geometry.dispose();
    material.dispose();
    texture.dispose();
    sky.geometry.dispose();
    sky.material.dispose();
    skyMap.dispose();
    renderer.dispose();
    if (renderer.domElement.parentElement) {
      renderer.domElement.parentElement.removeChild(renderer.domElement);
    }
  };

  renderer.setAnimationLoop(animate);

  return { dispose };
}

window.__THREE_CLOUD_APP__ = init();
