import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const script = fs.readFileSync(new URL('../public/home-portal-v1.js', import.meta.url), 'utf8');
assert.equal(script, fs.readFileSync(new URL('../../home-portal-v1.js', import.meta.url), 'utf8'));

function fixture(hash = '#standardized-mortality', mounted = true) {
  let clock = 0;
  const timers = [], listeners = new Map(), links = new Map();
  const body = {}, html = {};
  const document = {body, documentElement: html, activeElement: body,
    getElementById: id => links.get(id) || (mounted && sections.get(id)) || null,
    querySelectorAll: () => []};
  const section = id => ({id, visits: 0, classList: {add() {}, remove() {}},
    scrollIntoView() { this.visits++; }, focus() { document.activeElement = this; }});
  const sections = new Map(['standardized-mortality', 'population-pyramid'].map(id => [id, section(id)]));
  for (const id of ['portal-population-link', 'portal-population-page-link', 'portal-smr-link']) {
    links.set(id, {href: '', addEventListener(type, callback) { this[type] = callback; }});
  }
  const location = {hash, pathname: '/', search: '?area=05201', href: 'https://municipal-smr.jp/?area=05201' + hash};
  const context = {document, location, URL, URLSearchParams,
    history: {pushState() {}}, matchMedia: () => ({matches: true}),
    addEventListener(type, callback) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(callback); },
    requestAnimationFrame(callback) { callback(); },
    setTimeout(callback, delay) { timers.push({callback, at: clock + delay}); },
    setInterval() { throw new Error('Unexpected unresolved explicit navigation'); }, clearInterval() {}};
  vm.runInNewContext(script, context);
  function advance(until) {
    while (timers.some(timer => timer.at <= until)) {
      timers.sort((a, b) => a.at - b.at);
      const timer = timers.shift(); clock = timer.at; timer.callback();
    }
    clock = until;
  }
  return {document, sections, location, advance, mount() { mounted = true; },
    interact(type) { for (const callback of listeners.get(type) || []) callback({isTrusted: true}); },
    click(id) { const link = links.get(id); link.click({currentTarget: link, preventDefault() {}}); }};
}

for (const hash of ['#standardized-mortality', '#population-pyramid']) {
  const f = fixture(hash, false);
  f.advance(100); assert.equal(f.sections.get(hash.slice(1)).visits, 0);
  f.mount(); f.advance(4500);
  assert.equal(f.document.activeElement, f.sections.get(hash.slice(1)), 'lazy deep link still arrives');
  assert.equal(f.sections.get(hash.slice(1)).visits, 5, 'retains delayed positioning before interaction');
}
for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
  const f = fixture(); f.advance(0);
  const checkbox = {checked: false}; f.document.activeElement = checkbox;
  f.interact(type);
  for (const time of [1500, 2900, 4600]) {
    checkbox.checked = !checkbox.checked;
    f.advance(time);
    assert.equal(f.document.activeElement, checkbox, 'initial timer stole focus after ' + type);
  }
  assert(checkbox.checked);
  assert.equal(f.sections.get('standardized-mortality').visits, 1);
  f.click('portal-population-link');
  assert.equal(f.document.activeElement, f.sections.get('population-pyramid'), 'explicit navigation remains available');
}
{
  const f = fixture(); f.advance(0);
  const control = {}; f.document.activeElement = control;
  f.advance(5000); assert.equal(f.document.activeElement, control, 'respects focus even without an input event');
}
{
  const f = fixture(); f.advance(0); f.location.hash = '#population-pyramid'; f.advance(5000);
  assert.equal(f.sections.get('standardized-mortality').visits, 1);
  assert.equal(f.sections.get('population-pyramid').visits, 0, 'initial retries cannot follow a later hash');
}
console.log('Home portal initial focus: 8 deterministic late-timer and interaction cases passed.');
