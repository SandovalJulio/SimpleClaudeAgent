// Prueba unitaria: las skills de ejemplo se copian una vez y no sobrescriben (sin SDK ni tokens).
// Uso: node test/seed.test.js
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const mem = require("../src/main/memory");

const folder = fs.mkdtempSync(path.join(os.tmpdir(), "agente-seed-"));
const examples = path.resolve(__dirname, "..", "build", "skills-ejemplo");
const names = fs.readdirSync(examples);
assert.ok(names.length >= 2, "hay al menos dos skills de ejemplo");
for (const n of names) {
  const text = fs.readFileSync(path.join(examples, n, "SKILL.md"), "utf8");
  assert.ok(new RegExp(`^name: ${n}$`, "m").test(text), `frontmatter name de ${n}`);
  assert.ok(/^description: .{20,}/m.test(text), `description de ${n}`);
}

const copied = mem.seedExampleSkills(folder);
assert.deepStrictEqual(copied.sort(), names.slice().sort(), "copia todas la primera vez");
const listed = mem.listSkills(folder).filter((s) => s.scope === "proyecto").map((s) => s.name).sort();
assert.deepStrictEqual(listed, names.slice().sort(), "listSkills las ve");

// Segunda vez: nada que copiar, y una modificación local se respeta.
const mine = path.join(folder, ".claude", "skills", names[0], "SKILL.md");
fs.writeFileSync(mine, "---\nname: " + names[0] + "\ndescription: editada por mí\n---\nmío\n");
assert.deepStrictEqual(mem.seedExampleSkills(folder), [], "segunda vez no copia");
assert.ok(fs.readFileSync(mine, "utf8").includes("editada por mí"), "no sobrescribe");
assert.deepStrictEqual(mem.seedExampleSkills(null), [], "sin carpeta no hace nada");

fs.rmSync(folder, { recursive: true, force: true });
console.log("seed.test.js: skills de ejemplo OK (" + names.join(", ") + ")");
