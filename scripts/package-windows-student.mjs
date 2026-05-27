import { execFileSync } from "node:child_process";
import {
  cpSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const releaseDir = resolve(root, "release");
const outDir = resolve(releaseDir, "windows-student");
const appDir = resolve(outDir, "app");
const nodeDir = resolve(outDir, "node");
const cacheDir = resolve(releaseDir, ".cache");
const zipPath = resolve(releaseDir, "windows-student.zip");
const ffmpegWinDir = resolve(cacheDir, "ffmpeg-static-win32-x64");
const nodeVersion = process.env.NODE_WINDOWS_VERSION || "20.18.1";
const nodeArchiveName = `node-v${nodeVersion}-win-x64.zip`;
const nodeArchivePath = resolve(cacheDir, nodeArchiveName);
const nodeDownloadUrl = `https://nodejs.org/dist/v${nodeVersion}/${nodeArchiveName}`;
const packageJson = JSON.parse(readText(resolve(root, "package.json")));
const ffmpegStaticVersion = packageJson.dependencies?.["ffmpeg-static"] || "^5.3.0";

run("npm", ["run", "build"]);

rmSync(outDir, { recursive: true, force: true });
rmSync(zipPath, { force: true });
mkdirSync(appDir, { recursive: true });
mkdirSync(cacheDir, { recursive: true });

cpSync(resolve(root, "dist"), resolve(appDir, "dist"), { recursive: true });
cpSync(resolve(root, "docs"), resolve(appDir, "docs"), { recursive: true });
cpSync(resolve(root, ".env.example"), resolve(appDir, ".env.example"));

bundleServer();
await ensureWindowsNode();
ensureWindowsFfmpeg();
writeStudentFiles();
makeZip();

console.log("");
console.log("Windows student package created:");
console.log(`- ${outDir}`);
console.log(`- ${zipPath}`);

function bundleServer() {
  const esbuildBin = resolve(root, "node_modules", ".bin", "esbuild");
  run(esbuildBin, [
    resolve(root, "src/server/index.ts"),
    "--bundle",
    "--platform=node",
    "--format=cjs",
    "--target=node20",
    `--outfile=${resolve(appDir, "server.cjs")}`
  ]);
}

function ensureWindowsFfmpeg() {
  const ffmpegPath = resolve(ffmpegWinDir, "node_modules", "ffmpeg-static", "ffmpeg.exe");
  if (!existsSync(ffmpegPath)) {
    rmSync(ffmpegWinDir, { recursive: true, force: true });
    mkdirSync(ffmpegWinDir, { recursive: true });
    writeFileSync(
      resolve(ffmpegWinDir, "package.json"),
      JSON.stringify({
        private: true,
        dependencies: {
          "ffmpeg-static": ffmpegStaticVersion
        }
      }, null, 2),
      "utf8"
    );
    run("npm", ["install", "--omit=dev"], {
      cwd: ffmpegWinDir,
      env: {
        ...process.env,
        npm_config_platform: "win32",
        npm_config_arch: "x64"
      }
    });
  }

  mkdirSync(resolve(appDir, "bin"), { recursive: true });
  cpSync(ffmpegPath, resolve(appDir, "bin", "ffmpeg.exe"));
}

async function ensureWindowsNode() {
  if (!existsSync(nodeArchivePath)) {
    console.log(`Downloading ${nodeDownloadUrl}`);
    const response = await fetch(nodeDownloadUrl);
    if (!response.ok || !response.body) {
      throw new Error(`Failed to download Windows Node.js: ${response.status} ${response.statusText}`);
    }
    await pipeline(Readable.fromWeb(response.body), createWriteStream(nodeArchivePath));
  }

  rmSync(nodeDir, { recursive: true, force: true });
  run("unzip", ["-q", nodeArchivePath, "-d", outDir]);

  const extracted = readdirSync(outDir).find((name) => name === `node-v${nodeVersion}-win-x64`);
  if (!extracted) {
    throw new Error("Could not find extracted Windows Node.js directory.");
  }
  renameSync(resolve(outDir, extracted), nodeDir);
}

function writeStudentFiles() {
  writeFileSync(
    resolve(outDir, "start.bat"),
    [
      "@echo off",
      "setlocal",
      "title HUSKYLENS AI",
      "cd /d \"%~dp0app\"",
      "set PORT=8787",
      "set FFMPEG_PATH=%~dp0app\\bin\\ffmpeg.exe",
      "start \"\" \"http://localhost:8787\"",
      "\"..\\node\\node.exe\" server.cjs",
      "echo.",
      "echo HUSKYLENS AI has stopped.",
      "pause"
    ].join("\r\n"),
    "utf8"
  );

  writeFileSync(
    resolve(outDir, "README-학생용.txt"),
    [
      "HUSKYLENS AI 학생용 실행 안내",
      "",
      "1. 이 폴더의 압축을 풉니다.",
      "2. start.bat을 더블클릭합니다.",
      "3. 브라우저가 열리면 API 키를 입력합니다.",
      "4. 첫 화면에서 스트리밍 모드 또는 대화모드를 선택합니다.",
      "5. 스트리밍 모드는 HUSKYLENS에서 RTSP Streaming을 켜고 주소를 입력합니다.",
      "6. 대화모드는 HUSKYLENS에서 MCP Service를 켜고 MCP 주소를 입력합니다.",
      "7. 연결되지 않으면 자동 찾기를 누르거나 주소를 직접 입력합니다.",
      "",
      "주의",
      "- HUSKYLENS와 PC는 같은 Wi-Fi에 연결되어 있어야 합니다.",
      "- 대화모드에서는 HUSKYLENS에서 MCP Service가 켜져 있어야 합니다.",
      "- 스트리밍 모드에서는 HUSKYLENS에서 RTSP Streaming이 켜져 있어야 합니다.",
      "- 브라우저가 자동으로 열리지 않으면 http://localhost:8787 을 직접 입력하세요.",
      "- 대회가 끝나면 브라우저 저장 데이터를 지우면 API 키 저장값이 삭제됩니다."
    ].join("\r\n"),
    "utf8"
  );
}

function makeZip() {
  run("zip", ["-qr", zipPath, "windows-student"], { cwd: releaseDir });
}

function run(command, args, options = {}) {
  execFileSync(command, args, {
    cwd: root,
    stdio: "inherit",
    ...options
  });
}

function readText(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}
