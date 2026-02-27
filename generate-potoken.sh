#!/bin/sh
# Run this in Koyeb console to generate a PoToken from the datacenter IP
# and inject it into the running Lavalink instance via REST API.
#
# Usage: sh /app/generate-potoken.sh

echo "=== PoToken Generator for Koyeb ==="
echo "Installing dependencies..."

cd /tmp
mkdir -p potoken-gen && cd potoken-gen

cat > package.json << 'PKGJSON'
{ "name": "potoken-gen", "type": "module", "dependencies": { "bgutils-js": "^3.2.0", "youtubei.js": "^13.0.0", "jsdom": "^25.0.0" } }
PKGJSON

npm install --no-audit --no-fund 2>&1 | tail -3

cat > gen.mjs << 'SCRIPT'
import { BG } from 'bgutils-js';
import { Innertube } from 'youtubei.js';
import { JSDOM } from 'jsdom';

const requestKey = 'O43z0dpjhgX20SCx4KAo';

console.log('Creating Innertube session...');
const innertube = await Innertube.create({ retrieve_player: false });
const visitorData = innertube.session.context.client.visitorData;
if (!visitorData) throw new Error('Could not get visitor data');
console.log('Got visitorData');

const dom = new JSDOM();
Object.assign(globalThis, { window: dom.window, document: dom.window.document });

console.log('Getting BotGuard challenge...');
const bgConfig = {
  fetch: (input, init) => fetch(input, init),
  globalObj: globalThis,
  identifier: visitorData,
  requestKey
};

const bgChallenge = await BG.Challenge.create(bgConfig);
if (!bgChallenge) throw new Error('Could not get challenge');

const js = bgChallenge.interpreterJavascript.privateDoNotAccessOrElseSafeScriptWrappedValue;
if (js) { new Function(js)(); } else throw new Error('Could not load VM');

console.log('Generating PoToken...');
const result = await BG.PoToken.generate({
  program: bgChallenge.program,
  globalName: bgChallenge.globalName,
  bgConfig
});

console.log('\n=== Generated Tokens ===');
console.log('visitorData:', visitorData);
console.log('poToken:', result.poToken);

// Inject into running Lavalink via REST API
console.log('\nInjecting into Lavalink...');
const resp = await fetch('http://localhost:2333/youtube', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'remani-lavalink'
  },
  body: JSON.stringify({
    poToken: result.poToken,
    visitorData: visitorData
  })
});

if (resp.status === 204) {
  console.log('SUCCESS! PoToken injected into Lavalink.');
  console.log('Try playing a song now with /play');
} else {
  console.log('Failed to inject. Status:', resp.status);
  const text = await resp.text();
  console.log('Response:', text);
  console.log('\nManual injection: paste these values into application.yml under plugins.youtube.pot:');
  console.log('  token:', JSON.stringify(result.poToken));
  console.log('  visitorData:', JSON.stringify(visitorData));
}

process.exit(0);
SCRIPT

echo "Running PoToken generator (this may take 30-60 seconds)..."
node --max-old-space-size=512 gen.mjs
