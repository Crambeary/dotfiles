// node tests/herdr/forge-pin-refresh.mjs
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {resolve} from 'node:path';
const base='private_dot_config/herdr-app/mods/omarchy-forge-sidebar/';
const data=s=>'data:text/javascript,'+encodeURIComponent(s);
const pinsURL=data(await readFile(base+'pins.js','utf8'));
const pins=await import(pinsURL);
const refresh=await import(data((await readFile(base+'pin-refresh.js','utf8')).replace('./pins.js',pinsURL)));
const contextURL=data(await readFile(base+'context.js','utf8'));
const {BACKEND_VERSION}=await import(contextURL);
const {pinReadArgs,parsePinReply}=await import(data((await readFile(base+'pin-reader.js','utf8')).replace('./context.js',contextURL)));
const {PinSchedule,reserve,release,cadence,statusFresh}=refresh;
const project={on:'remote',provider:'gitlab',host:'git.example.com',repo:'team/app'};
const row=(id,status='running')=>({id,status,url:'https://git.example.com/team/app/-/pipelines/'+id});
let raw; for(let id=1;id<=5;id++) raw=pins.togglePin(raw,project,row(id),new Map(),id);
const schedule=new PinSchedule(); schedule.sync(raw);
const pool={starts:[],busy:null};
let time=1000000; const picked=[];
// More demand than budget: every origin is eventually served despite active pins.
for(let minute=0;minute<5;minute++) {
  const token=reserve(pool,time,2); assert.ok(token);
  const pick=schedule.pick(time); picked.push(pick.ref.id);
  schedule.finish(pick,{row:row(pick.ref.id)},time); release(pool,token);
  // Ongoing local enrichment consumes the other half of the shared budget.
  for(let i=0;i<2;i++) {const local=reserve(pool,time,1);assert.ok(local);release(pool,local);}
  assert.equal(reserve(pool,time,1),null);
  time+=60001;
}
assert.equal(new Set(picked).size,5,'due ordering prevents starvation across pins under local job demand');
assert.equal(cadence(row(1)),60000); assert.equal(cadence(row(1,'success')),300000);
const staleToken=reserve(pool,time,1); assert.ok(staleToken);
assert.equal(reserve(pool,time+1000,1),null,'global mutex serializes pin/local/copy work');
const takeover=reserve(pool,time+71000,1);assert.ok(takeover,'abandoned owner expires after hot reload');
release(pool,staleToken);assert.equal(pool.busy,takeover,'old owner cannot unlock new owner');release(pool,takeover);
const backoffSchedule=new PinSchedule();backoffSchedule.sync(pins.togglePin(undefined,project,row(9)));
let pick=backoffSchedule.pick(time);
backoffSchedule.finish(pick,{error:'offline'},time);
assert.equal(backoffSchedule.pick(time+59999),null);
pick=backoffSchedule.pick(time+60000);assert.ok(pick);
backoffSchedule.finish(pick,{error:'offline'},time+60000);
assert.equal(backoffSchedule.pick(time+179999),null);
assert.ok(backoffSchedule.pick(time+180000),'successive failures double retry delay');
const race=new PinSchedule();race.sync(raw);pick=race.pick(time);race.hide();assert.equal(race.accepts(pick),false);
assert.equal(statusFresh({row:row(1),at:time-100000},time),false);
assert.equal(statusFresh({row:row(1,'success'),at:time-300000},time),true);
assert.equal(statusFresh({row:row(1),at:time,error:'offline'},time),false);
// Execute the actual transported Python adapter against an independent, inert
// provider/cache oracle. There is no auth, network, live DB or user's pin state.
const run=promisify(execFile);
await run('/usr/bin/git',['check-ignore','-q','.scratch/']);
const home=resolve('.scratch/forge-pin-reader-oracle');await mkdir(home,{recursive:true});
const file=home+'/forge-'+BACKEND_VERSION+'.py';
const fixture=String.raw`import json,os
VERSION="VERSION_REPLACE"
SHAPES=2
if __name__ == "__main__": raise RuntimeError("must import, never invoke vendor main")
def ms(s): return 123000 if s else None
class API:
    def __init__(self,p):
        self.p=p; self.project="projects/team%2Fapp"; self.repo="repos/team/app"
    def api(self,path):
        with open(os.path.join(os.environ["HERDR_FORGE_HOME"],"calls.jsonl"),"a") as f: f.write(json.dumps(path)+"\\n")
        if path not in ("projects/team%2Fapp/pipelines/117853","repos/team/app/actions/runs/117853"):
            raise RuntimeError("unexpected endpoint: "+path)
        return {"id":117853,"iid":8872,"ref":"main","sha":"abc","status":os.environ.get("FIXTURE_STATUS","running"),"updated_at":"fake-time","web_url":"https://example/run/117853"}
    def run_out(self,r):
        return {"id":r["id"],"iid":r["iid"],"ref":r["ref"],"status":r["status"],"sha":r["sha"],"updated_ms":123000,"url":r["web_url"]}
class Project:
    def __init__(self,provider,host,repo): self.forge=API(self)
    def cached(self,key,age,fetch,default):
        assert key=="sidebar-pin-v1:117853",key
        return fetch(),123,os.environ.get("FIXTURE_ERROR")
    def jobs(self,pid,age,force):
        assert pid==117853 and force is False
        return {"jobs":[{"status":"success","group":"build"}],"at":122,"error":None}
`.replace('VERSION_REPLACE',BACKEND_VERSION);
await writeFile(file,fixture);
const python=process.env.SIDEBAR_TEST_PYTHON||'python3';
const env={PATH:'/usr/bin:/bin',HERDR_FORGE_HOME:home};
for(const provider of ['gitlab','github']) {
  for(const status of ['running','failed','success']) {
    const origin={...project,provider};
    const out=await run(python,pinReadArgs(origin,117853,60),{env:{...env,FIXTURE_STATUS:status}});
    const observed=parsePinReply({code:0,stdout:out.stdout},117853);
    assert.equal(observed.row.status,status,'exact run state comes from detail even if outside recent 20');
    assert.equal(observed.row.iid,8872);assert.equal(observed.at,123000);
  }
}
const jobResult=await run(python,pinReadArgs(project,117853,300,'jobs'),{env});
assert.deepEqual(parsePinReply({code:0,stdout:jobResult.stdout},117853,'jobs'),{jobs:[{status:'success',group:'build'}],at:122000,error:null});
const errorResult=await run(python,pinReadArgs(project,117853,60),{env:{...env,FIXTURE_ERROR:'offline, cached'}});
assert.equal(parsePinReply({code:0,stdout:errorResult.stdout},117853).error,'offline, cached');
assert.equal(parsePinReply({code:0,stdout:errorResult.stdout},117853).at,123000,'error does not advance original timestamp');
const endpoints=(await readFile(home+'/calls.jsonl','utf8')).trim().split('\\n').filter(Boolean).map(JSON.parse);
assert.ok(endpoints.includes('projects/team%2Fapp/pipelines/117853'));
assert.ok(endpoints.includes('repos/team/app/actions/runs/117853'));
assert.equal(endpoints.some(p=>p.includes('?per_page=20')),false);
await writeFile(file,fixture.replace('SHAPES=2','SHAPES=999'));
const incompatible=await run(python,pinReadArgs(project,117853),{env});
assert.throws(()=>parsePinReply({code:0,stdout:incompatible.stdout},117853),/Incompatible/);
const absent=await run(python,pinReadArgs(project,117853),{env:{...env,HERDR_FORGE_HOME:home+'/absent'}});
assert.throws(()=>parsePinReply({code:0,stdout:absent.stdout},117853),/missing on origin/);
assert.throws(()=>pinReadArgs(project,'117853;bad'),/Invalid/);
assert.throws(()=>pinReadArgs(project,117853,60,'pipeline-act'),/Invalid/);
console.log('PASS pinned read adapter exact-ID GitLab/GitHub, version/missing backend, honest timestamps, shared budget/lease, fairness and backoff');
