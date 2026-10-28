/**
 * node:fs / path / url / module / http / net / child_process in the browser bundle. Only imported transitively (e.g.
 * lib/env.ts reads .env files); nothing on the browser path calls them, and if something did it fails loudly.
 */
const stub = (name: string) => (..._args: unknown[]): never => {
  throw new Error(`${name} is not available in the browser spike bundle`);
};
export const existsSync = stub('fs.existsSync');
export const readFileSync = stub('fs.readFileSync');
export const writeFileSync = stub('fs.writeFileSync');
export const mkdirSync = stub('fs.mkdirSync');
export const appendFileSync = stub('fs.appendFileSync');
export const copyFileSync = stub('fs.copyFileSync');
export const readdirSync = stub('fs.readdirSync');
export const statSync = stub('fs.statSync');
export const rmSync = stub('fs.rmSync');
export const join = stub('path.join');
export const dirname = stub('path.dirname');
export const resolve = stub('path.resolve');
export const basename = stub('path.basename');
export const relative = stub('path.relative');
export const fileURLToPath = stub('url.fileURLToPath');
export const pathToFileURL = stub('url.pathToFileURL');
export const createRequire = stub('module.createRequire');
export const createServer = stub('http.createServer');
export const createConnection = stub('net.createConnection');
export const spawn = stub('child_process.spawn');
export const execFile = stub('child_process.execFile');
export default {};
