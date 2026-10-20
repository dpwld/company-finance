import { build } from "esbuild";
import { mkdir,rm } from "node:fs/promises";
await mkdir(".test-build",{recursive:true});try{await build({entryPoints:["tests/integration.ts"],outfile:".test-build/integration.mjs",bundle:true,platform:"node",format:"esm",packages:"external"});await import(new URL("../.test-build/integration.mjs",import.meta.url));}finally{await rm(".test-build",{recursive:true,force:true});}
