import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/[[path]].js';

const csv=[
  'Course,State,Institute,Stipend Year 1,Stipend Year 2,Stipend Year 3,Bond Years,Bond Penalty,BED',
  'MD,State A,Alpha Institute,100,200,300,1,500,1000',
  'MD,State B,Beta Institute,110,210,310,2,600,1100',
  'MD,State C,Central Institute,120,220,320,3,700,1200',
  'MD,State D,Delta Restricted Hospital,130,230,330,4,800,1300',
  'MD,State Z,Zeta Restricted Hospital,140,240,340,5,900,1400'
].join('\n');


test('anonymous data response contains A–C rows and no restricted source values',async()=>{
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async url=>String(url).includes('/storage/v1/object/college-data/all.csv')?new Response(csv):new Response('Unexpected fetch',{status:500});
  let response;try{response=await onRequest({request:new Request('https://example.test/api/data'),env:{SUPABASE_URL:'https://project.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'service',SUPABASE_STORAGE_BUCKET:'college-data',DATA_KEY:'all.csv'}});}finally{globalThis.fetch=originalFetch;}
  assert.equal(response.status,200);
  const body=await response.text();
  assert.match(body,/Alpha Institute/);
  assert.match(body,/Beta Institute/);
  assert.match(body,/Central Institute/);
  assert.doesNotMatch(body,/Delta Restricted Hospital|Zeta Restricted Hospital|State D|State Z|1300|1400/);
  assert.equal((body.match(/__LOCKED_PREMIUM__/g)||[]).length,2);
});

test('authenticated premium data response returns full source only when entitlement exists',async()=>{
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async url=>{
    if(String(url).includes('/auth/v1/user'))return new Response(JSON.stringify({id:'user-1',email:'test@example.test'}),{status:200});
    if(String(url).includes('/rest/v1/premium_entitlements'))return new Response(JSON.stringify([{user_id:'user-1'}]),{status:200});
    if(String(url).includes('/storage/v1/object/college-data/all.csv'))return new Response(csv);
    throw new Error('Unexpected fetch '+url);
  };
  try{
    const request=new Request('https://example.test/api/data',{headers:{authorization:'Bearer valid-test-token'}});
    const response=await onRequest({request,env:{DATA_KEY:'all.csv',SUPABASE_STORAGE_BUCKET:'college-data',SUPABASE_URL:'https://project.supabase.co',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'service'}});
    assert.equal(response.status,200);
    const body=await response.text();
    assert.match(body,/Delta Restricted Hospital/);
    assert.match(body,/Zeta Restricted Hospital/);
    assert.doesNotMatch(body,/__LOCKED_PREMIUM__/);
  }finally{globalThis.fetch=originalFetch;}
});

test('profile endpoint rejects requests without an authenticated user',async()=>{
  const originalError=console.error;console.error=()=>{};
  const response=await onRequest({request:new Request('https://example.test/api/profile'),env:{SUPABASE_URL:'https://project.supabase.co',SUPABASE_ANON_KEY:'anon'}});
  console.error=originalError;
  assert.equal(response.status,401);
});
