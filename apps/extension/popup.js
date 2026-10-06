const $ = (id) => document.getElementById(id);
let observation;
chrome.storage.local.get(['api', 'token']).then((s) => { if (s.api) $('api').value = s.api; if (s.token) $('token').value = s.token; });
$('setup').addEventListener('submit', async (e) => {
 e.preventDefault(); try { const u = new URL($('api').value); if(u.protocol !== 'https:' && u.hostname !== 'localhost') throw new Error('Use HTTPS or localhost.');
 const granted=await chrome.permissions.request({origins:[`${u.origin}/*`]}); if(!granted)throw new Error('API permission was not granted.');
 await chrome.storage.local.set({api:u.href.replace(/\/$/,''),token:$('token').value}); $('status').textContent='Connection saved on this browser.';
 } catch(e){$('status').textContent=e.message;}
});
$('capture').addEventListener('click', async () => {
 try {const [tab]=await chrome.tabs.query({active:true,currentWindow:true});if(!tab?.id)throw new Error('Open a title page first.');
 const results=await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>{const video=document.querySelector('video');return {title:document.title,url:location.href,video:video?{paused:video.paused,currentTime:video.currentTime,duration:Number.isFinite(video.duration)?video.duration:null}:null};}});
 observation=results[0].result; $('title').value=observation.title.replace(/\s*[-|]\s*Netflix.*$/i,''); $('preview').hidden=false;
 $('evidence').textContent=observation.video?'Video observed. Position and pause state do not prove completion. Confirm the title and log in Ludex.':'Page captured. Match the title in Ludex before logging progress.';
 }catch(e){$('status').textContent=e.message;}
});
$('save').addEventListener('click',async()=>{
 try{const cfg=await chrome.storage.local.get(['api','token']);if(!cfg.token)throw new Error('Connect Ludex first.');const r=await fetch(`${cfg.api}/connections/capture`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${cfg.token}`},body:JSON.stringify({title:$('title').value,url:observation.url,video:observation.video,observationId:crypto.randomUUID()})});const data=await r.json();if(!r.ok)throw new Error(data.message||'Capture could not be saved.');$('status').textContent='Saved for review. Open Ludex to confirm progress.';}catch(e){$('status').textContent=e.message;}
});
