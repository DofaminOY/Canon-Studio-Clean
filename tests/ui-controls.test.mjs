import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

function mockElement(id, value = '') {
  const classes = new Set();
  const handlers = new Map();
  const attributes = new Map();
  return {
    id, value, disabled: false, textContent: '', style: {}, dataset: {},
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
      toggle(name, active) {
        if (active === undefined) active = !classes.has(name);
        active ? classes.add(name) : classes.delete(name);
        return active;
      },
    },
    addEventListener(type, fn) { handlers.set(type, fn); },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.get(name); },
    replaceChildren() {}, append() {},
    fire(type) { const fn = handlers.get(type); assert.ok(fn, `${id}: handler ${type}`); fn({ target: this }); },
  };
}

test('quality/speed are one control; all segments and manual tone selection stay in sync', async () => {
  const elements = new Map();
  const values = { printer: 'Canon TS5350i series', copies: '1', paper: 'A4', scale: 'fit', duplex: 'simplex', pageFilter: 'all' };
  const get = (id) => {
    if (!elements.has(id)) elements.set(id, mockElement(id, values[id] || ''));
    return elements.get(id);
  };
  const groups = {};
  for (const [name, names] of Object.entries({ colors: ['monochrome', 'color'], qualities: ['draft', 'standard', 'high'], presets: ['economy', 'normal', 'rich'] })) {
    groups[`#${name} button`] = names.map((value) => {
      const element = mockElement(`${name}-${value}`);
      element.dataset.value = value;
      return element;
    });
  }
  globalThis.location = { hostname: 'sample.invalid' }; // Browser-only mode; no network requests.
  globalThis.document = {
    getElementById: get,
    createElement: (tag) => mockElement(tag),
    querySelector: () => ({ value: 'all', checked: true }),
    querySelectorAll: (selector) => groups[selector] || [],
  };
  globalThis.Option = class { constructor(label, value) { this.label = label; this.value = value; } };
  await import('../public/assets/js/app.js');
  const { state } = await import('../public/assets/js/state.js');
  assert.equal(state.settings.quality, 'standard');
  assert.equal('speed' in state.settings, false);
  const chosen = (group) => groups[`#${group} button`].filter((b) => b.classList.contains('selected'));
  assert.deepEqual(chosen('qualities').map((b) => b.dataset.value), ['standard']);
  groups['#qualities button'][2].fire('click');
  assert.equal(state.settings.quality, 'high');
  assert.deepEqual(chosen('qualities').map((b) => b.dataset.value), ['high']);
  assert.equal(groups['#qualities button'][2].getAttribute('aria-pressed'), 'true');
  assert.equal(groups['#qualities button'][1].getAttribute('aria-pressed'), 'false');
  groups['#colors button'][1].fire('click');
  assert.equal(state.settings.color, 'color');
  assert.deepEqual(chosen('colors').map((b) => b.dataset.value), ['color']);
  groups['#presets button'][2].fire('click');
  assert.deepEqual([state.settings.preset, state.settings.density, state.settings.contrast], ['rich', 25, 0]);
  get('contrast').value = '15';
  get('contrast').fire('input');
  assert.equal(state.settings.preset, null);
  assert.equal(chosen('presets').length, 0);
  assert.match(get('profileMode').textContent, /Настроено вручную/);
  groups['#presets button'][1].fire('click');
  assert.deepEqual([state.settings.preset, state.settings.density, state.settings.contrast], ['normal', 0, 0]);
  assert.deepEqual(chosen('presets').map((b) => b.dataset.value), ['normal']);
});

test('HTML contains no duplicate speed selector and styles support selected, hover and keyboard states', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const css = await readFile('public/assets/css/main.css', 'utf8');
  assert.doesNotMatch(html, /id="speeds"/);
  assert.match(html, /id="qualities"/);
  assert.match(html, /id="profileMode"/);
  assert.match(css, /\.seg button\.selected::after/);
  assert.match(css, /\.page-choice:has\(input:checked\)/);
  assert.match(css, /\.page-choice:has\(input:focus-visible\)/);
});
