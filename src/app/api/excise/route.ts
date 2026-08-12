import { NextResponse } from 'next/server'
import { requireOrgAccess } from '@/lib/supabase/guard'
export async function GET(req: Request) { const q=new URL(req.url).searchParams; const orgId=q.get('orgId'); const guard=await requireOrgAccess(orgId); if(!guard.ok)return guard.response; const {data,error}=await guard.supabase.from('excise_product_facts').select('*').eq('org_id',orgId); if(error)return NextResponse.json({error:error.message},{status:500}); return NextResponse.json({data}) }
