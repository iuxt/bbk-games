import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const games = [
    "伏魔记",
    "金庸群侠传",
    "赤壁之战之乱世枭雄",
    "赤壁之战之谁与争锋",
    "侠客行",
];
const pageNames = ["index", "pc", "m"];
const checkOnly = process.argv.includes("--check");
const mismatches = [];

for (const pageName of pageNames) {
    const templatePath = path.join(root, "fm", "templates", `${pageName}.tpl`);
    const template = await readFile(templatePath, "utf8");

    for (const game of games) {
        const outputPath = path.join(root, "fm", "games", game, `${pageName}.html`);
        const expected = template.replaceAll("{{GAME_NAME}}", game);

        if (checkOnly) {
            const actual = await readFile(outputPath, "utf8");
            if (actual !== expected) mismatches.push(path.relative(root, outputPath));
        } else {
            await writeFile(outputPath, expected);
        }
    }
}

if (mismatches.length) {
    console.error("以下 RPG 页面没有与模板同步：");
    for (const file of mismatches) console.error(`- ${file}`);
    console.error("请运行 npm run generate:fmj");
    process.exitCode = 1;
} else if (checkOnly) {
    console.log("RPG 生成页面与模板一致");
} else {
    console.log(`已生成 ${games.length * pageNames.length} 个 RPG 页面`);
}
