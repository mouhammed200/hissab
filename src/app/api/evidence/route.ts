import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { requireOrgAccess, WRITE_ROLES } from '@/lib/supabase/guard'

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
const ALLOWED = new Set(['application/pdf', 'image/jpeg', 'image/png', 'text/csv', 'text/plain'])

export async function POST(request: NextRequest) {
  const form = await request.formData()
  const file = form.get('file') as File | null
  const orgId = form.get('orgId') as string | null
  const recordType = form.get('recordType') as string | null
  const recordId = form.get('recordId') as string | null
  const sourceChannel = (form.get('sourceChannel') as string | null) || 'upload'
  const guard = await requireOrgAccess(orgId, { roles: WRITE_ROLES })
  if (!guard.ok) return guard.response
  if (!file || !recordType || !recordId) return NextResponse.json({ error: 'file, recordType and recordId are required' }, { status: 400 })
  if (file.size > MAX_UPLOAD_BYTES || !ALLOWED.has(file.type)) return NextResponse.json({ error: 'Unsupported or oversized evidence file' }, { status: 415 })
  const bytes = Buffer.from(await file.arrayBuffer())
  const hash = createHash('sha256').update(bytes).digest('hex')
  const path = `${orgId}/${recordType}/${recordId}/${hash}-${file.name}`
  const upload = await guard.supabase.storage.from('evidence').upload(path, bytes, { contentType: file.type, upsert: false })
  if (upload.error && !upload.error.message.toLowerCase().includes('already exists')) throw upload.error
  const { data, error } = await guard.supabase.from('attachments').insert({ org_id: orgId, record_type: recordType, record_id: recordId, file_name: file.name, file_path: path, file_size_bytes: bytes.byteLength, mime_type: file.type, uploaded_by: guard.user.id, sha256_hash: hash, source_channel: sourceChannel, captured_at: new Date().toISOString(), metadata: { originalLastModified: file.lastModified } }).select('id').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, attachmentId: data.id, sha256: hash })
}
