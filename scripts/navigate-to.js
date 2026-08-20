import { readFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { WorldGraph } from '../src/navigation/world-graph.js';
import { parseWorldState, tileKey } from '../src/navigation/world-state.js';
import { HumanMovementTiming } from '../src/navigation/human-movement.js';

function option(name, fallback) { const index=process.argv.indexOf(`--${name}`);return index>=0?process.argv[index+1]:fallback; }
const graphPath=path.resolve(option('graph','captures/world-graph.json'));
const port=Number(option('port','37666'));
const destination={map:option('map',''),x:Number(option('x','NaN')),y:Number(option('y','NaN'))};
const cadenceMs=Number(option('cadence-ms','250'));
if(!destination.map||!Number.isFinite(destination.x)||!Number.isFinite(destination.y))throw new Error('Use --map <key> --x <tile> --y <tile>');

function command(line,timeoutMs=2500){return new Promise((resolve,reject)=>{const socket=net.createConnection({host:'127.0.0.1',port});let response='';const timer=setTimeout(()=>socket.destroy(new Error(`Timeout: ${line}`)),timeoutMs);socket.setEncoding('utf8');socket.once('connect',()=>socket.write(`${line}\n`));socket.on('data',chunk=>{response+=chunk;const newline=response.indexOf('\n');if(newline<0)return;clearTimeout(timer);socket.end();const value=response.slice(0,newline).trim();if(value.startsWith('OK '))resolve(value.slice(3));else reject(new Error(value));});socket.once('error',reject);});}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const graph=new WorldGraph(JSON.parse(await readFile(graphPath,'utf8')));
const timing=new HumanMovementTiming({walkCadenceMs:cadenceMs});
let current=parseWorldState(await command('WORLD'));
const route=graph.route(current,destination);
if(!route)throw new Error(`No learned route from ${tileKey(current)} to ${tileKey(destination)}`);
process.stdout.write(`route steps=${route.length} from=${tileKey(current)} to=${tileKey(destination)}\n`);

let previousDirection=current.direction;
for(const step of route){
  if((await command('STATE'))==='BATTLE')throw new Error('Encounter interrupted navigation');
  let reached=false;
  for(let attempt=0;attempt<7;attempt++){
    const before=current;
    await command(`MOVE ${step.direction}`);
    await delay(timing.nextDelay({directionChanged:step.direction!==previousDirection,advanced:attempt>0?false:true}));
    current=parseWorldState(await command('WORLD'));
    if(current.map.endsWith(':-1')){await delay(1000);current=parseWorldState(await command('WORLD'));}
    if(tileKey(current)===step.to){reached=true;break;}
    if(step.type==='warp'&&current.map!==step.from.split('@')[0]){
      await delay(1200);current=parseWorldState(await command('WORLD'));
      if(tileKey(current)===step.to){reached=true;break;}
    }
    previousDirection=step.direction;
  }
  if(!reached)throw new Error(`Could not reach learned edge ${step.from} -> ${step.to}; now ${tileKey(current)}`);
  process.stdout.write(`${step.type} ${tileKey(current)}\n`);
}
process.stdout.write(`arrived ${JSON.stringify(current)}\n`);
