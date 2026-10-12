import fs from 'node:fs/promises';
import path from 'node:path';
import { encodeVisibilityMeshCache, parseVisibilityGlb } from 'csdm/node/death-review/visibility-mesh';

// A separate Node process contains the temporary GLB and packed-map allocations.
async function bake() {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk.toString();
    if (Buffer.byteLength(input) > 16_384) throw new Error('Invalid visibility bake request');
  }
  const request = JSON.parse(input) as { inputGlb: string; outputCache: string };
  if (
    typeof request.inputGlb !== 'string' ||
    typeof request.outputCache !== 'string' ||
    !path.isAbsolute(request.inputGlb) ||
    !path.isAbsolute(request.outputCache) ||
    path.extname(request.inputGlb) !== '.glb' ||
    path.extname(request.outputCache) !== '.mesh' ||
    path.dirname(request.inputGlb) !== path.dirname(request.outputCache)
  )
    throw new Error('Invalid visibility bake paths');
  const stat = await fs.stat(request.inputGlb);
  if (!stat.isFile() || stat.size > 512 * 1024 * 1024) throw new Error('Visibility GLB exceeds its size limit');
  const mesh = parseVisibilityGlb(await fs.readFile(request.inputGlb));
  if (mesh.hasAnimatedNodes) throw new Error('Animated world geometry is unsupported');
  await fs.writeFile(request.outputCache, encodeVisibilityMeshCache(mesh), { flag: 'wx' });
  process.stdout.write(JSON.stringify({ sourceAssetHash: mesh.sourceAssetHash, triangleCount: mesh.triangleCount }));
}

void bake().catch((error: unknown) => {
  process.stderr.write(error instanceof Error ? error.message : 'Visibility map bake failed');
  process.exitCode = 1;
});
