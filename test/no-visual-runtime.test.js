import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('local automation runner has no screenshot or fixed-coordinate UI fallback', async () => {
  const source = await readFile(new URL('../scripts/run-world-explorer.js', import.meta.url), 'utf8');
  for (const forbidden of [
    'capture-map-view.ps1',
    'click-pokemmo-window.ps1',
    'send-catch-ui.ps1',
    'visual_map_frame_captured',
    'battle_ui_fallback',
  ]) {
    assert.equal(source.includes(forbidden), false, `runner must not contain ${forbidden}`);
  }
});
