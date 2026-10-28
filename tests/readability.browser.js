async (page) => {
  if (!['localhost','127.0.0.1'].includes(new URL(page.url()).hostname)) throw new Error('Run this scenario only against a local server.');
  await page.locator('.connection').filter({hasText:'На устройстве'}).waitFor();
  await page.emulateMedia({reducedMotion:'reduce'});
async function contrast(page) {
  const result = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    function rgba(color) { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data].map((x, i) => i === 3 ? x / 255 : x); }
    function over(fg, bg) { return fg.slice(0,3).map((x,i) => x * fg[3] + bg[i] * (1 - fg[3])).concat(1); }
    function background(el) { if (!el) return [255,255,255,1]; const color = rgba(getComputedStyle(el).backgroundColor); return color[3] === 1 ? color : over(color, background(el.parentElement)); }
    function luminance(rgb) { return rgb.slice(0,3).map(x => { x /= 255; return x <= .04045 ? x/12.92 : ((x+.055)/1.055)**2.4; }).reduce((sum,x,i) => sum + x*[.2126,.7152,.0722][i],0); }
    const contrast = [], small = [], touches = [];
    for (const el of document.querySelectorAll('body *')) {
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height || el.closest('[aria-hidden="true"],.recharts-tooltip-wrapper')) continue;
      const css = getComputedStyle(el);
      if (css.visibility === 'hidden' || Number(css.opacity) === 0) continue;
      const text = [...el.childNodes].filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent.trim()).join(' ').trim();
      if (text && !['STYLE','SCRIPT','OPTION'].includes(el.tagName)) {
        const bg = background(el), fg = over(rgba(el.closest('svg') ? css.fill : css.color), bg);
        const light = Math.max(luminance(bg), luminance(fg)), dark = Math.min(luminance(bg), luminance(fg));
        const ratio = (light+.05)/(dark+.05), size = parseFloat(css.fontSize);
        const large = size >= 24 || (size >= 18.66 && Number(css.fontWeight) >= 600);
        if (ratio < 7 - .02) contrast.push({ selector: el.className, text: text.slice(0,70), ratio: +ratio.toFixed(2), color: css.color, background: bg });
        if (size < 14) small.push({ selector: el.className, text, size });
      }
      if (['BUTTON','A'].includes(el.tagName) && rect.right > 0 && rect.left < innerWidth && !el.classList.contains('skip-link') && (rect.width < 44 || rect.height < 44)) touches.push({ selector: el.className, text: el.textContent.trim().slice(0,40), width: rect.width, height: rect.height });
    }
    return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, contrast, small, touches };
  });
  return result;
}

  const checks=[]; const failures=[];
  const date=new Date().toLocaleDateString('en-CA');
  const workspace={models:[{id:'m1',name:'Мой товар — большая упаковка для особого заказа',color:'#526df4',version:1},{id:'m2',name:'Я'.repeat(120),color:'#a493eb',version:1}],purchases:[{id:'p1',modelId:'m1',date,quantity:9999,unitPrice:60000000.55,extra:42,sold:0,version:1},{id:'p2',modelId:'m2',date,quantity:20,unitPrice:1570,extra:200,sold:0,version:1}],sales:[{id:'s1',modelId:'m1',date,quantity:8888,unitPrice:99999999.99,costBasis:0,note:'С'.repeat(500),version:1}]};
  await page.keyboard.press('Escape');
  await page.evaluate(workspace=>{localStorage.clear();localStorage.setItem('libre-ledger-v2:guest',JSON.stringify({base:{workspace,generation:'visual-audit',revision:0,appliedIds:[]},pending:[],recovery:null}))},workspace);
  await page.reload(); await page.locator('.finance-stage').waitFor();
  const nav=()=>page.getByRole('navigation',{name:innerNav}); let innerNav='Основная навигация';
  async function audit(label) {
    await page.evaluate(()=>document.fonts.ready);
    const result=await contrast(page); checks.push({label,...result});
    if(result.scrollWidth>result.width||result.contrast.length||result.small.length||result.touches.length)failures.push({label,...result});
    const clipped=await page.evaluate(()=>[...document.querySelectorAll('.finance-stage strong,.chart-totals strong,.stock-total strong,.inventory-summary strong,.activity-amount,.lot-card-bottom b,.history-positive,.history-negative')].filter(el=>el.getBoundingClientRect().width&&el.scrollWidth>el.clientWidth+2).map(el=>({class:el.className,text:el.textContent,width:el.clientWidth,scroll:el.scrollWidth})));
    if(clipped.length) failures.push({label,clipped});
  }
  for(const width of [1440,1024,768,430,390,360,320]) {
    await page.setViewportSize({width,height:900}); innerNav=width<=900?'Мобильная навигация':'Основная навигация';
    for(const [name,label] of [['Обзор','overview'],['Склад','inventory'],['Операции','history'],['Настройки','settings']]) {
      await nav().getByRole('button',{name:name==='Склад'?/^Склад/:name,exact:name!=='Склад'}).click(); await audit(`${label}-${width}`);
      if(name==='Склад') {await page.getByRole('button',{name:'Модели 2',exact:true}).click();await audit(`catalog-${width}`);}
      if(width===390&&name==='Обзор')await page.screenshot({path:'output/playwright/overview-large-mobile.png',fullPage:true});
      if(width===1440&&name==='Обзор')await page.screenshot({path:'output/playwright/overview-large-desktop.png',fullPage:true});
    }
  }
  await page.setViewportSize({width:390,height:844}); innerNav='Мобильная навигация';
  await nav().getByRole('button',{name:'Операции',exact:true}).click();
  await page.getByRole('button',{name:'Изменить продажу '+workspace.models[0].name,exact:true}).click();await audit('edit-form-390');
  await page.locator('.modal-box').getByRole('button',{name:'Удалить',exact:true}).click();await audit('delete-confirm-390');
  await page.keyboard.press('Escape');
  await nav().getByRole('button',{name:'Настройки',exact:true}).click();
  await page.getByRole('button',{name:'Войти в аккаунт',exact:true}).click(); await audit('login-390');
  await page.keyboard.press('Escape');
  if(failures.length) throw new Error(JSON.stringify(failures));
  return {checks:checks.length,failures};
}
