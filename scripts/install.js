import { chmod, mkdir, readFile, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { homedir, platform } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const HOME = homedir()
const CONFIG_DIR = join(HOME, ".config", "opencode")
const ASKPASS_DEST = join(CONFIG_DIR, "sudo-askpass.sh")
const GJS_DEST = join(CONFIG_DIR, "sudo-askpass-gjs.js")
const WRAPPER_DEST = join(HOME, ".local", "bin", "sudo")
// OpenCode V1 discovers global plugins in `plugin/`, V2 uses `plugins/`.
const PLUGIN_DIRS = [join(CONFIG_DIR, "plugin"), join(CONFIG_DIR, "plugins")]
const LOCAL_BIN = join(HOME, ".local", "bin")

const ASKPASS_UNIX = `"${ASKPASS_DEST}"`
const ASKPASS_ESC = ASKPASS_UNIX.replaceAll('"', '\\"')

async function ensureAskpass() {
  await mkdir(CONFIG_DIR, { recursive: true })
  // askpass wrapper + its GJS dialog must live side by side in the same dir.
  const src = join(__dirname, "..", "bin", "sudo-askpass.sh")
  const gjs = join(__dirname, "..", "bin", "sudo-askpass-gjs.js")
  const content = await readFile(src)
  const gjsContent = await readFile(gjs)
  await writeFile(ASKPASS_DEST, content)
  await chmod(ASKPASS_DEST, 0o755)
  await writeFile(GJS_DEST, gjsContent)
  await chmod(GJS_DEST, 0o755)
  return ASKPASS_DEST
}

async function ensureSudoWrapper() {
  await mkdir(LOCAL_BIN, { recursive: true })
  const src = join(__dirname, "..", "bin", "sudo-wrapper.sh")
  const content = await readFile(src)
  await writeFile(WRAPPER_DEST, content)
  await chmod(WRAPPER_DEST, 0o755)
  return WRAPPER_DEST
}

async function ensurePlugin() {
  const src = join(__dirname, "..", "src", "index.js")
  const content = await readFile(src)
  const dests = []
  for (const dir of PLUGIN_DIRS) {
    await mkdir(dir, { recursive: true })
    const dest = join(dir, "sudo-reason.js")
    await writeFile(dest, content)
    dests.push(dest)
  }
  return dests
}

function shellRc(shell) {
  const map = {
    zsh: join(HOME, ".zshenv"),
    bash: join(HOME, ".bashrc"),
    fish: join(HOME, ".config", "fish", "config.fish"),
  }
  return map[shell] || null
}

function exportLine(shell) {
  if (shell === "fish") return `set -gx SUDO_ASKPASS ${ASKPASS_ESC}`
  return `export SUDO_ASKPASS=${ASKPASS_UNIX}`
}

function pathLine(shell) {
  const bin = `"${LOCAL_BIN}"`
  if (shell === "fish") return `set -gx PATH ${bin} $PATH`
  return `export PATH=${bin}:$PATH`
}

async function lineMissing(cur, line) {
  // Normalise whitespace for comparison.
  const norm = (s) => s.replace(/\s+/g, " ").trim()
  const target = norm(line)
  return cur.split("\n").every((l) => norm(l) !== target)
}

async function ensureEnv() {
  if (platform() === "win32") return false
  const shell = process.env.SHELL?.split("/").pop()
  if (!shell) return false
  const rc = shellRc(shell)
  if (!rc) return false

  await mkdir(dirname(rc), { recursive: true })
  let cur = existsSync(rc) ? await readFile(rc, "utf8") : ""

  const lines = [pathLine(shell), exportLine(shell)]
  let changed = false
  for (const line of lines) {
    if (await lineMissing(cur, line)) {
      cur = cur ? `${cur}\n${line}` : line
      changed = true
    }
  }
  if (changed) {
    await writeFile(rc, `${cur}\n# added by opencode-sudo-popup\n`)
  }
  return changed
}

async function main() {
  const ask = await ensureAskpass()
  console.log(`[opencode-sudo-popup] askpass helper -> ${ask}`)
  const wrap = await ensureSudoWrapper()
  console.log(`[opencode-sudo-popup] sudo wrapper -> ${wrap}`)
  const plugins = await ensurePlugin()
  for (const plugin of plugins) console.log(`[opencode-sudo-popup] plugin -> ${plugin}`)
  const wired = await ensureEnv()
  if (wired) console.log("[opencode-sudo-popup] PATH + SUDO_ASKPASS exported to your shell rc")
  console.log("[opencode-sudo-popup] NOTE: restart opencode (and your terminal) after installing.")
  console.log("[opencode-sudo-popup] Ensure ~/.local/bin is in your PATH before /usr/bin so the sudo wrapper takes effect.")
}

main().catch((e) => {
  // Never fail the whole npm install because of a helper issue.
  console.error("[opencode-sudo-popup] setup warning:", e.message)
})
