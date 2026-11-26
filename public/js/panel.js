window.VP = (() => {
  const state = {};
  function qs(s,r=document){return r.querySelector(s)} function qsa(s,r=document){return [...r.querySelectorAll(s)]}
  function toast(msg,type='info'){ let w=qs('#toasts'); if(!w){w=document.createElement('div');w.id='toasts';document.body.appendChild(w)} const t=document.createElement('div'); t.className=`toast ${type}`; t.textContent=msg; w.appendChild(t); setTimeout(()=>{t.style.opacity='0';t.style.transition='opacity .25s';setTimeout(()=>t.remove(),260)},3200); }
  async function api(url,opts={}){ const o={...opts,headers:{...(opts.headers||{})}}; if(o.body && typeof o.body!=='string'){o.headers['Content-Type']='application/json'; o.body=JSON.stringify(o.body)} const r=await fetch(url,o); let data=null; try{data=await r.json()}catch{} if(!r.ok){const e=new Error((data&&data.error)||`Request failed (${r.status})`); e.data=data; throw e;} return data; }
  function fmtBytes(n){ n=Number(n||0); if(n<1024) return n+' B'; const u=['KB','MB','GB','TB']; let i=-1; do{n/=1024;i++}while(n>=1024&&i<u.length-1); return n.toFixed(n>=100?0:n>=10?1:2)+' '+u[i]; }
  function confirmDialog(message,{danger=true,title='Are you sure?',okText='Confirm'}={}){ return new Promise(resolve=>{ const ov=document.createElement('div'); ov.className='modal-overlay'; const m=document.createElement('div'); m.className='modal'; m.innerHTML=`<h3>${title}</h3><p>${message}</p><div class="modal-actions"><button class="btn" data-c>Cancel</button><button class="btn ${danger?'btn-danger':'btn-primary'}" data-o>${okText}</button></div>`; ov.appendChild(m); document.body.appendChild(ov); m.querySelector('[data-c]').onclick=()=>{ov.remove();resolve(false)}; m.querySelector('[data-o]').onclick=()=>{ov.remove();resolve(true)}; ov.onclick=e=>{if(e.target===ov){ov.remove();resolve(false)}}; }); }
  const confirm = (m,o)=>confirmDialog(m,o);
  function openSidebar(){ qs('.sidebar')?.classList.add('open'); qs('.sidebar-overlay')?.classList.add('open'); }
  function closeSidebar(){ qs('.sidebar')?.classList.remove('open'); qs('.sidebar-overlay')?.classList.remove('open'); }
  function toggleSidebar(){ if(window.innerWidth<=1024) return qs('.sidebar')?.classList.contains('open')?closeSidebar():openSidebar(); document.body.classList.toggle('sidebar-collapsed'); localStorage.setItem('vp_sidebar_collapsed', document.body.classList.contains('sidebar-collapsed')?'1':'0'); }
  function globalSearch(q){ q=String(q||'').trim(); if(!q) return; if(/^#?\d+$/.test(q)) { location.href='/vds/'+q.replace('#',''); return; } location.href='/vds?q='+encodeURIComponent(q); }
  document.addEventListener('DOMContentLoaded',()=>{
    if(localStorage.getItem('vp_sidebar_collapsed')==='1' && window.innerWidth>1024) document.body.classList.add('sidebar-collapsed');
    document.addEventListener('click',e=>{ if(!e.target.closest('.user-menu')) qsa('.user-menu.open').forEach(n=>n.classList.remove('open')); });
  });
  return { state,qs,qsa,toast,api,fmtBytes,confirmDialog,confirm,openSidebar,closeSidebar,toggleSidebar,globalSearch };
})();
