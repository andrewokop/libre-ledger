async(page)=>{
 if(!['localhost','127.0.0.1'].includes(new URL(page.url()).hostname))throw Error('Local server required');
 const date=new Date().toLocaleDateString('en-CA');
 const workspace={models:[{id:'m',name:'Проверка диалога',color:'#526df4',salePrice:0}],purchases:[{id:'p',modelId:'m',date,quantity:10,unitPrice:10,extra:0,sold:0,expiry:'2030-03'}],sales:[],writeOffs:[],settings:{version:0,storeName:'Мой магазин',homePage:'overview',primaryMetric:'profit',chartMonths:1,chartUnit:'rub',expiryWarningDays:60,lowStockThreshold:3,lotSelection:'fefo',costingMethod:'lot'}};
 await page.evaluate(w=>localStorage.setItem('libre-ledger-v3:guest',JSON.stringify({schemaVersion:3,base:{workspace:w,generation:'dialog-test',revision:0,appliedIds:[]},pending:[],recovery:null})),workspace);
 const checks=[];
 for(const font of ['normal','large','xlarge']) {
  await page.evaluate(font=>localStorage.setItem('libre-appearance:guest',JSON.stringify({font,reduced:true})),font);await page.reload();await page.locator('.v3-finance').waitFor();
  for(const width of [320,390,1440])for(const height of [480,844]){
   await page.setViewportSize({width,height});await page.getByRole('button',{name:'Продажа',exact:true}).click();const modal=page.locator('.modal-box');await modal.waitFor();await page.waitForTimeout(30);
   const b=await modal.boundingBox();if(b.y < -1 || b.y+b.height > height+1)throw Error(JSON.stringify({font,width,height,b}));
   const close=modal.getByRole('button',{name:'Закрыть',exact:true}).first(),c=await close.boundingBox();if(c.y < -1 || c.y+c.height > height+1)throw Error('Close hidden '+font+width+height);
   await close.click();await modal.waitFor({state:'hidden'});checks.push(`${font}-${width}-${height}`);
  }
 }
 await page.setViewportSize({width:390,height:844});await page.getByRole('navigation',{name:'Мобильная навигация'}).getByRole('button',{name:'Настройки',exact:true}).click();await page.getByRole('button',{name:'Войти в аккаунт',exact:true}).click();await page.locator('[name=email]').fill('wrong@example.invalid');await page.getByRole('button',{name:'Забыли пароль?',exact:true}).click();await page.locator('.form-error').waitFor();await page.keyboard.press('Tab');if(!await page.evaluate(()=>document.querySelector('.modal-box').contains(document.activeElement)))throw Error('Focus escaped error dialog');checks.push('Keyboard stays in dialog after error');await page.keyboard.press('Escape');return{passed:checks.length,checks};
}
