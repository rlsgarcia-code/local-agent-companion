import { parentPort, workerData } from "node:worker_threads";
import { processGameMedia } from "./process";
import { initializeVectorRasterizer } from "./rasterizer";

async function main() {try {
  const files=new Map<string,Buffer>((workerData.files as {path:string;data:Uint8Array}[]).map((file)=>[file.path,Buffer.from(file.data)]));
  const rasterize=workerData.operation?.type==="image.vector"&&workerData.operation.output?.endsWith(".png")
    ?await initializeVectorRasterizer(workerData.rasterizer):undefined;
  const result=processGameMedia(workerData.operation,files,rasterize);
  parentPort!.postMessage({ok:true,result});
} catch(error) {parentPort!.postMessage({ok:false,error:(error instanceof Error?error.message:"Asset processing failed").slice(0,2000)});}
parentPort!.close();
}
void main();
