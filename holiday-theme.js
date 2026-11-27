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

  // Every occasion has several looks and several lines, and the year picks which ones — so
  // Christmas 2027 does not look like Christmas 2026 (Rommel, 2026-11-27: "the theme should change
  // every year"). Each occasion starts at a different point in its list, so they do not all turn
  // over in step. Within a year the choice is fixed, so the strip doesn't change from day to day.
  function seed(k){ var s=0; for(var i=0;i<k.length;i++) s=(s*31+k.charCodeAt(i))>>>0; return s; }
  function pick(k,year,arr){ return arr[(year+seed(k))%arr.length]; }
  function G(a,b){ return 'linear-gradient(90deg,'+a+','+b+')'; }
  function mk(k,year,from,to,looks,lines,extra){
    var lk=pick(k,year,looks), ln=pick(k,year+3,lines), o={k:k,from:from,to:to,bg:lk.bg,hat:lk.hat,ic:lk.ic,line:ln,year:year};
    if(extra) for(var x in extra) o[x]=extra[x];
    return o;
  }

  function occasionFor(now){
    var y=now.getFullYear(), t=D(y,now.getMonth()+1,now.getDate()), L=[];

    // 17 January — a quiet nod to someone's birthday. Not named, on purpose; a different joke every year.
    L.push(mk('bday',y,D(y,1,17),D(y,1,17),
      [{bg:G('#7c3aed','#db2777'),hat:'🥳',ic:'🎂'},{bg:G('#0891b2','#7c3aed'),hat:'🎈',ic:'🎈'},{bg:G('#db2777','#f59e0b'),hat:'🎉',ic:'🧁'},{bg:G('#4338ca','#0d9488'),hat:'👑',ic:'🍰'}],
      ['Today the system is running on cake. Do not ask whose. (Discounts still need approval.)',
       'Someone here levelled up today. The server has been told to behave.',
       'Free cake was spotted somewhere in the building. This strip neither confirms nor denies.',
       'Fun fact: the person who built this app is a year wiser today. The bugs are not.',
       'Today\'s forecast: 100% chance of cake, 0% chance of an unapproved discount.'],
      {msg:function(){ return this.ic+' '+this.line; }}));

    L.push(mk('fools',y,D(y,4,1),D(y,4,1),
      [{bg:G('#0f766e','#65a30d'),hat:'🃏',ic:'🃏'},{bg:G('#7c2d12','#ca8a04'),hat:'🤡',ic:'🎭'},{bg:G('#1e3a8a','#be185d'),hat:'🥸',ic:'🙃'}],
      ['Breaking: everything is now 100% off… April Fools. Nothing changed — carry on.',
       'Management has approved a 4-day weekend… for the server. April Fools.',
       'All boards are now 5x9. Please re-quote everything… just kidding. April Fools.',
       'Lami has been promoted to Manager. April Fools — she still has no PIN.'],
      {msg:function(){ return this.ic+' '+this.line; }}));

    var th=nthWeekday(y,11,4,4), bf=add(th,1);
    L.push(mk('blackfri',y,bf,add(bf,3),
      [{bg:G('#000000','#7f1d1d'),hat:'🕶️',ic:'🛍️'},{bg:G('#111827','#a16207'),hat:'💸',ic:'🏷️'},{bg:G('#0f172a','#be123c'),hat:'🛒',ic:'🛍️'}],
      ['Black Friday in the States. Over here, a discount still needs a PIN.',
       'Black Friday sale: 0% off approvals. Still worth every peso.',
       'Black Friday in the US. Cyber Monday soon. Our prices? Still fair every day.'],
      {msg:function(){ return this.ic+' '+this.line; }}));

    L.push(mk('thanks',y,add(th,-6),th,
      [{bg:G('#9a3412','#b45309'),hat:'🍂',ic:'🦃'},{bg:G('#78350f','#a16207'),hat:'🥧',ic:'🍁'},{bg:G('#7c2d12','#4d7c0f'),hat:'🌽',ic:'🦃'}],
      ['Thankful for clients who approve on the first try.','Thankful for teammates who reply before lunch.','Thankful for cutting lists that add up the first time.'],
      {msg:function(d){ var n=days(d,th); return this.ic+' '+(n?'Thanksgiving in '+pl(n,'day')+'. ':'Happy Thanksgiving! ')+this.line; }}));

    L.push(mk('souls',y,D(y,11,1),D(y,11,2),[{bg:'#374151',hat:'',ic:'🕯️'},{bg:'#3f3f46',hat:'',ic:'🌼'},{bg:'#334155',hat:'',ic:'🕯️'}],
      ['All Saints\' and All Souls\' Day — remembering those before us.','Undas — a time to remember and to give thanks.','All Souls\' Day — keeping our loved ones in mind today.'],
      {msg:function(){ return this.ic+' '+this.line; }}));

    L.push(mk('halloween',y,D(y,10,24),D(y,10,31),
      [{bg:G('#1f2937','#c2410c'),hat:'🎃',ic:'🎃'},{bg:G('#3b0764','#ea580c'),hat:'🦇',ic:'🦇'},{bg:G('#111827','#4d7c0f'),hat:'👻',ic:'🕸️'},{bg:G('#431407','#7e22ce'),hat:'🧙',ic:'🕷️'}],
      ['Even the ghosts want their work done by Friday.','The scariest thing this week: an unsaved draft.','Spooky season: beware of cutting lists with no sizes.','Trick or treat? Treat: an approved quotation.'],
      {msg:function(d){ var n=days(d,D(y,10,31)); return this.ic+' '+(n?'Halloween in '+pl(n,'day')+'. ':'Happy Halloween! ')+this.line; }}));

    // New Year runs over the year boundary; it takes its look from the year it welcomes.
    var jan=now.getMonth()===0, ny=jan?D(y,1,1):D(y+1,1,1), nyY=ny.getFullYear();
    L.push(mk('newyear',nyY,jan?D(y-1,12,27):D(y,12,27),ny,
      [{bg:G('#1e1b4b','#b45309'),hat:'🎉',ic:'🎉'},{bg:G('#0c0a09','#a16207'),hat:'🥂',ic:'🎆'},{bg:G('#172554','#be185d'),hat:'🎊',ic:'✨'},{bg:G('#14532d','#ca8a04'),hat:'🎉',ic:'🎇'}],
      ['May this year be your best one yet.','New year, new quotations, same great team.','Here\'s to more approvals and fewer revisions.','Bagong taon, bagong pag-asa!'],
      {tick:true,msg:function(d){
        if(d.getMonth()===0) return this.ic+' Happy New Year '+nyY+'! '+this.line;
        if(d.getDate()===31){ var s=Math.max(0,Math.floor((ny-d)/1000)), hh=Math.floor(s/3600), mm=Math.floor(s%3600/60), ss=s%60;
          return '🥂 Countdown to '+nyY+': '+String(hh).padStart(2,'0')+':'+String(mm).padStart(2,'0')+':'+String(ss).padStart(2,'0'); }
        return this.ic+' '+pl(days(d,ny),'day')+' to '+nyY+'.'; }}));

    L.push(mk('kings',y,D(y,1,2),D(y,1,6),
      [{bg:G('#713f12','#a16207'),hat:'👑',ic:'👑'},{bg:G('#4c1d95','#b45309'),hat:'⭐',ic:'⭐'},{bg:G('#1e3a8a','#a16207'),hat:'🐫',ic:'🎁'}],
      ['the last stretch of Pasko.','gold, frankincense and myrrh on the way.','the Christmas season\'s grand finale.'],
      {msg:function(d){ var n=days(d,D(y,1,6)); return this.ic+this.ic+this.ic+' '+(n?'Three Kings in '+pl(n,'day')+' — '+this.line:'Happy Three Kings! Christmas officially wraps up today.'); }}));

    var ea=easter(y);
    L.push(mk('easter',y,ea,add(ea,1),
      [{bg:G('#0e7490','#7c3aed'),hat:'🐰',ic:'🐣'},{bg:G('#15803d','#ca8a04'),hat:'🌷',ic:'🌸'},{bg:G('#be185d','#7c3aed'),hat:'🥚',ic:'🐣'}],
      ['He is risen.','A blessed Easter to you and your family.','New life, new hope — happy Easter.'],
      {msg:function(){ return this.ic+' Happy Easter! '+this.line; }}));
    L.push(mk('holyweek',y,add(ea,-7),add(ea,-1),[{bg:'#44403c',hat:'',ic:'🕊️'},{bg:'#3f3f46',hat:'',ic:'✝️'},{bg:'#292524',hat:'',ic:'🕊️'}],
      ['Holy Week — a quiet week of reflection.','Holy Week — a time for prayer and family.','Semana Santa — rest, reflect, recharge.'],
      {msg:function(){ return this.ic+' '+this.line; }}));

    var hero=lastWeekday(y,8,1);
    L.push(mk('heroes',y,add(hero,-6),hero,
      [{bg:G('#1e3a8a','#b91c1c'),hat:'🎖️',ic:'🎖️'},{bg:G('#172554','#a16207'),hat:'🦸',ic:'🏅'},{bg:G('#7f1d1d','#1e40af'),hat:'🎖️',ic:'🫡'}],
      ['A salute to everyone who saves the day at 5pm.','Not all heroes wear capes — some carry tape measures.','Honouring the heroes, past and present.'],
      {msg:function(d){ var n=days(d,hero); return this.ic+' '+(n?'National Heroes Day in '+pl(n,'day')+'. ':'Happy National Heroes Day! ')+this.line; }}));

    L.push(mk('independence',y,D(y,6,5),D(y,6,12),
      [{bg:G('#1d4ed8','#dc2626'),hat:'☀️',ic:'☀️⭐⭐⭐'},{bg:G('#dc2626','#1d4ed8'),hat:'⭐',ic:'⭐☀️⭐'},{bg:G('#1e3a8a','#b91c1c'),hat:'☀️',ic:'☀️'}],
      ['Mabuhay ang Pilipinas!','Proudly Filipino-made, every cabinet.','Kalayaan — salamat sa mga bayani.'],
      {msg:function(d){ var n=days(d,D(y,6,12)); return this.ic+' '+(n?'Independence Day in '+pl(n,'day')+'. ':'Maligayang Araw ng Kalayaan! ')+this.line; }}));

    L.push(mk('valentine',y,D(y,2,7),D(y,2,14),
      [{bg:G('#be185d','#e11d48'),hat:'💘',ic:'💘'},{bg:G('#9f1239','#c026d3'),hat:'🌹',ic:'🌹'},{bg:G('#db2777','#f97316'),hat:'💝',ic:'💌'},{bg:G('#7c3aed','#e11d48'),hat:'💕',ic:'💕'}],
      ['Roses are red, boards are 4x8, approve this quotation, don\'t make me wait.','Love your clients — reply on time.','Our love language: a signed Final Quotation.','Sweet, like a quotation approved on the first try.'],
      {msg:function(d){ var n=days(d,D(y,2,14)); return this.ic+' '+(n?pl(n,'day')+' to Valentine\'s. ':'Happy Valentine\'s! ')+this.line; }}));

    if(CNY[y]){ var p=CNY[y].split('-'), cny=D(+p[0],+p[1],+p[2]);
      var ZOD=['Monkey','Rooster','Dog','Pig','Rat','Ox','Tiger','Rabbit','Dragon','Snake','Horse','Goat'], zod=ZOD[y%12];
      L.push(mk('cny',y,add(cny,-6),cny,
        [{bg:G('#991b1b','#b45309'),hat:'🧧',ic:'🧧'},{bg:G('#7f1d1d','#ca8a04'),hat:'🏮',ic:'🏮'},{bg:G('#b91c1c','#a16207'),hat:'🐉',ic:'🎊'}],
        ['May every board nest with zero waste.','Wishing you prosperity and full order books.','Huat ah! May the year be lucky for us all.'],
        {msg:function(d){ var n=days(d,cny); return this.ic+' '+(n?'Year of the '+zod+' in '+pl(n,'day')+'. Kung Hei Fat Choi!':'Kung Hei Fat Choi! Welcome to the Year of the '+zod+'. '+this.line); }})); }

    // Christmas — from September, the Filipino way. The early-season and late-season lines both rotate.
    var xmas=D(y,12,25), early=pick('xmas-early',y,['Ber months na!','Cue the Jose Mari Chan.','The parols are going up.','Christmas party planning starts now.']);
    L.push(mk('christmas',y,D(y,9,1),D(y,12,26),
      [{bg:G('#14532d','#991b1b'),hat:'🎅',ic:'🎄'},{bg:G('#0c4a6e','#a16207'),hat:'⛄',ic:'❄️'},{bg:G('#7f1d1d','#065f46'),hat:'🦌',ic:'🎁'},{bg:G('#1e1b4b','#b91c1c'),hat:'🎄',ic:'⭐'}],
      ['Simbang Gabi is coming.','Finish the quotations, then the shopping.','Hamon and queso de bola soon.','The countdown to Noche Buena is on.'],
      {msg:function(d){ var n=days(d,xmas);
        if(n===1) return this.ic+' Noche Buena tonight — Merry Christmas Eve!';
        if(n===0) return this.ic+' Maligayang Pasko! Merry Christmas.';
        if(n<0) return '🎁 Happy Boxing Day — hope Santa approved your wish list.';
        return this.ic+' '+pl(n,'day')+' to Christmas. '+(n>60?early:this.line); }}));

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
