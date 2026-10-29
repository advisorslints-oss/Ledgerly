import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createApp } from './app.ts'
import { openDatabase, type DB } from './db.ts'

export interface TestServer {
  db: DB
  base: string
  server: Server
  close: () => Promise<void>
}

/** A sync server on a random local port with an in-memory database, for tests. */
export async function startTestServer(): Promise<TestServer> {
  const db = openDatabase(':memory:')
  const app = createApp({ db })
  const server = createServer((req, res) => void app(req, res))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    db,
    server,
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}
