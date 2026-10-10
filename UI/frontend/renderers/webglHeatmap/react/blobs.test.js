import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./blobs.js', import.meta.url), 'utf8');

describe('webglHeatmap texture setup', () => {
  it('clamps both texture axes so non-power-of-two canvases stay complete', () => {
    expect(source).toContain(
      'gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);',
    );
    expect(source).toContain(
      'gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);',
    );
  });
});
