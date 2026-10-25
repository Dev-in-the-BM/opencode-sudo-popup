import { cp, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const uuid = 'opencode-sudo-popup@uvindusl.github.io'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'gnome-extension')
const destination = join(homedir(), '.local', 'share', 'gnome-shell', 'extensions', uuid)

await mkdir(join(destination, '..'), { recursive: true })
await cp(source, destination, { recursive: true })
console.log(`[opencode-sudo-popup] GNOME extension installed -> ${destination}`)
console.log(`[opencode-sudo-popup] enable with: gnome-extensions enable ${uuid}`)
console.log('[opencode-sudo-popup] if the UUID is not yet recognized, log out and back in before enabling')
