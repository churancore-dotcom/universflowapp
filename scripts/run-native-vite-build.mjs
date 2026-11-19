// Runs the native vite build and exits once prerendering reports completion.
// Something left open after prerender keeps the process alive forever, which
// stalled CI until GitHub cancelled the job. Output is complete at that point.
import { spawn } from "node:child_process";

const child = spawn("npx", ["vite", "build"], {
  env: { ...process.env, NATIVE_BUILD: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
let done = false;
const watch = (stream, out) =>
  stream.on("data", (chunk) => {
    out.write(chunk);
    if (!done && chunk.toString().includes("[/lovable-prerender-report]")) {
      done = true;
      setTimeout(() => { child.kill("SIGTERM"); process.exit(0); }, 3000);
    }
  });
watch(child.stdout, process.stdout);
watch(child.stderr, process.stderr);
child.on("exit", (code) => { if (!done) process.exit(code ?? 1); });
setTimeout(() => { console.error("native build timed out"); child.kill("SIGKILL"); process.exit(1); }, 15 * 60 * 1000).unref();
