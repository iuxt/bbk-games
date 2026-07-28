import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const client = path.join(dist, "client");
const files = [
    "index.html",
    "choose.html",
    "backup.html",
    "m.html",
    "mt.html",
    "pc.html",
    "favicon.png",
    "libs.json",
    "modlib.txt",
];
const directories = ["css", "js", "libs", "bbk-games"];

await rm(dist, { recursive: true, force: true });
await mkdir(client, { recursive: true });

for (const file of files) {
    await cp(path.join(root, file), path.join(client, file));
}
for (const directory of directories) {
    await cp(path.join(root, directory), path.join(client, directory), {
        recursive: true,
    });
}

await mkdir(path.join(dist, "server"), { recursive: true });
await writeFile(
    path.join(dist, "server", "index.js"),
    `export default {
    async fetch(request, env) {
        return env.ASSETS.fetch(request);
    }
};
`,
    "utf8"
);
