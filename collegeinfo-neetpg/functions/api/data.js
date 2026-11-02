const JSON_HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'no-store, private'};
const csvHeaders=['Course','State','Institute','Stipend Year 1','Stipend Year 2','Stipend Year 3','Bond Years','Bond Penalty','BED'];
const reply=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{...JSON_HEADERS,...headers}});
const fail=(message,status=400)=>reply({error:message},status);

async function hmacHex(secret,message){
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const bytes=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(message)));
  return [...bytes].map(x=>x.toString(16).padStart(2,'0')).join('');
}
function safeEqual(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let x=0;for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);return x===0;}
function parseCsv(text){
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){if(c==='"'&&text[i+1]==='"'){cell+='"';i++;}else if(c==='"')quoted=false;else cell+=c;}
    else if(c==='"')quoted=true;
    else if(c===','){row.push(cell);cell='';}
    else if(c==='\n'){row.push(cell.replace(/\r$/,''));rows.push(row);row=[];cell='';}
    else cell+=c;
  }
  if(quoted)throw new Error('The CSV has an unclosed quoted field.');
  if(cell.length||row.length){row.push(cell.replace(/\r$/,''));rows.push(row);}
  if(!rows.length)throw new Error('The dataset is empty.');
  const header=rows.shift().map(x=>x.trim());
  const indices=csvHeaders.map(name=>header.findIndex(x=>x.toLowerCase()===name.toLowerCase()));
  if(indices.some(x=>x<0))throw new Error('The CSV must contain these columns: '+csvHeaders.join(', '));
  const data=[];
  for(const r of rows){if(r.every(x=>!String(x||'').trim()))continue;if(r.length!==header.length)throw new Error('A CSV row has an unexpected number of columns.');data.push(indices.map(i=>r[i]??''));}
  if(!data.length)throw new Error('The dataset has no data rows.');
  return data;
}
function csvCell(value){const s=String(value??'');return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;}
function toCsv(rows){return [csvHeaders.map(csvCell).join(','),...rows.map(r=>r.map(csvCell).join(','))].join('\r\n');}
async function getUser(request,env){
  const token=request.headers.get('authorization')?.replace(/^Bearer\s+/i,'');
  if(!token)return null;
  const res=await fetch(env.SUPABASE_URL.replace(/\/$/,'')+'/auth/v1/user',{headers:{apikey:env.SUPABASE_ANON_KEY,authorization:'Bearer '+token}});
  if(!res.ok)return null;
  const user=await res.json();return user?.id?user:null;
}
async function db(env,path,options={}){
  const base=env.SUPABASE_URL.replace(/\/$/,'')+'/rest/v1/';
  const res=await fetch(base+path,{...options,headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,'content-type':'application/json',...(options.headers||{})}});
  const text=await res.text();if(!res.ok)throw new Error('Database request failed ('+res.status+'): '+text.slice(0,300));
  return text?JSON.parse(text):null;
}
async function premiumFor(env,userId){
  const rows=await db(env,'premium_entitlements?user_id=eq.'+encodeURIComponent(userId)+'&select=user_id&limit=1');
  return Array.isArray(rows)&&rows.length>0;
}
async function requireUser(request,env){const user=await getUser(request,env);if(!user)throw Object.assign(new Error('Please sign in again.'),{status:401});return user;}
async function profile(request,env,user){
  if(request.method==='GET'){
    const rows=await db(env,'profiles?user_id=eq.'+encodeURIComponent(user.id)+'&select=username&limit=1');
    const username=rows?.[0]?.username||null;
    return reply({profile:{username,is_premium:await premiumFor(env,user.id)}});
  }
  if(request.method==='PUT'){
    let body;try{body=await request.json();}catch{return fail('Invalid request body.');}
    const username=String(body.username||'').trim();
    if(!/^[A-Za-z0-9_]{3,30}$/.test(username))return fail('Username must be 3–30 letters, numbers or underscores.');
    try{
      await db(env,'profiles?on_conflict=user_id',{method:'POST',headers:{prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({user_id:user.id,username,updated_at:new Date().toISOString()})});
    }catch(e){if(/unique|duplicate/i.test(e.message))return fail('That username is already taken.',409);throw e;}
    return reply({ok:true});
  }
  return fail('Method not allowed.',405);
}
async function createOrder(request,env,user){
  const profiles=await db(env,'profiles?user_id=eq.'+encodeURIComponent(user.id)+'&select=username&limit=1');
  if(!profiles?.[0]?.username)return fail('Choose a username before purchasing Premium.',409);
  const already=await premiumFor(env,user.id);if(already)return fail('This account already has lifetime Premium access.',409);
  const auth=btoa(env.RAZORPAY_KEY_ID+':'+env.RAZORPAY_KEY_SECRET);
  const rr=await fetch('https://api.razorpay.com/v1/orders',{method:'POST',headers:{authorization:'Basic '+auth,'content-type':'application/json'},body:JSON.stringify({amount:100,currency:'INR',receipt:'neetpg_'+crypto.randomUUID().replace(/-/g,'').slice(0,24),notes:{supabase_user_id:user.id}})});
  const order=await rr.json();if(!rr.ok||!order.id)throw new Error('Razorpay could not create the order.');
  await db(env,'payment_orders',{method:'POST',headers:{prefer:'return=minimal'},body:JSON.stringify({user_id:user.id,razorpay_order_id:order.id,amount:100,currency:'INR',status:'created'})});
  return reply({orderId:order.id,amount:100,currency:'INR',keyId:env.RAZORPAY_KEY_ID});
}
async function verifyPayment(request,env,user){
  let body;try{body=await request.json();}catch{return fail('Invalid payment response.');}
  const {razorpay_order_id:orderId,razorpay_payment_id:paymentId,razorpay_signature:signature}=body;
  if(!orderId||!paymentId||!signature)return fail('Payment verification details are incomplete.');
  const orderRows=await db(env,'payment_orders?razorpay_order_id=eq.'+encodeURIComponent(orderId)+'&user_id=eq.'+encodeURIComponent(user.id)+'&select=id,status,amount&limit=1');
  if(!orderRows?.length||orderRows[0].amount!==100)return fail('Payment order not found for this account.',403);
  const expected=await hmacHex(env.RAZORPAY_KEY_SECRET,orderId+'|'+paymentId);
  if(!safeEqual(expected,signature))return fail('Payment signature verification failed.',403);
  const auth=btoa(env.RAZORPAY_KEY_ID+':'+env.RAZORPAY_KEY_SECRET);
  const pr=await fetch('https://api.razorpay.com/v1/payments/'+encodeURIComponent(paymentId),{headers:{authorization:'Basic '+auth}});
  const payment=await pr.json();
  if(!pr.ok||payment.order_id!==orderId||payment.status!=='captured'||payment.amount!==100||payment.currency!=='INR')return fail('The provider has not confirmed a captured ₹1 payment. Premium access was not granted.',402);
  await db(env,'payment_orders?id=eq.'+encodeURIComponent(orderRows[0].id),{method:'PATCH',headers:{prefer:'return=minimal'},body:JSON.stringify({status:'captured',razorpay_payment_id:paymentId,verified_at:new Date().toISOString()})});
  await db(env,'premium_entitlements?on_conflict=user_id',{method:'POST',headers:{prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({user_id:user.id,source:'razorpay',razorpay_order_id:orderId,razorpay_payment_id:paymentId,granted_at:new Date().toISOString()})});
  return reply({ok:true,premium:true});
}
async function webhook(request,env){
  const raw=await request.text();const sig=request.headers.get('x-razorpay-signature')||'';
  const expected=await hmacHex(env.RAZORPAY_WEBHOOK_SECRET,raw);
  if(!safeEqual(expected,sig))return fail('Invalid webhook signature.',401);
  let event;try{event=JSON.parse(raw);}catch{return fail('Invalid webhook payload.');}
  if(event.event==='payment.captured'){
    const p=event.payload?.payment?.entity;const orderId=p?.order_id;
    if(p&&orderId&&p.amount===100&&p.currency==='INR'&&p.status==='captured'){
      const orders=await db(env,'payment_orders?razorpay_order_id=eq.'+encodeURIComponent(orderId)+'&select=id,user_id,amount&limit=1');
      if(orders?.length&&orders[0].amount===100){
        await db(env,'payment_orders?id=eq.'+encodeURIComponent(orders[0].id),{method:'PATCH',headers:{prefer:'return=minimal'},body:JSON.stringify({status:'captured',razorpay_payment_id:p.id,verified_at:new Date().toISOString()})});
        await db(env,'premium_entitlements?on_conflict=user_id',{method:'POST',headers:{prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({user_id:orders[0].user_id,source:'razorpay',razorpay_order_id:orderId,razorpay_payment_id:p.id,granted_at:new Date().toISOString()})});
      }
    }
  }
  return reply({received:true});
}

export async function onRequest(context){
  const {request,env}=context;const url=new URL(request.url);const path=url.pathname;
  try{
    if(path==='/api/config'&&request.method==='GET'){
      if(!env.SUPABASE_URL||!env.SUPABASE_ANON_KEY)return fail('Authentication is not configured on this deployment.',503);
      return reply({supabaseUrl:env.SUPABASE_URL,supabaseAnonKey:env.SUPABASE_ANON_KEY,razorpayKeyId:env.RAZORPAY_KEY_ID});
    }
    if(path==='/api/payment/webhook'&&request.method==='POST')return await webhook(request,env);
    if(path==='/api/data'&&request.method==='GET'){
      const user=await getUser(request,env);const isPremium=user?await premiumFor(env,user.id):false;
      if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY||!env.SUPABASE_STORAGE_BUCKET)return fail('Private dataset storage is not configured. Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_STORAGE_BUCKET.',503);
      const storageUrl=env.SUPABASE_URL.replace(/\/$/,'')+'/storage/v1/object/'+encodeURIComponent(env.SUPABASE_STORAGE_BUCKET)+'/'+(env.DATA_KEY||'all.csv').split('/').map(encodeURIComponent).join('/');
      const datasetResponse=await fetch(storageUrl,{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY}});
      if(!datasetResponse.ok){const detail=await datasetResponse.text();console.error('Supabase Storage dataset fetch failed:',datasetResponse.status,detail.slice(0,300));return fail(datasetResponse.status===404?'The private all.csv file was not found in the configured Supabase Storage bucket.':'The private dataset could not be loaded from Supabase Storage.',503);}
      const rows=parseCsv(await datasetResponse.text());
      const safeRows=isPremium?rows:rows.map((r,i)=>/^[a-c]/i.test(r[2])?r:['','','__LOCKED_PREMIUM__'+i,'','','','','','']);
      return new Response(toCsv(safeRows),{headers:{'content-type':'text/csv; charset=utf-8','cache-control':'no-store, private','x-content-type-options':'nosniff','content-disposition':'inline; filename="institutes.csv"'}});
    }
    if(path.startsWith('/api/')){
      const user=await requireUser(request,env);
      if(path==='/api/profile')return await profile(request,env,user);
      if(path==='/api/payment/order'&&request.method==='POST')return await createOrder(request,env,user);
      if(path==='/api/payment/verify'&&request.method==='POST')return await verifyPayment(request,env,user);
      return fail('API route not found.',404);
    }
    return new Response('Not found',{status:404,headers:{'cache-control':'no-store'}});
  }catch(e){
    console.error('API error',e);
    return fail(e.status?e.message:'A server error occurred. Check the deployment configuration and server logs.',e.status||500);
  }
}
