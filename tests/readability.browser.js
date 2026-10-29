async (page) => {
  if (!['localhost', '127.0.0.1'].includes(new URL(page.url()).hostname)) throw Error('Local server required')
  const now = new Date(), date = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`
  const settings = {version:1,storeName:'Мой магазин',homePage:'overview',primaryMetric:'profit',chartMonths:1,chartUnit:'rub',expiryWarningDays:60,lowStockThreshold:3,lotSelection:'fefo',costingMethod:'lot'}
  const workspace = {models:[{id:'m',name:'Очень длинное название модели для проверки переноса',color:'#526df4',version:1}],purchases:[{id:'p',modelId:'m',date,quantity:9999,unitPrice:60000000.55,extra:42,sold:0,version:1}],sales:[{id:'s',modelId:'m',date,quantity:8888,unitPrice:99999999.99,costBasis:0,allocations:[{purchaseId:'p',quantity:8888}],version:1}],writeOffs:[],settings}
  await page.evaluate(workspace => { localStorage.setItem('libre-ledger-v3:guest',JSON.stringify({schemaVersion:3,base:{workspace,generation:'visual-qa',revision:0,appliedIds:[]},pending:[],recovery:null})) }, workspace)
  const failures=[], checks=[]
  for (const font of ['normal','large','xlarge']) {
    await page.evaluate(font => localStorage.setItem('libre-appearance:guest',JSON.stringify({font,reduced:true})),font); await page.reload(); await page.locator('.v3-finance').waitFor()
    for (const width of [1920,1440,1024,768,430,390,360,320]) {
      await page.setViewportSize({width,height:900}); await page.evaluate(()=>document.fonts.ready); await page.waitForTimeout(250); await page.locator('.recharts-line').waitFor()
      const audit = await page.evaluate(() => {
        const issues=[]; if(document.documentElement.scrollWidth>innerWidth) issues.push(`overflow ${document.documentElement.scrollWidth}`)
        const canvas=document.createElement('canvas'); canvas.width=canvas.height=1; const ctx=canvas.getContext('2d',{willReadFrequently:true});
        const rgba=c=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=c;ctx.fillRect(0,0,1,1);const x=[...ctx.getImageData(0,0,1,1).data];return [x[0],x[1],x[2],x[3]/255]};
        const over=(f,b)=>f.slice(0,3).map((x,i)=>x*f[3]+b[i]*(1-f[3])).concat(1); const bg=e=>{if(!e)return [255,255,255,1];const c=rgba(getComputedStyle(e).backgroundColor);return c[3]===1?c:over(c,bg(e.parentElement))};
        const lum=c=>c.slice(0,3).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4}).reduce((s,x,i)=>s+x*[.2126,.7152,.0722][i],0)
        for(const el of document.querySelectorAll('.v3-overview *')) {const rect=el.getBoundingClientRect(), css=getComputedStyle(el); if(!rect.width||!rect.height||css.visibility==='hidden')continue; const text=[...el.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent.trim()).join(' ').trim(); if(text&&!el.closest('svg')) {const size=parseFloat(css.fontSize);if(size<16)issues.push(`font ${size}: ${text}`);const b=bg(el),f=over(rgba(css.color),b),ratio=(Math.max(lum(b),lum(f))+.05)/(Math.min(lum(b),lum(f))+.05);if(ratio<6.98)issues.push(`contrast ${ratio.toFixed(2)}: ${text}`)} if(el.matches('button')&&(rect.width<44||rect.height<44))issues.push(`touch ${rect.width}x${rect.height}: ${el.textContent.trim()}`); if(el.matches('.v3-metric strong,.v3-activity-row > strong')&&el.scrollWidth>el.clientWidth+2)issues.push(`clipped ${el.textContent}`) }
        return issues
      })
      checks.push(`${font}-${width}`); if(audit.length)failures.push({font,width,audit})
      if(font==='large' && [390,1440].includes(width)) await page.screenshot({path:`output/playwright/overview-v3-${width}.png`,fullPage:true})
    }
  }
  for(const font of ['normal','large','xlarge']) {
    await page.evaluate(font=>localStorage.setItem('libre-appearance:guest',JSON.stringify({font,reduced:true})),font);await page.reload();await page.locator('.v3-finance').waitFor();
    for(const width of [320,768,1440]) {
      await page.setViewportSize({width,height:900});
      const nav=page.getByRole('navigation',{name:width<=900?'Мобильная навигация':'Основная навигация'});
      for(const name of ['Склад','Операции','Настройки']) {
        await nav.getByRole('button',{name:name==='Склад'?/^Склад/:name,exact:name!=='Склад'}).click();
        await page.waitForTimeout(50);
        const layout=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
        checks.push(`${name}-${font}-${width}`);if(layout.scroll>width)failures.push({name,font,width,layout});
      }
      await nav.getByRole('button',{name:'Обзор',exact:true}).click();
    }
  }
  if(failures.length)throw Error(JSON.stringify(failures)); return {checks}
}
