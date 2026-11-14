// 통합 테스트 실행기: 개발 서버를 빈 포트에 띄우고 tests/e2e/*.test.cjs 를 차례로 돌린 뒤 서버를 끈다.
// 특정 파일만: npm run test:e2e -- table
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';

const here = import.meta.dirname;
const root = resolve(here, '..', '..');

const freePort = () => new Promise((ok, fail) => {
  const s = createServer();
  s.once('error', fail);
  s.listen(0, () => { const { port } = s.address(); s.close(() => ok(port)); });
});

const port = await freePort();
const server = spawn(process.execPath, [join(root, 'scripts', 'serve.mjs')], {
  env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((ok, fail) => {
  server.stdout.once('data', ok);
  server.once('exit', (code) => fail(new Error(`서버가 시작되지 않았습니다(종료 코드 ${code})`)));
});

const only = process.argv.slice(2);
const files = readdirSync(here)
  .filter((f) => f.endsWith('.test.cjs'))
  .filter((f) => !only.length || only.some((o) => f.includes(o)))
  .sort();

let failed = 0;
for (const file of files) {
  console.log(`\n── ${file}`);
  const code = await new Promise((ok) => {
    spawn(process.execPath, [join(here, file)], {
      env: { ...process.env, BASE: `http://localhost:${port}/` }, stdio: 'inherit',
    }).once('exit', ok);
  });
  if (code !== 0) failed++;
}
server.kill();
console.log(`\n통합 테스트 ${files.length - failed}/${files.length} 통과`);
process.exit(failed ? 1 : 0);
