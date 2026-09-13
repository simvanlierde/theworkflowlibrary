(async function(){
  const res = await fetch('/catalog.json'); const rows = await res.json();
  const tb = document.querySelector('#tbl tbody'), q = document.getElementById('q'), only = document.getElementById('onlyfull'), count = document.getElementById('count');
  let cat = new URLSearchParams(location.hash.split('?')[1]||'').get('cat') || '';
  const chips = [...document.querySelectorAll('.chip')];
  function setCat(c){cat=c;chips.forEach(x=>x.classList.toggle('active',x.dataset.cat===c));render();}
  chips.forEach(x=>x.addEventListener('click',()=>setCat(x.dataset.cat)));
  document.querySelectorAll('.card').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();const c=new URLSearchParams(a.getAttribute('href').split('?')[1]).get('cat');setCat(c);document.getElementById('library').scrollIntoView({behavior:'smooth'});}));
  function render(){
    const t = q.value.trim().toLowerCase();
    const list = rows.filter(r => (!cat || r.category===cat) && (!only.checked || r.status!=='planned') && (!t || (r.title+' '+r.id+' '+r.cat_label+' '+r.object).toLowerCase().includes(t)));
    tb.innerHTML = list.map(r => {
      const link = r.status==='planned' ? r.title : `<a href="/w/${r.id}.html">${r.title}</a>`;
      const st = r.status==='planned' ? ((r.publish_on && /^\d{4}-/.test(r.publish_on)) ? ('Fri ' + r.publish_on.slice(5).replace('-','/')) : 'Coming') : {free:'Free',full:'Full spec'}[r.status];
      const lvl = {1:'Simple',2:'Intermediate',3:'Advanced'}[r.difficulty]||'';
      return `<tr class="${r.status}"><td>${link}<br><span class="muted small">${r.id}</span></td><td>${r.cat_label}</td><td>${r.object}</td><td>${r.tier_label}</td><td>${lvl}</td><td><span class="badge ${r.status}">${st}</span></td></tr>`;
    }).join('');
    count.textContent = `${list.length} workflows shown` + (only.checked ? ` (untick "Full specs only" to see all ${rows.length} planned)` : ` of ${rows.length}`);
  }
  // hover preview (desktop only): shows the share image of the spec next to the row
  const pv = document.createElement('div'); pv.className='rowpv'; pv.innerHTML='<img alt="">'; document.body.appendChild(pv);
  const fine = matchMedia('(pointer:fine)').matches;
  tb.addEventListener('mouseover', e => { if(!fine) return; const tr = e.target.closest('tr'); if(!tr || tr.classList.contains('planned')) { pv.classList.remove('on'); return; } const id = tr.querySelector('.small')?.textContent.trim(); if(!id) return; pv.querySelector('img').src = '/og/' + id + '.png'; pv.classList.add('on'); });
  tb.addEventListener('mousemove', e => { if(!pv.classList.contains('on')) return; const w = 480, h = 252; let x = e.clientX + 24, y = e.clientY + 16; if (x + w > innerWidth - 12) x = e.clientX - w - 24; if (y + h > innerHeight - 12) y = innerHeight - h - 12; pv.style.transform = `translate(${x}px, ${y}px)`; });
  tb.addEventListener('mouseleave', () => pv.classList.remove('on'));
  q.addEventListener('input',render); only.addEventListener('change',render);
  if (cat) setCat(cat); else render();
})();
