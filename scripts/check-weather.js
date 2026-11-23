// Lightweight offline checks. Run with: node scripts/check-weather.js
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const dashboard = fs.readFileSync('weather/index.html', 'utf8');
const updater = fs.readFileSync('scripts/update-weather.js', 'utf8');
const data = JSON.parse(fs.readFileSync('weather/weather-data.json', 'utf8'));

const scripts = [...dashboard.matchAll(/<script>([\s\S]*?)<\/script>/g)];
assert.equal(scripts.length, 1, 'Dashboard must contain one inline script');
new vm.Script(scripts[0][1], { filename: 'weather/index.html' });
new vm.Script(updater, { filename: 'scripts/update-weather.js' });

const ids = [...dashboard.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(ids).size, ids.length, 'HTML IDs must be unique');
assert.ok(!dashboard.includes("setText('statusMsg'"), 'No dangling status element');
assert.ok(dashboard.includes("timeformat: 'unixtime'"), 'Korea times must be UTC seconds');
assert.ok(dashboard.includes('new Date(Number(current.time) * 1000)'));
assert.ok(dashboard.includes('Daily Rain (forecast)'), 'Label forecast precipitation');
assert.ok(dashboard.includes('UV Max (forecast)'), 'Label forecast UV');
assert.ok(dashboard.includes('quality check not performed'), 'Show unverified data');
assert.ok(updater.includes('failedStations'), 'Preserve per-station failures');
assert.ok(updater.includes('successCount === 0'), 'Do not overwrite on total failure');

for (const id of ['KFLOVIED224', 'KMIMOUNT110']) {
  assert.ok(data.observations[id], 'Expected station in fixture: ' + id);
}

console.log('Weather dashboard syntax and structural checks passed.');
