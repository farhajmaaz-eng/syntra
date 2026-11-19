import * as THREE from 'three';
import { ProceduralTextureSpec } from '../../shared/sceneSchema';

const textureCache = new Map<string, { texture: THREE.CanvasTexture; users: number }>();
const textureKeys = new WeakMap<THREE.Texture, string>();

export function releaseProceduralCanvasTexture(texture: THREE.Texture | null) {
  if (!texture) return;
  const key = textureKeys.get(texture);
  if (!key) return;
  const entry = textureCache.get(key);
  if (!entry || --entry.users > 0) return;
  texture.dispose();
  textureCache.delete(key);
  textureKeys.delete(texture);
}

export function getProceduralCanvasTexture(
  baseHex: string,
  spec: ProceduralTextureSpec
): THREE.CanvasTexture | null {
  if (!spec || spec.pattern === 'none' || typeof document === 'undefined') {
    return null;
  }

  const key = `${baseHex}_${spec.pattern}_${spec.scaleU}_${spec.scaleV}_${spec.secondaryColor}`;
  const cached = textureCache.get(key);
  if (cached) {
    cached.users++;
    return cached.texture;
  }

  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, size, size);

  const sec = spec.secondaryColor || '#374151';

  if (spec.pattern === 'studs') {
    // Classic Roblox Stud tile pattern
    const cells = 4;
    const step = size / cells;
    for (let y = 0; y < cells; y++) {
      for (let x = 0; x < cells; x++) {
        const cx = x * step + step * 0.5;
        const cy = y * step + step * 0.5;
        ctx.strokeStyle = 'rgba(0,0,0,0.22)';
        ctx.lineWidth = 2;
        ctx.strokeRect(x * step + 1, y * step + 1, step - 2, step - 2);

        // Raised circular stud shadow + highlight
        ctx.beginPath();
        ctx.arc(cx + 1.5, cy + 1.5, step * 0.24, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.fill();

        ctx.beginPath();
        ctx.arc(cx, cy, step * 0.24, 0, Math.PI * 2);
        ctx.fillStyle = baseHex;
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
  } else if (spec.pattern === 'checker') {
    const cells = 8;
    const step = size / cells;
    ctx.fillStyle = sec;
    for (let y = 0; y < cells; y++) {
      for (let x = 0; x < cells; x++) {
        if ((x + y) % 2 === 1) {
          ctx.fillRect(x * step, y * step, step, step);
        }
      }
    }
  } else if (spec.pattern === 'grid') {
    const cells = 8;
    const step = size / cells;
    ctx.strokeStyle = sec;
    ctx.lineWidth = 2;
    for (let i = 0; i <= cells; i++) {
      const p = i * step;
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, size);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, p);
      ctx.lineTo(size, p);
      ctx.stroke();
    }
  } else if (spec.pattern === 'brushed_metal') {
    for (let y = 0; y < size; y += 2) {
      const v = Math.floor((Math.sin(y * 12.9898) * 0.5 + 0.5) * 32);
      ctx.fillStyle = y % 4 === 0 ? `rgba(255,255,255,${v / 420})` : `rgba(0,0,0,${v / 420})`;
      ctx.fillRect(0, y, size, 1);
    }
  } else if (spec.pattern === 'noise') {
    const img = ctx.getImageData(0, 0, size, size);
    const data = img.data;
    for (let i = 0; i < data.length; i += 4) {
      const n = ((Math.sin(i * 12.9898) * 43758.5453) % 1) * 26 - 13;
      data[i] = Math.max(0, Math.min(255, data[i] + n));
      data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + n));
      data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + n));
    }
    ctx.putImageData(img, 0, 0);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(spec.scaleU || 1, spec.scaleV || 1);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  textureCache.set(key, { texture: tex, users: 1 });
  textureKeys.set(tex, key);
  return tex;
}
