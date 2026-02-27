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

console.log('visitorData:', visitorData);
console.log('poToken:', result.poToken);

console.log('Injecting into Lavalink...');
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
  console.log('PoToken injected into Lavalink successfully');
} else {
  console.error('Failed to inject PoToken. Status:', resp.status);
  const text = await resp.text();
  console.error('Response:', text);
  process.exit(1);
}
