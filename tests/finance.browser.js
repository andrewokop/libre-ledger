async (page) => {
  if(!['localhost','127.0.0.1'].includes(new URL(page.url()).hostname))throw Error('Local server required');
  await page.locator('.connection').filter({hasText:'На устройстве'}).waitFor();
  await page.keyboard.press('Escape');await page.emulateMedia({reducedMotion:'reduce'});
  const checks=[];const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const check=(value,label)=>{if(!value)throw Error(label);checks.push(label)};
  const now=new Date();
  const date=(offset,day)=>{const d=new Date(now.getFullYear(),now.getMonth()+offset,Math.min(day,offset===0?now.getDate():28),12);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
  const sale=(id,offset,day,quantity,unitPrice)=>({id,modelId:'m1',date:date(offset,day),quantity,unitPrice,costBasis:0,version:1});
  const workspace={models:[{id:'m1',name:'Моя модель',color:'#526df4',version:1},{id:'m2',name:'Старый цвет',color:'#75b7ee',version:1}],purchases:[{id:'p1',modelId:'m1',date:date(-5,1),quantity:100,unitPrice:4200,extra:1000,sold:0,version:1},{id:'p2',modelId:'m1',date:date(0,3),quantity:5,unitPrice:4000,extra:250,sold:0,version:1}],sales:[sale('s1',0,8,2,6500),sale('s2',0,20,1,6800),sale('s3',-1,10,3,6600),sale('s4',-2,10,3,6000),sale('s5',-3,10,2,6300)]};
  await page.evaluate(workspace=>{localStorage.clear();localStorage.setItem('libre-ledger-v2:guest',JSON.stringify({base:{workspace,generation:'finance-qa',revision:0,appliedIds:[]},pending:[],recovery:null}))},workspace);
  await page.reload();await page.locator('.finance-stage').waitFor();
  check(JSON.stringify(await page.locator('.finance-stage .finance-label').allTextContents())===JSON.stringify(['Оборот продаж','Прибыль от продаж','Стоимость остатков']),'Financial metrics follow the intended priority');
  const amount=async(index)=>Number((await page.locator('.chart-totals strong').nth(index).innerText()).replace(/[^\d,.-]/g,'').replace(',','.'));
  for(const [label,expected,expenses] of [['1 месяц',19800,20250],['3 месяца',57600,20250],['6 месяцев',70200,441250]]) {
    const button=page.getByRole('button',{name:label,exact:true});await button.click();
    check(await button.getAttribute('aria-pressed')==='true',`${label} is selected`);
    check(await amount(0)===expected,`${label}: sales sum is correct`);check(await amount(1)===expenses,`${label}: purchases include delivery`);
    await page.locator('.recharts-bar').first().waitFor();check(await page.locator('.recharts-bar').count()===2,`${label}: both values use comparable bars`);
  }
  await page.getByText('Точные суммы по месяцам',{exact:true}).click();
  check(await page.locator('.flow-table tbody tr').count()===6,'Exact monthly data can be opened without a tooltip');
  for(const width of [1440,1024,768,430,390,360,320]) {
    await page.setViewportSize({width,height:900});
    await page.waitForFunction(()=>Math.abs(document.querySelector('.chart-wrap').clientWidth-document.querySelector('.recharts-surface').clientWidth)<2);
    check(await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth),`Expanded six-month chart fits ${width}px`);
    const overlaps=await page.locator('.recharts-xAxis .recharts-cartesian-axis-tick').evaluateAll(nodes=>{const boxes=nodes.map(n=>n.getBoundingClientRect());return boxes.some((b,i)=>i&&b.left<boxes[i-1].right-1)});
    check(!overlaps,`Month labels remain separate at ${width}px`);
    if(width===1440)await page.screenshot({path:'output/playwright/finance-desktop.png',fullPage:true});
    if(width===390)await page.screenshot({path:'output/playwright/finance-mobile.png',fullPage:true});
  }
  await page.setViewportSize({width:390,height:844});
  const nav=page.getByRole('navigation',{name:'Мобильная навигация'});await nav.getByRole('button',{name:'Склад',exact:true}).click();
  await page.getByRole('button',{name:'Модели 2',exact:true}).click();await page.getByRole('button',{name:'Изменить',exact:true}).first().click();
  check(await page.getByRole('radio').count()===8,'Eight distinct named colors are visible');
  await page.getByRole('radio',{name:'Красный',exact:true}).check();
  await page.locator('.modal-box').getByRole('button',{name:'Сохранить изменения',exact:true}).click();
  const saved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('libre-ledger-v2:guest')).base.workspace);
  check((await saved()).models[0].color==='#c83e48','Selected palette color is saved');
  await page.getByRole('button',{name:'Изменить',exact:true}).nth(1).click();
  check(await page.getByRole('radio',{name:'Текущий цвет',exact:true}).isChecked(),'Legacy model color is preserved and remains selectable');
  for(const width of [390,360,320]) {await page.setViewportSize({width,height:844});check(await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth),`Palette fits ${width}px`)}
  await page.keyboard.press('Escape');await page.reload();
  check((await saved()).models[0].color==='#c83e48','Color choice survives reload');
  await page.clock.setFixedTime(new Date(now.getFullYear(),now.getMonth()+1,0,12));
  await page.reload();await page.locator('.recharts-bar').first().waitFor();
  await page.waitForFunction(()=>Math.abs(document.querySelector('.chart-wrap').clientWidth-document.querySelector('.recharts-surface').clientWidth)<2);
  const weekOverlap=await page.locator('.recharts-xAxis .recharts-cartesian-axis-tick').evaluateAll(nodes=>{const boxes=nodes.map(n=>n.getBoundingClientRect());return boxes.some((b,i)=>i&&b.left<boxes[i-1].right-1)});
  check(!weekOverlap,'End-of-month weekly labels fit a 320px screen');
  check(errors.length===0,`No browser exceptions: ${JSON.stringify(errors)}`);
  return {passed:checks.length,checks};
}
