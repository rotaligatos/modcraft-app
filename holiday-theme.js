/* Holiday theme — shared by every app on rotaligatos.github.io (Modcraft, Approval, Command Center,
   HATID, PMES, KEYSTONE, ShelfSync). One calendar, one look, one place to change it.

   Load it, then call HolidayTheme.mount({...}). It draws a slim strip at the top of the page and,
   when the app has one, puts an outfit on its mascot (Lami in Modcraft). Decoration only: it never
   touches figures, buttons, status colours or anything printed.

   Off switches, all stored in localStorage on this one domain, so they hold across every app:
     mc_holiday_off = '1'            this person has switched it off everywhere
     mc_hol_hide_<occasion>_<date>   × on today's strip (just for today)
   An app can also pass enabled:false (Modcraft does, when an Admin switches it off for everyone).

   Each occasion runs from a week before to the day itself; a short, specific day takes priority
   over a long season it falls inside (Halloween and Black Friday inside Christmas). Times are the
   browser's local time, which is Philippine time for this team. (Rommel, 2026-11-27) */
(function(){
  'use strict';
  function D(y,m,d){ return new Date(y,m-1,d); }
  function add(dt,n){ var x=new Date(dt.getFullYear(),dt.getMonth(),dt.getDate()); x.setDate(x.getDate()+n); return x; }
  function easter(y){ // Anonymous Gregorian computus
    var a=y%19,b=Math.floor(y/100),c=y%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),
        h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451);
    return D(y,Math.floor((h+l-7*m+114)/31),((h+l-7*m+114)%31)+1);
  }
  function nthWeekday(y,m,wd,n){ var d=D(y,m,1); return D(y,m,1+((wd-d.getDay()+7)%7)+7*(n-1)); }
  function lastWeekday(y,m,wd){ var d=D(y,m+1,0); return D(y,m,d.getDate()-((d.getDay()-wd+7)%7)); }
  var CNY={2026:'2026-02-17',2027:'2027-02-06',2028:'2028-01-26',2029:'2029-02-13',2030:'2030-02-03',2031:'2031-01-23',2032:'2032-02-11',2033:'2033-01-31',2034:'2034-02-19',2035:'2035-02-08'};
  function days(a,b){ var a0=new Date(a.getFullYear(),a.getMonth(),a.getDate()); return Math.round((b-a0)/864e5); } // whole days, ignoring the time of day
  function pl(n,w){ return n+' '+w+(n===1?'':'s'); }

  function occasionFor(now){
    var y=now.getFullYear(), t=D(y,now.getMonth()+1,now.getDate()), L=[];
    // 17 January — a quiet nod to someone's birthday. Not named, on purpose.
    L.push({k:'bday',from:D(y,1,17),to:D(y,1,17),bg:'linear-gradient(90deg,#7c3aed,#db2777)',hat:'🥳',
      msg:function(){ return '🎂 Today the system is running on cake. Do not ask whose. (Discounts still need approval.)'; }});
    L.push({k:'fools',from:D(y,4,1),to:D(y,4,1),bg:'linear-gradient(90deg,#0f766e,#65a30d)',hat:'🃏',
      msg:function(){ return '🃏 Breaking: everything is now 100% off… April Fools. Nothing changed — carry on.'; }});
    var th=nthWeekday(y,11,4,4), bf=add(th,1);
    L.push({k:'blackfri',from:bf,to:add(bf,3),bg:'linear-gradient(90deg,#000000,#7f1d1d)',hat:'🕶️',
      msg:function(){ return '🛍️ Black Friday in the States. Over here, a discount still needs a PIN.'; }});
    L.push({k:'thanks',from:add(th,-6),to:th,bg:'linear-gradient(90deg,#9a3412,#b45309)',hat:'🍂',
      msg:function(d){ var n=days(d,th); return n?'🦃 Thanksgiving in '+pl(n,'day')+'. Thankful for clients who approve on the first try.':'🦃 Happy Thanksgiving — thankful for every client who approves on the first try.'; }});
    L.push({k:'souls',from:D(y,11,1),to:D(y,11,2),bg:'#374151',hat:'',
      msg:function(){ return '🕯️ All Saints\' and All Souls\' Day — remembering those before us.'; }});
    L.push({k:'halloween',from:D(y,10,24),to:D(y,10,31),bg:'linear-gradient(90deg,#1f2937,#c2410c)',hat:'🎃',
      msg:function(d){ var n=days(d,D(y,10,31)); return n?'🎃 Halloween in '+pl(n,'day')+'. Even the ghosts want their work done by Friday.':'👻 Boo. Happy Halloween — nothing scary today, please.'; }});
    var jan=now.getMonth()===0, ny=jan?D(y,1,1):D(y+1,1,1);
    L.push({k:'newyear',from:jan?D(y-1,12,27):D(y,12,27),to:ny,bg:'linear-gradient(90deg,#1e1b4b,#b45309)',hat:'🎉',tick:true,
      msg:function(d){
        if(d.getMonth()===0) return '🎆 Happy New Year! May this year be your best one yet.';
        if(d.getDate()===31){ var s=Math.max(0,Math.floor((ny-d)/1000)), hh=Math.floor(s/3600), mm=Math.floor(s%3600/60), ss=s%60;
          return '🥂 New Year countdown: '+String(hh).padStart(2,'0')+':'+String(mm).padStart(2,'0')+':'+String(ss).padStart(2,'0'); }
        return '🎉 '+pl(days(d,ny),'day')+' to the New Year.'; }});
    L.push({k:'kings',from:D(y,1,2),to:D(y,1,6),bg:'linear-gradient(90deg,#713f12,#a16207)',hat:'👑',
      msg:function(d){ var n=days(d,D(y,1,6)); return n?'👑👑👑 Three Kings in '+pl(n,'day')+' — the last stretch of Pasko.':'👑👑👑 Happy Three Kings! Christmas officially wraps up today.'; }});
    var ea=easter(y);
    L.push({k:'easter',from:ea,to:add(ea,1),bg:'linear-gradient(90deg,#0e7490,#7c3aed)',hat:'🐰',
      msg:function(){ return '🐣 Happy Easter! He is risen.'; }});
    L.push({k:'holyweek',from:add(ea,-7),to:add(ea,-1),bg:'#44403c',hat:'',
      msg:function(){ return '🕊️ Holy Week — a quiet week of reflection.'; }});
    var hero=lastWeekday(y,8,1);
    L.push({k:'heroes',from:add(hero,-6),to:hero,bg:'linear-gradient(90deg,#1e3a8a,#b91c1c)',hat:'🎖️',
      msg:function(d){ var n=days(d,hero); return n?'🎖️ National Heroes Day in '+pl(n,'day')+'. A salute to everyone who saves the day at 5pm.':'🎖️ Happy National Heroes Day — salute to the heroes, past and present.'; }});
    L.push({k:'independence',from:D(y,6,5),to:D(y,6,12),bg:'linear-gradient(90deg,#1d4ed8,#dc2626)',hat:'☀️',
      msg:function(d){ var n=days(d,D(y,6,12)); return n?'☀️⭐⭐⭐ Independence Day in '+pl(n,'day')+'. Mabuhay!':'☀️⭐⭐⭐ Maligayang Araw ng Kalayaan! Mabuhay ang Pilipinas.'; }});
    L.push({k:'valentine',from:D(y,2,7),to:D(y,2,14),bg:'linear-gradient(90deg,#be185d,#e11d48)',hat:'💘',
      msg:function(d){ var n=days(d,D(y,2,14)); return n?'💘 '+pl(n,'day')+' to Valentine\'s. Love your clients — reply on time.':'💘 Happy Valentine\'s! Roses are red, boards are 4x8, approve this quotation, don\'t make me wait.'; }});
    if(CNY[y]){ var p=CNY[y].split('-'), cny=D(+p[0],+p[1],+p[2]);
      L.push({k:'cny',from:add(cny,-6),to:cny,bg:'linear-gradient(90deg,#991b1b,#b45309)',hat:'🧧',
        msg:function(d){ var n=days(d,cny); return n?'🧧 Chinese New Year in '+pl(n,'day')+'. Kung Hei Fat Choi!':'🧧 Kung Hei Fat Choi! May every board nest with zero waste.'; }}); }
    var xmas=D(y,12,25); // Christmas from September, the Filipino way
    L.push({k:'christmas',from:D(y,9,1),to:D(y,12,26),bg:'linear-gradient(90deg,#14532d,#991b1b)',hat:'🎅',
      msg:function(d){ var n=days(d,xmas);
        if(n===1) return '🎄 Noche Buena tonight — Merry Christmas Eve!';
        if(n===0) return '🎄 Maligayang Pasko! Merry Christmas.';
        if(n<0) return '🎁 Happy Boxing Day — hope Santa approved your wish list.';
        return '🎄 '+pl(n,'day')+' to Christmas.'+(n>60?' Ber months na!':''); }});
    for(var i=0;i<L.length;i++) if(t>=L[i].from&&t<=L[i].to) return L[i];
    return null;
  }

  function esc(s){ return String(s).replace(/[&<>"]/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  function ls(k,v){ try{ if(v===undefined) return localStorage.getItem(k); if(v===null) localStorage.removeItem(k); else localStorage.setItem(k,v); }catch(e){ return null; } }
  function hideKey(h,now){ return 'mc_hol_hide_'+h.k+'_'+now.toDateString(); }

  var opts={}, cur=null, timer=null, tick=null;
  function find(x){ return typeof x==='string'?document.querySelector(x):x; }

  function apply(nowOverride){
    var now=nowOverride||new Date();
    var on=(opts.enabled===undefined||(typeof opts.enabled==='function'?opts.enabled():opts.enabled))&&ls('mc_holiday_off')!=='1';
    var h=on?occasionFor(now):null; cur=h;
    var strip=document.getElementById('hol-strip');
    if(!strip){
      strip=document.createElement('div'); strip.id='hol-strip';
      var before=find(opts.before);
      if(before&&before.parentNode) before.parentNode.insertBefore(strip,before); else document.body.insertBefore(strip,document.body.firstChild);
    }
    var hidden=!!(h&&ls(hideKey(h,now)));
    if(h&&!hidden){
      strip.style.cssText='display:flex;align-items:center;justify-content:center;gap:10px;min-height:26px;padding:3px 44px;box-sizing:border-box;'
        +'background:'+h.bg+';color:#fff;font:500 12px/1.3 system-ui,-apple-system,"Segoe UI",sans-serif;position:relative;'
        +'text-shadow:0 1px 1px rgba(0,0,0,.25);text-align:center;'+(opts.stripStyle||'');
      strip.innerHTML='<span id="hol-msg">'+esc(h.msg(now))+'</span>'
        +'<button type="button" id="hol-x" title="Hide for today" aria-label="Hide for today" '
        +'style="position:absolute;right:10px;top:50%;transform:translateY(-50%);background:transparent;border:none;color:#fff;opacity:.85;cursor:pointer;font-size:15px;line-height:1;padding:2px 4px">&times;</button>';
      document.getElementById('hol-x').onclick=function(){ hideToday(); };
    } else { strip.style.display='none'; strip.innerHTML=''; }
    var host=find(opts.mascot), hat=document.getElementById('hol-hat');
    if(host&&!hat){ hat=document.createElement('div'); hat.id='hol-hat';
      hat.style.cssText='position:absolute;top:-9px;left:44%;transform:translateX(-50%) rotate(-14deg);font-size:21px;line-height:1;pointer-events:none;user-select:none;'+(opts.hatStyle||'');
      host.appendChild(hat); }
    if(hat){ hat.textContent=(h&&h.hat)||''; hat.style.display=(h&&h.hat)?'':'none'; }
    clearInterval(tick); tick=null;
    if(h&&h.tick&&!hidden&&!nowOverride&&now.getMonth()===11&&now.getDate()===31)
      tick=setInterval(function(){ var m=document.getElementById('hol-msg'); if(m&&cur) m.textContent=cur.msg(new Date()); else clearInterval(tick); },1000);
    if(!timer&&!nowOverride) timer=setInterval(function(){ apply(); },10*60*1000);
    if(typeof opts.onChange==='function'){ try{ opts.onChange(h); }catch(e){} }
    return h;
  }
  function hideToday(){
    if(cur) ls(hideKey(cur,new Date()),'1');
    var s=document.getElementById('hol-strip'); if(s){ s.style.display='none'; s.innerHTML=''; }
    clearInterval(tick); tick=null;
  }
  function mount(o){
    opts=o||{};
    var go=function(){ try{ apply(); }catch(e){ if(window.console) console.warn('[holiday]',e); } };
    if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',go); else go();
    // the mascot may be drawn after sign-in, so look again shortly after
    setTimeout(go,4000); setTimeout(go,15000);
  }
  window.HolidayTheme={
    mount:mount, apply:apply, hideToday:hideToday, occasionFor:occasionFor, current:function(){ return cur; },
    isOffForMe:function(){ return ls('mc_holiday_off')==='1'; },
    setForMe:function(on){ ls('mc_holiday_off',on?null:'1'); apply(); }
  };
})();
