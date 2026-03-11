import { BG } from 'bgutils-js';
import { Innertube } from 'youtubei.js';
import { JSDOM } from 'jsdom';

const requestKey = 'O43z0dpjhgX20SCx4KAo';

console.error('Creating Innertube session...');
const innertube = await Innertube.create({ retrieve_player: false });
const visitorData = innertube.session.context.client.visitorData;
if (!visitorData) throw new Error('Could not get visitor data');
console.error('Got visitorData:', visitorData);

const dom = new JSDOM();
Object.assign(globalThis, { window: dom.window, document: dom.window.document });

console.error('Getting BotGuard challenge...');
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

console.error('Generating PoToken...');
const result = await BG.PoToken.generate({
  program: bgChallenge.program,
  globalName: bgChallenge.globalName,
  bgConfig
});

console.error('PoToken generated successfully!');

// Output JSON to stdout for consumption by bot
console.log(JSON.stringify({
  poToken: result.poToken,
  visitorData: visitorData
}));
