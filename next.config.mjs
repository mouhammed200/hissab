import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Fix: suppress lockfile root detection warning
  outputFileTracingRoot: path.join(__dirname, '../../'),
  // Next.js 15: moved out of experimental
  serverExternalPackages: ['xlsx'],
}

export default nextConfig
