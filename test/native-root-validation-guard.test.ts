import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import test from "node:test";

test("native Root qualification client refuses every role outside its protected boundary before provisioning", async () => {
  const root=await mkdtemp(path.join(os.tmpdir(),"native-root-refusal-"));
  try{
    for(const role of ["--provision","--serve","--run"]){
      const result=spawnSync(process.execPath,[path.join(__dirname,"kidos-native-validation-harness.js"),role,root],
        {encoding:"utf8",timeout:15000,env:{...process.env,KIDOS_NATIVE_ROOT_VALIDATION:"1"}});
      assert.notEqual(result.status,0);assert.match(result.stderr,/explicit temporary native Root validation/);
      assert.equal(result.stdout,"");assert.deepEqual(await readdir(root),[]);
    }
  }finally{await rm(root,{recursive:true,force:true});}
});
