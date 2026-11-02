(async()=>{
  'use strict';
  const $=id=>document.getElementById(id);
  const state={client:null,session:null,profile:null,config:null};
  const show=id=>['auth-loading','auth-signed-out','auth-needs-username','auth-free','auth-premium'].forEach(x=>$(x).hidden=x!==id);
  const api=async(path,opts={})=>{
    const headers={...(opts.headers||{})};
    if(state.session?.access_token)headers.Authorization='Bearer '+state.session.access_token;
    if(opts.body)headers['Content-Type']='application/json';
    const res=await fetch(path,{...opts,headers});
    const data=await res.json().catch(()=>({error:'Unexpected server response'}));
    if(!res.ok)throw new Error(data.error||'Request failed ('+res.status+')');
    return data;
  };
  async function refresh(){
    show('auth-loading');
    const {data:{session}}=await state.client.auth.getSession();state.session=session;
    if(!session){state.profile=null;show('auth-signed-out');return;}
    try{
      const d=await api('/api/profile');state.profile=d.profile;
      if(!d.profile?.username){$('signedInEmail').textContent=session.user.email||'Google account';show('auth-needs-username');}
      else if(d.profile.is_premium){$('premiumUsername').textContent=d.profile.username;show('auth-premium');}
      else{$('accountUsername').textContent=d.profile.username;show('auth-free');}
    }catch(e){$('usernameError').textContent=e.message;show('auth-needs-username');}
  }
  async function signOut(){await state.client.auth.signOut();state.session=null;state.profile=null;show('auth-signed-out');}
  try{
    state.config=await fetch('/api/config').then(r=>{if(!r.ok)throw new Error('Unable to load site configuration.');return r.json();});
    if(!window.supabase?.createClient)throw new Error('Authentication library could not be loaded.');
    state.client=window.supabase.createClient(state.config.supabaseUrl,state.config.supabaseAnonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
    $('googleSignIn').onclick=async()=>{try{const {error}=await state.client.auth.signInWithOAuth({provider:'google',options:{redirectTo:location.origin+'/#premium'}});if(error)throw error;}catch(e){alert(e.message);}};
    $('saveUsername').onclick=async()=>{
      const v=$('usernameInput').value.trim();$('usernameError').textContent='';
      if(!/^[A-Za-z0-9_]{3,30}$/.test(v)){$('usernameError').textContent='Use 3–30 letters, numbers or underscores.';return;}
      try{await api('/api/profile',{method:'PUT',body:JSON.stringify({username:v})});$('usernameInput').value='';await refresh();}catch(e){$('usernameError').textContent=e.message;}
    };
    $('signOutBeforeUsername').onclick=signOut;$('signOutFree').onclick=signOut;$('signOutPremium').onclick=signOut;
    $('buyPremium').onclick=async()=>{
      $('paymentError').textContent='';$('buyPremium').disabled=true;
      try{
        const order=await api('/api/payment/order',{method:'POST',body:'{}'});
        if(!window.Razorpay)await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://checkout.razorpay.com/v1/checkout.js';s.onload=resolve;s.onerror=()=>reject(new Error('Payment checkout could not be loaded.'));document.head.appendChild(s);});
        const checkout=new Razorpay({key:order.keyId,amount:order.amount,currency:'INR',name:'NEET PG Institute Information',description:'Lifetime Premium access',order_id:order.orderId,prefill:{email:state.session.user.email||''},theme:{color:'#0a84ff'},handler:async response=>{
          try{await api('/api/payment/verify',{method:'POST',body:JSON.stringify(response)});await refresh();}
          catch(e){$('paymentError').textContent='Payment verification is pending: '+e.message;}
        },modal:{ondismiss:()=>{$('buyPremium').disabled=false;}}});
        checkout.on('payment.failed',r=>{$('paymentError').textContent=r.error?.description||'Payment failed. No premium access was granted.';$('buyPremium').disabled=false;});
        checkout.open();
      }catch(e){$('paymentError').textContent=e.message;$('buyPremium').disabled=false;}
    };
    state.client.auth.onAuthStateChange((_event,session)=>{state.session=session;setTimeout(refresh,0);});
    await refresh();
  }catch(e){show('auth-signed-out');$('auth-signed-out').innerHTML='<p class="auth-error">'+String(e.message).replace(/[<>]/g,'')+'</p>' ;}
})();
