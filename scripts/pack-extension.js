import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const result = spawnSync('gnome-extensions', [
  'pack',
  join(root, 'gnome-extension'),
  `--extra-source=${join(root, 'gnome-extension', 'list-sessions.py')}`,
  '--force',
], { cwd: root, stdio: 'inherit' })

if (result.error)
    throw result.error
if (result.status !== 0)
    process.exit(result.status ?? 1)
