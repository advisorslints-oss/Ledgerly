import { existsSync, mkdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from './app.ts'
import { openDatabase } from './db.ts'

// Serves the Ledgerly website and the sync API from one place.
// PORT, DATA_DIR (where the database lives) and STATIC_DIR (the built app) can be set in the environment,
// or passed as --port=8787 --data=./somewhere.
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=')
const port = Number(arg('port') ?? process.env.PORT ?? 8787)
const dataDir = arg('data') ?? process.env.DATA_DIR ?? fileURLToPath(new URL('./data', import.meta.url))
const staticDir = process.env.STATIC_DIR ?? fileURLToPath(new URL('../dist', import.meta.url))

mkdirSync(dataDir, { recursive: true })
const db = openDatabase(join(dataDir, 'ledgerly.db'))
const app = createApp({ db, staticDir: existsSync(staticDir) ? staticDir : undefined })

createServer((req, res) => void app(req, res)).listen(port, () => {
  console.log(`Ledgerly is running at http://localhost:${port}`)
  if (!existsSync(staticDir)) console.log('No built app found; serving the API only. Run "npm run build" to include the website.')
})
