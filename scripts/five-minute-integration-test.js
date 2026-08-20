import { appendFile, open, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { HumanMovementTiming } from '../src/navigation/human-movement.js';
import { parseWorldState } from '../src/navigation/world-state.js';

const root=path.resolve('.'),capture=path.join(root,'captures/decrypted-gameplay-session2.jsonl');
const log=path.join(root,`captures/five-minute-test-${Date.now()}.jsonl`);
const controlPort=37666,clientPid=19160,durationMs=300000;
let offset=(await stat(capture)).size,remainder='',stopped=false,battle=false,commandPending=false;
let encounters=0,battles=0,ballsThrown=0,caught=false,switchStage=0,switchTested=false,recoveryStarted=false,recoveryComplete=false;
let catchAttemptsThisBattle=0,ballsAtBattleStart=0;
let movementIndex=0,lastWorld=parseWorldState(await command('WORLD')),previousDirection=lastWorld.direction;
const directions=[3,3,2,2],timing=new HumanMovementTiming({walkCadenceMs:250,pauseEveryMin:16,pauseEveryMax:28});
const startedAt=Date.now();

async function write(event,details={}){const record={timestamp:new Date().toISOString(),event,...details};await appendFile(log,`${JSON.stringify(record)}\n`);process.stdout.write(`${JSON.stringify(record)}\n`);}
function command(line,timeoutMs=3000){return new Promise((resolve,reject)=>{const socket=net.createConnection({host:'127.0.0.1',port:controlPort});let text='';const timer=setTimeout(()=>socket.destroy(new Error(`timeout ${line}`)),timeoutMs);socket.setEncoding('utf8');socket.once('connect',()=>socket.write(`${line}\n`));socket.on('data',chunk=>{text+=chunk;const newline=text.indexOf('\n');if(newline<0)return;clearTimeout(timer);socket.end();const result=text.slice(0,newline).trim();result.startsWith('OK ')?resolve(result.slice(3)):reject(new Error(result));});socket.once('error',reject);});}
function runPowerShell(script,args=[]){return new Promise((resolve,reject)=>{const child=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts',script),...args],{cwd:root,windowsHide:true});let stdout='',stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);child.once('error',reject);child.once('close',code=>code===0?resolve(stdout.trim()):reject(new Error(`${script} exit=${code} ${stderr}`)));});}
function runNode(script,args=[]){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,[path.join(root,'scripts',script),...args],{cwd:root,windowsHide:true});let stdout='',stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);child.once('error',reject);child.once('close',code=>code===0?resolve(stdout.trim()):reject(new Error(`${script} exit=${code} ${stderr}`)));});}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function battleMove(moveId=52){const output=await runPowerShell('send-battle-move-packet.ps1',['-ProcessId',String(clientPid),'-MoveId',String(moveId)]);await write('battle_move',{moveId,output});}
async function switchParty(slot){const output=await runPowerShell('send-switch-action.ps1',['-ProcessId',String(clientPid),'-Slot',String(slot)]);await write('party_switch',{slot,output});}
async function throwBall(){const before=await command('INVENTORY');const output=await runPowerShell('send-catch-ui.ps1',['-ProcessId',String(clientPid)]);ballsThrown++;catchAttemptsThisBattle++;await write('catch_action',{output,ballsThrown,catchAttemptsThisBattle,before});}
function enemyHp(text){const match=/hp=(\d+)\s+maxHp=(\d+)/.exec(text);return match?{hp:Number(match[1]),maxHp:Number(match[2])}:null;}
function ballCount(text){const match=/(?:^|\|)5004:(\d+):/.exec(text);return match?Number(match[1]):0;}

async function takeTurn(){if(commandPending||!battle)return;commandPending=true;try{
  const identified=await command('IDENTIFY');const enemy=enemyHp(identified);await write('turn_state',{enemy:identified});
  if(!enemy||enemy.hp<=0)return;
  if(!caught){
    // A level-10 starter can one-shot the smallest Route 1 encounters. Only
    // designate a catch target with enough HP to survive one 40-power hit.
    if(enemy.hp===enemy.maxHp&&enemy.maxHp>=16){await battleMove(10);}
    else if(enemy.hp<enemy.maxHp&&catchAttemptsThisBattle<3){const inventory=await command('INVENTORY');if(!inventory.includes('5004:'))throw new Error('No Poke Ball stack');await throwBall();}
    else await battleMove(52);
  }
  else if(caught&&!switchTested&&switchStage===0){await switchParty(1);switchStage=1;}
  else if(caught&&!switchTested&&switchStage===1){await switchParty(0);switchStage=2;switchTested=true;}
  else await battleMove(52);
}catch(error){await write('turn_error',{message:error.message});}finally{commandPending=false;}}

async function handlePacket(packet){if(packet.type!=='plain_packet'||packet.direction!=='server_to_client')return;
  if(packet.opcode===48){battle=true;catchAttemptsThisBattle=0;ballsAtBattleStart=ballCount(await command('INVENTORY'));encounters++;await write('encounter',{encounters,ballsAtBattleStart});await delay(350);try{await write('enemy_identified',{enemy:await command('IDENTIFY')});}catch(error){await write('identify_error',{message:error.message});}}
  else if(packet.opcode===50){void takeTurn();}
  else if(packet.opcode===49){battle=false;battles++;const inventory=await command('INVENTORY');const catchSucceeded=catchAttemptsThisBattle>0&&ballCount(inventory)<ballsAtBattleStart;if(!caught&&catchSucceeded)caught=true;await write('battle_end',{battles,caught,catchSucceeded,catchAttemptsThisBattle,inventory});}
}
async function pollCapture(){const size=(await stat(capture)).size;if(size===offset)return;const length=size-offset,buffer=Buffer.alloc(length),file=await open(capture,'r');try{await file.read(buffer,0,length,offset);}finally{await file.close();}offset=size;const lines=(remainder+buffer.toString('utf8')).split(/\r?\n/);remainder=lines.pop()??'';for(const line of lines)if(line.trim())try{await handlePacket(JSON.parse(line));}catch(error){await write('packet_error',{message:error.message});}}

async function movementLoop(){while(!stopped){if(!battle&&!recoveryStarted){const direction=directions[movementIndex%directions.length];try{const response=await command(`MOVE ${direction}`);const world=parseWorldState(response.replace(/^MOVED\s+\d+\s+/,''));const advanced=world.map!==lastWorld.map||world.x!==lastWorld.x||world.y!==lastWorld.y;if(advanced)movementIndex++;await write('movement',{direction,advanced,map:world.map,x:world.x,y:world.y});lastWorld=world;await delay(timing.nextDelay({directionChanged:direction!==previousDirection,advanced}));previousDirection=direction;}catch(error){await write('movement_error',{message:error.message});await delay(300);}}else await delay(100);}}

async function centerRecovery(){if(recoveryStarted||battle)return;recoveryStarted=true;await write('center_trip_start');try{
  const graph=path.join(root,'captures/world-graph.json');
  const outbound=await runNode('navigate-to.js',['--graph',graph,'--map','0:5:4:303','--x','7','--y','5','--port',String(controlPort)]);await write('center_arrived',{output:outbound});
  const heal=await runPowerShell('send-client-key.ps1',['-ProcessId',String(clientPid),'-Key','A','-DurationMs','140','-Repeat','6','-BetweenMs','1900']);await write('heal_interaction',{output:heal});
  await delay(3500);
  const returned=await runNode('navigate-to.js',['--graph',graph,'--map','0:3:19:291','--x','14','--y','6','--port',String(controlPort)]);recoveryComplete=true;lastWorld=parseWorldState(await command('WORLD'));await write('center_trip_complete',{output:returned,world:lastWorld});
}catch(error){await write('center_trip_error',{message:error.message});recoveryStarted=false;}}

await write('test_started',{durationMs,world:lastWorld,inventory:await command('INVENTORY')});
const pollTimer=setInterval(()=>void pollCapture().catch(error=>write('poll_error',{message:error.message})),60);
void movementLoop();
const recoveryTimer=setInterval(()=>{if(Date.now()-startedAt>190000&&!recoveryStarted&&!battle)void centerRecovery();},500);
await delay(durationMs);
stopped=true;clearInterval(pollTimer);clearInterval(recoveryTimer);await pollCapture();
await write('test_complete',{elapsedMs:Date.now()-startedAt,encounters,battles,ballsThrown,caught,switchTested,recoveryComplete,world:await command('WORLD'),inventory:await command('INVENTORY')});
process.stdout.write(`LOG ${log}\n`);
