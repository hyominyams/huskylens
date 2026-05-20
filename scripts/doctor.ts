import http from "node:http";
import { networkInterfaces } from "node:os";

const requiredMajor = 20;
const nodeMajor = Number(process.versions.node.split(".")[0]);

console.log(`Node.js: ${process.version}`);
if (nodeMajor < requiredMajor) {
  console.log(`Node.js ${requiredMajor} 이상을 권장합니다.`);
}

console.log("\nLocal network addresses:");
for (const item of getLocalAddresses()) {
  console.log(`- http://${item}:5173`);
}

await checkPort(8787, "API server");
await checkPort(5173, "Web server");

function getLocalAddresses() {
  const addresses: string[] = [];
  for (const values of Object.values(networkInterfaces())) {
    for (const value of values || []) {
      if (value.family === "IPv4" && !value.internal) {
        addresses.push(value.address);
      }
    }
  }
  return addresses;
}

function checkPort(port: number, label: string) {
  return new Promise<void>((resolve) => {
    const req = http.get({ host: "localhost", port, path: "/", timeout: 800 }, () => {
      console.log(`${label}: port ${port} is in use`);
      resolve();
    });
    req.on("timeout", () => {
      req.destroy();
      console.log(`${label}: port ${port} is available`);
      resolve();
    });
    req.on("error", () => {
      console.log(`${label}: port ${port} is available`);
      resolve();
    });
  });
}
