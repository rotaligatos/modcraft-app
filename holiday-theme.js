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

  // What each occasion is decorated with: a garland of its icons and the colours of its lights.
  // Rommel, 2026-11-27: the first version was "so boring… not even noticeable" — so the strip is
  // taller and moves, a row of lights twinkles under it, Lami's outfit bounces, and the first open
  // of the day gets a short shower of icons. Anyone with "reduce motion" set gets it all still.
  var DECO={
    christmas:{g:['🎄','❄️','🎁','⭐','🔔','🍬','☃️'],lights:['#ef4444','#22c55e','#facc15','#3b82f6','#f97316']},
    newyear:{g:['🎆','🎉','🥂','✨','🎊','🎇'],lights:['#facc15','#f472b6','#60a5fa','#fbbf24','#a78bfa']},
    kings:{g:['👑','⭐','🎁','🐫','✨'],lights:['#facc15','#fbbf24','#f59e0b']},
    bday:{g:['🎈','🎂','🎉','🧁','🎁','🥳'],lights:['#f472b6','#a78bfa','#38bdf8','#facc15']},
    valentine:{g:['💘','🌹','💕','💌','💝'],lights:['#f43f5e','#ec4899','#fda4af']},
    cny:{g:['🧧','🏮','🐉','🎊','🍊'],lights:['#ef4444','#facc15','#f59e0b']},
    fools:{g:['🃏','🤡','🙃','🎭','😜'],lights:['#22c55e','#facc15','#3b82f6','#ec4899']},
    holyweek:{g:['🕊️'],lights:[]},
    easter:{g:['🐣','🌷','🥚','🐰','🌸'],lights:['#f9a8d4','#a5f3fc','#fde68a','#c4b5fd']},
    independence:{g:['☀️','⭐','🌟','🎆'],lights:['#3b82f6','#ef4444','#facc15','#ffffff']},
    heroes:{g:['🎖️','🏅','🫡','⭐'],lights:['#3b82f6','#ef4444','#facc15']},
    halloween:{g:['🎃','🦇','👻','🕸️','🕷️','🍬'],lights:['#f97316','#a855f7','#84cc16']},
    souls:{g:['🕯️','🌼'],lights:[]},
    thanks:{g:['🍂','🦃','🍁','🥧','🌽'],lights:['#f97316','#b45309','#facc15']},
    blackfri:{g:['🛍️','🏷️','💸','🛒','🔥'],lights:['#facc15','#ef4444','#ffffff']}
  };
  var _styled=false;
  function style(){
    if(_styled) return; _styled=true;
    var css='@keyframes holShift{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}'
      +'@keyframes holSlide{from{transform:translateX(0)}to{transform:translateX(-50%)}}'
      +'@keyframes holBlink{0%,100%{opacity:1;filter:brightness(1.25)}50%{opacity:.35;filter:brightness(.8)}}'
      +'@keyframes holBob{0%,100%{transform:translateX(-50%) rotate(-14deg) translateY(0)}50%{transform:translateX(-50%) rotate(-6deg) translateY(-3px)}}'
      +'@keyframes holFall{0%{transform:translateY(-40px) rotate(0)}100%{transform:translateY(105vh) rotate(360deg)}}'
      +'@keyframes holPop{0%{transform:scale(.85);opacity:0}100%{transform:scale(1);opacity:1}}'
      +'#hol-strip{background-size:220% 220%!important;animation:holShift 10s ease infinite;overflow:hidden}'
      +'#hol-strip .hol-track{flex:1 1 0;min-width:0;overflow:hidden;display:flex;align-items:center;white-space:nowrap;font-size:17px;opacity:.95;pointer-events:none;-webkit-mask-image:linear-gradient(90deg,transparent,#000 8%,#000 92%,transparent);mask-image:linear-gradient(90deg,transparent,#000 8%,#000 92%,transparent)}'
      +'#hol-strip .hol-track span{display:inline-block;animation:holSlide 40s linear infinite;letter-spacing:10px}'
      +'#hol-strip .hol-track.r span{animation-direction:reverse}'
      +'#hol-strip .hol-pill{flex:0 1 auto;margin:0 12px;position:relative;z-index:1;background:rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.35);border-radius:999px;padding:5px 16px;'
        +'box-shadow:0 2px 10px rgba(0,0,0,.25);animation:holPop .5s ease-out;max-width:70%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
      +'#hol-strip .hol-lights{position:absolute;left:0;right:0;bottom:0;height:6px;display:flex;justify-content:space-around;align-items:center;pointer-events:none}'
      +'#hol-strip .hol-lights i{width:7px;height:7px;border-radius:50%;display:block;box-shadow:0 0 6px currentColor;animation:holBlink 1.6s ease-in-out infinite}'
      +'#hol-hat{animation:holBob 2.4s ease-in-out infinite}'
      +'.hol-drop{position:fixed;top:0;z-index:2147483000;pointer-events:none;animation:holFall linear forwards;will-change:transform}'
      +'@media (prefers-reduced-motion:reduce){#hol-strip,#hol-strip *,#hol-hat{animation:none!important}.hol-drop{display:none!important}}'
      +'@media (max-width:700px){#hol-strip .hol-track{display:none}}';
    var el=document.createElement('style'); el.id='hol-style'; el.textContent=css; (document.head||document.documentElement).appendChild(el);
  }
  function garland(icons,n){ var o=''; for(var i=0;i<n;i++) o+=icons[i%icons.length]; return o+o; }
  function shower(h,now){
    var key='mc_hol_shower_'+h.k+'_'+now.toDateString();
    if(ls(key)) return; ls(key,'1');
    if(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var icons=(DECO[h.k]&&DECO[h.k].g)||[h.ic]; if(!icons.length) return;
    for(var i=0;i<22;i++)(function(i){
      var d=document.createElement('div'); d.className='hol-drop'; d.textContent=icons[i%icons.length];
      var dur=2.6+Math.random()*2.2;
      d.style.cssText='left:'+(Math.random()*96)+'vw;font-size:'+(18+Math.random()*16)+'px;animation-duration:'+dur+'s;animation-delay:'+(Math.random()*1.2)+'s';
      document.body.appendChild(d); setTimeout(function(){ if(d.parentNode) d.parentNode.removeChild(d); },(dur+1.5)*1000);
    })(i);
  }

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
      style();
      var dc=DECO[h.k]||{g:[h.ic],lights:[]}, quiet=!dc.lights.length;
      strip.style.cssText='display:flex;align-items:center;justify-content:center;min-height:'+(quiet?30:40)+'px;padding:4px 44px '+(quiet?4:10)+'px;box-sizing:border-box;'
        +'background:'+h.bg+';color:#fff;font:600 13px/1.3 system-ui,-apple-system,"Segoe UI",sans-serif;position:relative;'
        +'text-shadow:0 1px 2px rgba(0,0,0,.35);text-align:center;'+(quiet?'animation:none;':'')+(opts.stripStyle||'');
      var lights='';
      if(dc.lights.length){ for(var li=0;li<40;li++) lights+='<i style="color:'+dc.lights[li%dc.lights.length]+';background:'+dc.lights[li%dc.lights.length]+';animation-delay:'+((li%5)*0.3)+'s"></i>'; }
      strip.innerHTML=(quiet?'':'<div class="hol-track"><span>'+garland(dc.g,24)+'</span></div>')
        +'<span class="hol-pill" id="hol-msg">'+esc(h.msg(now))+'</span>'
        +(quiet?'':'<div class="hol-track r"><span>'+garland(dc.g,24)+'</span></div>')
        +(lights?'<div class="hol-lights">'+lights+'</div>':'')
        +'<button type="button" id="hol-x" title="Hide for today" aria-label="Hide for today" '
        +'style="position:absolute;right:10px;top:50%;transform:translateY(-50%);background:transparent;border:none;color:#fff;opacity:.85;cursor:pointer;font-size:15px;line-height:1;padding:2px 4px">&times;</button>';
      document.getElementById('hol-x').onclick=function(){ hideToday(); };
    } else { strip.style.display='none'; strip.innerHTML=''; }
    var host=find(opts.mascot), hat=document.getElementById('hol-hat');
    if(host&&!hat){ hat=document.createElement('div'); hat.id='hol-hat';
      hat.style.cssText='position:absolute;top:-14px;left:46%;transform:translateX(-50%) rotate(-14deg);font-size:28px;line-height:1;pointer-events:none;user-select:none;filter:drop-shadow(0 2px 2px rgba(0,0,0,.3));'+(opts.hatStyle||'');
      host.appendChild(hat); }
    if(hat){ hat.textContent=(h&&h.hat)||''; hat.style.display=(h&&h.hat)?'':'none'; }
    if(h&&!hidden&&!nowOverride&&DECO[h.k]&&DECO[h.k].lights.length){ try{ shower(h,now); }catch(e){} }
    clearInterval(tick); tick=null;
    if(h&&h.tick&&!hidden&&!nowOverride&&now.getMonth()===11&&now.getDate()===31)
      tick=setInterval(function(){ var m=document.getElementById('hol-msg'); if(m&&cur) m.textContent=cur.msg(new Date()); else clearInterval(tick); },1000);
    if(!timer&&!nowOverride) timer=setInterval(function(){ apply(); },10*60*1000);
    try{ setFrame(h); }catch(e){}
    if(typeof opts.onChange==='function'){ try{ opts.onChange(h); }catch(e){} }
    return h;
  }
  // Photo frames (Rommel, 2026-11-28): a ring in the occasion's colours round every profile photo,
  // with the occasion's emoji on the corner (and a second one on a big photo). An app wraps a photo
  // with HolidayTheme.frame(html,size); with no occasion, or the theme switched off, the wrapper is
  // plain and the photo looks exactly as before. The outer size never changes, so nothing reflows.
  // Follows the person's own switch-off, not the strip's "hide for today".
  function frameStyle(){
    if(document.getElementById('hol-frame-style')) return;
    var css='.hol-frame{display:inline-flex;align-items:center;justify-content:center;border-radius:50%;flex:none;vertical-align:middle;position:relative;box-sizing:border-box}'
      +'html[data-hol-frame] .hol-frame{background:var(--hol-ring);padding:var(--hol-w)}'
      +'html[data-hol-frame] .hol-frame>img,html[data-hol-frame] .hol-frame>span,html[data-hol-frame] .hol-frame>div{width:calc(var(--hol-s) - 2*var(--hol-w))!important;height:calc(var(--hol-s) - 2*var(--hol-w))!important;margin:0!important;box-shadow:0 0 0 1.5px rgba(255,255,255,.85)}'
      +'html[data-hol-frame] .hol-frame::after{content:var(--hol-badge);position:absolute;right:calc(var(--hol-s) * -0.12);top:calc(var(--hol-s) * -0.16);font-size:calc(var(--hol-s) * 0.42);line-height:1;filter:drop-shadow(0 1px 1px rgba(0,0,0,.35));pointer-events:none;transform:rotate(12deg)}'
      +'html[data-hol-frame] .hol-frame.big::before{content:var(--hol-badge2);position:absolute;left:calc(var(--hol-s) * -0.06);bottom:calc(var(--hol-s) * -0.06);font-size:calc(var(--hol-s) * 0.26);line-height:1;filter:drop-shadow(0 1px 1px rgba(0,0,0,.35));pointer-events:none;z-index:1}'
      +'html[data-hol-frame] .hol-frame.sm::after{display:none}';
    var el=document.createElement('style'); el.id='hol-frame-style'; el.textContent=css; (document.head||document.documentElement).appendChild(el);
  }
  function setFrame(h){
    var root=document.documentElement; frameStyle();
    if(!h){ root.removeAttribute('data-hol-frame'); ['--hol-ring','--hol-badge','--hol-badge2'].forEach(function(v){ root.style.removeProperty(v); }); return; }
    var dc=DECO[h.k]||{g:[h.ic],lights:[]};
    var cols=(dc.lights&&dc.lights.length)?dc.lights.slice():(String(h.bg).match(/#[0-9a-fA-F]{3,8}/g)||['#64748b']);
    var ring=cols.length>1?'conic-gradient('+cols.concat([cols[0]]).join(',')+')':cols[0];
    var g=dc.g&&dc.g.length?dc.g:[h.ic||''];
    var b1=h.hat||g[0]||'', b2=g[1]||g[0]||'';
    var q=function(x){ return '"'+String(x).replace(/["\\]/g,'')+'"'; };
    root.setAttribute('data-hol-frame',h.k);
    root.style.setProperty('--hol-ring',ring);
    root.style.setProperty('--hol-badge',q(b1));
    root.style.setProperty('--hol-badge2',q(b2));
  }
  function frame(html,size){
    size=+size||24;
    var w=Math.max(2,Math.round(size*0.06));
    return '<span class="hol-frame'+(size<22?' sm':'')+(size>=80?' big':'')+'" style="--hol-s:'+size+'px;--hol-w:'+w+'px;width:'+size+'px;height:'+size+'px">'+html+'</span>';
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
    mount:mount, apply:apply, hideToday:hideToday, occasionFor:occasionFor, current:function(){ return cur; }, frame:frame,
    isOffForMe:function(){ return ls('mc_holiday_off')==='1'; },
    setForMe:function(on){ ls('mc_holiday_off',on?null:'1'); apply(); }
  };
})();
