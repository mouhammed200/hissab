import { NextResponse } from 'next/server'
import { requireOrgAccess, WRITE_ROLES } from '@/lib/supabase/guard'
export async function POST(req: Request) { const body=await req.json(); const guard=await requireOrgAccess(body.orgId,{roles:WRITE_ROLES}); if(!guard.ok)return guard.response; const {data,error}=await guard.supabase.rpc('reconcile_bank_transaction',{p_request:{...body,org_id:body.orgId}}); if(error)return NextResponse.json({error:error.message},{status:500}); return NextResponse.json(data) }
